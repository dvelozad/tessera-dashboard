---
name: tessera
description: Catalog simulations in Tessera from any machine - create or update projects, attach metadata and descriptions to runs, upload trajectories and input files. Use whenever a run finishes, when a project needs its description/lead/keywords filled in, when data must be filed under a project, or when someone asks what is in the datalake.
---

# Tessera control

Tessera is the lab's simulation data lake: metadata in Postgres, blobs on Google
Drive, a dashboard at `https://bigmsi.tail500ddf.ts.net:8420`. This skill lets an
agent file work into it from **any** machine — bigmsi, pckr258, nrodia — without
a checkout of the app.

## Setup (once per machine)

```bash
export TESSERA_URL=https://bigmsi.tail500ddf.ts.net:8420
export TESSERA_EMAIL=you@example.org
export TESSERA_PASSWORD=...          # or export TESSERA_TOKEN=...
```

The control client is `scripts/tessera_ctl.py` in the Tessera repository, or the
installed copy at `~/.local/share/tessera/tessera_ctl.py`. It needs only Python 3
(plus curl for uploads). Verify with:

```bash
tessera_ctl.py projects list
```

**Hosts that cannot reach the server** (pckr258 is on a different network and
cannot open the dashboard) run the call through a host that can:

```bash
export TESSERA_SSH=bigmsi
```

With that set, every metadata command is executed on bigmsi over SSH. `push`
still runs **locally**, on the machine holding the data, because that is where
the blobs and obleas live; only the JSON record needs to reach the server, and
bigmsi imports it automatically within two minutes.

## The two ways data enters

**1. A whole run directory (the normal path for a finished simulation).**
Run this on the machine that holds the data:

```bash
tessera_ctl.py push /data/bee14/diazd/projects/LJ_GC/PROD_MUT7b \
  --project LJ_GC --name PROD_MUT7b --description "10 ns NPT production"
```

`push` parses the directory, hashes and uploads the blobs to Drive, runs obleas
analyses (RDF, density, diffusion for LAMMPS; T/P/E from `.edr` for GROMACS) and
writes a small JSON record. Then move that record to the server and import it:

```bash
scp PROD_MUT7b.json bigmsi:.        # or copy it however you like
ssh bigmsi 'cd ~/Documents/tessera-dashboard && .venv/bin/python -m mddatalake.cli.main import PROD_MUT7b.json'
```

On bigmsi itself a timer imports anything that lands in
`~/.local/share/tessera/records/`, so dropping the JSON there is enough.

**2. Extra files onto an existing run.** No code needed, pure HTTP:

```bash
tessera_ctl.py artifacts upload 42 traj.xtc topol.tpr
```

## Metadata: what to set and when

A run is only useful if it can be found later. After pushing, **always** set:

```bash
tessera_ctl.py runs update 42 \
  --set description="NPT production, 300 K, 1 bar, TIP4P/2005 water" \
  --set run_name="water_npt_300K"
```

A project is only useful if a reader understands it. When you create one, fill
it in the same breath:

```bash
tessera_ctl.py projects create --name LJ_GC \
  --set description="Grand-canonical LJ fluids with H-AdResS particle insertion, validated against full-atomistic references" \
  --set pi_name="Diego Veloza Diaz" \
  --set institution="Max Planck Institute for Polymer Research" \
  --set funding_source="Minciencias" \
  --set is_public=true \
  --set "keywords=[\"Lennard-Jones\",\"H-AdResS\",\"grand-canonical\"]"
```

Fields that exist today: project `name`, `description`, `pi_name`,
`institution`, `funding_source`, `grant_number`, `keywords`, `is_public`; run
`run_name`, `description`.

## Links and labels

A project carries links to its repository, dataset or manuscript; a run carries
free-form labels:

```bash
# repository / dataset / manuscript URLs on a project
tessera_ctl.py raw POST /projects/2/links \
  --data '{"link_type":"github","label":"dvelozad/arepas","url":"https://github.com/dvelozad/arepas"}'
tessera_ctl.py raw GET  /projects/2/links
tessera_ctl.py raw DELETE /projects/2/links/1

# labels on a run (production, paper-1, needs-review, ...)
tessera_ctl.py raw POST /runs/42/tags --data '{"tag_name":"production"}'
tessera_ctl.py raw GET  /runs/42/tags
tessera_ctl.py raw DELETE /runs/42/tags/production
```

`link_type` is one of `github`, `overleaf`, `dataset`, `url`. Adding the same
tag twice is a no-op, so scripts can be re-run safely.

## Rule: file what matters

Every agent working on a project under `~/projects` or `/data/...` is expected to
keep Tessera current, not to leave results only on the cluster:

1. **After a campaign, batch or paper run**, choose the *representative* set —
   the production trajectory, its input deck, the log, the topology, the
   analysis outputs that back a figure — and `push` each run. Do not dump the
   entire scratch tree; file what a colleague would need to understand and
   reproduce the result.
2. **Each pushed run gets a description** saying what it physically is
   (method, ensemble, temperature, system) and a label or two from the shared
   vocabulary: `production`, `paper-1`, `benchmark`, `needs-review`,
   `superseded`.
3. **The project carries the context**: description, lead, institution and the
   repository/Overleaf/dataset links, so the lake explains itself without you.
4. **Never invent metadata.** Unknown PI, funding or science goes in as unknown
   and gets asked about, not guessed.
5. **Re-run `push` is safe.** Blobs are content-addressed, so a second push only
   adds what is new and re-attaches analyses.

If a run matters enough to cite, plot or hand over, it matters enough to be in
Tessera.

## Rules

- **Never invent metadata.** If you do not know the PI, the funding or the
  scientific description, ask the user or leave the field empty — a wrong
  description is worse than none, and it is inherited by everyone who reads the
  lake later.
- **Description over label.** State what the run physically is (ensemble,
  temperatures, force field, system) before any internal nickname.
- **File into the right project.** If the project does not exist, create it and
  fill its description; do not drop runs into a catch-all.
- **Verify after writing.** `tessera_ctl.py runs get <id>` and check the fields
  landed; the dashboard shows the same data.
- **Do not upload the same directory twice.** `push` is content-addressed, so
  duplicate blobs are skipped, but a second `import` of the same record would
  attach analyses to the existing run — which is intended, not an error.

## Reference

| Command | Purpose |
|---|---|
| `tessera_ctl.py projects list` | every project with run counts |
| `tessera_ctl.py projects get <id>` | one project |
| `tessera_ctl.py projects create --name X --set k=v` | new project |
| `tessera_ctl.py projects update <id> --set k=v` | edit metadata |
| `tessera_ctl.py runs list [--project X]` | runs, newest first |
| `tessera_ctl.py runs update <id> --set k=v` | edit a run |
| `tessera_ctl.py artifacts upload <run_id> <files...>` | attach files |
| `tessera_ctl.py push <dir> --project X` | ingest a directory |
| `tessera_ctl.py raw GET /runs?limit=5` | anything not modelled here |
| `tessera_ctl.py raw POST /projects/2/links --data '{...}'` | attach a link |
| `tessera_ctl.py raw POST /runs/42/tags --data '{...}'` | label a run |

Exit status is non-zero on failure with the API's error text on stderr.
