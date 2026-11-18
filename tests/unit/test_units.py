"""The unit system is what turns a timestep into a duration."""

from mddatalake.utils.units import (
    normalise_units,
    simulated_time_ns,
    timestep_unit,
)


def test_real_units_are_femtoseconds():
    # 1 fs x 1e6 steps = 1 ns
    assert simulated_time_ns("real", 1.0, 1_000_000) == 1.0


def test_metal_units_are_picoseconds():
    assert simulated_time_ns("metal", 0.001, 1_000_000) == 1.0


def test_nano_units_are_nanoseconds():
    assert simulated_time_ns("nano", 0.5, 10) == 5.0


def test_micro_units_are_microseconds():
    # 1 µs * 1000 = 1 ns
    assert simulated_time_ns("micro", 1.0, 1) == 1000.0


def test_si_units_are_seconds():
    assert simulated_time_ns("si", 1e-12, 1000) == 1.0


def test_gromacs_is_picoseconds():
    assert simulated_time_ns("gromacs", 0.002, 500_000) == 1.0


def test_lj_without_tau_is_unknown_not_wrong():
    """A reduced-unit run has no duration until someone supplies τ."""
    assert simulated_time_ns("lj", 0.004, 3000) is None
    assert simulated_time_ns("lj", 0.004, 3000, lj_time_ps=0) is None


def test_lj_with_tau():
    # 3000 steps x 0.004 τ x 2 ps/τ = 24 ps = 0.024 ns
    assert abs(simulated_time_ns("lj", 0.004, 3000, lj_time_ps=2.0) - 0.024) < 1e-12


def test_unknown_units_give_no_number():
    assert simulated_time_ns(None, 1.0, 1000) is None
    assert simulated_time_ns("furlongs", 1.0, 1000) is None


def test_missing_inputs_give_no_number():
    assert simulated_time_ns("real", None, 1000) is None
    assert simulated_time_ns("real", 1.0, None) is None


def test_normalise_and_labels():
    assert normalise_units(" LJ ") == "lj"
    assert normalise_units("REAL") == "real"
    assert normalise_units("bogus") is None
    assert timestep_unit("lj") == "τ"
    assert timestep_unit("real") == "fs"
