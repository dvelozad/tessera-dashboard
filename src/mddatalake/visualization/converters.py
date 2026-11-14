"""Trajectory format conversion utilities."""

import hashlib
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

MDA_ATOM_STYLE_MAP = {
    "atomic": "id type x y z",
    "bond": "id mol type x y z",
    "angle": "id mol type x y z",
    "molecular": "id mol type x y z",
    "full": "id mol type q x y z",
    "charge": "id type q x y z",
    "dipole": "id type q x y z mux muy muz",
    "sphere": "id type diameter density x y z",
    "ellipsoid": "id type ellipsoidflag density x y z",
    "full/gc/hadress": "id mol type q replambdaH moltypeH reservoirH x y z",
}


def normalize_atom_style(atom_style: Any) -> str | None:
    """Normalize a LAMMPS atom style into an MDAnalysis column specification."""
    if not atom_style:
        return None
    val = atom_style.value if hasattr(atom_style, "value") else str(atom_style)
    val = val.strip()
    if not val:
        return None
    if " " in val:
        return val
    return MDA_ATOM_STYLE_MAP.get(val.lower())


def parse_topology_file(
    topology_path: Path,
    engine: str = "UNKNOWN",
    atom_style: Any = None,
    atom_type_mapping: Any = None,
) -> dict:
    """
    Parse a topology file into a JSON-serializable structure with atoms and bonds.

    Args:
        topology_path: Local path to topology file
        engine: MD engine name (e.g. LAMMPS, GROMACS)
        atom_style: LAMMPS atom style name or column spec
        atom_type_mapping: Optional dict of atom type mappings

    Returns:
        Dict with "atoms", "bonds", "n_atoms", "n_bonds"
    """
    try:
        import MDAnalysis as mda  # noqa: N813
    except ImportError:
        raise ImportError("MDAnalysis is required to parse topology files")

    topology_path = Path(topology_path)
    if not topology_path.exists():
        raise FileNotFoundError(f"Topology file not found: {topology_path}")

    engine_upper = engine.upper()
    is_lammps = (
        engine_upper == "LAMMPS"
        or topology_path.suffix.lower() in [".lmp", ".data"]
    )

    universe = None
    if is_lammps:
        is_pdb = topology_path.suffix.lower() == ".pdb"
        if is_pdb:
            universe = mda.Universe(str(topology_path))
        else:
            norm_style = normalize_atom_style(atom_style)
            candidates: list[str | None] = []
            if norm_style:
                candidates.append(norm_style)
            for cand in ["id mol type q x y z", "id type x y z", "id mol type x y z", None]:
                if cand not in candidates:
                    candidates.append(cand)

            last_err: Exception | None = None
            for cand in candidates:
                try:
                    kwargs: dict[str, Any] = {"topology_format": "DATA"}
                    if cand:
                        kwargs["atom_style"] = cand
                    universe = mda.Universe(str(topology_path), **kwargs)
                    break
                except Exception as e:
                    last_err = e
                    universe = None

            if universe is None:
                raise ValueError(f"Failed to parse LAMMPS data file: {last_err}")
    else:
        universe = mda.Universe(str(topology_path))

    # Extract type mappings
    type_mappings: dict = {}
    if atom_type_mapping:
        if isinstance(atom_type_mapping, dict):
            type_mappings = atom_type_mapping.get("mappings", atom_type_mapping)

    atoms = []
    for atom in universe.atoms:
        atom_type = ""
        try:
            atom_type = str(atom.type)
        except Exception:
            pass

        map_entry = type_mappings.get(atom_type, {}) if isinstance(type_mappings, dict) else {}

        name = None
        try:
            name = atom.name
        except Exception:
            pass
        if not name and map_entry:
            name = map_entry.get("name")
        if not name:
            name = f"A{atom_type}" if atom_type else f"A{atom.index + 1}"

        resname = ""
        try:
            resname = str(atom.resname)
        except Exception:
            pass
        if not resname and map_entry:
            resname = map_entry.get("residue", "MOL")
        if not resname:
            resname = "MOL"

        resid = 0
        try:
            resid = int(atom.resid)
        except Exception:
            resid = 0

        element = ""
        try:
            element = str(atom.element)
        except Exception:
            pass
        if not element and map_entry:
            element = map_entry.get("element", "")
        if not element:
            try:
                mass = float(atom.mass)
                if 1.0 <= mass <= 1.02:
                    element = "H"
                elif 11.9 <= mass <= 12.1:
                    element = "C"
                elif 13.9 <= mass <= 14.1:
                    element = "N"
                elif 15.9 <= mass <= 16.1:
                    element = "O"
                elif 30.8 <= mass <= 31.2:
                    element = "P"
                elif 31.9 <= mass <= 32.2:
                    element = "S"
            except Exception:
                pass

        atoms.append({
            "index": int(atom.index),
            "name": name,
            "type": atom_type if atom_type else str(name),
            "resname": resname,
            "resid": resid,
            "element": element,
        })

    bonds = []
    if hasattr(universe, "bonds") and universe.bonds:
        try:
            for bond in universe.bonds:
                bonds.append([int(bond.atoms[0].index), int(bond.atoms[1].index)])
        except Exception:
            bonds = []

    return {
        "atoms": atoms,
        "bonds": bonds,
        "n_atoms": len(atoms),
        "n_bonds": len(bonds),
    }


class TrajectoryConverter:
    """
    Convert trajectory files to formats compatible with NGL Viewer.

    Supported conversions:
    - LAMMPS dump -> DCD
    - GROMACS native formats (XTC, TRR) -> no conversion needed
    """

    def __init__(self, cache_dir: Path | None = None):
        """
        Initialize converter.

        Args:
            cache_dir: Directory to cache converted files. Defaults to /tmp/trajectory_cache
        """
        self.cache_dir = cache_dir or Path("/tmp/trajectory_cache")
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    async def convert_if_needed(
        self,
        trajectory_path: Path,
        topology_path: Path,
        engine: str,
        first_frame_only: bool = False,
        atom_style: Any | None = None,
    ) -> tuple[Path, Path]:
        """
        Convert trajectory to viewer-compatible format if needed.

        Args:
            trajectory_path: Path to trajectory file
            topology_path: Path to topology file
            engine: MD engine name (LAMMPS or GROMACS)
            first_frame_only: If True, convert only the first frame for faster loading
            atom_style: Optional LAMMPS atom style

        Returns:
            Tuple of (converted_trajectory, converted_topology)

        Raises:
            ValueError: If engine not supported
            FileNotFoundError: If input files don't exist
        """
        if not trajectory_path.exists():
            raise FileNotFoundError(f"Trajectory file not found: {trajectory_path}")

        if not topology_path.exists():
            raise FileNotFoundError(f"Topology file not found: {topology_path}")

        engine = engine.upper()

        # Check if trajectory and topology are the same file (static structure case)
        if trajectory_path == topology_path:
            logger.info(
                f"Static structure (same file), no conversion needed: {trajectory_path}"
            )
            return trajectory_path, topology_path

        if engine == "GROMACS":
            # GROMACS files are already compatible
            logger.info(f"GROMACS trajectory, no conversion needed: {trajectory_path}")
            return trajectory_path, topology_path

        elif engine == "LAMMPS":
            # LAMMPS dump needs conversion to DCD
            return await self._convert_lammps_to_dcd(
                trajectory_path,
                topology_path,
                first_frame_only=first_frame_only,
                atom_style=atom_style,
            )

        else:
            raise ValueError(f"Unsupported engine: {engine}")

    async def _convert_lammps_to_dcd(
        self,
        dump_file: Path,
        data_file: Path,
        first_frame_only: bool = False,
        atom_style: Any | None = None,
    ) -> tuple[Path, Path]:
        """
        Convert LAMMPS dump file to DCD format.

        Args:
            dump_file: LAMMPS dump file
            data_file: LAMMPS data file (topology) - can be DATA or PDB format
            first_frame_only: If True, convert only the first frame
            atom_style: Optional LAMMPS atom style

        Returns:
            Tuple of (dcd_file, pdb_file)
        """
        try:
            import MDAnalysis as mda  # noqa: N813
        except ImportError:
            raise ImportError(
                "MDAnalysis is required for LAMMPS conversion. "
                "Install with: pip install MDAnalysis"
            )

        # Generate cache keys based on file checksums
        dump_checksum = self._compute_checksum(dump_file)
        data_checksum = self._compute_checksum(data_file)
        cache_key = f"{dump_checksum}_{data_checksum}"
        if first_frame_only:
            cache_key += "_first_frame"

        # Check cache
        cached_dcd = self.cache_dir / f"{cache_key}.dcd"
        cached_pdb = self.cache_dir / f"{cache_key}.pdb"

        if cached_dcd.exists() and cached_pdb.exists():
            logger.info(f"Using cached conversion: {cached_dcd}")
            return cached_dcd, cached_pdb

        logger.info(f"Converting LAMMPS dump to DCD: {dump_file}")

        try:
            # Detect topology format based on file extension
            topology_format = None
            if data_file.suffix.lower() == '.pdb':
                topology_format = "PDB"
                logger.info("Detected PDB topology format")
            elif data_file.suffix.lower() in ['.data', '.lmp']:
                topology_format = "DATA"
                logger.info("Detected LAMMPS DATA topology format")

            # Load LAMMPS trajectory
            if topology_format == "PDB":
                universe = mda.Universe(
                    str(data_file),
                    str(dump_file),
                    format="LAMMPSDUMP",
                )
                import shutil
                shutil.copy(str(data_file), str(cached_pdb))
                logger.info(f"Using existing PDB topology: {cached_pdb}")
            else:
                norm_style = normalize_atom_style(atom_style)
                candidates: list[str | None] = []
                if norm_style:
                    candidates.append(norm_style)
                for cand in ["id mol type q x y z", "id type x y z", "id mol type x y z", None]:
                    if cand not in candidates:
                        candidates.append(cand)

                universe = None
                last_err: Exception | None = None
                for cand in candidates:
                    try:
                        kwargs: dict[str, Any] = {
                            "topology_format": "DATA",
                            "format": "LAMMPSDUMP",
                        }
                        if cand:
                            kwargs["atom_style"] = cand
                        universe = mda.Universe(str(data_file), str(dump_file), **kwargs)
                        break
                    except Exception as e:
                        last_err = e
                        universe = None

                if universe is None:
                    try:
                        universe = mda.Universe(
                            str(dump_file),
                            format="LAMMPSDUMP",
                            atom_style="id type x y z",
                        )
                    except Exception:
                        raise last_err or ValueError("Failed to parse LAMMPS files")

                # Write topology as PDB
                logger.info(f"Writing topology to PDB: {cached_pdb}")
                with mda.Writer(str(cached_pdb), universe.atoms.n_atoms) as pdb_writer:
                    pdb_writer.write(universe.atoms)

            # Write trajectory as DCD
            if first_frame_only:
                logger.info(f"Writing first frame only to DCD: {cached_dcd}")
                with mda.Writer(str(cached_dcd), universe.atoms.n_atoms) as dcd_writer:
                    universe.trajectory[0]  # Go to first frame
                    dcd_writer.write(universe.atoms)
            else:
                logger.info(f"Writing trajectory to DCD: {cached_dcd}")
                with mda.Writer(str(cached_dcd), universe.atoms.n_atoms) as dcd_writer:
                    for ts in universe.trajectory:
                        dcd_writer.write(universe.atoms)

            logger.info("Conversion complete")
            return cached_dcd, cached_pdb

        except Exception as e:
            logger.error(f"Conversion failed: {e}")
            # Clean up partial files
            if cached_dcd.exists():
                cached_dcd.unlink()
            if cached_pdb.exists():
                cached_pdb.unlink()
            raise

    def _compute_checksum(self, file_path: Path) -> str:
        """Compute SHA-256 checksum of a file."""
        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                sha256.update(chunk)
        return sha256.hexdigest()[:16]  # First 16 chars

    async def get_trajectory_metadata(
        self,
        trajectory_path: Path,
        topology_path: Path,
        engine: str,
        atom_style: Any | None = None,
    ) -> dict:
        """
        Extract trajectory metadata (frame count, atom count, etc.).

        Args:
            trajectory_path: Path to trajectory file
            topology_path: Path to topology file
            engine: MD engine name
            atom_style: Optional LAMMPS atom style

        Returns:
            Dictionary with metadata
        """
        try:
            import MDAnalysis as mda  # noqa: N813
        except ImportError:
            raise ImportError("MDAnalysis is required for metadata extraction")

        engine = engine.upper()

        try:
            if engine == "GROMACS":
                universe = mda.Universe(str(topology_path), str(trajectory_path))
            elif engine == "LAMMPS":
                if topology_path.suffix.lower() == '.pdb':
                    universe = mda.Universe(
                        str(topology_path),
                        str(trajectory_path),
                        format="LAMMPSDUMP",
                    )
                else:
                    norm_style = normalize_atom_style(atom_style)
                    candidates: list[str | None] = []
                    if norm_style:
                        candidates.append(norm_style)
                    for cand in ["id mol type q x y z", "id type x y z", "id mol type x y z", None]:
                        if cand not in candidates:
                            candidates.append(cand)

                    universe = None
                    last_err: Exception | None = None
                    for cand in candidates:
                        try:
                            kwargs: dict[str, Any] = {
                                "topology_format": "DATA",
                                "format": "LAMMPSDUMP",
                            }
                            if cand:
                                kwargs["atom_style"] = cand
                            universe = mda.Universe(
                                str(topology_path), str(trajectory_path), **kwargs
                            )
                            break
                        except Exception as e:
                            last_err = e
                            universe = None

                    if universe is None:
                        try:
                            universe = mda.Universe(
                                str(trajectory_path),
                                format="LAMMPSDUMP",
                                atom_style="id type x y z",
                            )
                        except Exception:
                            raise last_err or ValueError("Failed to parse LAMMPS files")
            else:
                raise ValueError(f"Unsupported engine: {engine}")

            metadata = {
                "n_atoms": int(universe.atoms.n_atoms),
                "n_frames": int(len(universe.trajectory)),
                "dt": float(universe.trajectory.dt),  # timestep in ps
                "total_time": float(universe.trajectory.totaltime),  # total time in ps
                "format": trajectory_path.suffix[1:],  # Remove leading dot
            }

            logger.info(f"Extracted metadata: {metadata}")
            return metadata

        except Exception as e:
            logger.error(f"Failed to extract metadata: {e}")
            # Return minimal metadata
            return {
                "n_atoms": 0,
                "n_frames": 0,
                "dt": 0.0,
                "total_time": 0.0,
                "format": trajectory_path.suffix[1:],
                "error": str(e)
            }
