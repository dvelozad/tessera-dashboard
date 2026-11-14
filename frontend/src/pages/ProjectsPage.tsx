import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import apiClient from '@/services/api';
import type { Project, SimulationRun } from '@/types/visualization';
import {
  EYEBROW,
  METHOD_LABEL,
  engineBucket,
  fmtAtoms,
  fmtConditions,
  fmtDate,
  fmtLength,
  initials,
  methodOf,
  qualityColor,
} from '@/lib/design';

const COLS = 'minmax(150px,2fr) 96px 104px minmax(140px,1.4fr) 70px 64px 94px';

export const ProjectsPage: React.FC = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number | null>(null);

  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => apiClient.listProjects() });
  const runsQuery = useQuery({ queryKey: ['runs', 'projects'], queryFn: () => apiClient.listRuns({ limit: 1000 }) });

  const projects = (projectsQuery.data ?? []) as Project[];
  const runs = ((runsQuery.data?.runs ?? []) as (SimulationRun & { project_name?: string })[]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((project) =>
      [project.name, project.description, project.pi_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [projects, query]);

  const active = projects.find((project) => project.id === selected) || filtered[0];
  const activeRuns = runs.filter((run) => (active ? run.project_name === active.name : false));

  const totalRuns = runs.length;

  return (
    <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '16px 24px', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flex: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={EYEBROW}>Projects</span>
          <span style={{ fontSize: 13, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
            <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-default)', fontWeight: 600 }}>{filtered.length}</b> projects ·{' '}
            <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-default)', fontWeight: 600 }}>{totalRuns}</b> runs
          </span>
        </div>
        <button
          onClick={() => navigate('/upload')}
          style={{
            all: 'unset',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            padding: '5px 14px',
            borderRadius: 5,
            background: 'var(--primary-600)',
            color: '#fff',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M5 12h14M12 5v14" />
          </svg>
          Upload run
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '340px minmax(0,1fr)', gap: 16 }}>
        {/* Project list */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 4, boxShadow: 'var(--shadow-1)', overflow: 'hidden' }}>
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 40, borderBottom: '1px solid var(--border-default)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--fg-muted)" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter projects"
              style={{ flex: 1, border: 0, outline: 0, background: 'transparent', fontSize: 13, color: 'var(--fg-default)', fontFamily: 'var(--font-sans)' }}
            />
          </div>
          <div style={{ flex: 'none', padding: '8px 16px', background: 'var(--bg-sunken)', borderBottom: '1px solid var(--border-default)', display: 'flex', justifyContent: 'space-between' }}>
            <span style={EYEBROW}>Name</span>
            <span style={EYEBROW}>Runs</span>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {filtered.map((project) => {
              const isActive = active?.id === project.id;
              const projectRuns = runs.filter((run) => run.project_name === project.name);
              const engines = [...new Set(projectRuns.map((run) => engineBucket(run.engine?.name)))].join(' · ');
              return (
                <div
                  key={project.id}
                  onClick={() => setSelected(project.id)}
                  style={{
                    padding: '10px 16px 10px 13px',
                    borderBottom: '1px solid var(--border-subtle)',
                    borderLeft: `3px solid ${isActive ? 'var(--primary-500)' : 'transparent'}`,
                    background: isActive ? 'var(--bg-selected)' : 'transparent',
                    cursor: 'pointer',
                    lineHeight: 1.3,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: isActive ? 'var(--fg-link-hover)' : 'var(--fg-link)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {project.name}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{project.run_count ?? projectRuns.length}</span>
                  </div>
                  {project.description && (
                    <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {project.description}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--primary-100)', color: 'var(--primary-700)', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {initials(project.pi_name || 'Tessera')}
                    </span>
                    <span style={{ fontSize: 12, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                      {project.pi_name || '—'}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                      {engines}
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        fontSize: 11,
                        fontWeight: 500,
                        padding: '1px 6px',
                        borderRadius: 999,
                        background: project.is_public ? 'var(--accent-300)' : 'var(--ink-100)',
                        color: project.is_public ? 'var(--accent-700)' : 'var(--ink-600)',
                      }}
                    >
                      {project.is_public ? 'Public' : 'Private'}
                    </span>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: 24, fontSize: 13, color: 'var(--fg-muted)' }}>No projects match that filter.</div>
            )}
          </div>
        </div>

        {/* Workspace */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 4, boxShadow: 'var(--shadow-1)', overflow: 'auto', lineHeight: 1.4 }}>
          {!active && <div style={{ padding: 32, fontSize: 13, color: 'var(--fg-muted)' }}>Select a project.</div>}

          {active && (
            <>
              <div style={{ flex: 'none', padding: '18px 24px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>
                  projects / {active.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                    <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>{active.name}</h2>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-muted)', maxWidth: 720 }}>{active.description || 'No description yet.'}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
                    <button onClick={() => navigate('/')} style={{ all: 'unset', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '5px 12px', borderRadius: 5, border: '1px solid var(--border-default)', color: 'var(--fg-default)' }}>
                      Open in datalake
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
                  {[
                    ['Lead', active.pi_name || '—'],
                    ['Institution', active.institution || '—'],
                    ['Funding', active.funding_source || '—'],
                    ['Runs', String(activeRuns.length)],
                  ].map(([label, value]) => (
                    <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={EYEBROW}>{label}</span>
                      <span style={{ fontSize: 13 }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ flex: 'none', padding: '0 24px', borderBottom: '1px solid var(--border-default)' }}>
                <span style={{ display: 'inline-block', padding: '10px 0', fontSize: 13, fontWeight: 600, color: 'var(--fg-default)', borderBottom: '2px solid var(--primary-500)' }}>
                  Runs <span style={{ fontWeight: 400, color: 'var(--fg-muted)' }}>{activeRuns.length}</span>
                </span>
              </div>

              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: COLS, background: 'var(--bg-sunken)', borderBottom: '1px solid var(--border-default)', position: 'sticky', top: 0, zIndex: 1 }}>
                  {['Run', 'Engine', 'Method', 'Conditions', 'Length', 'Atoms', 'Quality'].map((label, index) => (
                    <span key={label} style={{ ...EYEBROW, padding: '8px 12px', paddingLeft: index === 0 ? 16 : 12, textAlign: index >= 4 ? 'right' : 'left' }}>
                      {label}
                    </span>
                  ))}
                </div>
                {activeRuns.map((run) => {
                  const method = methodOf(run.simulation_method);
                  const quality = run.completeness_score ?? 0;
                  return (
                    <div
                      key={run.id}
                      onClick={() => navigate(`/runs/${run.id}`)}
                      style={{ display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)', lineHeight: 1.3 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div style={{ padding: '9px 16px', minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: 'var(--fg-link)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {run.run_name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {run.system?.composition}
                        </div>
                      </div>
                      <div style={{ padding: '0 12px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, padding: '1px 5px', border: '1px solid var(--border-default)', borderRadius: 2 }}>
                          {run.engine?.name}
                        </span>
                      </div>
                      <div style={{ padding: '0 12px', fontSize: 11, fontWeight: 600 }}>
                        {METHOD_LABEL[method]}
                      </div>
                      <div style={{ padding: '0 12px', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {fmtConditions(run.ensemble, run.temperature_target, run.pressure_target) || '—'}
                      </div>
                      <div style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'right' }}>{fmtLength(run.total_time)}</div>
                      <div style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'right' }}>{fmtAtoms(run.system?.n_atoms)}</div>
                      <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 2, background: 'var(--border-default)', borderRadius: 1, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${quality}%`, background: qualityColor(quality) }} />
                        </div>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>{quality}</span>
                      </div>
                    </div>
                  );
                })}
                {activeRuns.length === 0 && (
                  <div style={{ padding: 32, fontSize: 13, color: 'var(--fg-muted)' }}>This project has no runs yet.</div>
                )}
              </div>

              <div style={{ flex: 'none', padding: '10px 24px', borderTop: '1px solid var(--border-default)', background: 'var(--bg-sunken)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>
                created {fmtDate(active.created_at)}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
};

export default ProjectsPage;
