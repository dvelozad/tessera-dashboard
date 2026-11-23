#!/usr/bin/env python3
"""Small, dependency-free control client for a running Tessera server.

Works from any machine that can reach the server (bigmsi over Tailscale,
pckr258, nrodia) and needs nothing but Python 3.9+ and, for uploads, curl.

    export TESSERA_URL=https://bigmsi.tail500ddf.ts.net:8420
    export TESSERA_EMAIL=you@example.org TESSERA_PASSWORD=...
    ./tessera_ctl.py projects list
    ./tessera_ctl.py projects update 3 --set pi_name="Diego Veloza Diaz"
    ./tessera_ctl.py runs update 12 --set description="10 ns NPT production"
    ./tessera_ctl.py artifacts upload 12 traj.xtc topol.tpr
    ./tessera_ctl.py push /data/run --project LJ_GC

A token from `TESSERA_TOKEN` wins over email/password. Credentials are never
written to disk; the cached token lives in ~/.cache/tessera/token.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_URL = "https://bigmsi.tail500ddf.ts.net:8420"
TOKEN_PATH = Path.home() / ".cache" / "tessera" / "token"


class TesseraError(RuntimeError):
    pass


def base_url() -> str:
    return os.environ.get("TESSERA_URL", DEFAULT_URL).rstrip("/")


def cached_token() -> str | None:
    token = os.environ.get("TESSERA_TOKEN")
    if token:
        return token.strip()
    try:
        return TOKEN_PATH.read_text().strip() or None
    except OSError:
        return None


def login(force: bool = False) -> str:
    if os.environ.get("TESSERA_SSH"):
        return "ssh"

    token = None if force else cached_token()
    if token:
        return token

    email = os.environ.get("TESSERA_EMAIL")
    password = os.environ.get("TESSERA_PASSWORD")
    if not email or not password:
        raise TesseraError(
            "Set TESSERA_TOKEN, or TESSERA_EMAIL and TESSERA_PASSWORD, to authenticate."
        )

    body = urllib.parse.urlencode({"username": email, "password": password}).encode()
    request = urllib.request.Request(
        f"{base_url()}/api/v1/auth/login",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        raise TesseraError(f"Login failed ({error.code}): {error.read()[:200]!r}") from error

    token = payload["access_token"]
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_PATH.write_text(token)
    TOKEN_PATH.chmod(0o600)
    return token


def call_via_ssh(method: str, path: str, payload: dict | None = None) -> object:
    """Run the request on a host that can reach the server, over SSH."""
    import shlex

    host = os.environ["TESSERA_SSH"]
    # Non-interactive SSH does not source the profile, so name the path.
    remote_ctl = os.environ.get("TESSERA_REMOTE_CTL", "~/.local/bin/tessera-ctl")
    # Quote the path: a query string reaches the remote shell unquoted, where
    # zsh treats '?' and '&' as syntax and fails before tessera-ctl runs.
    command = f"{remote_ctl} raw {method} {shlex.quote(path)}"
    if payload is not None:
        command += " --data " + shlex.quote(json.dumps(payload))

    result = subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            # A stale ControlMaster socket on the client refuses new sessions.
            "-o",
            "ControlMaster=no",
            "-o",
            "ControlPath=none",
            host,
            command,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise TesseraError(f"remote call failed: {result.stderr.strip()[:300] or result.stdout[:300]}")
    return json.loads(result.stdout) if result.stdout.strip() else None


def call(method: str, path: str, payload: dict | None = None) -> object:
    if os.environ.get("TESSERA_SSH"):
        return call_via_ssh(method, path, payload)

    token = login()
    url = f"{base_url()}/api/v1/{path.lstrip('/')}"
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Authorization": f"Bearer {token}"}
    if data is not None:
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:400]
        raise TesseraError(f"{method} {path} -> {error.code}: {detail}") from error


def parse_set(pairs: list[str]) -> dict:
    """Parse --set key=value, coercing booleans and numbers."""
    out: dict = {}
    for item in pairs:
        if "=" not in item:
            raise TesseraError(f"--set expects key=value, got {item!r}")
        key, value = item.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value.lower() in ("true", "false"):
            out[key] = value.lower() == "true"
        elif value.lower() in ("null", "none", ""):
            out[key] = None
        else:
            try:
                out[key] = int(value)
            except ValueError:
                try:
                    out[key] = float(value)
                except ValueError:
                    out[key] = value
    return out


def cmd_login(args) -> None:
    login(force=args.force)
    print("ok: token cached")


def cmd_projects(args) -> None:
    if args.action == "list":
        print(json.dumps(call("GET", "projects"), indent=2))
    elif args.action == "create":
        payload = parse_set(args.set or [])
        if args.name:
            payload["name"] = args.name
        print(json.dumps(call("POST", "projects", payload), indent=2))
    elif args.action == "update":
        payload = parse_set(args.set or [])
        print(json.dumps(call("PATCH", f"projects/{args.id}", payload), indent=2))
    elif args.action == "get":
        print(json.dumps(call("GET", f"projects/{args.id}"), indent=2))


def cmd_runs(args) -> None:
    if args.action == "list":
        query = f"?project_name={urllib.parse.quote(args.project)}" if args.project else ""
        print(json.dumps(call("GET", f"runs{query}"), indent=2))
    elif args.action == "get":
        print(json.dumps(call("GET", f"runs/{args.id}"), indent=2))
    elif args.action == "update":
        payload = parse_set(args.set or [])
        print(json.dumps(call("PATCH", f"runs/{args.id}", payload), indent=2))


def cmd_upload(args) -> None:
    if os.environ.get("TESSERA_SSH"):
        raise TesseraError(
            "artifacts upload needs the file on the server side; "
            "use `push <dir>` on the host that holds the data instead."
        )
    token = login()
    files = [Path(item) for item in args.files]
    for path in files:
        if not path.is_file():
            raise TesseraError(f"not a file: {path}")
    command = [
        "curl",
        "-sS",
        "-X",
        "POST",
        f"{base_url()}/api/v1/runs/{args.run_id}/artifacts/upload",
        "-H",
        f"Authorization: Bearer {token}",
    ]
    for path in files:
        command += ["-F", f"files=@{path}"]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise TesseraError(f"upload failed: {result.stderr[:400]}")
    print(result.stdout)


def cmd_push(args) -> None:
    """Delegate to the packaged CLI, which knows how to push blobs to Drive."""
    script = Path(__file__).resolve().parent / ".." / "src"
    env = dict(os.environ)
    env["PYTHONPATH"] = f"{script.resolve()}:{env.get('PYTHONPATH', '')}"
    interpreter = os.environ.get("TESSERA_PUSH_PYTHON")
    if not interpreter:
        candidate = Path.home() / "tessera-src" / ".venv" / "bin" / "python"
        interpreter = str(candidate) if candidate.is_file() else sys.executable
    command = [
        interpreter,
        "-m",
        "mddatalake.cli.main",
        "push",
        args.directory,
        "--project",
        args.project,
    ]
    if args.name:
        command += ["--name", args.name]
    if args.description:
        command += ["--description", args.description]
    if args.record:
        command += ["--record", args.record]
    result = subprocess.run(command, env=env)
    raise SystemExit(result.returncode)


def cmd_raw(args) -> None:
    payload = json.loads(args.data) if args.data else None
    print(json.dumps(call(args.method.upper(), args.path, payload), indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", help="Tessera base URL (or TESSERA_URL)")
    sub = parser.add_subparsers(dest="command", required=True)

    auth = sub.add_parser("login", help="authenticate and cache a token")
    auth.add_argument("--force", action="store_true")
    auth.set_defaults(func=cmd_login)

    projects = sub.add_parser("projects", help="project operations")
    projects.add_argument("action", choices=["list", "get", "create", "update"])
    projects.add_argument("id", nargs="?")
    projects.add_argument("--name")
    projects.add_argument("--set", action="append", metavar="KEY=VALUE")
    projects.set_defaults(func=cmd_projects)

    runs = sub.add_parser("runs", help="run operations")
    runs.add_argument("action", choices=["list", "get", "update"])
    runs.add_argument("id", nargs="?")
    runs.add_argument("--project")
    runs.add_argument("--set", action="append", metavar="KEY=VALUE")
    runs.set_defaults(func=cmd_runs)

    artifacts = sub.add_parser("artifacts", help="artifact operations")
    artifacts_sub = artifacts.add_subparsers(dest="action", required=True)
    upload = artifacts_sub.add_parser("upload", help="attach files to an existing run")
    upload.add_argument("run_id", type=int)
    upload.add_argument("files", nargs="+")
    upload.set_defaults(func=cmd_upload)

    push = sub.add_parser("push", help="ingest a directory (needs the Tessera package)")
    push.add_argument("directory")
    push.add_argument("--project", required=True)
    push.add_argument("--name")
    push.add_argument("--description")
    push.add_argument("--record")
    push.set_defaults(func=cmd_push)

    raw = sub.add_parser("raw", help="call any endpoint")
    raw.add_argument("method")
    raw.add_argument("path")
    raw.add_argument("--data")
    raw.set_defaults(func=cmd_raw)

    args = parser.parse_args()
    if getattr(args, "url", None):
        os.environ["TESSERA_URL"] = args.url

    try:
        args.func(args)
    except TesseraError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
