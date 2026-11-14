"""Two-tier storage: a bounded local hot cache in front of a cold remote.

Writes land on local disk first, so ingestion never waits for a multi-hour
upload. With ``defer_upload`` enabled a job is queued for the transfer worker;
otherwise the write is pushed synchronously.

Reads are served from the hot tier when the bytes are still there, and hydrated
from the cold tier when they are not. The hot tier is bounded and evicted LRU,
but anything with a pending transfer job is never evicted.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, BinaryIO

from mddatalake.core.exceptions import StorageError
from mddatalake.storage.backend import StorageBackend
from mddatalake.utils.checksum import compute_checksum

CHUNK_SIZE = 8 * 1024 * 1024
QUEUE_DIRNAME = ".queue"
FAILED_DIRNAME = ".failed"


class TieredBackend(StorageBackend):
    """Hot local cache in front of a cold :class:`StorageBackend`."""

    def __init__(
        self,
        hot_root: str | Path,
        cold: StorageBackend,
        *,
        max_bytes: int,
        defer_upload: bool = True,
        keep_hot: bool = True,
        min_free_bytes: int = 2_000_000_000,
    ) -> None:
        self.hot_root = Path(hot_root)
        self.hot_root.mkdir(parents=True, exist_ok=True)
        self.cold = cold
        self.max_bytes = max_bytes
        self.defer_upload = defer_upload
        self.keep_hot = keep_hot
        self.min_free_bytes = min_free_bytes
        self.queue_dir.mkdir(parents=True, exist_ok=True)
        (self.queue_dir / FAILED_DIRNAME).mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ paths

    @property
    def queue_dir(self) -> Path:
        return self.hot_root / QUEUE_DIRNAME

    def hot_path(self, storage_key: str) -> Path:
        return self.hot_root / storage_key.lstrip("/")

    def local_path(self, storage_key: str) -> Path | None:
        """Return the hot copy of a key, or None when it is not cached."""
        path = self.hot_path(storage_key)
        if path.is_file():
            return path
        return None

    # ---------------------------------------------------------------- helpers

    def _job_files(self) -> list[Path]:
        return sorted(
            (
                p
                for p in self.queue_dir.glob("*.json")
                if p.is_file()
            ),
            key=lambda p: p.stat().st_mtime,
        )

    def pending_keys(self) -> set[str]:
        """Keys that are queued for upload but not yet on the cold tier."""
        keys: set[str] = set()
        for job in self._job_files():
            try:
                keys.add(json.loads(job.read_text())["key"])
            except (OSError, ValueError, KeyError):
                continue
        return keys

    def pending_bytes(self) -> int:
        total = 0
        for job in self._job_files():
            try:
                total += int(json.loads(job.read_text()).get("size", 0))
            except (OSError, ValueError):
                continue
        return total

    def _enqueue(self, key: str, src: Path, checksum: str | None, size: int) -> Path:
        """Write a transfer job atomically into the queue."""
        job_id = uuid.uuid4().hex
        payload = {
            "key": key,
            "src": str(src),
            "size": size,
            "checksum": checksum,
            "created_at": time.time(),
            "attempts": 0,
            "next_attempt": 0,
            "last_error": None,
        }
        final = self.queue_dir / f"{job_id}.json"
        tmp = self.queue_dir / f".{job_id}.tmp"
        tmp.write_text(json.dumps(payload))
        os.replace(tmp, final)
        return final

    def _drop_jobs_for(self, key: str) -> None:
        for job in self._job_files():
            try:
                if json.loads(job.read_text()).get("key") == key:
                    job.unlink(missing_ok=True)
            except (OSError, ValueError):
                continue

    def _iter_hot_files(self):
        for path in self.hot_root.rglob("*"):
            if not path.is_file():
                continue
            if QUEUE_DIRNAME in path.parts or FAILED_DIRNAME in path.parts:
                continue
            yield path

    def evict_if_needed(self, required_bytes: int = 0) -> int:
        """Evict least-recently-used hot files until the cache fits.

        Files with a pending upload job are never evicted: they are the only
        copy of those bytes until the worker pushes them.
        """
        pending = self.pending_keys()
        usage = sum(p.stat().st_size for p in self._iter_hot_files())
        target = self.max_bytes - required_bytes
        if usage <= target:
            return 0

        candidates = []
        for path in self._iter_hot_files():
            key = str(path.relative_to(self.hot_root))
            if key in pending:
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            candidates.append((max(stat.st_atime, stat.st_mtime), stat.st_size, path))

        candidates.sort(key=lambda item: item[0])

        freed = 0
        for _, size, path in candidates:
            if usage - freed <= target:
                break
            try:
                path.unlink()
                freed += size
            except OSError:
                continue

        return freed

    # ------------------------------------------------------------ StorageBackend

    async def upload(
        self, file_path: Path, storage_key: str, checksum: str | None = None
    ) -> str:
        """Copy a file into the hot tier and schedule its cold-tier upload."""
        file_path = Path(file_path)
        if not file_path.exists():
            raise StorageError(f"File not found: {file_path}")

        size = file_path.stat().st_size
        dest = self.hot_path(storage_key)
        dest.parent.mkdir(parents=True, exist_ok=True)

        if dest.exists():
            # Already cached: verify it is the same content before trusting it.
            existing = compute_checksum(dest)
            if checksum is None and existing:
                return storage_key
            if existing != checksum:
                raise StorageError(f"Hot cache checksum mismatch for {storage_key}")
        else:
            self.evict_if_needed(required_bytes=size)

            # Eviction cannot free anything when every cached file still has a
            # pending upload. Refuse the write rather than filling the volume:
            # a full disk here takes the whole service down.
            free = shutil.disk_usage(self.hot_root).free
            if free - size < self.min_free_bytes:
                raise StorageError(
                    f"Hot tier is full: {free / 1e9:.1f} GB free, "
                    f"{size / 1e9:.1f} GB needed, "
                    f"{self.min_free_bytes / 1e9:.1f} GB must stay free. "
                    "Drain the transfer queue (tessera worker) and retry."
                )

            tmp = dest.with_name(dest.name + ".part")
            try:
                with open(file_path, "rb") as src, open(tmp, "wb") as out:
                    shutil.copyfileobj(src, out, CHUNK_SIZE)
                    out.flush()
                    os.fsync(out.fileno())
                os.replace(tmp, dest)
            except OSError as e:
                tmp.unlink(missing_ok=True)
                raise StorageError(f"Failed to write hot copy of {storage_key}: {e}") from e

            if checksum is not None:
                copied = compute_checksum(dest)
                if copied != checksum:
                    dest.unlink(missing_ok=True)
                    raise StorageError(
                        f"Hot copy verification failed for {storage_key}: "
                        f"{copied} != {checksum}"
                    )

        if self.defer_upload:
            self._enqueue(storage_key, dest, checksum, size)
        else:
            await self.cold.upload(dest, storage_key, checksum)
            if not self.keep_hot and dest.exists():
                dest.unlink(missing_ok=True)

        return storage_key

    async def _hydrate(self, storage_key: str) -> Path:
        """Bring a cold object into the hot tier and return its path."""
        dest = self.hot_path(storage_key)
        dest.parent.mkdir(parents=True, exist_ok=True)

        try:
            size = await self.cold.get_size(storage_key)
        except StorageError:
            size = 0
        if size:
            self.evict_if_needed(required_bytes=size)

        await self.cold.download(storage_key, dest)
        return dest

    async def download(self, storage_key: str, output_path: Path) -> None:
        """Copy an artifact to a local path, hydrating it when necessary."""
        source = self.local_path(storage_key)
        if source is None:
            source = await self._hydrate(storage_key)

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, output_path)

    async def download_stream(self, storage_key: str) -> BinaryIO:
        """Open an artifact for streaming, hydrating it when necessary."""
        source = self.local_path(storage_key)
        if source is None:
            source = await self._hydrate(storage_key)
        return open(source, "rb")

    async def download_head(self, storage_key: str, nbytes: int) -> Path:
        """Return a local file holding the first ``nbytes`` of an artifact."""
        source = self.local_path(storage_key)
        if source is None:
            head = getattr(self.cold, "download_head", None)
            if callable(head):
                # Let the cold tier read just the head; do not pull gigabytes
                # into the hot cache to look at the first frames.
                return await head(storage_key, nbytes)
            source = await self._hydrate(storage_key)

        handle = tempfile.NamedTemporaryFile(
            prefix="tessera-head-", suffix=Path(storage_key).suffix, delete=False
        )
        remaining = nbytes
        with open(source, "rb") as src, open(handle.name, "wb") as out:
            while remaining > 0:
                chunk = src.read(min(CHUNK_SIZE, remaining))
                if not chunk:
                    break
                out.write(chunk)
                remaining -= len(chunk)
        handle.close()
        return Path(handle.name)

    async def exists(self, storage_key: str) -> bool:
        if self.local_path(storage_key) is not None:
            return True
        return await self.cold.exists(storage_key)

    async def delete(self, storage_key: str) -> None:
        path = self.hot_path(storage_key)
        path.unlink(missing_ok=True)
        self._drop_jobs_for(storage_key)
        await self.cold.delete(storage_key)

    async def get_size(self, storage_key: str) -> int:
        path = self.local_path(storage_key)
        if path is not None:
            return path.stat().st_size
        return await self.cold.get_size(storage_key)

    # ----------------------------------------------------------------- extras

    async def list_files(self) -> list[dict[str, Any]]:
        """List cached files (used by storage scan/stats)."""
        return [
            {
                "path": str(path),
                "storage_key": str(path.relative_to(self.hot_root)),
                "size": path.stat().st_size,
            }
            for path in self._iter_hot_files()
        ]
