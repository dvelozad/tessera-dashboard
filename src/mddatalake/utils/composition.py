"""Derive a system's composition from its LAMMPS data file.

The parser cannot know chemistry by itself, so the tables showed "Unknown" for
every run. A LAMMPS data file does carry what is needed: the ``Masses`` section
maps atom type to mass, and the ``Atoms`` section says how many atoms of each
type exist. Counting the two gives a formula such as ``C240H560O140``.
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# LAMMPS data-file sections, as written by write_data.
SECTIONS = {
    "Masses",
    "Atoms",
    "Velocities",
    "Bonds",
    "Angles",
    "Dihedrals",
    "Impropers",
    "Pair Coeffs",
    "PairIJ Coeffs",
    "Bond Coeffs",
    "Angle Coeffs",
    "Dihedral Coeffs",
    "Improper Coeffs",
    "BondBond Coeffs",
    "BondAngle Coeffs",
    "MiddleBondTorsion Coeffs",
    "EndBondTorsion Coeffs",
    "AngleTorsion Coeffs",
    "AngleAngleTorsion Coeffs",
    "BondBond13 Coeffs",
    "AngleAngle Coeffs",
}

# Coarse element windows: enough to label atoms, not to do chemistry.
MASS_RANGES = [
    ((0.5, 1.5), "H"),
    ((3.5, 4.5), "He"),
    ((5.5, 7.0), "Li"),
    ((8.5, 9.5), "Be"),
    ((9.5, 11.0), "B"),
    ((11.5, 12.5), "C"),
    ((13.5, 14.6), "N"),
    ((15.5, 16.5), "O"),
    ((18.5, 19.5), "F"),
    ((20.0, 21.0), "Ne"),
    ((22.5, 23.5), "Na"),
    ((23.9, 24.6), "Mg"),
    ((26.5, 27.5), "Al"),
    ((27.5, 28.6), "Si"),
    ((30.5, 31.5), "P"),
    ((31.5, 32.6), "S"),
    ((34.5, 36.0), "Cl"),
    ((38.5, 40.0), "K"),
    ((39.0, 40.6), "Ca"),
    ((54.0, 56.0), "Fe"),
    ((62.5, 64.0), "Cu"),
    ((78.0, 79.5), "Br"),
    ((126.0, 128.0), "I"),
]


def element_from_mass(mass: float) -> str:
    for (low, high), element in MASS_RANGES:
        if low <= mass <= high:
            return element
    return "X"


def lammps_composition(path: Path, max_lines: int = 5_000_000) -> str | None:
    """Return a formula like ``C240H560O140`` for a LAMMPS data file.

    Returns None when the file has no readable Atoms/Masses sections, and
    ``coarse-grained`` when every type carries unit mass (a CG model).
    """
    path = Path(path)
    masses: dict[int, float] = {}
    counts: dict[int, int] = {}
    section: str | None = None
    type_column = 2  # 1-based; "id type ..." for styles without a molecule id
    saw_atoms = False
    section_rows = 0

    try:
        with open(path, "r", errors="replace") as handle:
            for _ in range(max_lines):
                line = handle.readline()
                if not line:
                    break
                stripped = line.strip()

                if not stripped:
                    # LAMMPS puts a blank line right after a section header, so
                    # a blank only closes the block once it has rows.
                    if section is not None and section_rows > 0:
                        section = None
                    continue

                head = stripped.split("#")[0].strip()
                if head in SECTIONS:
                    section = head
                    comment = stripped.split("#", 1)[1].strip().lower() if "#" in stripped else ""
                    section_rows = 0
                    if head == "Atoms":
                        saw_atoms = True
                        # full, molecular, bond, angle carry a molecule id
                        type_column = 3 if any(k in comment for k in ("mol", "full", "bond", "angle")) else 2
                    continue

                section_rows += 1

                if section == "Masses":
                    parts = stripped.split()
                    if len(parts) >= 2:
                        try:
                            masses[int(parts[0])] = float(parts[1])
                        except ValueError:
                            continue
                elif section == "Atoms":
                    parts = stripped.split()
                    if len(parts) >= type_column:
                        try:
                            atom_type = int(parts[type_column - 1])
                        except ValueError:
                            continue
                        counts[atom_type] = counts.get(atom_type, 0) + 1
    except OSError as error:
        logger.warning(f"Cannot read {path}: {error}")
        return None

    if not saw_atoms or not counts:
        return None

    if not masses:
        return f"{sum(counts.values())} atoms, {len(counts)} types"

    if all(abs(mass - 1.0) < 0.05 for mass in masses.values()):
        return "coarse-grained (unit masses)"

    by_element: dict[str, int] = {}
    for atom_type, count in counts.items():
        element = element_from_mass(masses.get(atom_type, 0.0))
        by_element[element] = by_element.get(element, 0) + count

    ordered = sorted(by_element.items(), key=lambda item: (-item[1], item[0]))
    return "".join(
        f"{element}{count if count > 1 else ''}" for element, count in ordered
    )
