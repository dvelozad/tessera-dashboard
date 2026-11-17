import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useIsNarrow } from '@/hooks/useIsNarrow';
import { ResizeHandle, useResizableColumns } from '@/hooks/useResizableColumns';
import { EditRunDialog } from '@/components/browser/EditRunDialog';
import { MobileDatalake } from '@/pages/MobileDatalake';
import apiClient from '@/services/api';
import type { RunUpdate, SimulationRun } from '@/types/visualization';
import {
  EYEBROW,
  METHOD_COLOR,
  METHOD_LABEL,
  engineBucket,
  fmtAtoms,
  fmtConditions,
  fmtDate,
  fmtLength,
  methodOf,
  qualityColor,
  type MethodCode,
} from '@/lib/design';

type RunRow = SimulationRun & {
  project_name?: string;
  project_id?: number;
  group_id?: number | null;
  group_name?: string | null;
};

type View = 'table' | 'grouped' | 'cards';
type Density = 'comfortable' | 'compact';
type GroupBy = 'project' | 'campaign' | 'engine' | 'method';

const GROUP_BY_OPTIONS: { id: GroupBy; label: string }[] = [
  { id: 'project', label: 'Project' },
  { id: 'campaign', label: 'Campaign' },
  { id: 'engine', label: 'Engine' },
  { id: 'method', label: 'Method' },
];

const COLS =
  'minmax(170px,2fr) minmax(110px,1.1fr) 112px 118px minmax(150px,1.5fr) 74px 66px 104px 100px 44px';

const COLUMN_LABELS = [
  'Run', 'Project', 'Engine', 'Method', 'Conditions', 'Length', 'Atoms', 'Quality', 'Uploaded', '',
];

const ENGINE_BUCKETS = ['LAMMPS', 'GROMACS', 'AREPAS', 'Other'] as const;

const Chevron: React.FC<{ dir?: 'right' | 'down'; size?: number }> = ({ dir = 'right', size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 14 14"
    fill="none"
    style={{ transform: dir === 'down' ? 'rotate(90deg)' : undefined, transition: 'transform 200ms' }}
  >
    <path d="M5.25 3.5L8.75 7L5.25 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface CheckProps {
  checked: boolean;
  onClick: () => void;
  label: React.ReactNode;
  count: number;
  mono?: boolean;
  dot?: string;
}

const FilterCheck: React.FC<CheckProps> = ({ checked, onClick, label, count, mono, dot }) => (
  <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '4px 0' }}>
    <span
      style={{
        width: 14,
        height: 14,
        borderRadius: 2,
        border: `1.5px solid ${checked ? 'var(--primary-600)' : 'var(--border-strong)'}`,
        background: checked ? 'var(--primary-600)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        flex: 'none',
      }}
    >
      {checked && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </span>
    {dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />}
    <span style={{ flex: 1, fontSize: 13, fontFamily: mono ? 'var(--font-mono)' : undefined, fontWeight: mono ? 500 : 400 }}>{label}</span>
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>{count}</span>
  </div>
);

export const DatalakePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const narrow = useIsNarrow();
  // Arriving from a project's "Show in datalake" pre-filters to that project.
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  useEffect(() => {
    const incoming = (location.state as { projectName?: string } | null)?.projectName;
    if (incoming) setProjectFilter(incoming);
  }, [location.state]);

  const [q, setQ] = useState('');
  const [engines, setEngines] = useState<string[]>([]);
  const [methods, setMethods] = useState<MethodCode[]>([]);
  const [minQ, setMinQ] = useState(0);
  const [view, setView] = useState<View>('table');
  const [groupBy, setGroupBy] = useState<GroupBy>('project');
  const [density, setDensity] = useState<Density>('comfortable');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [newestFirst, setNewestFirst] = useState(true);
  const [editingRun, setEditingRun] = useState<SimulationRun | null>(null);

  // Columns are draggable; the widths survive a reload.
  const { template, headerRef, beginResize, reset } = useResizableColumns(
    'tessera.datalake.columns',
    COLS,
    COLUMN_LABELS.length
  );
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['runs', 'datalake'],
    queryFn: () => apiClient.listRuns({ limit: 1000 }),
  });

  const runs = (data?.runs ?? []) as RunRow[];

  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return runs.filter((run) => {
      if (!needle) return true;
      const haystack = [
        run.run_name,
        run.project_name,
        run.group_name,
        run.system?.composition,
        run.engine?.name,
        METHOD_LABEL[methodOf(run.simulation_method)],
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [runs, q]);

  const filtered = useMemo(() => {
    const rows = searched.filter((run) => {
      if (projectFilter && run.project_name !== projectFilter) return false;
      if (engines.length && !engines.includes(engineBucket(run.engine?.name))) return false;
      if (methods.length && !methods.includes(methodOf(run.simulation_method))) return false;
      if ((run.completeness_score ?? 0) < minQ) return false;
      return true;
    });

    // Newest or oldest upload first; rows without a date sort last either way.
    const time = (run: RunRow) => {
      const value = run.created_at ? new Date(run.created_at).getTime() : NaN;
      return Number.isNaN(value) ? -Infinity : value;
    };
    return rows.sort((a, b) => (newestFirst ? time(b) - time(a) : time(a) - time(b)));
  }, [searched, engines, methods, minQ, projectFilter, newestFirst]);

  const projectCount = new Set(filtered.map((r) => r.project_name)).size;
  const ensembleCount = new Set(filtered.map((r) => r.ensemble).filter(Boolean)).size;
  const activeCount = engines.length + methods.length + (minQ ? 1 : 0) + (projectFilter ? 1 : 0);
  const hasActive = activeCount > 0;

  const perPage = 20;
  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pageCount);
  const visible = filtered.slice((current - 1) * perPage, current * perPage);

  const toggleEngine = (name: string) =>
    setEngines((list) => (list.includes(name) ? list.filter((e) => e !== name) : [...list, name]));
  const toggleMethod = (code: MethodCode) =>
    setMethods((list) => (list.includes(code) ? list.filter((m) => m !== code) : [...list, code]));
  const clearFilters = () => {
    setProjectFilter(null);
    setEngines([]);
    setMethods([]);
    setMinQ(0);
  };

  const compact = density === 'compact';
  const rowPad = compact ? '6px' : '10px';
  const rowFont = compact ? 12.5 : 13.5;

  const groups = useMemo(() => {
    const byKey = new Map<string, RunRow[]>();
    visible.forEach((run) => {
      let key: string;
      switch (groupBy) {
        case 'campaign':
          key = run.group_name || 'Ungrouped';
          break;
        case 'engine':
          key = engineBucket(run.engine?.name);
          break;
        case 'method':
          key = METHOD_LABEL[methodOf(run.simulation_method)];
          break;
        case 'project':
        default:
          key = run.project_name || 'Unknown';
          break;
      }
      byKey.set(key, [...(byKey.get(key) || []), run]);
    });
    return [...byKey.entries()].map(([name, rows]) => {
      const totalNs = rows.reduce((sum, r) => sum + (r.total_time || 0), 0);
      const meanQ = Math.round(rows.reduce((sum, r) => sum + (r.completeness_score || 0), 0) / rows.length);
      return { name, rows, totalNs, meanQ };
    });
  }, [visible, groupBy]);

  const renderRow = (run: RunRow) => {
    const method = methodOf(run.simulation_method);
    const q = run.completeness_score ?? 0;
    const methodColor = METHOD_COLOR[method];
    // The design sets `ed = true`, so a hovered row inverts to the primary
    // colour with white text in both themes. That inversion is the highlight.
    const hovered = hoverId === run.id;
    const muted = hovered ? 'rgba(255,255,255,0.8)' : 'var(--fg-muted)';
    const link = hovered ? '#fff' : 'var(--fg-link)';
    const line = hovered ? 'rgba(255,255,255,0.15)' : 'var(--border-subtle)';

    return (
      <div
        key={run.id}
        onClick={() => navigate(`/runs/${run.id}`)}
        onMouseEnter={() => setHoverId(run.id)}
        onMouseLeave={() => setHoverId(null)}
        style={{
          display: 'grid',
          gridTemplateColumns: template,
          alignItems: 'center',
          cursor: 'pointer',
          lineHeight: 1.3,
          borderBottom: `1px solid ${line}`,
          background: hovered ? 'var(--primary-500)' : 'transparent',
          color: hovered ? '#fff' : 'var(--fg-default)',
          transition: 'background 120ms cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <div style={{ padding: `${rowPad} 16px`, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: rowFont, fontWeight: 500, color: link, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {run.run_name}
          </div>
          {!compact && (
            <div style={{ fontSize: 11, color: muted, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {run.system?.composition || '—'}
            </div>
          )}
        </div>
        <div style={{ padding: '0 12px', minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: link, textDecoration: 'underline', textDecorationColor: hovered ? 'rgba(255,255,255,0.5)' : 'var(--border-default)', textUnderlineOffset: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
            {run.project_name || '—'}
          </span>
        </div>
        <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, padding: '1px 5px', border: `1px solid ${hovered ? 'rgba(255,255,255,0.6)' : 'var(--border-strong)'}`, borderRadius: 2, color: hovered ? '#fff' : 'var(--fg-default)' }}>
            {run.engine?.name || '—'}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {run.engine?.version || ''}
          </span>
        </div>
        <div style={{ padding: '0 12px' }}>
          <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: hovered ? '#fff' : methodColor, color: hovered ? 'var(--primary-700)' : '#fff', whiteSpace: 'nowrap' }}>
            {METHOD_LABEL[method]}
          </span>
        </div>
        <div style={{ padding: '0 12px', fontSize: 13, color: hovered ? '#fff' : 'var(--fg-default)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontVariantNumeric: 'tabular-nums' }}>
          {fmtConditions(run.ensemble, run.temperature_target, run.pressure_target) || '—'}
        </div>
        <div style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 13, color: hovered ? '#fff' : 'var(--fg-default)', textAlign: 'right', whiteSpace: 'nowrap' }}>
          {fmtLength(run.total_time)}
        </div>
        <div style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 13, color: hovered ? '#fff' : 'var(--fg-default)', textAlign: 'right' }}>
          {fmtAtoms(run.system?.n_atoms)}
        </div>
        <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 2, background: hovered ? 'rgba(255,255,255,0.25)' : 'var(--border-default)', borderRadius: 1, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${q}%`, background: hovered ? '#fff' : qualityColor(q) }} />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: hovered ? '#fff' : 'var(--fg-muted)', minWidth: 20, textAlign: 'right' }}>{q}</span>
        </div>
        <div style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: muted, whiteSpace: 'nowrap' }}>
          {fmtDate(run.created_at)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, color: muted }}>
          <button
            type="button"
            aria-label={`Edit run ${run.run_name}`}
            onClick={(event) => {
              event.stopPropagation();
              setEditingRun(run as SimulationRun);
            }}
            onMouseEnter={() => setHoverId(null)}
            title="Edit project, campaign and labels"
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              borderRadius: 3,
              color: hovered ? '#fff' : 'var(--fg-muted)',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M9.6 1.9a1.4 1.4 0 0 1 2 2L4.4 11.1l-2.7.6.6-2.7 7.3-7.1Z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <Chevron />
        </div>
      </div>
    );
  };

  const renderCard = (run: RunRow) => {
    const method = methodOf(run.simulation_method);
    const q = run.completeness_score ?? 0;
    return (
      <div
        key={run.id}
        onClick={() => navigate(`/runs/${run.id}`)}
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 4,
          boxShadow: 'var(--shadow-1)',
          overflow: 'hidden',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ height: 92, background: '#0d1117', position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '8px 10px', boxSizing: 'border-box' }}>
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: METHOD_COLOR[method], color: '#fff', whiteSpace: 'nowrap' }}>
              {METHOD_LABEL[method]}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, padding: '1px 5px', border: '1px solid rgba(255,255,255,0.5)', borderRadius: 2, color: '#fff' }}>
              {run.engine?.name}
            </span>
          </div>
          <span style={{ position: 'relative', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>
            {run.project_name}
          </span>
        </div>
        <div style={{ height: 2, background: 'var(--border-default)' }}>
          <div style={{ height: '100%', width: `${q}%`, background: qualityColor(q) }} />
        </div>
        <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: 'var(--fg-link)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {run.run_name}
          </span>
          {!compact && (
            <span style={{ fontSize: 12, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {run.system?.composition}
            </span>
          )}
          <span style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {fmtConditions(run.ensemble, run.temperature_target, run.pressure_target)}
          </span>
          <div style={{ display: 'flex', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)', marginTop: 4 }}>
            <span>{fmtLength(run.total_time)}</span>
            <span>{fmtAtoms(run.system?.n_atoms)} atoms</span>
            <span style={{ marginLeft: 'auto', color: 'var(--fg-default)' }}>Q {q}</span>
          </div>
        </div>
      </div>
    );
  };

  const toggleBtn = (active: boolean) => ({
    all: 'unset' as const,
    cursor: 'pointer' as const,
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 6,
    fontSize: 13,
    fontWeight: 500,
    padding: '4px 12px',
    background: active ? 'var(--primary-600)' : 'transparent',
    color: active ? '#fff' : 'var(--fg-muted)',
  });

  if (narrow) {
    return <MobileDatalake />;
  }

  return (
    <main style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
      {/* Filter rail */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: filtersOpen ? 0 : -320,
          width: 362,
          zIndex: 20,
          transition: 'left 320ms cubic-bezier(0.4,0,0.2,1)',
          display: 'flex',
        }}
      >
        <div style={{ width: 320, flex: 'none', height: '100%', background: 'var(--bg-surface)', boxShadow: 'var(--shadow-3)', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-default)' }}>
          <div style={{ padding: '20px 20px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-default)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 600 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary-500)" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 6h18M7 12h10M10 18h4" />
              </svg>
              Filters
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={clearFilters} style={{ all: 'unset', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--fg-link)' }}>
                Clear
              </button>
              <button onClick={() => setFiltersOpen(false)} aria-label="Close filters" style={{ all: 'unset', cursor: 'pointer', display: 'flex', padding: 4, borderRadius: 4, color: 'var(--fg-muted)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={EYEBROW}>Engine</span>
              {ENGINE_BUCKETS.map((name) => (
                <FilterCheck
                  key={name}
                  mono
                  checked={engines.includes(name)}
                  onClick={() => toggleEngine(name)}
                  label={name === 'Other' ? 'Other (RASPA, …)' : name}
                  count={searched.filter((r) => engineBucket(r.engine?.name) === name).length}
                />
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={EYEBROW}>Method</span>
              {(Object.keys(METHOD_LABEL) as MethodCode[]).map((code) => (
                <FilterCheck
                  key={code}
                  checked={methods.includes(code)}
                  onClick={() => toggleMethod(code)}
                  dot={METHOD_COLOR[code]}
                  label={METHOD_LABEL[code]}
                  count={searched.filter((r) => methodOf(r.simulation_method) === code).length}
                />
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={EYEBROW}>Minimum completeness</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {[0, 50, 80, 90].map((value) => {
                  const on = minQ === value;
                  return (
                    <button
                      key={value}
                      onClick={() => setMinQ(value)}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        flex: 1,
                        textAlign: 'center',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                        padding: '5px 0',
                        borderRadius: 4,
                        border: `1px solid ${on ? 'var(--primary-600)' : 'var(--border-default)'}`,
                        background: on ? 'var(--primary-600)' : 'transparent',
                        color: on ? '#fff' : 'var(--fg-default)',
                      }}
                    >
                      {value ? `≥ ${value}` : 'Any'}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div
          onClick={() => setFiltersOpen((open) => !open)}
          title={filtersOpen ? 'Hide filters' : 'Show filters'}
          style={{
            width: 42,
            height: '100%',
            flex: 'none',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            background: 'var(--bg-surface)',
            borderRight: '1px solid var(--border-default)',
            boxShadow: '2px 0 8px rgba(0,0,0,0.06)',
          }}
        >
          <span style={{ writingMode: 'vertical-rl', fontSize: 11, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', userSelect: 'none' }}>
            Filters
          </span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary-500)" strokeWidth="1.5" strokeLinecap="round">
            <path d="M3 6h18M7 12h10M10 18h4" />
          </svg>
          {hasActive && (
            <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--primary-500)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {activeCount}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, marginLeft: 42, padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12, transition: 'margin-left 320ms cubic-bezier(0.4,0,0.2,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 2, boxShadow: 'var(--shadow-1)', padding: '0 14px', height: 40, flex: 'none' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--fg-muted)" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name, composition, project, engine or method"
            style={{ flex: 1, border: 0, outline: 0, background: 'transparent', fontSize: 14, color: 'var(--fg-default)', fontFamily: 'var(--font-sans)' }}
          />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-subtle)', border: '1px solid var(--border-default)', borderRadius: 2, padding: '1px 5px' }}>/</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flex: 'none', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={EYEBROW}>Datalake</span>
            <span style={{ fontSize: 13, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
              <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-default)', fontWeight: 600 }}>{filtered.length}</b> runs ·{' '}
              <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-default)', fontWeight: 600 }}>{projectCount}</b> projects ·{' '}
              <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-default)', fontWeight: 600 }}>{ensembleCount}</b> ensembles
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Engine</span>
              <div style={{ display: 'inline-flex', border: '1px solid var(--border-default)', borderRadius: 4, overflow: 'hidden', background: 'var(--bg-surface)' }}>
                <button
                  onClick={() => setEngines([])}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 12px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    fontWeight: 500,
                    background: engines.length === 0 ? 'var(--primary-600)' : 'transparent',
                    color: engines.length === 0 ? '#fff' : 'var(--fg-muted)',
                    borderRight: '1px solid var(--border-default)',
                  }}
                >
                  All<span style={{ fontSize: 11, opacity: 0.7 }}>{searched.length}</span>
                </button>
                {ENGINE_BUCKETS.map((name) => {
                  const on = engines.includes(name);
                  return (
                    <button
                      key={name}
                      onClick={() => toggleEngine(name)}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 12px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                        fontWeight: 500,
                        background: on ? 'var(--primary-600)' : 'transparent',
                        color: on ? '#fff' : 'var(--fg-muted)',
                        borderRight: '1px solid var(--border-default)',
                      }}
                    >
                      {name === 'Other' ? 'Other' : name}
                      <span style={{ fontSize: 11, opacity: 0.7 }}>{searched.filter((r) => engineBucket(r.engine?.name) === name).length}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {view === 'grouped' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Group by</span>
                <div style={{ display: 'inline-flex', border: '1px solid var(--border-default)', borderRadius: 4, overflow: 'hidden', background: 'var(--bg-surface)' }}>
                  {GROUP_BY_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setGroupBy(opt.id)}
                      style={toggleBtn(groupBy === opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'inline-flex', border: '1px solid var(--border-default)', borderRadius: 4, overflow: 'hidden', background: 'var(--bg-surface)' }}>
              {(['table', 'grouped', 'cards'] as View[]).map((mode) => (
                <button key={mode} onClick={() => setView(mode)} style={toggleBtn(view === mode)}>
                  {mode === 'table' ? 'Table' : mode === 'grouped' ? 'Grouped' : 'Cards'}
                </button>
              ))}
            </div>

            <div style={{ display: 'inline-flex', border: '1px solid var(--border-default)', borderRadius: 4, overflow: 'hidden', background: 'var(--bg-surface)' }}>
              {(['comfortable', 'compact'] as Density[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setDensity(mode)}
                  aria-label={`${mode} rows`}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '5px 8px',
                    background: density === mode ? 'var(--primary-600)' : 'transparent',
                    color: density === mode ? '#fff' : 'var(--fg-muted)',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    {mode === 'comfortable' ? <path d="M3 6h18M3 12h18M3 18h18" /> : <path d="M3 4h18M3 9h18M3 14h18M3 19h18" />}
                  </svg>
                </button>
              ))}
            </div>
          </div>
        </div>

        {hasActive && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 'none' }}>
            {projectFilter && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 6px 3px 10px', borderRadius: 2, background: 'var(--bg-selected)', color: 'var(--primary-800)' }}>
                project: {projectFilter}
                <button onClick={() => setProjectFilter(null)} style={{ all: 'unset', cursor: 'pointer', display: 'flex' }}>×</button>
              </span>
            )}
            {engines.map((name) => (
              <span key={`e-${name}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 6px 3px 10px', borderRadius: 2, background: 'var(--bg-selected)', color: 'var(--primary-800)' }}>
                {name}
                <button onClick={() => toggleEngine(name)} style={{ all: 'unset', cursor: 'pointer', display: 'flex' }}>×</button>
              </span>
            ))}
            {methods.map((code) => (
              <span key={`m-${code}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 6px 3px 10px', borderRadius: 2, background: 'var(--bg-selected)', color: 'var(--primary-800)' }}>
                {METHOD_LABEL[code]}
                <button onClick={() => toggleMethod(code)} style={{ all: 'unset', cursor: 'pointer', display: 'flex' }}>×</button>
              </span>
            ))}
            {minQ > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 6px 3px 10px', borderRadius: 2, background: 'var(--bg-selected)', color: 'var(--primary-800)' }}>
                Q ≥ {minQ}
                <button onClick={() => setMinQ(0)} style={{ all: 'unset', cursor: 'pointer', display: 'flex' }}>×</button>
              </span>
            )}
            <button onClick={clearFilters} style={{ all: 'unset', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--fg-link)', marginLeft: 4 }}>
              Clear all
            </button>
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 4, boxShadow: 'var(--shadow-1)', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {isLoading && <div style={{ padding: 32, fontSize: 13, color: 'var(--fg-muted)' }}>Loading runs…</div>}
            {error && <div style={{ padding: 32, fontSize: 13, color: 'var(--critical-500)' }}>Failed to load runs.</div>}

            {!isLoading && !error && view === 'table' && (
              <>
                <div ref={headerRef} style={{ display: 'grid', gridTemplateColumns: template, background: 'var(--bg-sunken)', borderBottom: '1px solid var(--border-default)', position: 'sticky', top: 0, zIndex: 2 }}>
                  {COLUMN_LABELS.map((label, index) => (
                    <span
                      key={`${label}-${index}`}
                      onClick={label === 'Uploaded' ? () => setNewestFirst((v) => !v) : undefined}
                      title={label === 'Uploaded' ? 'Sort by upload date' : undefined}
                      style={{
                        ...EYEBROW,
                        position: 'relative',
                        padding: '10px 12px',
                        paddingLeft: index === 0 ? 16 : 12,
                        textAlign: index === 5 || index === 6 ? 'right' : 'left',
                        cursor: label === 'Uploaded' ? 'pointer' : 'default',
                        userSelect: 'none',
                        color: label === 'Uploaded' ? 'var(--fg-default)' : undefined,
                      }}
                    >
                      {label}
                      {label === 'Uploaded' && (
                        <span style={{ marginLeft: 4 }}>{newestFirst ? '↓' : '↑'}</span>
                      )}
                      {index < COLUMN_LABELS.length - 1 && (
                        <ResizeHandle
                          onPointerDown={beginResize(index)}
                          onDoubleClick={reset}
                        />
                      )}
                    </span>
                  ))}
                </div>
                {visible.map(renderRow)}
              </>
            )}

            {!isLoading && !error && view === 'grouped' && (
              <>
                <div ref={headerRef} style={{ display: 'grid', gridTemplateColumns: template, background: 'var(--bg-sunken)', borderBottom: '1px solid var(--border-default)', position: 'sticky', top: 0, zIndex: 2 }}>
                  {COLUMN_LABELS.map((label, index) => (
                    <span
                      key={`g-${label}-${index}`}
                      onClick={label === 'Uploaded' ? () => setNewestFirst((v) => !v) : undefined}
                      style={{
                        ...EYEBROW,
                        position: 'relative',
                        padding: '10px 12px',
                        paddingLeft: index === 0 ? 16 : 12,
                        textAlign: index === 5 || index === 6 ? 'right' : 'left',
                        cursor: label === 'Uploaded' ? 'pointer' : 'default',
                        userSelect: 'none',
                        color: label === 'Uploaded' ? 'var(--fg-default)' : undefined,
                      }}
                    >
                      {label}
                      {label === 'Uploaded' && <span style={{ marginLeft: 4 }}>{newestFirst ? '↓' : '↑'}</span>}
                      {index < COLUMN_LABELS.length - 1 && (
                        <ResizeHandle
                          onPointerDown={beginResize(index)}
                          onDoubleClick={reset}
                        />
                      )}
                    </span>
                  ))}
                </div>
                {groups.map((group) => {
                  const isCollapsed = collapsed[group.name];
                  return (
                    <React.Fragment key={group.name}>
                      <div
                        onClick={() => setCollapsed((state) => ({ ...state, [group.name]: !isCollapsed }))}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: 'var(--bg-canvas)', borderBottom: '1px solid var(--border-default)', cursor: 'pointer', position: 'sticky', top: 37, zIndex: 1 }}
                      >
                        <Chevron dir={isCollapsed ? 'right' : 'down'} />
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>{group.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{group.rows.length}</span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                          Σ {fmtLength(group.totalNs)}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 120 }}>
                          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>mean</span>
                          <div style={{ flex: 1, height: 2, background: 'var(--border-default)', borderRadius: 1, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${group.meanQ}%`, background: qualityColor(group.meanQ) }} />
                          </div>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, minWidth: 20, textAlign: 'right' }}>{group.meanQ}</span>
                        </div>
                      </div>
                      {!isCollapsed && group.rows.map(renderRow)}
                    </React.Fragment>
                  );
                })}
              </>
            )}

            {!isLoading && !error && view === 'cards' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 12, padding: 16 }}>
                {visible.map(renderCard)}
              </div>
            )}

            {!isLoading && !error && filtered.length === 0 && (
              <div style={{ padding: '64px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>No runs match these filters.</span>
                <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>Loosen them, or upload a trajectory.</span>
                <button onClick={clearFilters} style={{ all: 'unset', cursor: 'pointer', marginTop: 8, fontSize: 13, fontWeight: 600, color: 'var(--primary-600)', border: '1px solid var(--border-default)', borderRadius: 5, padding: '6px 12px' }}>
                  Clear filters
                </button>
              </div>
            )}
          </div>

          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border-default)', background: 'var(--bg-sunken)', fontSize: 13, color: 'var(--fg-muted)' }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
              {filtered.length === 0 ? '0 runs' : `${(current - 1) * perPage + 1}–${Math.min(current * perPage, filtered.length)} of ${filtered.length}`}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, padding: '4px 8px', border: '1px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-surface)', color: 'var(--fg-default)', whiteSpace: 'nowrap' }}>
                {perPage} / page
              </span>
              <button onClick={() => setPage(Math.max(1, current - 1))} disabled={current === 1} style={{ all: 'unset', cursor: current === 1 ? 'default' : 'pointer', fontSize: 12, padding: '0 6px', opacity: current === 1 ? 0.4 : 1 }}>
                ‹
              </button>
              <span style={{ width: 28, height: 28, borderRadius: 4, background: 'var(--primary-600)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 500 }}>
                {current}
              </span>
              <button onClick={() => setPage(Math.min(pageCount, current + 1))} disabled={current === pageCount} style={{ all: 'unset', cursor: current === pageCount ? 'default' : 'pointer', fontSize: 12, padding: '0 6px', opacity: current === pageCount ? 0.4 : 1 }}>
                ›
              </button>
            </div>
          </div>
        </div>
      </div>

      {editingRun && (
        <EditRunDialog
          open={Boolean(editingRun)}
          run={editingRun}
          onClose={() => setEditingRun(null)}
          onSave={async (data: RunUpdate) => {
            await apiClient.updateRun(editingRun.id, data);
          }}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['runs', 'datalake'] });
            await queryClient.invalidateQueries({ queryKey: ['projects'] });
          }}
        />
      )}
    </main>
  );
};

export default DatalakePage;
