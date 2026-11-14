#!/usr/bin/env python3
"""Fill project metadata from what the runs actually show.

Sets the lead and institution, and writes a description built only from
observed facts (engines, ensembles, system size, temperature range). It never
asserts a method, force field or scientific claim that the data does not carry.

    TESSERA_URL=... TESSERA_EMAIL=... TESSERA_PASSWORD=... \
        python3 scripts/backfill_project_metadata.py [--dry-run]

Existing non-empty descriptions are left alone unless --overwrite is given.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".local/share/tessera"))

import tessera_ctl as tc  # noqa: E402

PI_NAME = "Diego Veloza Diaz"
INSTITUTION = "Max Planck Institute for Polymer Research"


def fmt_atoms(value: int) -> str:
    if value >= 1e6:
        return f"{value / 1e6:.1f}M"
    if value >= 1e3:
        return f"{value / 1e3:.1f}k"
    return str(value)


def describe(runs: list[dict]) -> str | None:
    if not runs:
        return None

    engines = sorted({r["engine"]["name"] for r in runs if r.get("engine")})
    ensembles = sorted({r["ensemble"] for r in runs if r.get("ensemble")})
    atoms = [r["system"]["n_atoms"] for r in runs if r.get("system", {}).get("n_atoms")]
    temps = sorted({r["temperature_target"] for r in runs if r.get("temperature_target") is not None})

    parts = []
    if engines:
        parts.append(f"{' / '.join(engines)} simulations")
    parts.append(f"{len(runs)} run{'s' if len(runs) != 1 else ''}")
    if ensembles:
        parts.append(f"ensembles {' · '.join(ensembles)}")
    if atoms:
        low, high = min(atoms), max(atoms)
        parts.append(f"{fmt_atoms(low)} atoms" if low == high else f"{fmt_atoms(low)}–{fmt_atoms(high)} atoms")
    if temps:
        parts.append(f"{temps[0]}–{temps[-1]} K" if len(temps) > 1 else f"{temps[0]} K")

    return "; ".join(parts) + "."


def keywords_for(project: dict, runs: list[dict]) -> list[str]:
    words = [token.lower() for token in project["name"].replace('-', '_').split('_') if token]
    words += [r["engine"]["name"].lower() for r in runs if r.get("engine")]
    seen: list[str] = []
    for word in words:
        if word and word not in seen:
            seen.append(word)
    return seen[:8]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--overwrite", action="store_true", help="replace existing descriptions")
    args = parser.parse_args()

    projects = tc.call("GET", "projects")
    runs = tc.call("GET", "runs?limit=1000")["runs"]

    for project in projects:
        mine = [r for r in runs if r.get("project_name") == project["name"]]
        payload: dict = {}

        if not project.get("pi_name"):
            payload["pi_name"] = PI_NAME
        if not project.get("institution"):
            payload["institution"] = INSTITUTION
        if project.get("keywords") in (None, []):
            payload["keywords"] = keywords_for(project, mine)
        if not project.get("description") or args.overwrite:
            description = describe(mine)
            if description:
                payload["description"] = description

        if not payload:
            print(f"{project['name']}: nothing to fill")
            continue

        print(f"{project['name']}: {payload}")
        if not args.dry_run:
            tc.call("PATCH", f"projects/{project['id']}", payload)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
