"""Transfer worker: drains the hot-tier upload queue into the cold tier.

Runs as its own process (``tessera worker``) so a slow Drive upload never blocks
an API request. Jobs are plain JSON files, so a crash or restart loses nothing:
whatever is on disk is retried, with exponential backoff.

Google Drive allows roughly 750 GiB of uploads per account per day. The worker
keeps a per-day ledger and pauses when the configured cap is reached instead of
hammering the API and failing every job.
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from mddatalake.storage.tiered import TieredBackend

logger = logging.getLogger(__name__)

LOCK_STALE_SECONDS = 3600
BACKOFF_BASE_SECONDS = 60
BACKOFF_MAX_SECONDS = 3600


class TransferWorker:
    """Push queued artifacts from the hot cache to the cold tier."""

    def __init__(
        self,
        backend: TieredBackend,
        *,
        max_gb_per_day: float | None = 700.0,
        poll_interval: float = 5.0,
        max_attempts: int = 5,
    ) -> None:
        self.backend = backend
        self.max_bytes_per_day = (
            int(max_gb_per_day * 1_000_000_000) if max_gb_per_day else None
        )
        self.poll_interval = poll_interval
        self.max_attempts = max_attempts

    # ------------------------------------------------------------------ ledger

    @property
    def ledger_path(self) -> Path:
        return self.backend.hot_root / ".quota.json"

    @property
    def lock_path(self) -> Path:
        return self.backend.queue_dir / ".lock"

    @staticmethod
    def _today() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def _read_ledger(self) -> dict[str, Any]:
        try:
            payload = json.loads(self.ledger_path.read_text())
        except (OSError, ValueError):
            return {"date": self._today(), "bytes": 0}
        if payload.get("date") != self._today():
            return {"date": self._today(), "bytes": 0}
        return payload

    def _write_ledger(self, payload: dict[str, Any]) -> None:
        tmp = self.ledger_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload))
        os.replace(tmp, self.ledger_path)

    def bytes_left_today(self) -> int | None:
        """Bytes still allowed today, or None when uncapped."""
        if self.max_bytes_per_day is None:
            return None
        return max(0, self.max_bytes_per_day - int(self._read_ledger()["bytes"]))

    # -------------------------------------------------------------------- lock

    def _acquire_lock(self) -> bool:
        try:
            fd = os.open(self.lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return True
        except FileExistsError:
            try:
                age = time.time() - self.lock_path.stat().st_mtime
            except OSError:
                return False
            if age > LOCK_STALE_SECONDS:
                logger.warning("Removing stale transfer lock (%ds old)", int(age))
                self.lock_path.unlink(missing_ok=True)
                return self._acquire_lock()
            return False

    def _release_lock(self) -> None:
        self.lock_path.unlink(missing_ok=True)

    # ------------------------------------------------------------------- jobs

    def _failed_dir(self) -> Path:
        path = self.backend.queue_dir / ".failed"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _due_jobs(self) -> list[tuple[Path, dict[str, Any]]]:
        now = time.time()
        due: list[tuple[Path, dict[str, Any]]] = []
        for job_file in self.backend._job_files():
            try:
                payload = json.loads(job_file.read_text())
            except (OSError, ValueError):
                continue
            if float(payload.get("next_attempt", 0)) <= now:
                due.append((job_file, payload))
        due.sort(key=lambda item: float(item[1].get("created_at", 0)))
        return due

    def _fail(self, job_file: Path, payload: dict[str, Any], error: str) -> None:
        payload["attempts"] = int(payload.get("attempts", 0)) + 1
        payload["last_error"] = error[:1000]

        if payload["attempts"] >= self.max_attempts:
            target = self._failed_dir() / job_file.name
            payload["failed_at"] = time.time()
            target.write_text(json.dumps(payload))
            job_file.unlink(missing_ok=True)
            logger.error(
                "Transfer %s failed permanently after %d attempts: %s",
                payload.get("key"),
                payload["attempts"],
                error,
            )
            return

        delay = min(BACKOFF_MAX_SECONDS, BACKOFF_BASE_SECONDS * 2 ** payload["attempts"])
        payload["next_attempt"] = time.time() + delay
        tmp = job_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload))
        os.replace(tmp, job_file)
        logger.warning(
            "Transfer %s failed (attempt %d), retrying in %ds: %s",
            payload.get("key"),
            payload["attempts"],
            delay,
            error,
        )

    # --------------------------------------------------------------- processing

    async def run_once(self) -> int:
        """Process every due job. Returns the number of successful transfers."""
        if not self._acquire_lock():
            logger.debug("Another transfer worker holds the lock")
            return 0

        processed = 0
        try:
            for job_file, payload in self._due_jobs():
                key = payload.get("key", "")
                src = Path(payload.get("src", ""))

                if not key:
                    self._fail(job_file, payload, "job has no key")
                    continue
                if not src.exists():
                    self._fail(job_file, payload, f"hot copy missing: {src}")
                    continue

                size = int(payload.get("size", 0))
                left = self.bytes_left_today()
                if left is not None and size > left:
                    logger.warning(
                        "Daily upload cap reached (%d bytes left, next job %d bytes); "
                        "pausing until a new UTC day",
                        left,
                        size,
                    )
                    break

                try:
                    await self.backend.cold.upload(
                        src, key, payload.get("checksum")
                    )
                except Exception as e:  # noqa: BLE001 - worker must not die on one job
                    self._fail(job_file, payload, str(e))
                    continue

                job_file.unlink(missing_ok=True)
                ledger = self._read_ledger()
                ledger["bytes"] = int(ledger["bytes"]) + size
                self._write_ledger(ledger)

                if not self.backend.keep_hot:
                    src.unlink(missing_ok=True)

                processed += 1
                logger.info("Uploaded %s (%d bytes)", key, size)
        finally:
            self._release_lock()

        return processed

    async def run_forever(self) -> None:
        """Process the queue until cancelled."""
        import asyncio

        logger.info(
            "Transfer worker started: hot=%s cap=%s GB/day",
            self.backend.hot_root,
            self.max_bytes_per_day / 1e9 if self.max_bytes_per_day else "none",
        )
        while True:
            try:
                await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                logger.exception("Transfer worker loop error: %s", e)
            await asyncio.sleep(self.poll_interval)
