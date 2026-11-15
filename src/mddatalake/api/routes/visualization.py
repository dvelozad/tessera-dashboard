"""Visualization session management routes."""

import asyncio
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mddatalake.db.models.artifact import Artifact
from mddatalake.db.models.simulation_run import SimulationRun
from mddatalake.db.session import get_db
from mddatalake.visualization.mdserv_manager import MDservManager


router = APIRouter(prefix="/visualizations", tags=["visualization"])
mdserv_manager = MDservManager()


class CreateSessionRequest(BaseModel):
    """Request body for creating a visualization session."""

    config: Optional[dict] = None
    first_frame_only: bool = False


class CreateSessionResponse(BaseModel):
    """Response for creating a visualization session."""

    session_id: str
    mdserv_url: str
    expires_at: datetime
    session: dict


class VisualizationSessionResponse(BaseModel):
    """Response for getting a visualization session."""

    id: int
    session_id: str
    simulation_run_id: int
    created_at: datetime
    expires_at: datetime
    last_accessed_at: datetime
    mdserv_port: int
    status: str
    config: Optional[dict]


@router.post("/runs/{run_id}/visualizations", response_model=CreateSessionResponse)
async def create_visualization_session(
    run_id: int,
    request: CreateSessionRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new visualization session for a simulation run.

    This endpoint:
    1. Validates the simulation run exists
    2. Spawns an MDsrv process
    3. Creates a session record in the database
    4. Returns connection information
    """
    # Check if run exists
    result = await db.execute(
        select(SimulationRun).where(SimulationRun.id == run_id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Simulation run {run_id} not found"
        )

    # Create session
    try:
        session = await mdserv_manager.create_session(
            db=db,
            run_id=run_id,
            config=request.config or {},
            first_frame_only=request.first_frame_only
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create visualization session: {str(e)}"
        )

    return CreateSessionResponse(
        session_id=session.session_id,
        mdserv_url=f"http://localhost:{session.mdserv_port}",
        expires_at=session.expires_at,
        session={
            "id": session.id,
            "session_id": session.session_id,
            "status": session.status,
            "mdserv_port": session.mdserv_port,
        }
    )


@router.get("/{session_id}", response_model=VisualizationSessionResponse)
async def get_visualization_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get visualization session status and information."""
    session = await mdserv_manager.get_session(db, session_id)

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )

    return VisualizationSessionResponse(
        id=session.id,
        session_id=session.session_id,
        simulation_run_id=session.simulation_run_id,
        created_at=session.created_at,
        expires_at=session.expires_at,
        last_accessed_at=session.last_accessed_at,
        mdserv_port=session.mdserv_port,
        status=session.status,
        config=session.config,
    )


@router.delete("/{session_id}")
async def terminate_visualization_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Terminate a visualization session and cleanup resources."""
    try:
        await mdserv_manager.terminate_session(db, session_id)
        return {"message": "Session terminated successfully"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to terminate session: {str(e)}"
        )


async def _get_artifact_local_path(storage, artifact) -> tuple[Path, bool]:
    """
    Get a local path to an artifact, downloading if needed.
    Returns (path, is_temporary).
    """
    if hasattr(storage, "local_path"):
        local = storage.local_path(artifact.storage_key)
        if local is not None and Path(local).exists():
            return Path(local), False

    suffix = Path(artifact.file_name).suffix or ".tmp"
    temp_file = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    temp_file.close()
    temp_path = Path(temp_file.name)
    try:
        await storage.download(artifact.storage_key, temp_path)
        return temp_path, True
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


@router.get("/runs/{run_id}/trajectory/metadata")
async def get_trajectory_metadata(
    run_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get trajectory metadata for a simulation run."""
    from sqlalchemy.orm import selectinload

    from mddatalake.db.models.artifact import Artifact
    from mddatalake.db.models.simulation_run import SimulationRun
    from mddatalake.storage import get_storage_backend
    from mddatalake.visualization.converters import TrajectoryConverter

    # Get simulation run
    run_result = await db.execute(
        select(SimulationRun)
        .options(selectinload(SimulationRun.engine))
        .where(SimulationRun.id == run_id)
    )
    run = run_result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")

    # Find trajectory and topology artifacts
    artifacts_result = await db.execute(
        select(Artifact).where(Artifact.simulation_run_id == run_id)
    )
    artifacts = artifacts_result.scalars().all()

    trajectory_artifact = None
    topology_artifact = None

    for artifact in artifacts:
        is_traj = (
            artifact.artifact_type in ["trajectory", "xtc", "trr", "dcd", "dump", "lammpstrj"]
            or (hasattr(artifact.artifact_type, "value") and artifact.artifact_type.value == "trajectory")
            or artifact.file_name.lower().endswith((".xtc", ".trr", ".dcd", ".dump", ".lammpstrj"))
        )
        is_topo = (
            artifact.artifact_type in ["topology", "gro", "pdb", "data", "top"]
            or (hasattr(artifact.artifact_type, "value") and artifact.artifact_type.value == "topology")
            or artifact.file_name.lower().endswith((".gro", ".pdb", ".data", ".lmp", ".top"))
        )
        if is_traj:
            if trajectory_artifact is None or artifact.file_size_bytes > trajectory_artifact.file_size_bytes:
                trajectory_artifact = artifact
        elif is_topo:
            topology_artifact = artifact

    if not trajectory_artifact or not topology_artifact:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trajectory or topology artifact not found"
        )

    storage = get_storage_backend()
    traj_temp: Path | None = None
    topo_temp: Path | None = None

    try:
        traj_path, is_traj_tmp = await _get_artifact_local_path(storage, trajectory_artifact)
        if is_traj_tmp:
            traj_temp = traj_path

        topo_path, is_topo_tmp = await _get_artifact_local_path(storage, topology_artifact)
        if is_topo_tmp:
            topo_temp = topo_path

        converter = TrajectoryConverter()
        engine_name = run.engine.name if run.engine else "UNKNOWN"

        metadata = await converter.get_trajectory_metadata(
            traj_path,
            topo_path,
            engine_name,
            atom_style=run.atom_style,
        )

        if "error" in metadata and metadata.get("n_frames", 0) == 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Failed to extract trajectory metadata: {metadata['error']}"
            )

        if hasattr(trajectory_artifact, "preview_frame_count"):
            trajectory_artifact.preview_frame_count = metadata.get("n_frames", 0)
            await db.commit()

        return metadata

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to extract metadata: {str(e)}"
        )
    finally:
        if traj_temp:
            traj_temp.unlink(missing_ok=True)
        if topo_temp:
            topo_temp.unlink(missing_ok=True)


@router.get("/runs/{run_id}/topology")
async def get_topology(
    run_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get topology information for a simulation run."""
    from sqlalchemy.orm import selectinload

    from mddatalake.db.models.artifact import Artifact
    from mddatalake.db.models.simulation_run import SimulationRun
    from mddatalake.storage import get_storage_backend
    from mddatalake.visualization.converters import parse_topology_file

    # Get simulation run
    run_result = await db.execute(
        select(SimulationRun)
        .options(selectinload(SimulationRun.engine))
        .where(SimulationRun.id == run_id)
    )
    run = run_result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")

    # Find topology artifact
    artifacts_result = await db.execute(
        select(Artifact).where(Artifact.simulation_run_id == run_id)
    )
    artifacts = artifacts_result.scalars().all()

    topology_artifact = None
    for artifact in artifacts:
        is_topo = (
            artifact.artifact_type in ["topology", "gro", "pdb", "data", "top"]
            or (hasattr(artifact.artifact_type, "value") and artifact.artifact_type.value == "topology")
            or artifact.file_name.lower().endswith((".gro", ".pdb", ".data", ".lmp", ".top"))
        )
        if is_topo:
            topology_artifact = artifact
            break

    if not topology_artifact:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Topology artifact not found"
        )

    storage = get_storage_backend()
    topo_temp: Path | None = None

    try:
        topo_path, is_topo_tmp = await _get_artifact_local_path(storage, topology_artifact)
        if is_topo_tmp:
            topo_temp = topo_path

        engine_name = run.engine.name if run.engine else "UNKNOWN"
        return parse_topology_file(
            topo_path,
            engine=engine_name,
            atom_style=run.atom_style,
            atom_type_mapping=run.atom_type_mapping,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to parse topology: {str(e)}"
        )
    finally:
        if topo_temp:
            topo_temp.unlink(missing_ok=True)



async def _run_preview_background(artifact_id: int):
    """Run preview extraction in background with isolated session."""
    from mddatalake.db.session import AsyncSessionLocal
    from mddatalake.ingestion.preview_service import PreviewExtractionService
    from mddatalake.storage import get_storage_backend
    from mddatalake.db.models.artifact import Artifact
    from sqlalchemy import select

    async with AsyncSessionLocal() as session:
        try:
            # Re-fetch artifact to detach from closed session
            result = await session.execute(
                select(Artifact).where(Artifact.id == artifact_id)
            )
            artifact = result.scalar_one_or_none()
            
            if artifact:
                preview_service = PreviewExtractionService(session, get_storage_backend())
                await preview_service.extract_preview(artifact)
        except Exception as e:
            # Log error (in production use proper logger)
            print(f"Background preview extraction failed: {e}")


@router.get("/runs/{run_id}/preview")
async def get_trajectory_preview(
    run_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Get pre-extracted trajectory preview (first frame).

    This endpoint serves cached preview frames for instant visualization.

    Returns:
        - 200 OK: Preview file (PDB format)
        - 202 Accepted: Preview generation in progress
        - 404 Not Found: No trajectory for this run
        - 500 Internal Server Error: Preview generation failed
    """
    from mddatalake.storage import get_storage_backend

    # Find trajectory artifact
    from mddatalake.core.enums import ArtifactType

    result = await db.execute(
        select(Artifact)
        .where(Artifact.simulation_run_id == run_id)
        .where(Artifact.artifact_type == ArtifactType.TRAJECTORY)
        .order_by(Artifact.file_size_bytes.desc())  # Select largest trajectory if multiple
        .limit(1)
    )
    artifact = result.scalar_one_or_none()

    if not artifact:
        raise HTTPException(404, "Trajectory not found for this run")

    # Check preview status
    if artifact.preview_status == "ready" and artifact.preview_cache_key:
        # Serve cached preview
        storage = get_storage_backend()

        # Download preview to temp file
        temp_file = Path(tempfile.mktemp(suffix=".pdb"))
        await storage.download(artifact.preview_cache_key, temp_file)

        return FileResponse(
            temp_file,
            media_type="chemical/x-pdb",
            headers={
                "X-Preview-Frame-Count": str(artifact.preview_frame_count or 1),
                "X-Preview-Generated-At": artifact.preview_generated_at.isoformat() if artifact.preview_generated_at else "",
                "Cache-Control": "public, max-age=3600"
            }
        )

    elif artifact.preview_status == "processing":
        return JSONResponse(
            status_code=202,
            content={
                "status": "processing",
                "message": "Preview extraction in progress, please retry in a few seconds"
            }
        )

    elif artifact.preview_status == "failed":
        raise HTTPException(
            500,
            f"Preview generation failed: {artifact.preview_error_message or 'Unknown error'}"
        )

    elif artifact.preview_status == "n/a":
        raise HTTPException(
            400,
            "Preview not available for this trajectory (file too large or incompatible format)"
        )

    else:  # pending or None (not set)
        if artifact.preview_status != "pending":
            # Set to pending if not already
            artifact.preview_status = "pending"
            await db.commit()

        # Trigger generation in background
        asyncio.create_task(_run_preview_background(artifact.id))

        return JSONResponse(
            status_code=202,
            content={
                "status": "pending",
                "message": "Preview generation started, please retry shortly"
            }
        )


@router.get("/runs/{run_id}/preview/trajectory")
async def get_preview_trajectory(run_id: int, db: AsyncSession = Depends(get_db)):
    """Animated companion of the preview still: the DCD trajectory.

    404 when the preview is a single frame, so the viewer can skip it.
    """
    from mddatalake.core.enums import ArtifactType
    from mddatalake.storage import get_storage_backend

    result = await db.execute(
        select(Artifact)
        .where(Artifact.simulation_run_id == run_id)
        .where(Artifact.artifact_type == ArtifactType.TRAJECTORY)
        .order_by(Artifact.file_size_bytes.desc())
        .limit(1)
    )
    artifact = result.scalar_one_or_none()
    if not artifact or not artifact.preview_cache_key:
        raise HTTPException(404, "No preview for this run")

    key = artifact.preview_cache_key
    if not key.endswith(".pdb"):
        raise HTTPException(404, "Preview has no trajectory")

    trajectory_key = key[: -len(".pdb")] + ".dcd"
    storage = get_storage_backend()
    if not await storage.exists(trajectory_key):
        raise HTTPException(404, "Preview has no trajectory")

    temp_file = Path(tempfile.mktemp(suffix=".dcd"))
    await storage.download(trajectory_key, temp_file)
    return FileResponse(
        temp_file,
        media_type="chemical/x-dcd",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.post("/runs/{run_id}/preview/regenerate")
async def regenerate_preview(
    run_id: int,
    force: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger preview regeneration for a run.

    Useful if preview generation failed or cache was cleared.
    """

    # Find trajectory artifact
    from mddatalake.core.enums import ArtifactType

    result = await db.execute(
        select(Artifact)
        .where(Artifact.simulation_run_id == run_id)
        .where(Artifact.artifact_type == ArtifactType.TRAJECTORY)
        .order_by(Artifact.file_size_bytes.desc())  # Select largest trajectory if multiple
        .limit(1)
    )
    artifact = result.scalar_one_or_none()

    if not artifact:
        raise HTTPException(404, "Trajectory not found")

    # Check if already ready (unless force=True)
    if artifact.preview_status == "ready" and not force:
        return JSONResponse(
            status_code=200,
            content={
                "message": "Preview already available",
                "cache_key": artifact.preview_cache_key
            }
        )

    # Trigger regeneration
    asyncio.create_task(_run_preview_background(artifact.id))

    return JSONResponse(
        status_code=202,
        content={"message": "Preview regeneration started"}
    )


@router.post("/runs/{run_id}/thumbnail")
async def generate_thumbnail(
    run_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Generate a thumbnail preview image for a simulation run."""
    from mddatalake.db.models.artifact import Artifact
    import tempfile

    # Find topology artifact for thumbnail generation
    artifacts_result = await db.execute(
        select(Artifact).where(Artifact.simulation_run_id == run_id)
    )
    artifacts = artifacts_result.scalars().all()

    topology_artifact = None
    for artifact in artifacts:
        if artifact.artifact_type in ["topology", "gro", "pdb", "top"]:
            topology_artifact = artifact
            break

    if not topology_artifact:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Topology artifact not found"
        )

    try:
        # Generate a simple placeholder thumbnail
        # In production, would use pymol, nglview headless, or similar
        from PIL import Image, ImageDraw

        # Create a simple placeholder image
        img = Image.new('RGB', (300, 200), color=(240, 240, 240))
        draw = ImageDraw.Draw(img)

        # Draw text
        text = f"Run {run_id}\n{topology_artifact.artifact_type}"
        draw.text((150, 100), text, fill=(100, 100, 100), anchor="mm")

        # Save to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as tmp:
            img.save(tmp, format="PNG")
            thumbnail_path = tmp.name

        return {
            "thumbnail_url": f"/api/v1/runs/{run_id}/thumbnail.png",
            "thumbnail_path": thumbnail_path,
            "message": "Placeholder thumbnail generated. Real thumbnail generation requires PyMOL or similar."
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate thumbnail: {str(e)}"
        )

