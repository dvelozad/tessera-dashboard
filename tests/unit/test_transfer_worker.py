"""Tests for the transfer worker (queue draining, retries, daily quota)."""

import json
from pathlib import Path

import pytest

from mddatalake.core.exceptions import StorageError
from mddatalake.storage.backend import StorageBackend
from mddatalake.storage.filesystem import FilesystemBackend
from mddatalake.storage.tiered import TieredBackend
from mddatalake.storage.transfer import TransferWorker
from mddatalake.utils.checksum import compute_checksum


class FailingBackend(StorageBackend):
    """Cold backend whose uploads always fail."""

    def __init__(self) -> None:
        self.attempts = 0

    async def upload(self, file_path, storage_key, checksum=None):
        self.attempts += 1
        raise StorageError("drive unavailable")

    async def download(self, storage_key, output_path):  # pragma: no cover
        raise StorageError("unavailable")

    async def download_stream(self, storage_key):  # pragma: no cover
        raise StorageError("unavailable")

    async def exists(self, storage_key):
        return False

    async def delete(self, storage_key):
        return None

    async def get_size(self, storage_key):
        raise StorageError("unavailable")


async def _make_tiered(tmp_path: Path, cold: StorageBackend, defer=True) -> TieredBackend:
    return TieredBackend(
        hot_root=tmp_path / "hot",
        cold=cold,
        max_bytes=10 * 1024 * 1024,
        defer_upload=defer,
        keep_hot=False,
    )


async def _queue_one(tiered: TieredBackend, tmp_path: Path, payload: bytes = b"x" * 2048):
    source = tmp_path / "traj.dump"
    source.write_bytes(payload)
    checksum = compute_checksum(source)
    key = f"cas/sha256/ab/cd/{checksum}.dump"
    await tiered.upload(source, key, checksum)
    return key, checksum


@pytest.mark.asyncio
async def test_worker_uploads_and_clears_job(tmp_path: Path):
    cold = FilesystemBackend(tmp_path / "cold")
    tiered = await _make_tiered(tmp_path, cold)
    key, _ = await _queue_one(tiered, tmp_path)

    worker = TransferWorker(tiered, max_gb_per_day=None)
    processed = await worker.run_once()

    assert processed == 1
    assert await cold.exists(key)
    assert list(tiered.queue_dir.glob("*.json")) == []
    assert tiered.local_path(key) is None  # keep_hot=False drops the hot copy


@pytest.mark.asyncio
async def test_worker_records_daily_ledger(tmp_path: Path):
    cold = FilesystemBackend(tmp_path / "cold")
    tiered = await _make_tiered(tmp_path, cold)
    await _queue_one(tiered, tmp_path)

    worker = TransferWorker(tiered, max_gb_per_day=1.0)
    await worker.run_once()

    ledger = json.loads((tiered.hot_root / ".quota.json").read_text())
    assert ledger["bytes"] == 2048


@pytest.mark.asyncio
async def test_worker_retries_on_failure(tmp_path: Path):
    cold = FailingBackend()
    tiered = await _make_tiered(tmp_path, cold)
    await _queue_one(tiered, tmp_path)

    worker = TransferWorker(tiered, max_gb_per_day=None, max_attempts=3)
    processed = await worker.run_once()

    assert processed == 0
    jobs = list(tiered.queue_dir.glob("*.json"))
    assert len(jobs) == 1
    payload = json.loads(jobs[0].read_text())
    assert payload["attempts"] == 1
    assert "drive unavailable" in payload["last_error"]
    assert payload["next_attempt"] > 0


@pytest.mark.asyncio
async def test_worker_gives_up_after_max_attempts(tmp_path: Path):
    cold = FailingBackend()
    tiered = await _make_tiered(tmp_path, cold)
    await _queue_one(tiered, tmp_path)

    worker = TransferWorker(tiered, max_gb_per_day=None, max_attempts=1)
    await worker.run_once()

    assert list(tiered.queue_dir.glob("*.json")) == []
    failed = list((tiered.queue_dir / ".failed").glob("*.json"))
    assert len(failed) == 1


@pytest.mark.asyncio
async def test_worker_stops_at_daily_quota(tmp_path: Path):
    cold = FilesystemBackend(tmp_path / "cold")
    tiered = await _make_tiered(tmp_path, cold)
    await _queue_one(tiered, tmp_path, b"y" * 4096)

    # Cap below one job's size: nothing should be transferred.
    worker = TransferWorker(tiered, max_gb_per_day=0.000001)
    processed = await worker.run_once()

    assert processed == 0
    assert len(list(tiered.queue_dir.glob("*.json"))) == 1


@pytest.mark.asyncio
async def test_worker_skips_missing_hot_copy(tmp_path: Path):
    cold = FilesystemBackend(tmp_path / "cold")
    tiered = await _make_tiered(tmp_path, cold)
    key, _ = await _queue_one(tiered, tmp_path)

    tiered.local_path(key).unlink()

    worker = TransferWorker(tiered, max_gb_per_day=None, max_attempts=1)
    await worker.run_once()

    failed = list((tiered.queue_dir / ".failed").glob("*.json"))
    assert len(failed) == 1
