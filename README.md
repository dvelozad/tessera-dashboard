# Tessera

A data lake and dashboard for molecular dynamics simulations: ingest LAMMPS and
GROMACS runs, index their metadata, browse their trajectories in 3D, and keep
the raw files on a 5 TB Google Drive instead of a server disk that cannot hold
them.

```
ingest ──► hot cache (bounded, local) ──► transfer worker ──► Google Drive
                 │                                              (5 TB)
                 └──► Postgres metadata ──► FastAPI ──► React dashboard
```

## Why it is built this way

Trajectories are tens of gigabytes; metadata is kilobytes. Tessera keeps the
metadata in Postgres and the bytes in Google Drive, with a small, evictable
local cache in front of Drive so the dashboard stays responsive. Ingestion never
waits for an upload: artifacts are written locally, queued, and pushed by a
separate worker that respects Drive's daily upload cap.

The full design, failure modes and portability notes are in
[docs/STORAGE_ARCHITECTURE.md](docs/STORAGE_ARCHITECTURE.md).

## Access

On bigmsi the dashboard is published on port **8420**, reachable over the
tailnet at:

    http://bigmsi.tail500ddf.ts.net:8420

`TESSERA_HTTP_PORT` changes the port; nothing else in the stack assumes it.

## Quick start

```bash
cp .env.example .env            # then edit it
make venv                       # Python 3.12 + dependencies
docker compose up -d postgres
make upgrade                    # database migrations
make run-api                    # API on :8000
make worker                     # in another terminal: Drive uploads
```

Frontend:

```bash
cd frontend && npm install && npm run dev
```

## Ingesting data

```bash
# from a path already on this machine
tessera ingest /data/runs/LJ_GC/PROD_MUT7b --project LJ_GC

# straight from pckr258 over ssh (rsync to staging, then ingest)
tessera pull pckr258:/data/bee14/diazd/projects/LJ_GC/PROD_MUT7b --project LJ_GC
```

## Storage backends

Set `STORAGE_BACKEND` in `.env`:

| Value | Use |
|---|---|
| `gdrive` | Google Drive cold tier + bounded hot cache (production) |
| `filesystem` | a single local directory (development) |
| `s3` | S3/MinIO |

For `gdrive`, configure an rclone remote once:

```bash
rclone config          # create a remote named "gdrive" of type drive
rclone about gdrive:   # should report the 5 TB plan
tessera doctor         # verifies reachability, cache, queue and database
```

## Layout on Drive

Blobs are content addressed (`cas/sha256/ab/cd/<sha>.<ext>`) and deduplicated;
each run also gets a human-readable `manifest.json` at
`projects/<project>/<run>/manifest.json` that maps original file names to blobs.

## Commands

| Command | Purpose |
|---|---|
| `tessera doctor` | diagnose config, Drive, hot cache, queue, database |
| `tessera ingest <dir> -p <project>` | ingest a local directory |
| `tessera pull <host>:<path> -p <project>` | rsync from a remote host, then ingest |
| `tessera worker` | push queued artifacts to Drive |
| `tessera query runs` | query indexed runs |
| `tessera storage stats` | storage statistics |

## Tests

```bash
make test                       # full suite with coverage
.venv/bin/python -m pytest tests/unit -q
```

Tests for the Drive backend use a local rclone path and never touch the network.

## License

MIT - see [LICENSE](LICENSE).
