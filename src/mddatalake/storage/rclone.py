"""Google Drive (and anything else rclone speaks) as a storage backend.

The backend shells out to the ``rclone`` CLI rather than reimplementing the
Drive API: rclone already handles resumable chunked uploads, retries, rate
limits and token refresh, which is exactly the part that is painful to get
right for multi-gigabyte trajectories.

Setting ``remote`` to an empty string makes every path a plain local path. The
tests use that mode so they never touch the network.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, BinaryIO

from mddatalake.core.exceptions import StorageError
from mddatalake.storage.backend import StorageBackend


class RcloneBackend(StorageBackend):
    """Store artifacts in an rclone remote."""

    def __init__(
        self,
        remote: str,
        root: str = "tessera",
        *,
        config_path: str | None = None,
        bandwidth_limit: str | None = None,
        transfers: int = 4,
        checkers: int = 8,
        drive_chunk_size: str = "128M",
        retries: int = 3,
        timeout: float | None = None,
    ) -> None:
        self.remote = remote
        # Keep a leading "/" for local-path mode: stripping it silently turns an
        # absolute destination into a path relative to the working directory.
        self.root = root.rstrip("/")
        self.config_path = config_path
        self.bandwidth_limit = bandwidth_limit
        self.transfers = transfers
        self.checkers = checkers
        self.drive_chunk_size = drive_chunk_size
        self.retries = retries
        self.timeout = timeout

    # ------------------------------------------------------------------ paths

    def remote_path(self, storage_key: str) -> str:
        """Return the rclone path for a storage key."""
        key = storage_key.lstrip("/")
        if self.remote:
            root = self.root.lstrip("/")
            prefix = f"{root}/" if root else ""
            return f"{self.remote}:{prefix}{key}"
        return str(Path(self.root) / key) if self.root else key

    # --------------------------------------------------------------- plumbing

    @staticmethod
    def _binary() -> str:
        """Locate the rclone executable.

        Callers do not all inherit an interactive PATH: a systemd unit, a
        non-login ssh shell and a cron job each see a different one, and a bare
        "rclone" then fails with "not installed" while it is plainly installed
        in ~/.local/bin. RCLONE_BIN overrides the search.
        """
        explicit = os.environ.get("RCLONE_BIN")
        if explicit:
            return explicit
        found = shutil.which("rclone")
        if found:
            return found
        for candidate in ("~/.local/bin/rclone", "/usr/local/bin/rclone", "/usr/bin/rclone"):
            path = Path(candidate).expanduser()
            if path.is_file():
                return str(path)
        return "rclone"

    def _base_flags(self) -> list[str]:
        flags: list[str] = ["--retries", str(self.retries), "--stats", "0"]
        if self.config_path:
            flags += ["--config", self.config_path]
        if self.bandwidth_limit:
            flags += ["--bwlimit", self.bandwidth_limit]
        return flags

    def _env(self) -> dict[str, str]:
        """Environment for rclone.

        rclone reads RCLONE_* variables itself and treats an empty value as an
        invalid flag (``RCLONE_BWLIMIT=""`` is a hard failure), so empty values
        from a .env file are dropped rather than forwarded.
        """
        env = {
            name: value
            for name, value in os.environ.items()
            if not (name.startswith("RCLONE_") and not value.strip())
        }
        if self.config_path:
            env["RCLONE_CONFIG"] = self.config_path
        return env

    async def _run(self, args: list[str]) -> tuple[int, str, str]:
        """Run rclone and return (returncode, stdout, stderr)."""
        try:
            process = await asyncio.create_subprocess_exec(
                self._binary(),
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=self._env(),
            )
        except FileNotFoundError as e:
            raise StorageError("rclone is not installed or not on PATH") from e

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(), timeout=self.timeout
            )
        except asyncio.TimeoutError as e:
            process.kill()
            await process.wait()
            raise StorageError(f"rclone timeout after {self.timeout}s: {' '.join(args)}") from e

        return (
            process.returncode or 0,
            stdout.decode(errors="replace"),
            stderr.decode(errors="replace"),
        )

    @staticmethod
    def _tail(text: str, limit: int = 400) -> str:
        text = " ".join(text.split())
        return text[-limit:]

    # ------------------------------------------------------------ StorageBackend

    async def upload(
        self, file_path: Path, storage_key: str, checksum: str | None = None
    ) -> str:
        """Copy a local file to the remote. Existing objects are left alone."""
        file_path = Path(file_path)
        if not file_path.exists():
            raise StorageError(f"File not found: {file_path}")

        if await self.exists(storage_key):
            return storage_key

        args = [
            "copyto",
            str(file_path),
            self.remote_path(storage_key),
            *self._base_flags(),
            "--transfers",
            str(self.transfers),
            "--checkers",
            str(self.checkers),
            "--drive-chunk-size",
            self.drive_chunk_size,
        ]
        code, _, err = await self._run(args)
        if code != 0:
            raise StorageError(
                f"rclone upload failed for {storage_key}: {self._tail(err)}"
            )
        return storage_key

    async def download(self, storage_key: str, output_path: Path) -> None:
        """Copy an object from the remote to a local path."""
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        args = [
            "copyto",
            self.remote_path(storage_key),
            str(output_path),
            *self._base_flags(),
        ]
        code, _, err = await self._run(args)
        if code != 0:
            raise StorageError(
                f"rclone download failed for {storage_key}: {self._tail(err)}"
            )

    async def download_stream(self, storage_key: str) -> BinaryIO:
        """Download to a temporary file and return the open handle.

        The caller owns the handle and should close it; the temporary file is
        removed when the process exits.
        """
        if not await self.exists(storage_key):
            raise StorageError(f"File not found in storage: {storage_key}")

        handle = tempfile.NamedTemporaryFile(
            prefix="tessera-", suffix=Path(storage_key).suffix, delete=False
        )
        handle.close()
        try:
            await self.download(storage_key, Path(handle.name))
        except Exception:
            Path(handle.name).unlink(missing_ok=True)
            raise
        return open(handle.name, "rb")

    async def download_head(self, storage_key: str, nbytes: int) -> Path:
        """Fetch only the first ``nbytes`` of an object.

        This is what makes previews of a 20 GB trajectory tractable: the
        viewer only needs the opening frames, and `rclone cat --head` reads
        just that many bytes instead of the whole file.
        """
        handle = tempfile.NamedTemporaryFile(
            prefix="tessera-head-", suffix=Path(storage_key).suffix, delete=False
        )
        handle.close()
        target = Path(handle.name)

        args = [
            "cat",
            self.remote_path(storage_key),
            "--head",
            str(int(nbytes)),
            *self._base_flags(),
        ]
        try:
            process = await asyncio.create_subprocess_exec(
                self._binary(),
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=self._env(),
            )
        except FileNotFoundError as e:
            raise StorageError("rclone is not installed or not on PATH") from e

        try:
            with open(target, "wb") as out:
                assert process.stdout is not None
                while chunk := await process.stdout.read(8 * 1024 * 1024):
                    out.write(chunk)
            await asyncio.wait_for(process.wait(), timeout=self.timeout)
            stderr = await process.stderr.read()  # type: ignore[union-attr]
        except asyncio.TimeoutError as e:
            process.kill()
            target.unlink(missing_ok=True)
            raise StorageError(f"rclone cat timeout for {storage_key}") from e

        if (process.returncode or 0) != 0:
            target.unlink(missing_ok=True)
            raise StorageError(
                f"rclone head read failed for {storage_key}: "
                f"{self._tail(stderr.decode(errors='replace'))}"
            )
        return target

    async def exists(self, storage_key: str) -> bool:
        """Return True when the object exists on the remote."""
        code, out, err = await self._run(
            ["lsjson", "--stat", self.remote_path(storage_key), *self._base_flags()]
        )
        if code == 0:
            return True

        message = (err + out).lower()
        if "not found" in message or "directory not found" in message:
            return False
        raise StorageError(f"rclone stat failed for {storage_key}: {self._tail(err)}")

    async def delete(self, storage_key: str) -> None:
        """Delete an object; a missing object is not an error."""
        code, _, err = await self._run(
            ["deletefile", self.remote_path(storage_key), *self._base_flags()]
        )
        if code != 0 and "not found" not in err.lower():
            raise StorageError(f"rclone delete failed for {storage_key}: {self._tail(err)}")

    async def get_size(self, storage_key: str) -> int:
        """Return the object size in bytes."""
        code, out, err = await self._run(
            ["lsjson", "--stat", self.remote_path(storage_key), *self._base_flags()]
        )
        if code != 0:
            raise StorageError(f"rclone stat failed for {storage_key}: {self._tail(err)}")

        try:
            payload: Any = json.loads(out)
            return int(payload["Size"])
        except (ValueError, KeyError, TypeError) as e:
            raise StorageError(f"Unexpected rclone lsjson output: {out[:200]}") from e

    async def check(self, local_path: Path, storage_key: str) -> bool:
        """Return True when the remote object matches the local file's size."""
        try:
            remote_size = await self.get_size(storage_key)
        except StorageError:
            return False
        return remote_size == Path(local_path).stat().st_size
