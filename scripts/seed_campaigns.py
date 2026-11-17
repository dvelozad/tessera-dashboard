#!/usr/bin/env python3
"""Propose campaigns from run-name prefixes, then apply them if asked.

Generic: it makes no assumption about a particular project. For every project
it strips the trailing index from each run name (PROD_MUT7b -> PROD_MUT,
CAL1 -> CAL) and proposes one campaign per prefix that at least two runs share.

    .venv/bin/python scripts/seed_campaigns.py            # show proposals
    .venv/bin/python scripts/seed_campaigns.py --apply    # create + assign
    .venv/bin/python scripts/seed_campaigns.py --apply --only LJ_GC
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

from mddatalake.db.models import Project, SimulationRun  # noqa: E402
from mddatalake.db.models.run_group import RunGroup  # noqa: E402
from mddatalake.db.session import AsyncSessionLocal  # noqa: E402

TRAILING_INDEX = re.compile(r"[_-]?\d+[a-z]?$")


def prefix_of(name: str) -> str:
    """PROD_MUT7b -> PROD_MUT, CAL1 -> CAL, AT30b -> AT."""
    stripped = TRAILING_INDEX.sub("", name).strip("_-")
    return stripped or name


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="create and assign")
    parser.add_argument("--only", help="restrict to one project name")
    parser.add_argument("--min-runs", type=int, default=2)
    args = parser.parse_args()

    async with AsyncSessionLocal() as db:
        projects = (await db.execute(select(Project).order_by(Project.name))).scalars().all()

        for project in projects:
            if args.only and project.name != args.only:
                continue

            runs = (
                await db.execute(
                    select(SimulationRun)
                    .options(selectinload(SimulationRun.group))
                    .where(SimulationRun.project_id == project.id)
                )
            ).scalars().all()
            if not runs:
                continue

            by_prefix: dict[str, list[SimulationRun]] = defaultdict(list)
            for run in runs:
                by_prefix[prefix_of(run.run_name)].append(run)

            proposals = {
                prefix: members
                for prefix, members in sorted(by_prefix.items())
                if len(members) >= args.min_runs
            }

            print(f"\n{project.name}  ({len(runs)} runs)")
            if not proposals:
                print("  no proposal: every prefix is unique")
                continue

            existing = {
                group.name
                for group in (
                    await db.execute(
                        select(RunGroup).where(RunGroup.project_id == project.id)
                    )
                ).scalars().all()
            }

            for prefix, members in proposals.items():
                names = ", ".join(run.run_name for run in members[:6])
                mark = " (exists)" if prefix in existing else ""
                print(f"  {prefix:<14} {len(members):>2} runs{mark}: {names}")

            if args.apply:
                created = assigned = 0
                for prefix, members in proposals.items():
                    group = (
                        await db.execute(
                            select(RunGroup).where(
                                RunGroup.project_id == project.id, RunGroup.name == prefix
                            )
                        )
                    ).scalar_one_or_none()
                    if not group:
                        group = RunGroup(
                            project_id=project.id,
                            name=prefix,
                            description=f"seeded from run-name prefix {prefix!r}",
                        )
                        db.add(group)
                        await db.flush()
                        created += 1
                    for run in members:
                        if run.group_id is None:
                            run.group_id = group.id
                            assigned += 1
                await db.commit()
                print(f"  -> created {created} campaign(s), assigned {assigned} run(s)")

    if not args.apply:
        print("\nNothing written. Re-run with --apply to create these campaigns.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
