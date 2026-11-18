/**
 * Presentation helpers for the Voxel-based dashboard.
 * Values mirror the design handoff (Tessera Dashboard.dc.html).
 */

export const NB = ' ';

export type MethodCode =
  | 'ATOMISTIC'
  | 'H_ADRESS'
  | 'COARSE_GRAINED'
  | 'UNITED_ATOM'
  | 'MONTE_CARLO';

export const METHOD_COLOR: Record<MethodCode, string> = {
  ATOMISTIC: '#2f4ea8',
  H_ADRESS: '#7d3cc6',
  COARSE_GRAINED: '#16936a',
  UNITED_ATOM: '#c87005',
  MONTE_CARLO: '#c44a85',
};

export const METHOD_LABEL: Record<MethodCode, string> = {
  ATOMISTIC: 'Atomistic',
  H_ADRESS: 'H-AdResS',
  COARSE_GRAINED: 'Coarse-grained',
  UNITED_ATOM: 'United atom',
  MONTE_CARLO: 'Monte Carlo',
};

export const ENGINES = ['LAMMPS', 'GROMACS', 'AREPAS', 'Other'] as const;

/** Bucket an engine name into one of the four filter groups. */
export function engineBucket(name: string | null | undefined): string {
  const value = (name || '').toUpperCase();
  if (value.startsWith('LAMMPS')) return 'LAMMPS';
  if (value.startsWith('GROMACS')) return 'GROMACS';
  if (value.startsWith('AREPAS')) return 'AREPAS';
  return 'Other';
}

/** Method for a run: the API stores null for plain atomistic runs. */
export function methodOf(value: string | null | undefined): MethodCode {
  const code = (value || 'ATOMISTIC').toUpperCase();
  return (code in METHOD_LABEL ? code : 'ATOMISTIC') as MethodCode;
}

export function qualityColor(q: number | null | undefined): string {
  const value = q ?? 0;
  if (value >= 80) return 'var(--accent-500)';
  if (value >= 50) return 'var(--signal-500)';
  return 'var(--critical-500)';
}

/** total_time is stored in ns. */
export function fmtLength(ns: number | null | undefined, cycles?: string | null): string {
  if (cycles) return cycles;
  if (ns == null || !Number.isFinite(ns) || ns <= 0) return '—';
  if (ns >= 1000) return `${(ns / 1000).toFixed(1)}${NB}µs`;
  return `${ns.toFixed(1)}${NB}ns`;
}

export function fmtAtoms(n: number | null | undefined): string {
  const value = n ?? 0;
  if (!value) return '—';
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(value);
}

export function fmtConditions(
  ensemble: string | null | undefined,
  temperature: number | null | undefined,
  pressure: number | null | undefined
): string {
  return [
    ensemble || null,
    temperature != null ? `${temperature}${NB}K` : null,
    pressure != null ? `${pressure.toFixed(1)}${NB}bar` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Clock time to the minute, for tables that show when something arrived. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function initials(name: string | null | undefined): string {
  return (name || 'Tessera')
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export const EYEBROW = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: 'var(--fg-muted)',
};
