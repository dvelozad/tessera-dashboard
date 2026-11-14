"""Tests for the rclone storage backend.

They run against a plain local path (``remote=""``), so nothing touches Google
Drive or the network.
"""

import shutil
from pathlib import Path

import pytest

from mddatalake.core.exceptions import StorageError
from mddatalake.storage.rclone import RcloneBackend
from mddatalake.utils.checksum import compute_checksum

pytestmark = pytest.mark.skipif(
    shutil.which("rclone") is None, reason="rclone not installed"
)


@pytest.fixture
def backend(tmp_path: Path) -> RcloneBackend:
    return RcloneBackend(remote="", root=str(tmp_path / "cold"), timeout=120)


@pytest.mark.asyncio
async def test_upload_download_roundtrip(backend: RcloneBackend, tmp_path: Path):
    source = tmp_path / "traj.xtc"
    source.write_bytes(b"frame-data" * 1000)
    checksum = compute_checksum(source)

    key = await backend.upload(source, "cas/sha256/ab/cd/traj.xtc", checksum)
    assert key == "cas/sha256/ab/cd/traj.xtc"
    assert await backend.exists(key)
    assert await backend.get_size(key) == source.stat().st_size

    target = tmp_path / "downloaded.xtc"
    await backend.download(key, target)
    assert target.read_bytes() == source.read_bytes()
    assert compute_checksum(target) == checksum


@pytest.mark.asyncio
async def test_upload_is_deduplicated(backend: RcloneBackend, tmp_path: Path):
    source = tmp_path / "in.lmp"
    source.write_text("units real\n")
    key = "cas/sha256/aa/bb/in.lmp"

    await backend.upload(source, key)
    stored = backend.remote_path(key)
    first_mtime = Path(stored).stat().st_mtime_ns

    # Second upload with identical content must not rewrite the object.
    await backend.upload(source, key)
    assert Path(stored).stat().st_mtime_ns == first_mtime


@pytest.mark.asyncio
async def test_exists_is_false_for_missing_key(backend: RcloneBackend):
    assert await backend.exists("cas/sha256/00/00/nope.dump") is False


@pytest.mark.asyncio
async def test_get_size_missing_raises(backend: RcloneBackend):
    with pytest.raises(StorageError):
        await backend.get_size("cas/sha256/00/00/nope.dump")


@pytest.mark.asyncio
async def test_delete_removes_object(backend: RcloneBackend, tmp_path: Path):
    source = tmp_path / "log.lammps"
    source.write_text("step temp\n0 300\n")
    key = "cas/sha256/cc/dd/log.lammps"

    await backend.upload(source, key)
    assert await backend.exists(key)

    await backend.delete(key)
    assert await backend.exists(key) is False


@pytest.mark.asyncio
async def test_delete_missing_is_not_an_error(backend: RcloneBackend):
    await backend.delete("cas/sha256/00/00/absent.file")


@pytest.mark.asyncio
async def test_upload_missing_source_raises(backend: RcloneBackend, tmp_path: Path):
    with pytest.raises(StorageError):
        await backend.upload(tmp_path / "ghost.txt", "cas/sha256/ee/ff/ghost.txt")


@pytest.mark.asyncio
async def test_download_stream_returns_readable_handle(
    backend: RcloneBackend, tmp_path: Path
):
    source = tmp_path / "conf.gro"
    source.write_bytes(b"gro contents\n" * 50)
    key = "cas/sha256/11/22/conf.gro"
    await backend.upload(source, key)

    handle = await backend.download_stream(key)
    try:
        assert handle.read() == source.read_bytes()
    finally:
        handle.close()


def test_empty_rclone_env_vars_are_dropped(monkeypatch):
    """An empty RCLONE_* value is an invalid flag to rclone, so drop it."""
    monkeypatch.setenv("RCLONE_BWLIMIT", "")
    monkeypatch.setenv("RCLONE_BUSY", "1")
    backend = RcloneBackend(remote="gdrive", root="tessera")

    env = backend._env()

    assert "RCLONE_BWLIMIT" not in env
    assert env["RCLONE_BUSY"] == "1"


def test_remote_path_keeps_absolute_local_root(tmp_path: Path):
    """Regression: a stripped leading slash wrote into the working directory."""
    backend = RcloneBackend(remote="", root=str(tmp_path / "cold"))
    assert backend.remote_path("cas/x.dump") == str(tmp_path / "cold" / "cas/x.dump")


def test_remote_path_with_named_remote():
    backend = RcloneBackend(remote="gdrive", root="tessera")
    assert backend.remote_path("cas/sha256/ab/cd/x.dump") == (
        "gdrive:tessera/cas/sha256/ab/cd/x.dump"
    )
