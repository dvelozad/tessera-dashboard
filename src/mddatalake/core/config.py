"""Application configuration using Pydantic Settings."""

from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

from mddatalake.core.enums import ValidationLevel


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database
    database_url: str = "postgresql+asyncpg://mddatalake:devpassword@localhost:5433/mddatalake"

    # JWT Authentication
    jwt_secret_key: str = "CHANGE-ME-IN-PRODUCTION-USE-A-LONG-RANDOM-STRING"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 480  # 8 hours

    # Storage Backend
    # filesystem: single local directory (development)
    # s3:         S3/MinIO object storage
    # gdrive:     tiered storage - bounded local hot cache in front of Google
    #             Drive (rclone) as the cold, authoritative tier
    storage_backend: Literal["filesystem", "s3", "gdrive"] = "filesystem"
    storage_root: str = "/var/lib/tessera/artifacts"

    # S3/MinIO Configuration
    s3_endpoint_url: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_bucket_name: str = "md-simulations"
    s3_region: str = "us-east-1"

    # Google Drive cold tier (storage_backend=gdrive)
    gdrive_remote: str = "gdrive"  # rclone remote name; "" means a plain local path
    gdrive_root: str = "tessera"  # folder inside the remote that holds everything
    rclone_config_path: str | None = None  # defaults to rclone's own config
    rclone_bwlimit: str | None = None  # e.g. "50M"; None = unlimited
    rclone_transfers: int = 4
    rclone_checkers: int = 8
    rclone_drive_chunk_size: str = "128M"
    rclone_timeout_seconds: int = 21600  # 6 h; large trajectory on a slow link
    gdrive_defer_uploads: bool = True  # enqueue, let tessera-worker push to Drive
    gdrive_daily_upload_gb: float = 700.0  # Drive's per-account daily upload cap
    storage_manifest_enabled: bool = True  # write projects/<p>/<run>/manifest.json

    # Hot cache (storage_backend=gdrive)
    hot_root: str = "/var/lib/tessera/hot"
    hot_max_gb: float = 10.0
    hot_keep_copies: bool = True  # keep the hot copy after a successful push
    # Never let the hot tier fill the volume; uploads are refused instead.
    hot_min_free_gb: float = 2.0

    # Staging area for `tessera pull` (rsync target before ingestion)
    staging_root: str = "/var/lib/tessera/staging"

    # obleas, the lab's MD analysis suite (C++/MPI). It runs on the host that
    # holds the data, so this path is where the binary lives on that host.
    obleas_bin: str = "obleas"
    obleas_timeout_seconds: int = 3600
    obleas_enabled: bool = True
    # Skip trajectories larger than this when analysing (0 = no limit).
    obleas_max_trajectory_gb: float = 0.0

    # API Configuration
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_workers: int = 4

    # Optional: serve the built SPA from the API itself (one process, one port).
    # Point this at frontend/dist. Empty disables it.
    frontend_dir: str = ""

    # Logging
    log_level: str = "INFO"
    log_format: Literal["json", "text"] = "text"

    # Ingestion Configuration
    compress_trajectories: bool = True
    compression_format: Literal["gzip", "zstd", "xz"] = "gzip"
    checksum_algorithm: Literal["sha256", "md5"] = "sha256"

    # Trajectory Preview Configuration
    preview_cache_enabled: bool = True
    preview_cache_root: str = "/tmp/mdrepo/preview_cache"
    preview_frame_count: int = 1  # Extract first N frames
    preview_format: Literal["pdb", "dcd"] = "pdb"
    preview_max_file_size_mb: int = 1000  # Above this, read only the head
    # Bytes read from the head of an oversized trajectory for its preview.
    # 0 disables head-based previews (large trajectories are then skipped).
    preview_head_bytes: int = 256 * 1024 * 1024
    preview_async_extraction: bool = True  # True = async, False = inline

    # Upload Validation Configuration
    validation_mode: ValidationLevel = ValidationLevel.WARNING
    allow_duplicate_trajectories: bool = False
    allow_duplicate_topologies: bool = False
    allow_duplicate_logs: bool = False
    require_minimal_dataset: bool = False
    max_files_per_upload: int = 50
    max_total_upload_size_gb: int = 50
    max_file_size_mb: int = 5000  # 5GB per file


settings = Settings()
