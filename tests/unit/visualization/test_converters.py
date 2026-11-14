"""Unit tests for trajectory conversion."""

import tempfile
from pathlib import Path

import pytest

from mddatalake.visualization.converters import (
    TrajectoryConverter,
    normalize_atom_style,
    parse_topology_file,
)


@pytest.fixture
def converter():
    """Create converter with temp cache directory."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield TrajectoryConverter(cache_dir=Path(tmpdir))


@pytest.fixture
def lammps_files():
    """Get paths to LAMMPS test files."""
    base_dir = Path(__file__).parent.parent.parent / "fixtures" / "lammps" / "water_nvt"
    return {
        "trajectory": base_dir / "traj.dump",
        "topology": base_dir / "data.water.lmp",
    }


@pytest.fixture
def gromacs_files():
    """Get paths to GROMACS test files."""
    base_dir = Path(__file__).parent.parent.parent / "fixtures" / "gromacs" / "lysozyme"
    return {
        "trajectory": base_dir / "conf.gro",
        "topology": base_dir / "conf.gro",
    }


class TestTrajectoryConverter:
    """Test trajectory format conversion."""

    @pytest.mark.asyncio
    async def test_gromacs_no_conversion_needed(self, converter, gromacs_files):
        """Test that GROMACS files are not converted."""
        traj, top = await converter.convert_if_needed(
            gromacs_files["trajectory"],
            gromacs_files["topology"],
            "GROMACS"
        )

        # Should return original files
        assert traj == gromacs_files["trajectory"]
        assert top == gromacs_files["topology"]

    @pytest.mark.asyncio
    async def test_lammps_conversion_to_dcd(self, converter, lammps_files):
        """Test LAMMPS dump to DCD conversion."""
        pytest.importorskip("MDAnalysis")

        traj, top = await converter.convert_if_needed(
            lammps_files["trajectory"],
            lammps_files["topology"],
            "LAMMPS"
        )

        # Should create new DCD and PDB files
        assert traj.suffix == ".dcd"
        assert top.suffix == ".pdb"
        assert traj.exists()
        assert top.exists()

    @pytest.mark.asyncio
    async def test_conversion_caching(self, converter, lammps_files):
        """Test that conversions are cached."""
        pytest.importorskip("MDAnalysis")

        # First conversion
        traj1, top1 = await converter.convert_if_needed(
            lammps_files["trajectory"],
            lammps_files["topology"],
            "LAMMPS"
        )

        # Second conversion should use cache
        traj2, top2 = await converter.convert_if_needed(
            lammps_files["trajectory"],
            lammps_files["topology"],
            "LAMMPS"
        )

        # Should return same files
        assert traj1 == traj2
        assert top1 == top2

    @pytest.mark.asyncio
    async def test_metadata_extraction_lammps(self, converter, lammps_files):
        """Test metadata extraction from LAMMPS files."""
        pytest.importorskip("MDAnalysis")

        metadata = await converter.get_trajectory_metadata(
            lammps_files["trajectory"],
            lammps_files["topology"],
            "LAMMPS"
        )

        assert "n_atoms" in metadata
        assert "n_frames" in metadata
        assert metadata["n_atoms"] == 32
        assert metadata["n_frames"] == 2  # Our test file has 2 frames

    @pytest.mark.asyncio
    async def test_metadata_extraction_gromacs(self, converter, gromacs_files):
        """Test metadata extraction from GROMACS files."""
        pytest.importorskip("MDAnalysis")

        metadata = await converter.get_trajectory_metadata(
            gromacs_files["trajectory"],
            gromacs_files["topology"],
            "GROMACS"
        )

        assert "n_atoms" in metadata
        assert "n_frames" in metadata
        assert metadata["n_atoms"] == 32

    @pytest.mark.asyncio
    async def test_invalid_engine(self, converter, lammps_files):
        """Test that invalid engine raises error."""
        with pytest.raises(ValueError, match="Unsupported engine"):
            await converter.convert_if_needed(
                lammps_files["trajectory"],
                lammps_files["topology"],
                "INVALID_ENGINE"
            )

    @pytest.mark.asyncio
    async def test_missing_files(self, converter):
        """Test that missing files raise error."""
        with pytest.raises(FileNotFoundError):
            await converter.convert_if_needed(
                Path("/nonexistent/traj.dump"),
                Path("/nonexistent/data.lmp"),
                "LAMMPS"
            )

    def test_checksum_computation(self, converter, lammps_files):
        """Test checksum computation."""
        checksum = converter._compute_checksum(lammps_files["trajectory"])

        # Should be 16-character hex string
        assert len(checksum) == 16
        assert all(c in "0123456789abcdef" for c in checksum)

        # Same file should give same checksum
        checksum2 = converter._compute_checksum(lammps_files["trajectory"])
        assert checksum == checksum2

    @pytest.mark.asyncio
    async def test_metadata_extraction_lammps_with_atom_style(self, converter, lammps_files):
        """Test metadata extraction from LAMMPS files when atom_style is specified."""
        pytest.importorskip("MDAnalysis")

        metadata = await converter.get_trajectory_metadata(
            lammps_files["trajectory"],
            lammps_files["topology"],
            "LAMMPS",
            atom_style="full",
        )

        assert "n_atoms" in metadata
        assert "n_frames" in metadata
        assert metadata["n_atoms"] == 32
        assert metadata["n_frames"] == 2

    def test_normalize_atom_style(self):
        """Test normalization of LAMMPS atom styles."""
        assert normalize_atom_style("full") == "id mol type q x y z"
        assert normalize_atom_style("atomic") == "id type x y z"
        assert normalize_atom_style("id resid type x y z") == "id resid type x y z"
        assert normalize_atom_style(None) is None

    def test_parse_topology_file_lammps(self, lammps_files):
        """Test parsing LAMMPS topology data file."""
        pytest.importorskip("MDAnalysis")

        res = parse_topology_file(lammps_files["topology"], engine="LAMMPS", atom_style="full")
        assert "atoms" in res
        assert "bonds" in res
        assert res["n_atoms"] == 32
        assert len(res["atoms"]) == 32
        first_atom = res["atoms"][0]
        assert "name" in first_atom
        assert "type" in first_atom
        assert "element" in first_atom
        assert "resid" in first_atom
        assert "resname" in first_atom

    def test_parse_topology_file_with_mapping(self, lammps_files):
        """Test parsing LAMMPS topology data file with atom_type_mapping."""
        pytest.importorskip("MDAnalysis")

        mapping = {
            "mappings": {
                "1": {"element": "O", "name": "OW", "residue": "SOL"},
                "2": {"element": "H", "name": "HW", "residue": "SOL"},
            }
        }
        res = parse_topology_file(
            lammps_files["topology"],
            engine="LAMMPS",
            atom_style="full",
            atom_type_mapping=mapping,
        )
        assert res["n_atoms"] == 32
        # Check that atom type 1 has OW and O
        atom1 = [a for a in res["atoms"] if a["type"] == "1"][0]
        assert atom1["name"] == "OW"
        assert atom1["element"] == "O"
        assert atom1["resname"] == "SOL"

    def test_parse_topology_unparseable_raises(self, tmp_path):
        """Test that invalid topology file raises ValueError or FileNotFoundError."""
        pytest.importorskip("MDAnalysis")

        bad_file = tmp_path / "corrupt.lmp"
        bad_file.write_text("Not a real LAMMPS file")

        with pytest.raises(ValueError, match="Failed to parse"):
            parse_topology_file(bad_file, engine="LAMMPS")
