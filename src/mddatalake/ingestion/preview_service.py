"""Preview extraction service for trajectory files."""

import logging
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mddatalake.core.config import settings
from mddatalake.db.models import Artifact
from mddatalake.storage.backend import StorageBackend
from mddatalake.utils.checksum import compute_checksum

logger = logging.getLogger(__name__)


class PreviewExtractionService:
    """Service for extracting trajectory preview frames."""

    def __init__(self, db: AsyncSession, storage: StorageBackend):
        """
        Initialize preview extraction service.

        Args:
            db: Database session
            storage: Storage backend
        """
        self.db = db
        self.storage = storage
        self.config = settings

    async def extract_preview(
        self,
        artifact: Artifact,
        topology_artifact: Artifact | None = None
    ) -> bool:
        """
        Extract preview frames for a trajectory artifact.

        Steps:
        1. Check if artifact is trajectory type
        2. Verify file size < max threshold
        3. Update status to 'processing'
        4. Download trajectory + topology from storage
        5. Extract N frames using MDAnalysis
        6. Save preview to cache directory
        7. Upload preview to storage backend
        8. Update artifact with preview metadata
        9. Set status to 'ready' or 'failed'

        Args:
            artifact: Trajectory artifact to extract preview from
            topology_artifact: Optional topology artifact (auto-detected if None)

        Returns:
            True if successful, False otherwise
        """
        try:
            # Check if trajectory
            from mddatalake.core.enums import ArtifactType
            if artifact.artifact_type != ArtifactType.TRAJECTORY:
                logger.info(f"Artifact {artifact.id} is not a trajectory ({artifact.artifact_type})")
                artifact.preview_status = "n/a"
                await self.db.commit()
                return False

            # Check file size. Above the threshold we do not give up: a preview
            # only needs the opening frames, so fetch the head of the file
            # instead of downloading tens of gigabytes.
            max_size_bytes = self.config.preview_max_file_size_mb * 1024 * 1024
            use_head = artifact.file_size_bytes > max_size_bytes
            head_bytes = getattr(self.config, "preview_head_bytes", 0)

            if use_head:
                download_head = getattr(self.storage, "download_head", None)
                if not head_bytes or not callable(download_head):
                    logger.info(
                        f"Artifact {artifact.id} too large for preview "
                        f"({artifact.file_size_bytes} bytes > {max_size_bytes} bytes) "
                        "and the backend cannot read a partial file"
                    )
                    artifact.preview_status = "n/a"
                    await self.db.commit()
                    return False
                logger.info(
                    f"Artifact {artifact.id} is {artifact.file_size_bytes} bytes; "
                    f"reading the first {head_bytes} bytes for its preview"
                )

            # Update status to processing
            artifact.preview_status = "processing"
            # Stamp the attempt so a run that dies mid-way can be recognised as
            # stale and retried instead of sitting in "processing" forever.
            artifact.preview_generated_at = datetime.utcnow()
            await self.db.commit()

            # Download files to temp location
            temp_dir = Path(tempfile.mkdtemp(prefix="preview_"))
            try:
                trajectory_path = temp_dir / artifact.file_name
                if use_head:
                    head_path = await self.storage.download_head(  # type: ignore[attr-defined]
                        artifact.storage_key, head_bytes
                    )
                    shutil.move(str(head_path), trajectory_path)
                    self._trim_partial_frame(trajectory_path)
                else:
                    await self.storage.download(artifact.storage_key, trajectory_path)

                # Get topology artifact
                if not topology_artifact:
                    topology_artifact = await self._find_topology_artifact(artifact.simulation_run_id)

                if not topology_artifact:
                    raise ValueError("Topology artifact not found")

                topology_path = temp_dir / topology_artifact.file_name
                await self.storage.download(topology_artifact.storage_key, topology_path)

                # Extract frames
                output_format = self.config.preview_format
                output_path = temp_dir / f"preview_{artifact.id}.{output_format}"

                # Get engine name, atom_style, and atom_type_mapping from simulation run
                await self.db.refresh(artifact, ["simulation_run"])
                await self.db.refresh(artifact.simulation_run, ["engine"])
                engine_name = artifact.simulation_run.engine.name
                atom_style = artifact.simulation_run.atom_style.value if artifact.simulation_run.atom_style else None
                atom_type_mapping = artifact.simulation_run.atom_type_mapping

                await self._extract_frames(
                    trajectory_path,
                    topology_path,
                    output_path,
                    engine_name=engine_name,
                    frame_count=self.config.preview_frame_count,
                    atom_style=atom_style,
                    atom_type_mapping=atom_type_mapping
                )

                # Upload preview to storage
                preview_checksum = compute_checksum(output_path)
                preview_key = await self.storage.upload(
                    output_path,
                    f"previews/artifact_{artifact.id}",
                    preview_checksum
                )

                # Update artifact
                artifact.preview_cache_key = preview_key
                artifact.preview_frame_count = self.config.preview_frame_count
                artifact.preview_generated_at = datetime.utcnow()
                artifact.preview_status = "ready"
                # Clear whatever a previous failed attempt recorded.
                artifact.preview_error_message = None
                await self.db.commit()

                logger.info(f"Preview extracted for artifact {artifact.id}")
                return True

            finally:
                # Cleanup temp directory
                shutil.rmtree(temp_dir, ignore_errors=True)

        except Exception as e:
            logger.error(f"Preview extraction failed for artifact {artifact.id}: {e}")
            artifact.preview_status = "failed"
            artifact.preview_error_message = str(e)
            await self.db.commit()
            return False

    def _convert_atom_style_to_mda_format(self, atom_style: str) -> str:
        """
        Convert LAMMPS atom style name to MDAnalysis column specification.

        Args:
            atom_style: LAMMPS atom style name (e.g., "full", "full/gc/HAdResS")

        Returns:
            MDAnalysis column specification string
        """
        # Mapping of LAMMPS atom styles to MDAnalysis column specs
        atom_style_map = {
            "atomic": "id type x y z",
            "bond": "id mol type x y z",
            "angle": "id mol type x y z",
            "molecular": "id mol type x y z",
            "full": "id mol type q x y z",
            "charge": "id type q x y z",
            "dipole": "id type q x y z mux muy muz",
            "sphere": "id type diameter density x y z",
            "ellipsoid": "id type ellipsoidflag density x y z",
            # H-AdResS custom format
            "full/gc/HAdResS": "id mol type q replambdaH moltypeH reservoirH x y z",
        }

        return atom_style_map.get(atom_style, "id type x y z")

    async def _extract_frames(
        self,
        trajectory_path: Path,
        topology_path: Path,
        output_path: Path,
        engine_name: str,
        frame_count: int,
        atom_style: str | None = None,
        atom_type_mapping: dict | None = None
    ) -> None:
        """
        Extract first N frames using MDAnalysis.

        Args:
            trajectory_path: Path to trajectory file
            topology_path: Path to topology file
            output_path: Path to output preview file
            engine_name: Engine name (LAMMPS, GROMACS, etc.)
            frame_count: Number of frames to extract
            atom_style: LAMMPS atom style (optional, for custom formats)
            atom_type_mapping: Atom type to element/name mapping (optional)
        """
        import MDAnalysis as mda

        # Load universe based on engine
        engine_upper = engine_name.upper()

        if engine_upper == "LAMMPS":
            # A LAMMPS data file cannot be read without knowing the atom style,
            # and plenty of runs never record one. Try the stored style first,
            # then the common ones; the Atoms section decides which is right.
            candidates: list[str] = []
            if atom_style:
                candidates.append(self._convert_atom_style_to_mda_format(atom_style))
            for fallback in ("full", "charge", "molecular", "atomic", "id type x y z"):
                if fallback not in candidates:
                    candidates.append(fallback)

            is_pdb_topology = topology_path.suffix.lower() == ".pdb"
            universe = None
            last_error: Exception | None = None

            for style in candidates:
                try:
                    if is_pdb_topology:
                        universe = mda.Universe(
                            str(topology_path),
                            str(trajectory_path),
                            format="LAMMPSDUMP",
                            atom_style=style,
                        )
                    else:
                        universe = mda.Universe(
                            str(topology_path),
                            str(trajectory_path),
                            topology_format="DATA",
                            format="LAMMPSDUMP",
                            atom_style=style,
                        )
                    logger.info(f"Loaded LAMMPS topology with atom_style={style!r}")
                    break
                except Exception as e:  # noqa: BLE001 - try the next style
                    last_error = e
                    universe = None

            if universe is None:
                # Last resort: the dump carries id/type/x/y/z itself, so the
                # structure can be built from the trajectory alone. HAdResS
                # data files declare styles like "full/gc/HAdResS/kk" that no
                # reader knows, but their dumps are perfectly ordinary.
                try:
                    universe = mda.Universe(
                        str(trajectory_path),
                        format="LAMMPSDUMP",
                        atom_style="id type x y z",
                    )
                    logger.warning(
                        "Fell back to building the structure from the trajectory "
                        f"({topology_path.name} unreadable: {last_error})"
                    )

                    # The dump only knows atom types. Recover elements from the
                    # data file's Masses section so the viewer can colour atoms
                    # instead of drawing everything as hydrogen-white.
                    masses_by_type = self._parse_lammps_masses(topology_path)
                    if masses_by_type:
                        import numpy as np

                        elements = np.array(
                            [
                                self._element_from_mass(masses_by_type.get(str(t), 0.0))
                                for t in universe.atoms.types
                            ],
                            dtype=object,
                        )
                        universe.add_TopologyAttr("elements", elements)
                        universe.add_TopologyAttr("names", elements.copy())
                        logger.info(
                            f"Assigned elements from the Masses section: "
                            f"{sorted(set(elements))}"
                        )
                except Exception as traj_error:  # noqa: BLE001
                    raise ValueError(
                        "Could not parse the LAMMPS topology with any known atom "
                        f"style (last error: {last_error}); reading the trajectory "
                        f"alone also failed: {traj_error}"
                    )
        elif engine_upper == "GROMACS":
            # GROMACS-specific loading
            universe = mda.Universe(str(topology_path), str(trajectory_path))
        else:
            # Generic loading (try to auto-detect)
            universe = mda.Universe(str(topology_path), str(trajectory_path))

        # Apply atom type mapping or guess element names from masses
        # This is crucial for proper coloring in visualizers
        try:
            if atom_type_mapping and 'mappings' in atom_type_mapping:
                # Use provided atom type mapping
                logger.info("Applying atom type mapping from database")
                from mddatalake.utils.atom_mapping import apply_atom_type_mapping

                # Get atom types as strings
                atom_types = [str(t) for t in universe.atoms.types]

                try:
                    apply_atom_type_mapping(universe, atom_types, atom_type_mapping)
                    logger.info(f"Applied mapping for {len(set(atom_types))} unique atom types")
                except Exception as map_error:
                    logger.warning(f"Failed to apply atom type mapping: {map_error}. Falling back to mass-based guessing.")
                    raise  # Trigger fallback

            elif not hasattr(universe.atoms, 'elements') or (hasattr(universe.atoms, 'elements') and universe.atoms.elements[0] == 'X'):
                # Fallback to mass-based guessing
                if hasattr(universe.atoms, 'masses'):
                    import numpy as np

                    logger.info("No atom type mapping found, using mass-based element guessing")

                    # Mass-based element guessing
                    def guess_element_from_mass(mass):
                        """Guess element from atomic mass."""
                        mass_ranges = {
                            (0.5, 1.5): 'H',
                            (6.5, 7.5): 'Li',
                            (9.5, 11.5): 'B',
                            (11.5, 12.5): 'C',
                            (13.5, 14.5): 'N',
                            (15.5, 16.5): 'O',
                            (18.5, 19.5): 'F',
                            (22.5, 23.5): 'Na',
                            (27.5, 28.5): 'Si',
                            (30.5, 32.5): 'S',
                            (34.5, 36.5): 'Cl',
                        }
                        for (low, high), element in mass_ranges.items():
                            if low <= mass <= high:
                                return element
                        return 'X'  # Unknown

                    # Apply guessing to all atoms
                    elements = np.array([guess_element_from_mass(m) for m in universe.atoms.masses], dtype=object)
                    universe.add_TopologyAttr('elements', elements)

                    # Also set atom names to element symbols for proper coloring in NGL
                    # NGL uses atom names for color scheme
                    universe.add_TopologyAttr('names', elements.copy())

                    unique_elements = set(elements) - {'X'}
                    logger.info(f"Guessed elements from masses: {sorted(unique_elements)}")
        except Exception as e:
            logger.warning(f"Failed to apply atom mapping or guess elements: {e}")

        # Extract frames
        actual_frames = min(frame_count, len(universe.trajectory))

        # Determine output format
        if output_path.suffix.lower() == ".pdb":
            output_format = "PDB"
        elif output_path.suffix.lower() == ".dcd":
            output_format = "DCD"
        else:
            output_format = "PDB"  # Default to PDB

        with mda.Writer(str(output_path), universe.atoms.n_atoms, format=output_format) as writer:
            for i in range(actual_frames):
                universe.trajectory[i]
                writer.write(universe.atoms)

        logger.info(f"Extracted {actual_frames} frames to {output_path}")

    @staticmethod
    def _parse_lammps_masses(path: Path, max_lines: int = 20000) -> dict[str, float]:
        """Read the ``Masses`` section of a LAMMPS data file: type -> mass.

        Deliberately a plain text scan: this file often uses a style MDAnalysis
        refuses to parse, but its Masses section is always simple.
        """
        masses: dict[str, float] = {}
        try:
            in_section = False
            with open(path, "r", errors="replace") as f:
                for _ in range(max_lines):
                    line = f.readline()
                    if not line:
                        break
                    stripped = line.strip()
                    if not stripped:
                        if in_section and masses:
                            break
                        continue
                    if stripped.split("#")[0].strip().lower() == "masses":
                        in_section = True
                        continue
                    if not in_section:
                        continue
                    parts = stripped.split()
                    if len(parts) >= 2:
                        try:
                            masses[parts[0]] = float(parts[1])
                        except ValueError:
                            continue
        except OSError as e:
            logger.warning(f"Could not read masses from {path}: {e}")
        return masses

    @staticmethod
    def _element_from_mass(mass: float) -> str:
        """Map an atomic mass to an element symbol (coarse, sufficient for colour)."""
        ranges = {
            (0.5, 1.5): "H",
            (5.5, 7.0): "Li",
            (9.5, 11.0): "B",
            (11.5, 12.5): "C",
            (13.5, 14.6): "N",
            (15.5, 16.5): "O",
            (18.5, 19.5): "F",
            (22.5, 23.5): "Na",
            (26.5, 27.5): "Al",
            (27.5, 28.5): "Si",
            (30.5, 32.6): "S",
            (34.5, 36.0): "Cl",
            (38.5, 40.0): "K",
            (39.5, 40.5): "Ca",
        }
        for (low, high), element in ranges.items():
            if low <= mass <= high:
                return element
        return "X"

    @staticmethod
    def _trim_partial_frame(path: Path, marker: bytes = b"ITEM: TIMESTEP") -> None:
        """Drop a trailing partial frame from a truncated text trajectory.

        A head of a LAMMPS dump almost never ends on a frame boundary, and a
        reader that hits a half-written frame raises instead of returning the
        frames it did read.
        """
        try:
            size = path.stat().st_size
            if size == 0:
                return
            # Frames are far smaller than this window, so the last marker is
            # inside it unless the head is a single enormous frame.
            window = min(size, 32 * 1024 * 1024)
            with open(path, "rb") as f:
                f.seek(size - window)
                tail = f.read(window)

            index = tail.rfind(marker)
            if index <= 0:
                return

            cut = size - window + index
            if cut < size:
                with open(path, "r+b") as f:
                    f.truncate(cut)
                logger.info(f"Trimmed {size - cut} trailing bytes from {path.name}")
        except OSError as e:
            logger.warning(f"Could not trim partial frame from {path}: {e}")

    async def _find_topology_artifact(self, run_id: int) -> Artifact | None:
        """
        Find topology artifact for a simulation run.

        Args:
            run_id: Simulation run ID

        Returns:
            Topology artifact or None if not found
        """
        from mddatalake.core.enums import ArtifactType
        result = await self.db.execute(
            select(Artifact)
            .where(Artifact.simulation_run_id == run_id)
            .where(Artifact.artifact_type == ArtifactType.TOPOLOGY)
            .limit(1)
        )
        return result.scalar_one_or_none()
