"""Filesystem storage backend with content-addressed storage (CAS)."""

import shutil
from pathlib import Path
from typing import BinaryIO

from mddatalake.core.exceptions import StorageError
from mddatalake.storage.backend import StorageBackend
from mddatalake.storage.keys import cas_key
from mddatalake.utils.checksum import compute_checksum


class FilesystemBackend(StorageBackend):
    """Filesystem storage backend using content-addressed storage."""

    def __init__(self, root: str | Path):
        """
        Initialize filesystem backend.

        Args:
            root: Root directory for storage
        """
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    async def upload(
        self, file_path: Path, storage_key: str, checksum: str | None = None
    ) -> str:
        """Copy a file into the content-addressed store.

        ``storage_key`` is the relative path to write; when empty the key is
        derived from the checksum using the shared convention.
        """
        file_path = Path(file_path)

        if not file_path.exists():
            raise StorageError(f"File not found: {file_path}")

        # Compute checksum if not provided
        if checksum is None:
            checksum = compute_checksum(file_path)

        if not storage_key:
            storage_key = cas_key(checksum, file_path.name)

        cas_path = self.root / storage_key
        cas_path.parent.mkdir(parents=True, exist_ok=True)

        # If file already exists with same checksum, skip upload (deduplication)
        if cas_path.exists():
            # Verify checksum matches
            existing_checksum = compute_checksum(cas_path)
            if existing_checksum != checksum:
                raise StorageError(f"Checksum mismatch for existing file: {cas_path}")
            return storage_key

        # Copy file to CAS location
        shutil.copy2(file_path, cas_path)

        # Verify uploaded file
        uploaded_checksum = compute_checksum(cas_path)
        if uploaded_checksum != checksum:
            cas_path.unlink()
            raise StorageError("Upload verification failed: checksum mismatch")

        return storage_key

    async def download(self, storage_key: str, output_path: Path) -> None:
        """Download file from filesystem storage."""
        source_path = self.root / storage_key

        if not source_path.exists():
            raise StorageError(f"File not found in storage: {storage_key}")

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        shutil.copy2(source_path, output_path)

    async def download_stream(self, storage_key: str) -> BinaryIO:
        """Download file as a stream.

        Returns an open file handle. The caller owns it and must close it; this
        deliberately does not buffer the file, because artifacts can be tens of
        gigabytes.
        """
        source_path = self.root / storage_key

        if not source_path.exists():
            raise StorageError(f"File not found in storage: {storage_key}")

        return open(source_path, "rb")

    async def exists(self, storage_key: str) -> bool:
        """Check if file exists."""
        return (self.root / storage_key).exists()

    async def delete(self, storage_key: str) -> None:
        """Delete file from storage."""
        file_path = self.root / storage_key

        if file_path.exists():
            file_path.unlink()

    async def get_size(self, storage_key: str) -> int:
        """Get file size."""
        file_path = self.root / storage_key

        if not file_path.exists():
            raise StorageError(f"File not found in storage: {storage_key}")

        return file_path.stat().st_size
