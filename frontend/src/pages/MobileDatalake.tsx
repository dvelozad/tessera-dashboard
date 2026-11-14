import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import apiClient from '@/services/api';
import type { SimulationRun } from '@/types/visualization';
import {
  EYEBROW,
  METHOD_COLOR,
  METHOD_LABEL,
  engineBucket,
  fmtAtoms,
  fmtConditions,
  fmtLength,
  methodOf,
  qualityColor,
} from '@/lib/design';

type RunRow = SimulationRun & { project_name?: string };

const ENGINE_BUCKETS = ['LAMMPS', 'GROMACS', 'AREPAS', 'Other'] as const;

/**
 * The phone layout from the handoff: 44px search, a horizontally scrolling
 * chip row, then one compact card per run instead of the ten-column table.
 */
export const MobileDatalake: React.FC = () => {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [engine, setEngine] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'cards'>('list');

  const { data, isLoading } = useQuery({
    queryKey: ['runs', 'datalake'],
    queryFn: () => apiClient.listRuns({ limit: 1000 }),
  });

  const runs = (data?.runs ?? []) as RunRow[];

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return runs.filter((run) => {
      if (engine && engineBucket(run.engine?.name) !== engine) return false;
      if (view === 'list' && false) return false;
      if (!needle) return true;
      return [run.run_name, run.project_name, run.system?.composition, run.engine?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [runs, q, engine, view]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <div style={{ padding: '12px 16px 10px', display: 'flex', flexDirection: 'column', gap: 10, position: 'sticky', top: 0, background: 'var(--bg-canvas)', zIndex: 5 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 12px', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 6 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--fg-muted)" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search runs"
              style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: 16, color: 'var(--fg-default)', fontFamily: 'var(--font-sans)' }}
            />
          </div>
          <button
            onClick={() => setView(view === 'list' ? 'cards' : 'list')}
            aria-label="Toggle layout"
            style={{ all: 'unset', cursor: 'pointer', width: 44, height: 44, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-default)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--fg-muted)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', margin: '0 -16px', padding: '0 16px', scrollbarWidth: 'none' }}>
          <button
            onClick={() => setEngine(null)}
            style={{
              all: 'unset', cursor: 'pointer', flex: 'none', display: 'flex', alignItems: 'center', gap: 6,
              height: 32, padding: '0 12px', borderRadius: 16, fontFamily: 'var(--font-mono)', fontSize: 12,
              border: '1px solid var(--border-default)',
              background: engine === null ? 'var(--primary-600)' : 'var(--bg-surface)',
              color: engine === null ? '#fff' : 'var(--fg-muted)',
            }}
          >
            All <span style={{ opacity: 0.7 }}>{runs.length}</span>
          </button>
          {ENGINE_BUCKETS.map((bucket) => {
            const count = runs.filter((run) => engineBucket(run.engine?.name) === bucket).length;
            const on = engine === bucket;
            return (
              <button
                key={bucket}
                onClick={() => setEngine(on ? null : bucket)}
                style={{
                  all: 'unset', cursor: 'pointer', flex: 'none', display: 'flex', alignItems: 'center', gap: 6,
                  height: 32, padding: '0 12px', borderRadius: 16, fontFamily: 'var(--font-mono)', fontSize: 12,
                  border: '1px solid var(--border-default)',
                  background: on ? 'var(--primary-600)' : 'var(--bg-surface)',
                  color: on ? '#fff' : 'var(--fg-muted)',
                }}
              >
                {bucket === 'Other' ? 'Other' : bucket} <span style={{ opacity: 0.7 }}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 16px 10px' }}>
        <span style={EYEBROW}>Datalake</span>
        <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
          <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-default)' }}>{filtered.length}</b> runs
        </span>
      </div>

      {isLoading && <div style={{ padding: 24, fontSize: 14, color: 'var(--fg-muted)' }}>Loading…</div>}

      {view === 'list' &&
        filtered.map((run) => {
          const method = methodOf(run.simulation_method);
          const quality = run.completeness_score ?? 0;
          return (
            <div
              key={run.id}
              onClick={() => navigate(`/runs/${run.id}`)}
              style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 5, cursor: 'pointer', background: 'var(--bg-surface)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500, color: 'var(--fg-link)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {run.run_name}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, padding: '1px 5px', border: '1px solid var(--border-strong)', borderRadius: 2 }}>
                  {run.engine?.name}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: METHOD_COLOR[method], color: '#fff', whiteSpace: 'nowrap' }}>
                  {METHOD_LABEL[method]}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg-muted)' }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {fmtConditions(run.ensemble, run.temperature_target, run.pressure_target) || '—'}
                </span>
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'nowrap' }}>
                  {fmtLength(run.total_time)} · {fmtAtoms(run.system?.n_atoms)}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                  {run.project_name}
                </span>
                <span style={{ whiteSpace: 'nowrap', marginLeft: 'auto' }}>{quality}</span>
                <div style={{ flex: '0 0 72px', height: 2, background: 'var(--border-default)', borderRadius: 1, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${quality}%`, background: qualityColor(quality) }} />
                </div>
              </div>
            </div>
          );
        })}

      {view === 'cards' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10, padding: '0 16px 16px' }}>
          {filtered.map((run) => {
            const method = methodOf(run.simulation_method);
            const quality = run.completeness_score ?? 0;
            return (
              <div key={run.id} onClick={() => navigate(`/runs/${run.id}`)} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ height: 72, background: '#0d1117', padding: '8px 10px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: METHOD_COLOR[method], color: '#fff', alignSelf: 'flex-start' }}>
                    {METHOD_LABEL[method]}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>{run.project_name}</span>
                </div>
                <div style={{ height: 2, background: 'var(--border-default)' }}>
                  <div style={{ height: '100%', width: `${quality}%`, background: qualityColor(quality) }} />
                </div>
                <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--fg-link)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{run.run_name}</span>
                  <span style={{ fontSize: 12, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {fmtConditions(run.ensemble, run.temperature_target, run.pressure_target)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div style={{ padding: '48px 24px', textAlign: 'center', fontSize: 14, color: 'var(--fg-muted)' }}>
          No runs match that search.
        </div>
      )}
    </div>
  );
};
