"""FastAPI application factory."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from mddatalake.core.config import settings

from mddatalake.api.routes import artifacts, completeness, health, plots, projects, runs, upload, visualization
from mddatalake.api.routes import auth
from mddatalake.api.scheduler import scheduler
from mddatalake.auth.dependencies import get_current_user
from mddatalake.__version__ import __version__

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.

    Handles startup and shutdown events.
    """
    # Startup
    logger.info("Starting application...")
    await scheduler.start()
    logger.info("Application started")

    yield

    # Shutdown
    logger.info("Shutting down application...")
    await scheduler.stop()
    logger.info("Application stopped")


app = FastAPI(
    title="MD Repo API",
    description="Production-ready backend for molecular dynamics simulation database",
    version=__version__,
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Public routes (no auth required)
app.include_router(health.router, tags=["Health"])
app.include_router(auth.router, prefix="/api/v1")

# Protected routes — all require a valid JWT
_auth = [Depends(get_current_user)]
app.include_router(runs.router, prefix="/api/v1", tags=["Simulation Runs"], dependencies=_auth)
app.include_router(artifacts.router, prefix="/api/v1", tags=["Artifacts"], dependencies=_auth)
app.include_router(visualization.router, prefix="/api/v1", tags=["Visualization"], dependencies=_auth)
app.include_router(completeness.router, prefix="/api/v1", tags=["Data Quality"], dependencies=_auth)
app.include_router(upload.router, prefix="/api/v1", tags=["Upload"], dependencies=_auth)
app.include_router(plots.router, prefix="/api/v1", tags=["Plots"], dependencies=_auth)
app.include_router(projects.router, prefix="/api/v1", tags=["Projects"], dependencies=_auth)


# ---------------------------------------------------------------------------
# Optional: serve the built frontend from the same process.
#
# Set FRONTEND_DIR to a `dist/` directory and the API also serves the SPA, so a
# deployment is one process on one port with no separate web server. Registered
# last, so API routes and /docs always win.
# ---------------------------------------------------------------------------
_frontend_dir = Path(settings.frontend_dir) if settings.frontend_dir else None

if _frontend_dir and (_frontend_dir / "index.html").is_file():
    assets_dir = _frontend_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        """Serve a static file when it exists, otherwise the SPA entry point."""
        if full_path:
            candidate = (_frontend_dir / full_path).resolve()
            try:
                candidate.relative_to(_frontend_dir.resolve())
            except ValueError:
                return FileResponse(_frontend_dir / "index.html")
            if candidate.is_file():
                return FileResponse(candidate)
        return FileResponse(_frontend_dir / "index.html")
