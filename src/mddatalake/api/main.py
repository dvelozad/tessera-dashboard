"""FastAPI application factory."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
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

if _frontend_dir:
    # Mounted even when the directory is momentarily absent (a build running)
    # and served lazily, so a rebuild never requires restarting the API.
    app.mount(
        "/assets",
        StaticFiles(directory=_frontend_dir / "assets", check_dir=False),
        name="assets",
    )

    def _spa_shell() -> FileResponse:
        """The SPA entry point.

        `no-cache` is deliberate: index.html names a hashed bundle, and a
        rebuild deletes the old one. A cached shell would ask for a file that
        no longer exists and the browser would render a blank page. While a
        build is in flight the file is briefly absent, so say so plainly
        instead of raising.
        """
        shell = _frontend_dir / "index.html"
        if not shell.is_file():
            raise HTTPException(
                status_code=503,
                detail="The web app is being rebuilt. Reload in a moment.",
                headers={"Retry-After": "5"},
            )
        return FileResponse(shell, headers={"Cache-Control": "no-cache"})

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        """Serve a static file when it exists, otherwise the SPA entry point."""
        # Never answer API requests with HTML: an unknown API path must be a
        # 404, not a 200 that silently hands the browser the app shell.
        if full_path.startswith(("api/", "docs", "redoc", "openapi.json", "health")):
            raise HTTPException(status_code=404, detail="Not found")

        if full_path:
            candidate = (_frontend_dir / full_path).resolve()
            try:
                candidate.relative_to(_frontend_dir.resolve())
            except ValueError:
                return _spa_shell()
            if candidate.is_file():
                return FileResponse(candidate)
        return _spa_shell()
