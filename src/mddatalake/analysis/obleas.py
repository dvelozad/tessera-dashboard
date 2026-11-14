"""Drive obleas -- the lab's MD analysis suite -- and read its results back.

obleas is a C++/MPI program that reads LAMMPS and GROMACS trajectories in
process and writes observables as plain text under ``output/<label>/``. It runs
on the machine that holds the data; Tessera only needs the small output files.

Two entry points are used:

* ``gmx energy -e <edr>`` for GROMACS thermodynamics (temperature, pressure,
  potential energy). obleas reads the ``.edr`` directly and keeps each term's
  native unit.
* a generated ``.anls`` config for structural analyses (LAMMPS rdf/density/
  diffusion), so one pass over the trajectory yields several series.

Note that obleas' native LAMMPS analyses do not report energy or pressure from
dump columns; those come from the LAMMPS log, which Tessera already parses.
"""

from __future__ import annotations

import asyncio
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from mddatalake.core.exceptions import MDRepoException


class ObleasError(MDRepoException):
    """obleas could not run or its output could not be understood."""


@dataclass(frozen=True)
class AnalysisSeries:
    """One x/y series read from an obleas output file."""

    analysis: str
    name: str
    unit: str | None
    x_name: str
    x_unit: str | None
    x: list[float]
    y: list[float]
    source_file: str

    def as_record(self) -> dict:
        return {
            "analysis": self.analysis,
            "name": self.name,
            "unit": self.unit,
            "x_name": self.x_name,
            "x_unit": self.x_unit,
            "x": self.x,
            "y": self.y,
            "source_file": self.source_file,
        }

    @staticmethod
    def from_record(payload: dict) -> "AnalysisSeries":
        return AnalysisSeries(
            analysis=payload["analysis"],
            name=payload["name"],
            unit=payload.get("unit"),
            x_name=payload.get("x_name", ""),
            x_unit=payload.get("x_unit"),
            x=list(payload["x"]),
            y=list(payload["y"]),
            source_file=payload.get("source_file", ""),
        )


# A token such as "time_ps", "density_nm^-3", "D_nm2_per_ps": name + unit.
_UNIT_SUFFIX = re.compile(
    r"^(?P<name>.+?)_"
    r"(?P<unit>"
    r"(?:nm\^?-?\d+|nm\d?|ps|fs|K|bar|kJ/mol|e|amu)"
    r"(?:_per_(?:ps|ns|nm\d?))?"
    r")$"
)
_PAREN_UNIT = re.compile(r"^(?P<name>.+?)\s*\((?P<unit>[^)]+)\)$")


def _split_name_unit(token: str) -> tuple[str, str | None]:
    """Split "Temperature (K)" / "time_ps" / "g" into (name, unit)."""
    token = token.strip()
    if not token:
        return token, None

    match = _PAREN_UNIT.match(token)
    if match:
        return match.group("name").strip(), match.group("unit").strip()

    match = _UNIT_SUFFIX.match(token)
    if match:
        return match.group("name"), match.group("unit")

    return token, None


def _header_tokens(text: str) -> list[str]:
    """Split a column header into ``name (unit)`` tokens.

    obleas writes three shapes: ``r_nm g``, ``Time (ps) Potential (kJ/mol)``
    and ``# time_ps MSD_nm2 selection=oxygen``. Units in parentheses must be
    re-joined to their name, and trailing ``key=value`` annotations dropped.
    """
    text = text.strip()

    pairs = re.findall(
        r"([A-Za-z][A-Za-z0-9_\-]*(?:\s+[A-Za-z][A-Za-z0-9_\-]*)*)\s*\(([^)]+)\)",
        text,
    )
    if pairs:
        return [f"{name.strip()} ({unit.strip()})" for name, unit in pairs]

    tokens: list[str] = []
    for token in text.split():
        if "=" in token:
            break
        tokens.append(token)
    return tokens


def _is_numeric_row(tokens: list[str]) -> bool:
    if not tokens:
        return False
    try:
        for token in tokens:
            float(token)
    except ValueError:
        return False
    return True


def parse_dat(path: Path, analysis: str = "", source_file: str = "") -> list[AnalysisSeries]:
    """Parse one obleas output file into a series per value column.

    Handles the three header styles obleas emits: a bare column line
    (``r_nm g``), a ``# Columns:`` line with parenthesised units
    (``Time (ps) Potential (kJ/mol)``), and a ``#``-prefixed column line
    (``# time_ps MSD_nm2``).
    """
    path = Path(path)
    try:
        lines = path.read_text(errors="replace").splitlines()
    except OSError as e:
        raise ObleasError(f"Cannot read {path}: {e}") from e

    header: list[str] | None = None
    header_index = -1

    for index, raw in enumerate(lines):
        line = raw.strip()
        if not line:
            continue

        stripped = line.lstrip("#").strip()
        if stripped.lower().startswith("columns:"):
            header = _header_tokens(stripped.split(":", 1)[1])
            header_index = index
            break

        tokens = _header_tokens(stripped)
        if not _is_numeric_row(tokens):
            # First non-numeric, non-comment line is the column header; a
            # comment line only counts if data follows it.
            if line.startswith("#"):
                following = [ln for ln in lines[index + 1:] if ln.strip()]
                if following and _is_numeric_row(following[0].split()):
                    header = tokens
                    header_index = index
                    break
                continue
            header = tokens
            header_index = index
            break

    if not header or len(header) < 2:
        raise ObleasError(f"No column header found in {path}")

    rows: list[list[float]] = []
    for raw in lines[header_index + 1:]:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        tokens = line.split()
        if not _is_numeric_row(tokens):
            continue
        values = [float(t) for t in tokens]
        if len(values) < len(header):
            continue
        rows.append(values[: len(header)])

    if not rows:
        raise ObleasError(f"No data rows found in {path}")

    x_name, x_unit = _split_name_unit(header[0])
    x_values = [row[0] for row in rows]

    series: list[AnalysisSeries] = []
    for column, token in enumerate(header[1:], start=1):
        name, unit = _split_name_unit(token)
        series.append(
            AnalysisSeries(
                analysis=analysis or path.parent.name,
                name=name,
                unit=unit,
                x_name=x_name,
                x_unit=x_unit,
                x=x_values,
                y=[row[column] for row in rows],
                source_file=source_file or str(path.name),
            )
        )
    return series


class ObleasRunner:
    """Run the obleas binary."""

    def __init__(self, binary: str = "obleas", timeout: float = 3600.0) -> None:
        self.binary = binary
        self.timeout = timeout

    def available(self) -> bool:
        return shutil.which(self.binary) is not None or Path(self.binary).is_file()

    async def _run(self, args: list[str], cwd: Path) -> str:
        if not self.available():
            raise ObleasError(
                f"obleas binary not found ({self.binary}); set OBLEAS_BIN"
            )

        process = await asyncio.create_subprocess_exec(
            self.binary,
            *args,
            cwd=str(cwd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        try:
            output, _ = await asyncio.wait_for(
                process.communicate(), timeout=self.timeout
            )
        except asyncio.TimeoutError as e:
            process.kill()
            await process.wait()
            raise ObleasError(
                f"obleas timed out after {self.timeout:.0f}s: {' '.join(args)}"
            ) from e

        text = output.decode(errors="replace")
        if (process.returncode or 0) != 0:
            raise ObleasError(
                f"obleas failed (exit {process.returncode}): {text.strip()[-600:]}"
            )
        return text

    async def energy_from_edr(
        self, workdir: Path, edr: Path, terms: list[str] | None = None
    ) -> list[AnalysisSeries]:
        """Extract thermodynamic series from a GROMACS .edr file."""
        term_list = terms or ["Potential", "Temperature", "Pressure"]
        await self._run(
            ["gmx", "energy", "-e", str(edr), "-terms", " ".join(term_list)],
            cwd=workdir,
        )

        produced = sorted(workdir.glob("output/gmx_energy/*.dat"))
        if not produced:
            raise ObleasError("obleas gmx energy produced no output file")
        return parse_dat(produced[0], analysis="gmx_energy", source_file=produced[0].name)

    async def run_config(self, workdir: Path, config_text: str) -> list[AnalysisSeries]:
        """Run a generated .anls config and read back every series."""
        config_path = workdir / "tessera.anls"
        config_path.write_text(config_text)

        await self._run([str(config_path)], cwd=workdir)

        series: list[AnalysisSeries] = []
        output_root = workdir / "output"
        if not output_root.is_dir():
            return series

        for dat in sorted(output_root.rglob("*_avg.dat")):
            relative = dat.relative_to(output_root)
            analysis = relative.parts[1] if len(relative.parts) > 2 else relative.parts[0]
            try:
                series.extend(parse_dat(dat, analysis=analysis, source_file=dat.name))
            except ObleasError:
                # A malformed file must not discard the analyses that worked.
                continue
        return series
