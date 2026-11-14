# obleas integration reference for Tessera

Verified against `/data/bee14/diazd/projects/obleas` at `main` = `66a5a96`, and against
`bin/obleas` built 2026-11-13. Every behaviour below was produced by running the binary
on `tests/fixtures/`, not read from documentation. Probe runs live in `/tmp/obleas_probe`,
`/tmp/gmxprobe`, `/tmp/nptprobe`, `/tmp/gmxcfg`.

---

## 1. Build and run

`bin/obleas` is built: 4.7 MB, dated 2026-11-13, `--version` reports
`obleas v0.2.0 (MPI + OpenMP)`. The `VERSION` file in the repo still says `0.1.0`, so
pin the version from `--version`, not from that file.

Two entry points share one engine:

```bash
bin/obleas run.anls                                  # config-file mode
bin/obleas lmp rdf -f traj.lammpstrj -units metal -type 2 -bins 200
```

Serial invocation needs no `mpirun`:

```bash
bin/obleas run.anls
```

MPI is linked dynamically (`libmpi.so.40`), and `MPI_Init_thread` runs in the `Analyzer`
constructor (`src/analyzer.cpp:304`). So a working `libmpi` must be resolvable at runtime,
but the bare binary runs as a singleton. Verified: serial run exit 0; `mpirun -np 2` also
exit 0, splitting frames across ranks. Set `MPI ranks: 1` expectations accordingly, and
note that with N ranks and no averaging you get N output files.

Exit codes: `0` on a completed analysis (a physical finding is not an error), `1` on
usage error or any fail-closed condition.

---

## 2. Config grammar (`.anls`)

Whitespace-separated `key value`, one directive per line, `#` starts a comment.
No schema, no version field. Order does not matter except that `analysis` lines are
evaluated after their referenced `select` lines.

Directives Tessera will generate:

| Key | Values | Notes |
|---|---|---|
| `trajectory` | path | `.lammpstrj`, `.xtc`, `.trr`, `.gro`, `.xyz`, `.pdb` |
| `trajectory_type` | `lammps`, `gromacs`, `xyz`, `mc` | `mc` routes to the fail-closed MC path |
| `lammps_units` (alias `units`) | `real`, `metal`, `si`, `cgs`, `electron`, `micro`, `nano`, `lj` | required in practice; `lj` needs the scale keys |
| `lj_length_nm`, `lj_energy_kj_mol`, `lj_time_ps` | float | mandatory for `lammps_units lj` |
| `timestep` | float | required for diffusion, conductivity, mbr, rotational_relaxation |
| `time_unit` | `fs`, `ps`, `ns`, `us`, `s` | defaults to the unit style's time unit |
| `particles` | int | optional; inferred from the trajectory header |
| `frames` | int | optional frame cap |
| `frame_selection` | `all`, `first`, `last`, `range A B`, `stride N` | raw rest-of-line, see pitfalls |
| `target_type` | `2` or `2,5,10` | LAMMPS atom types |
| `gromacs_target` | `OW SOL` | atom name plus residue name |
| `gromacs_type_mapping` | `OW 2` | maps a GROMACS name onto a numeric type |
| `gmx_tpr` | path | optional topology/structure for GROMACS |
| `lammps_data` (aliases `topology`, `lammps_topology`) | path | only for molecule-level analyses |
| `output_label` | string | names `output/<label>/`; collisions overwrite silently |
| `average_results` | `true`/`false` | **set true in production** |
| `select <name> <expression>` | e.g. `type 2` | named selection, usable by analyses |
| `analysis <name> <params>` | see below | one line per analysis |

`analysis` line grammars differ per analysis, and the differences are not cosmetic:

- `analysis rdf <bins>` also accepts `ref <name> sel <name>` or falls back to `target_type`.
- `analysis diffusion selection <name>` takes **no** bin count. A bare
  `analysis diffusion 100` fails with `Error: Unknown diffusion option '100'`.
- `analysis density_profile bins <n> axis <z> selection <name>`.

### LAMMPS example

```text
trajectory /runs/melt/traj.lammpstrj
trajectory_type lammps
lammps_units metal
timestep 0.001
time_unit ps
output_label ingress_0042
average_results true
select oxy type 2
analysis rdf 200 sel oxy
analysis density_profile bins 100 axis z selection oxy
analysis diffusion selection oxy
```

### GROMACS example

```text
trajectory /runs/water/traj.xtc
trajectory_type gromacs
gmx_tpr /runs/water/topol.tpr
output_label ingress_0043
average_results true
gromacs_target OW SOL
analysis rdf 200 ref OW sel OW
```

`gmx_tpr` is optional: the same config without it also runs (verified, exit 0).

---

## 3. Outputs

```text
output/<output_label>/<analysis_type>/
```

`<analysis_type>` is the directive name verbatim (`rdf`, `density_profile`, `diffusion`).
Each analysis writes `<prefix>_<rank>.dat` per rank, plus `<prefix>_avg.dat` from rank 0
when `average_results true`.

Exact filenames, all verified on the current binary:

| Analysis | Averaged file | Per-rank file |
|---|---|---|
| `rdf`, single target | `g_avg.dat` | `g_1_1_<rank>.dat` |
| `rdf`, two targets | `g_<t1>_<t2>_avg.dat` | `g_<t1>_<t2>_<rank>.dat` |
| `density_profile` | `density_avg.dat` | `density_<rank>.dat` |
| `diffusion` | `D_avg.dat` | `D_<rank>.dat` |

The RDF prefix depends on target cardinality, so glob `*_avg.dat` rather than hardcoding.

Real first lines, current binary:

`rdf` -> `output/probe/rdf/g_avg.dat`

```text
r_nm g
# histogram_cutoff_nm 9.3102997541427612e-01
# npt_frames_truncated 0
```

`density_profile` -> `output/densprobe/density_profile/density_avg.dat`

```text
# Density profile
# selection oxy = type 1
# axis z
...
position_nm density_nm^-3
```

The column-name line is the first non-`#` line, not necessarily line 1.

`diffusion` -> `output/dprobe/diffusion/D_avg.dat`

```text
# time_ps MSD_nm2 D_nm2_per_ps selection=oxy
0.0000000000000000e+00 0.0000000000000000e+00 0.0000000000000000e+00
1.0000000000000000e-02 4.5257654815564978e-04 7.6224453541639753e-03
```

Units are nm, ps and nm^2/ps throughout; derived tensor comments are labelled
`(nm^2/ps)` in `src/diffusion.cpp:1570`. Note the header style is not uniform: RDF and
density put units in the column names, diffusion puts them in an explanatory comment.
Older `D_*.dat` files on disk carry a legacy header (`# Time MSD D(t)`), so do not key a
parser on the header text alone.

### Machine-readable output

Only two analyses emit JSON:

- `bin/obleas thermal_conductivity --json <path>` writes a manifest-shaped JSON
  (default `<root>.json`).
- `dynamic_structure_factor` writes `<root>.json` alongside its curves.

Both delete any stale JSON before writing, so the JSON's presence is the success signal.
Everything else, including RDF, density and diffusion, is space-separated text with `#`
headers. There is no JSON for the common ingest analyses.

### A third layout: the GROMACS tool path

`bin/obleas gmx <tool>` is a different output path from `analysis ...` in a config file.
Config mode on a `.xtc` writes `output/<label>/rdf/g_avg.dat`. The `gmx rdf` CLI writes
`output/gmx_rdf/rdf_0.xvg`, `rdf_0.dat` and `rdf_0_kb.dat`. Pick one path per ingest and
parse only that one.

---

## 4. Thermodynamics (T/P/E)

**GROMACS `.edr`: yes.**

```bash
bin/obleas gmx energy -e ener.edr -terms "Temperature Pressure Potential"
```

Verified on `tests/fixtures/ener.edr`: exit 0, writes `output/gmx_energy/energy_0.xvg`
with time in ps and one column per requested term, plus a `.dat`. Column names come from
the `-terms` list and are echoed in the `@ s0 legend` lines.

**LAMMPS log: no.** obleas does not emit a T/P/E timeseries for LAMMPS. It parses LAMMPS
logs only as input to `npt` (R-03), `viscosity` (R-06) and `thermal_conductivity` (R-07),
which return response coefficients, not series. Additionally `npt` needs specific columns.
A default LAMMPS thermo block has no volume and fails:

```text
Error: no NPT rows found in the LAMMPS thermo file (need a Step/TimeStep header
with volume, potential and pressure columns)
```

A log with `Step Temp PotEng KinEng Press Volume` parses (verified, 400 samples). So
Tessera should extract LAMMPS T/P/E itself, or require
`thermo_style custom step temp vol pe press` in the run and use `obleas npt --format lammps`.

---

## 5. Selections

LAMMPS, by atom type:

```bash
bin/obleas lmp rdf -f traj.lammpstrj -units metal -type 2
```

`-type N`, `-type1/-type2`, `-type_a/-type_b`, and `-species <name> <type> <charge>`
(repeatable) for charge-aware analyses. In config: `target_type 2,5,10`, or a named
`select oxy type 2` reused by several analyses.

GROMACS, by name and residue:

```bash
bin/obleas gmx rdf -f traj.xtc -s topol.tpr -ref "name OW" -sel "name OW"
```

In config: `gromacs_target OW SOL` and `gromacs_type_mapping OW 2`.

**There is no info or dry-run subcommand.** `--version` prints engines and formats only;
there is no way to ask the tool which types or molecules a file contains. Manual mapping
is required. Tessera can read the `ITEM: ATOMS ... type` header of a LAMMPS dump itself
and take the distinct `type` values, and read the `%RES`/atom-name blocks of a `.gro` or
`.tpr`. That is the piece to implement on the Tessera side.

---

## 6. Interface

CLI only. There are no Python bindings and no C API: no pybind11, no `Python.h`, nothing
exported beyond the executable. The 62 Python files under `tests/python` are pytest
acceptance tests that shell out to `bin/obleas`.

Config grammar stability: hand-rolled whitespace parser, no schema, no format version
field, and unknown keys are silently ignored with exit 0 (see pitfalls). An unknown
`analysis` name does fail with exit 1 (`Unknown analysis type: <name>`), so the silent
path is specifically keys. Treat the grammar as stable in practice but unvalidated, and
assert on outputs after every generated config.

---

## 7. Pitfalls

1. **Unknown config keys are silently ignored, exit 0.** Verified with
   `totally_bogus_key 42`: no warning, run completed. A typo in a generated config yields
   a plausible wrong result. Always assert that the expected output files exist and are
   non-empty, and run `scripts/sanity_check.py` on the output directory.

2. **LAMMPS dumps need image flags for any dynamic analysis.** Without them the run
   continues to exit 0 with only this warning:
   `positions remain wrapped and cannot be unwrapped`. MSD saturates and diffusion is
   wrong. Require `dump_modify ... unwrap yes` or `ix iy iz`, and treat the warning as a
   hard reject for diffusion, conductivity and mbr.

3. **Particle count must be constant across frames.** A trajectory that changes N fails
   closed: `particle count changed from 100 to 150 at trajectory frame 1`. Correct
   behaviour, but it rejects some multi-stage dumps (melt-then-insert, GCMC-adjacent).

4. **`lammps_units lj` refuses to run without scale factors:**
   `LAMMPS units lj requires positive lj_length_nm and lj_time_ps to convert reduced
   quantities to nm and ps.` Supply `lj_length_nm`, `lj_energy_kj_mol`, `lj_time_ps`.

5. **Timestep is mandatory for dynamic analyses.** `diffusion`, `conductivity`, `mbr`
   and `rotational_relaxation` fail closed rather than assume a `dt`.

6. **MC input is refused by the same four analyses, exit 1.** That refusal is correct.
   Do not retry, and do not route AREPAS sweeps to them.

7. **`average_results true` is required in production.** Without it you get one file per
   rank and no `_avg.dat`. Kirkwood-Buff derived analyses hard-fail without it.

8. **`select` expressions and `frame_selection` are read as raw rest-of-line.** A trailing
   `#` comment on those lines is swallowed into the value. Keep comments off them.

9. **`output_label` collisions overwrite silently.** Make the label unique per ingest.

10. **`.xtc` alone is enough**, and obleas does not check that `-s` matches `-f`. I passed
    `water1728.tpr` with `water216.xtc` and it ran to exit 0. Pair topology and trajectory
    yourself.

11. **No type introspection.** See section 5.

12. **Unknown GROMACS tool names are warned and skipped**, not fatal.

13. **Legacy output headers exist on disk.** Key parsers on column count and the first
    non-`#` line, not on exact header text.

---

## 8. What Tessera passes and what it parses

### LAMMPS dump run

Pass on the command line, one process per ingest:

```bash
bin/obleas output/<label>.anls
```

with `<label>.anls` containing `trajectory`, `trajectory_type lammps`,
`lammps_units`, `timestep`, `output_label`, `average_results true`, the `select` lines
and the `analysis` lines from section 2.

Parse back, from `output/<label>/<analysis_type>/`:

- `rdf/`: `g_avg.dat`, or `g_<t1>_<t2>_avg.dat`. First non-`#` line is `r_nm g`.
- `density_profile/`: `density_avg.dat`. First non-`#` line is
  `position_nm density_nm^-3`.
- `diffusion/`: `D_avg.dat`. Header `# time_ps MSD_nm2 D_nm2_per_ps selection=<name>`.

Then run `python3 scripts/sanity_check.py output/<label>` and treat a non-zero exit as an
ingest failure, not a warning.

### GROMACS `.xtc` + `.tpr` run

Either path works. Use the config path if you want the same parser for both engines:

```text
trajectory /runs/x/traj.xtc
trajectory_type gromacs
gmx_tpr /runs/x/topol.tpr
output_label ingress_0043
average_results true
gromacs_target OW SOL
analysis rdf 200 ref OW sel OW
```

which writes `output/ingress_0043/rdf/g_avg.dat` (`r_nm g` header), verified.

Or use the GROMACS tool path when you want the native `.xvg`:

```bash
bin/obleas gmx rdf -f traj.xtc -s topol.tpr -rmax 0.8
bin/obleas gmx energy -e ener.edr -terms "Temperature Pressure Potential"
```

which writes `output/gmx_rdf/rdf_0.xvg`, `rdf_0.dat`, `rdf_0_kb.dat`, and
`output/gmx_energy/energy_0.xvg`.

Do not mix the two paths under one label. They name their outputs differently.
