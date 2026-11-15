# Tessera storage architecture

Status: implemented in `src/mddatalake/storage/` (rclone, tiered, transfer,
manifest). This document is the reference for operating it and for moving the
deployment to another host.

## 1. What we are solving

Tessera indexes molecular dynamics runs: LAMMPS and GROMACS directories with
input scripts, logs, topologies and trajectories. The metadata is small and
relational; the trajectories are not. The reference corpus on pckr258 alone is
about **695 GB of `.lammpstrj`**, 7.5 GB of GROMACS `.trr` and 0.65 GB of `.xtc`,
and it grows with every campaign.

The design target is therefore:

| Requirement | Consequence |
|---|---|
| Store every artifact durably, cheaply, at TB scale | Google Drive (5 TB) is the authority, not the server disk |
| Serve metadata and previews fast | Postgres + a bounded local hot cache |
| Never block a request on a multi-hour upload | Asynchronous transfer queue and a separate worker process |
| Survive a lost disk | The cold tier is authoritative; local state is disposable |
| Move to another machine in an afternoon | No host-specific path or credential in the code; everything through env vars |

## 2. Tiers

```
      ingest (CLI / pull / browser)            read (API, NGL viewer)
                  |                                      |
                  v                                      v
        +-------------------+                 +-------------------+
        |   HOT tier        |  hydrate /      |   HOT tier        |
        |  local disk       |  evict (LRU)    |  local disk       |
        |  <= HOT_MAX_GB    |<----------------|  <= HOT_MAX_GB    |
        +---------+---------+                 +---------+---------+
                  |                                     ^
                  | enqueue job                         | rclone copyto
                  v                                     |
        +-------------------+                 +---------+---------+
        |  Transfer worker  |---------------->|   COLD tier       |
        |  (tessera worker) |   rclone copyto |  Google Drive     |
        +-------------------+                 |  rclone remote    |
                                              +-------------------+
```

* **Cold tier (authoritative)** - Google Drive through the `rclone` CLI,
  root `GDRIVE_ROOT` (default `tessera`). Everything the lake owns lives here.
  It is the tier that must survive; a rebuilt machine can restore from it.
* **Hot tier (cache)** - `HOT_ROOT`, capped at `HOT_MAX_GB` (default 10 GB).
  Holds in-flight uploads, previews, conversions and recently read artifacts.
  Evicted least-recently-used. Losing it costs a re-download, nothing more.
* **Metadata** - Postgres, as before. It also records each artifact's tier
  state (`storage_state`) and its cold path (`remote_path`).

`STORAGE_BACKEND` selects the arrangement:

| Value | Meaning |
|---|---|
| `filesystem` | one local directory, no cold tier (development) |
| `s3` | S3/MinIO object storage |
| `gdrive` | tiered hot cache + Google Drive, with the transfer queue |

## 3. Layout on Google Drive

Blobs are content addressed, so an identical topology or input file shared by
ten runs is stored once:

```
tessera/
  cas/
    sha256/
      ab/cd/abcdef0123...7890.lammpstrj
      ef/01/ef0123...4567.gro
  projects/
    LJ_GC/
      PROD_MUT7b/
        manifest.json
```

`manifest.json` is the human layer over the hashes. It lists each artifact with
its original name, type, size, SHA-256 and the blob it maps to, plus the run's
engine and description. Opening Drive, you find the run; the manifest tells you
which blob is its trajectory.

Manifest keys are `projects/<project>/<run>/manifest.json`. When two runs in one
project share a name, the second manifest is written to
`projects/<project>/<run>--<run_id>/manifest.json` rather than overwriting the
first.

Keys are computed by `storage/keys.py::cas_key` and are backend independent:
the same key is a path under the local root, a bucket prefix, or a Drive folder.

## 4. Write path

1. **Ingest** validates the directory, detects the engine, parses metadata and
   computes a SHA-256 per file.
2. Each file is copied into the hot tier under its CAS key. The checksum is
   verified after the copy; a mismatch aborts before anything is recorded.
3. With `GDRIVE_DEFER_UPLOADS=true` (default) a job is written atomically to
   `HOT_ROOT/.queue/<uuid>.json` and the artifact row is marked
   `storage_state=pending`. The request returns immediately.
4. `tessera worker` picks the job up, runs `rclone copyto` to the cold tier,
   records the day's uploaded bytes in `HOT_ROOT/.quota.json`, deletes the job,
   and (unless `HOT_KEEP_COPIES=true`) drops the hot copy.
5. Failures back off exponentially (60 s, 2 min, 4 min ... capped at 1 h) and
   are retried up to `max_attempts`; after that the job moves to
   `.queue/.failed/` with the last error and is left for a human.

Setting `GDRIVE_DEFER_UPLOADS=false` pushes synchronously during ingestion. That
is appropriate for `tessera pull` on a fast link, not for API requests.

### The daily quota

Google Drive allows roughly **750 GiB of uploads per account per day**. The
worker keeps a ledger keyed by UTC date and stops for the day when
`GDRIVE_DAILY_UPLOAD_GB` (default 700) is reached. Uploading the 695 GB corpus
therefore takes at least a day, and the queue is the thing that makes that
survivable: ingestion never waits on it.

## 5. Read path

* Hot hit: served from local disk, no network.
* Hot miss: `rclone copyto` from Drive into the hot tier (after evicting LRU
  entries to make room), then served.
* Downloads stream in 8 MiB chunks and never load a whole artifact into memory.
  A 23 GB `.lammpstrj` is just a slower response, not an OOM kill.

### Animated previews

A preview is a pair: the opening frame as a PDB topology and, when the run has
more than one frame, the sampled frames as a DCD trajectory
(``previews/artifact_<id>_<topo8><dcd8>.{pdb,dcd}``). Frames are budgeted by
size (about 250,000 atoms total), so a 12,750-atom run gets 8 frames and a
200k-atom run gets 1.

The viewer loads the PDB with NGL, parses the DCD with NGL's ``autoLoad`` into
a frame object and attaches it with ``addTrajectory`` — the plain
``addTrajectory(url)`` overload is NGL's remote-trajectory protocol and throws
on a local file.

### Previews of enormous trajectories

A 3D preview needs the opening frames, not the file. Above
`PREVIEW_MAX_FILE_SIZE_MB` the preview service calls
`download_head(key, PREVIEW_HEAD_BYTES)` (256 MB by default), which is
`rclone cat --head` on the cold tier: only those bytes cross the network.

A head almost never ends on a frame boundary, and a reader that hits a
half-written LAMMPS frame raises instead of returning the frames it did read, so
the truncated tail is cut back to the last `ITEM: TIMESTEP` marker before
parsing. Set `PREVIEW_HEAD_BYTES=0` to skip oversized trajectories instead.

## 6. Failure modes

| Failure | Effect | Recovery |
|---|---|---|
| Worker down | Uploads queue up on local disk | Start it; jobs are durable JSON files |
| Hot disk fills | Eviction frees space; pending jobs are never evicted | Raise `HOT_MAX_GB` or drain the queue |
| Drive quota exhausted | Worker pauses until UTC midnight | Nothing; it resumes |
| Drive auth expires | `rclone` errors; jobs back off | Refresh the rclone token |
| Postgres lost | Metadata gone | Blobs and manifests survive on Drive; runs can be rebuilt from manifests |
| Machine lost | Hot cache gone | Point a new host at the same Drive root |
| Corrupt upload | Checksum verification fails during ingest | Re-ingest; the bad blob is never recorded |

## 7. Portability

Nothing host-specific is compiled in. The API can serve the built SPA itself
(`FRONTEND_DIR`), so a deployment is one process and one port; TLS is added in
front by whatever the host already runs (Tailscale Serve on bigmsi).

Each artifact records where it actually came from: `tessera pull` writes
`host:/original/path` into the artifact's `file_path` and the manifest's
`source`, not the staging directory it deleted afterwards, so provenance
survives the copy.

To move the deployment:

1. Copy `.env` to the new host (or re-create it from `.env.example`).
2. Put the same `rclone.conf` (or a token with access to the same Drive) in
   place.
3. `docker compose up -d` (or `make venv && make upgrade && make run-api`).
4. `tessera doctor` should report every check green.

The only state that must travel is Postgres (`pg_dump`) and the rclone
credential. The hot cache and staging area are disposable.

## 8. Operations

```bash
tessera doctor                 # config, rclone reachability, hot cache, queue, DB
tessera ingest /path/to/run -p PROJECT
tessera pull pckr258:/data/.../run -p PROJECT
tessera worker                 # foreground; use systemd or compose in production
tessera storage stats          # database-side storage statistics
tessera storage scan           # orphan detection (filesystem-like backends)
```

Systemd units for a bare-metal install live in `deploy/systemd/`.

## 9. Deliberate non-choices

* **No `rclone mount`.** FUSE over Drive gives unpredictable latency, does not
  survive network drops cleanly, and makes a database-backed service depend on
  a filesystem that can stall. Explicit `copyto` is slower per operation and
  far easier to reason about.
* **No duplicate human-readable tree by default.** A mirrored copy would double
  Drive usage for the largest artifacts. The manifest gives navigation; a
  materialising export can be added when there is a concrete need.
* **No dedup at the Drive-file level.** Dedup happens by checksum before the
  upload, which is strictly better than uploading duplicates and deleting them.
