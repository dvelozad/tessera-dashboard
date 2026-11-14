"""Tests for the obleas integration (parsing and config generation)."""

from pathlib import Path

import pytest

from mddatalake.analysis.obleas import ObleasError, parse_dat
from mddatalake.analysis.service import (
    build_lammps_config,
    detect_lammps_units,
    selections_from_mapping,
)

# Real headers produced by obleas v0.2.0.
RDF = """r_nm g
# reference_selection oxygen = type 2
# partner_selection oxygen = type 2
2.3275750000000001e-03 0.0000000000000000e+00
6.9827250000000004e-03 0.0000000000000000e+00
1.1637875000000000e-02 1.2340000000000000e-01
"""

DENSITY = """# Density profile
# selection oxygen = type 2
# axis z
position_nm density_nm^-3
-0.92172 21.6844
-0.903099 21.6844
"""

DIFFUSION = """# time_ps MSD_nm2 D_nm2_per_ps selection=oxygen
0.0000000000000000e+00 0.0000000000000000e+00 0.0000000000000000e+00
1.0000000000000000e-02 4.6469223851165935e-05 0.0000000000000000e+00
2.0000000000000000e-02 1.9899035896776395e-04 1.0000000000000000e-06
"""

ENERGY = """# GROMACS Energies
# Columns: Time (ps) Potential (kJ/mol) Temperature (K) Pressure (bar)
0.00000000e+00  -1.01206953e+04  3.09955292e+02  8.03849609e+02
1.00000000e-02  -1.05729766e+04  3.92026886e+02  1.03383508e+03
2.00000000e-02  -1.07956621e+04  4.33114410e+02  9.65862976e+02
"""


def _write(tmp_path: Path, name: str, text: str) -> Path:
    path = tmp_path / name
    path.write_text(text)
    return path


def test_parse_rdf(tmp_path: Path):
    series = parse_dat(_write(tmp_path, "g_avg.dat", RDF), analysis="rdf")

    assert len(series) == 1
    assert series[0].name == "g"
    assert series[0].unit is None
    assert series[0].x_name == "r"
    assert series[0].x_unit == "nm"
    assert len(series[0].x) == 3
    assert series[0].y[-1] == pytest.approx(0.1234)


def test_parse_density_profile(tmp_path: Path):
    series = parse_dat(_write(tmp_path, "density_avg.dat", DENSITY), analysis="density")

    assert series[0].name == "density"
    assert series[0].unit == "nm^-3"
    assert series[0].x[0] == pytest.approx(-0.92172)


def test_parse_diffusion_ignores_trailing_annotation(tmp_path: Path):
    series = parse_dat(_write(tmp_path, "D_avg.dat", DIFFUSION), analysis="diffusion")

    # MSD and D are separate series; the selection=... token is not a column.
    assert [s.name for s in series] == ["MSD", "D"]
    assert series[0].unit == "nm2"
    assert series[1].unit == "nm2_per_ps"
    assert series[0].x_unit == "ps"


def test_parse_gromacs_energy_columns(tmp_path: Path):
    series = parse_dat(_write(tmp_path, "energy_0.dat", ENERGY), analysis="gmx_energy")

    names = [s.name for s in series]
    assert names == ["Potential", "Temperature", "Pressure"]
    assert series[1].unit == "K"
    assert series[2].unit == "bar"
    assert series[0].x_name == "Time"
    assert len(series[0].x) == 3


def test_parse_rejects_file_without_header(tmp_path: Path):
    path = _write(tmp_path, "empty.dat", "1 2\n3 4\n")
    with pytest.raises(ObleasError):
        parse_dat(path)


def test_detect_lammps_units(tmp_path: Path):
    script = _write(tmp_path, "in.run", "units metal\natom_style atomic\n")
    assert detect_lammps_units([script]) == "metal"


def test_detect_lammps_units_defaults_to_real(tmp_path: Path):
    script = _write(tmp_path, "in.run", "atom_style atomic\n")
    assert detect_lammps_units([script]) == "real"


def test_selections_from_mapping():
    mapping = {
        "mappings": {
            "1": {"element": "O"},
            "2": {"element": "H"},
            "3": {"element": "H"},
        }
    }
    selections = selections_from_mapping(mapping)

    assert selections == {"O": [1], "H": [2, 3]}


def test_selections_from_flat_mapping():
    assert selections_from_mapping({"1": "Na"}) == {"Na": [1]}
    assert selections_from_mapping(None) == {}


def test_build_lammps_config():
    config = build_lammps_config(
        trajectory="traj.lammpstrj",
        units="real",
        timestep=1.0,
        selections={"O": [2], "H": [1]},
        label="tessera_test",
    )

    assert "trajectory traj.lammpstrj" in config
    assert "lammps_units real" in config
    assert "timestep 1" in config
    assert "select O type 2" in config
    assert "select H type 1" in config
    assert "select H type 1" in config
    assert "analysis rdf 200 ref O sel H" in config
    assert "analysis density" in config
    assert "analysis diffusion" in config
    assert "average_results true" in config


def test_build_lammps_config_without_timestep_skips_diffusion():
    config = build_lammps_config(
        trajectory="t.lammpstrj",
        units="lj",
        timestep=None,
        selections={},
        label="x",
    )
    assert "analysis diffusion" not in config
    assert "timestep" not in config


def test_existing_paths_accepts_a_bare_string(tmp_path: Path):
    """The parsers store 'input' and 'data' as strings, not lists."""
    from mddatalake.analysis.service import _existing_paths

    script = _write(tmp_path, "in.run", "units real\n")

    assert _existing_paths(str(script)) == [script]
    assert _existing_paths([str(script), "/does/not/exist"]) == [script]
    assert _existing_paths(None) == []


def test_build_lammps_config_comma_separates_types():
    """obleas splits type values on commas; spaces are a syntax error."""
    config = build_lammps_config(
        trajectory="t.lammpstrj",
        units="real",
        timestep=1.0,
        selections={"all": [1, 2, 3]},
        label="x",
    )
    assert "select all type 1,2,3" in config


def test_resolve_for_read_follows_symlinks(tmp_path: Path):
    """Simulation dirs symlink shared data files; the lake must store bytes."""
    from mddatalake.utils.files import resolve_for_read

    real = _write(tmp_path, "data.real", "0 0 0\n")
    link = tmp_path / "data.lmp"
    link.symlink_to(real)

    assert resolve_for_read(link) == real
    assert resolve_for_read(tmp_path / "missing") is None
    assert resolve_for_read(tmp_path) is None
