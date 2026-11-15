# Obleas integration

obleas is the lab's C++/MPI analysis suite. Tessera calls it during `push`, on the
machine that holds the data, and stores the resulting series as observables. No
trajectory bytes move for analysis.

Low-level, verified details of the obleas CLI, config grammar, output files and
pitfalls are in [obleas-reference.md](obleas-reference.md) (written by the Obleas
session on pckr258 and checked against the binary, not the docs).

## Why this split of work

| Source | Temperature / Pressure / Energy | Structure (RDF, density, MSD) |
|---|---|---|
| LAMMPS | **Tessera's log parser** — obleas does not emit LAMMPS thermo series | obleas |
| GROMACS | **obleas** `gmx energy -e <edr>` | obleas |

That split is not arbitrary: obleas' native LAMMPS analyses never consume energy
values, and conversely our parser only understands logs. Between them, every run
gets thermodynamics when it has a log or an `.edr`, and structure when it has a
trajectory.

## Pipeline

```
pckr258 (or wherever the data is)
  tessera push <dir> --analyze
      ├── parse the run, upload blobs to Drive
      ├── obleas runs locally:
      │     LAMMPS  → generated .anls → output/<label>/{rdf,density_profile,diffusion}
      │     GROMACS → gmx energy -e <stage>.edr
      └── record.json gains an "analyses" list (name, unit, x, y, source)

bigmsi
  tessera import record.json
      └── creates the run, then one Observable per series
```

Re-pushing a run that already exists attaches only the new series, so adding
analyses later never duplicates the run.

## What is generated

**LAMMPS** (`analysis/service.py::build_lammps_config`):

```text
trajectory traj.lammpstrj
trajectory_type lammps
lammps_units real            # parsed from the input script's `units` line
timestep 1                   # from the run metadata
output_label tessera_<run>
average_results true
select all type 1,2,3        # comma-separated; spaces are a syntax error
analysis density 100 axis z kind number selection all
analysis rdf 200 ref O all   # only when two selections exist
analysis diffusion           # only when a timestep is known
```

Selections come from the run's atom-type mapping (`atom_types.json`) when present.
Without one, every type declared in the data file's `Masses` section becomes a
single `all` selection, because obleas refuses a `density` without one.

**GROMACS**: `obleas gmx energy -e <edr> -terms "Potential Temperature Pressure"`.
A staged run has one `.edr` per stage, so series are prefixed with the stage:
`npt_prod/Temperature`, `npt_eq/Pressure`.

## Verified results

| Run | Data | What Tessera got |
|---|---|---|
| `analysis-test/gmx_analyzed` | staged GROMACS (em → nvt → npt_eq → npt_prod) | 11 series: T/P/Potential per stage, units K, bar, kJ/mol |
| `test-matrix/gmx_edr_only` | H-AdResS GROMACS fork, `.edr` only, no trajectory | 3 series (T, P, Potential) |
| `analysis-test/lmp_analyzed` | LAMMPS dump + data | density, g(r), MSD, D |
| `test-matrix/lmp_no_traj` | LAMMPS input + data + log, **no trajectory** | T, P, Pair/Molecular/Total Energy — from the log, no obleas |

The last row is the important one for partial runs: a directory with no trajectory
still yields full thermodynamics, because the log is enough.

## Constraints

* `OBLEAS_BIN` must point at the binary on the analysis host.
* Serial execution is fine; MPI is linked at runtime, so `libmpi` must be present.
* `OBLEAS_TIMEOUT_SECONDS` bounds each run (600 s on pckr258) so a pathological
  trajectory cannot stall an ingest campaign.
* Transport analyses (`diffusion`) fail closed on Monte Carlo streams. A failed
  config is retried once without them so `rdf`/`density` still land.
* `OBLEAS_MAX_TRAJECTORY_GB` can skip very large trajectories; 0 means no limit.

## Building obleas on bigmsi

The binary is C++14 + MPI, and bigmsi has no `mpicxx`. Conda supplies one
without touching the system:

```bash
conda create -y -n obleas-build -c conda-forge openmpi zlib
export PATH=$HOME/miniforge3/envs/obleas-build/bin:$PATH
export OMPI_CXX=/usr/bin/g++        # conda's wrapper expects its own compiler

rsync -a pckr258:/data/.../obleas/{src,Makefile,VERSION} ~/obleas-src/
cd ~/obleas-src && make -j$(nproc)
ln -sf ~/obleas-src/bin/obleas ~/.local/bin/obleas
```

The resulting binary runs without any `LD_LIBRARY_PATH` help. `OBLEAS_BIN`
points the app at it; `enrich_runs.py` uses it for GROMACS `.edr` files.

## Next steps

* GROMACS structural analyses (`obleas gmx rdf/msd/density`) are not wired yet —
  only `.edr` thermodynamics. The CLI and outputs are documented in the reference.
* `tessera analyze <run_id>` for runs already in the lake (re-run obleas against
  a hydrated copy) would remove the need to re-push.
* obleas could emit a JSON manifest for the common analyses; today only
  `thermal_conductivity` and `dynamic_structure_factor` do.
