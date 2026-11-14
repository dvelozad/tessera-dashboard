"""Tests for the hot-cache / cold-tier backend."""

import json
from pathlib import Path

import pytest

from mddatalake.core.exceptions import StorageError
from mddatalake.storage.filesystem import FilesystemBackend
from mddatalake.storage.tiered import TieredBackend
from mddatalake.utils.checksum import compute_checksum


@pytest.fixture
def cold(tmp_path: Path) -> FilesystemBackend:
    return FilesystemBackend(tmp_path / "cold")


@pytest.fixture
def tiered(tmp_path: Path, cold: FilesystemBackend) -> TieredBackend:
    return TieredBackend(
        hot_root=tmp_path / "hot",
        cold=cold,
        max_bytes=1024 * 1024,
        defer_upload=True,
        keep_hot=True,
    )


@pytest.mark.asyncio
async def test_deferred_upload_queues_job(tiered: TieredBackend, tmp_path: Path):
    source = tmp_path / "data.lmp"
    source.write_bytes(b"x" * 500)
    checksum = compute_checksum(source)

    key = await tiered.upload(source, "cas/sha256/ab/cd/data.lmp", checksum)

    assert tiered.local_path(key) is not None
    jobs = list(tiered.queue_dir.glob("*.json"))
    assert len(jobs) == 1
    payload = json.loads(jobs[0].read_text())
    assert payload["key"] == key
    assert payload["checksum"] == checksum
    assert key in tiered.pending_keys()
    # Not on the cold tier yet
    assert await tiered.cold.exists(key) is False


@pytest.mark.asyncio
async def test_synchronous_upload_pushes_cold(tmp_path: Path, cold: FilesystemBackend):
    tiered = TieredBackend(
        hot_root=tmp_path / "hot",
        cold=cold,
        max_bytes=1024 * 1024,
        defer_upload=False,
        keep_hot=False,
    )
    source = tmp_path / "in.lmp"
    source.write_text("units real\n")
    checksum = compute_checksum(source)

    key = await tiered.upload(source, "cas/sha256/ab/cd/in.lmp", checksum)

    assert await cold.exists(key)
    assert tiered.local_path(key) is None


@pytest.mark.asyncio
async def test_checksum_mismatch_is_rejected(tiered: TieredBackend, tmp_path: Path):
    source = tmp_path / "bad.bin"
    source.write_bytes(b"content")

    with pytest.raises(StorageError):
        await tiered.upload(source, "cas/sha256/ab/cd/bad.bin", "0" * 64)


@pytest.mark.asyncio
async def test_download_uses_hot_copy(tiered: TieredBackend, tmp_path: Path):
    source = tmp_path / "f.bin"
    source.write_bytes(b"hot-bytes")
    key = "cas/sha256/ab/cd/f.bin"
    await tiered.upload(source, key, compute_checksum(source))

    target = tmp_path / "out.bin"
    await tiered.download(key, target)
    assert target.read_bytes() == b"hot-bytes"


@pytest.mark.asyncio
async def test_download_hydrates_from_cold(tiered: TieredBackend, tmp_path: Path):
    source = tmp_path / "f.bin"
    source.write_bytes(b"cold-bytes")
    key = "cas/sha256/ef/01/f.bin"
    await tiered.cold.upload(source, key, compute_checksum(source))

    assert tiered.local_path(key) is None

    target = tmp_path / "out.bin"
    await tiered.download(key, target)

    assert target.read_bytes() == b"cold-bytes"
    assert tiered.local_path(key) is not None  # hydrated into the hot tier


@pytest.mark.asyncio
async def test_delete_removes_hot_job_and_cold(tiered: TieredBackend, tmp_path: Path):
    source = tmp_path / "f.bin"
    source.write_bytes(b"bytes")
    key = "cas/sha256/ab/cd/f.bin"
    await tiered.upload(source, key, compute_checksum(source))
    await tiered.cold.upload(source, key, compute_checksum(source))

    await tiered.delete(key)

    assert tiered.local_path(key) is None
    assert key not in tiered.pending_keys()
    assert await tiered.cold.exists(key) is False


def test_eviction_spares_pending_jobs(tmp_path: Path, cold: FilesystemBackend):
    tiered = TieredBackend(
        hot_root=tmp_path / "hot-small",
        cold=cold,
        max_bytes=1000,
        defer_upload=True,
        keep_hot=True,
    )
    pending = tiered.hot_path("cas/sha256/aa/aa/pending.bin")
    pending.parent.mkdir(parents=True, exist_ok=True)
    pending.write_bytes(b"p" * 600)

    evictable = tiered.hot_path("cas/sha256/bb/bb/evictable.bin")
    evictable.parent.mkdir(parents=True, exist_ok=True)
    evictable.write_bytes(b"e" * 600)

    tiered._enqueue("cas/sha256/aa/aa/pending.bin", pending, None, 600)

    freed = tiered.evict_if_needed(required_bytes=700)

    assert freed == 600
    assert pending.exists()
    assert not evictable.exists()


def test_pending_bytes_counts_queued_jobs(tiered: TieredBackend, tmp_path: Path):
    source = tmp_path / "f.bin"
    source.write_bytes(b"z" * 123)
    tiered._enqueue("k", source, None, 123)
    assert tiered.pending_bytes() == 123


@pytest.mark.asyncio
async def test_list_files_excludes_queue(tiered: TieredBackend, tmp_path: Path):
    source = tmp_path / "f.bin"
    source.write_bytes(b"z" * 10)
    await tiered.upload(source, "cas/sha256/ab/cd/f.bin", compute_checksum(source))

    entries = await tiered.list_files()
    keys = {e["storage_key"] for e in entries}
    assert "cas/sha256/ab/cd/f.bin" in keys
    assert not any(k.startswith(".queue") for k in keys)


@pytest.mark.asyncio
async def test_download_head_from_hot_copy(tiered: TieredBackend, tmp_path: Path):
    source = tmp_path / "traj.dump"
    source.write_bytes(b"x" * 4096)
    key = "cas/sha256/ab/cd/traj.dump"
    await tiered.upload(source, key, compute_checksum(source))

    head = await tiered.download_head(key, 100)
    try:
        assert len(head.read_bytes()) == 100
    finally:
        head.unlink(missing_ok=True)


@pytest.mark.asyncio
async def test_download_head_falls_back_to_cold(tmp_path: Path, cold: FilesystemBackend):
    tiered = TieredBackend(
        hot_root=tmp_path / "hot2", cold=cold, max_bytes=10**6, defer_upload=True
    )
    source = tmp_path / "traj2.dump"
    source.write_bytes(b"y" * 2048)
    key = "cas/sha256/ee/ff/traj2.dump"
    await cold.upload(source, key, compute_checksum(source))

    # FilesystemBackend has no head reader, so the file is hydrated first.
    head = await tiered.download_head(key, 64)
    try:
        assert len(head.read_bytes()) == 64
    finally:
        head.unlink(missing_ok=True)
