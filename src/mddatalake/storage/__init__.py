"""Storage backends for artifacts.

The backend is selected by ``STORAGE_BACKEND``:

* ``filesystem`` - one local directory, content addressed (development).
* ``s3`` - S3/MinIO object storage.
* ``gdrive`` - tiered: a bounded local hot cache in front of Google Drive,
  reached through the ``rclone`` CLI. Drive holds every artifact; local disk
  only ever holds a working set and is evicted LRU.

Every call site must use :func:`get_storage_backend` instead of constructing a
backend directly, so that moving to a different host or tier is a configuration
change rather than a code change.
"""

from mddatalake.storage.backend import StorageBackend
from mddatalake.storage.filesystem import FilesystemBackend
from mddatalake.storage.s3 import S3Backend


def get_storage_backend() -> StorageBackend:
    """
    Get configured storage backend.

    Returns:
        Storage backend instance based on configuration
    """
    from mddatalake.core.config import settings

    if settings.storage_backend == "gdrive":
        from mddatalake.storage.rclone import RcloneBackend
        from mddatalake.storage.tiered import TieredBackend

        cold = RcloneBackend(
            remote=settings.gdrive_remote,
            root=settings.gdrive_root,
            config_path=settings.rclone_config_path,
            bandwidth_limit=settings.rclone_bwlimit,
            transfers=settings.rclone_transfers,
            checkers=settings.rclone_checkers,
            drive_chunk_size=settings.rclone_drive_chunk_size,
            timeout=float(settings.rclone_timeout_seconds),
        )
        return TieredBackend(
            hot_root=settings.hot_root,
            cold=cold,
            max_bytes=int(settings.hot_max_gb * 1_000_000_000),
            defer_upload=settings.gdrive_defer_uploads,
            keep_hot=settings.hot_keep_copies,
            min_free_bytes=int(settings.hot_min_free_gb * 1_000_000_000),
        )

    if settings.storage_backend == "s3":
        return S3Backend()

    return FilesystemBackend(settings.storage_root)


def get_transfer_worker() -> "object":
    """
    Build a TransferWorker for the configured cold tier.

    Raises:
        RuntimeError: when the active backend has no asynchronous transfer queue
            (only ``gdrive`` does).
    """
    from mddatalake.core.config import settings

    if settings.storage_backend != "gdrive":
        raise RuntimeError(
            f"storage_backend={settings.storage_backend!r} has no transfer queue; "
            "set STORAGE_BACKEND=gdrive"
        )

    from mddatalake.storage.transfer import TransferWorker

    backend = get_storage_backend()
    return TransferWorker(
        backend,  # type: ignore[arg-type]
        max_gb_per_day=settings.gdrive_daily_upload_gb,
    )


__all__ = [
    "StorageBackend",
    "FilesystemBackend",
    "S3Backend",
    "get_storage_backend",
    "get_transfer_worker",
]
