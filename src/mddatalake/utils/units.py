"""Physical meaning of a run's timestep, per unit system.

A timestep is a bare number until the unit system says what it measures:
``1.0`` is 1 fs in ``real``, 1 ps in ``metal``, 1 ns in ``nano`` and 1τ in
``lj``. Without that, a run's simulated time cannot be reported, and a
reduced-unit run's "0.0 ns" is not merely imprecise, it is meaningless.

Reduced units carry no intrinsic length or time: σ and τ are whatever the
modeller chose. Those two numbers (``lj_length_nm``, ``lj_time_ps``) are
therefore stored on the run and supplied by a person or a project default.
"""

from __future__ import annotations

# Nanoseconds per timestep unit, for the unit systems that define one.
NS_PER_TIMESTEP_UNIT: dict[str, float] = {
    "real": 1e-6,       # fs  -> ns
    "metal": 1e-3,      # ps  -> ns
    "si": 1e9,          # s   -> ns
    "cgs": 1e9,         # s   -> ns
    "electron": 1e-6,   # fs  -> ns
    "micro": 1e3,       # µs  -> ns
    "nano": 1.0,        # ns  -> ns
    "gromacs": 1e-3,    # ps  -> ns
}

UNIT_SYSTEMS: tuple[str, ...] = (
    "real", "metal", "si", "cgs", "electron", "micro", "nano", "lj", "gromacs",
)

# What one timestep counts in, for the UI and for error messages.
TIMESTEP_UNIT: dict[str, str] = {
    "real": "fs",
    "metal": "ps",
    "si": "s",
    "cgs": "s",
    "electron": "fs",
    "micro": "µs",
    "nano": "ns",
    "lj": "τ",
    "gromacs": "ps",
}


def normalise_units(value: str | None) -> str | None:
    """Return a known unit system in lower case, or None."""
    if not value:
        return None
    candidate = value.strip().lower()
    return candidate if candidate in UNIT_SYSTEMS else None


def simulated_time_ns(
    units: str | None,
    timestep: float | None,
    n_steps: int | None,
    lj_time_ps: float | None = None,
) -> float | None:
    """Simulated time in nanoseconds, or None when it cannot be known.

    None is the honest answer for an unknown unit system, and for reduced
    units without the τ mapping — a wrong number is worse than no number.
    """
    if not timestep or not n_steps:
        return None

    system = normalise_units(units)
    if system is None:
        return None

    if system == "lj":
        if not lj_time_ps or lj_time_ps <= 0:
            return None
        # timestep is in τ; lj_time_ps is ps per τ.
        return (timestep * n_steps * lj_time_ps) / 1000.0

    scale = NS_PER_TIMESTEP_UNIT.get(system)
    if scale is None:
        return None
    return timestep * n_steps * scale


def timestep_unit(units: str | None) -> str:
    """What the run's timestep counts in, for display."""
    system = normalise_units(units)
    return TIMESTEP_UNIT.get(system or "", "")
