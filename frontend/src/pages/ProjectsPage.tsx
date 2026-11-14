import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
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
  METHOD_COLOR,
  initials,
  methodOf,
  qualityColor,
} from '@/lib/design';

const COLS = 'minmax(150px,2fr) 96px 104px minmax(140px,1.4fr) 70px 64px 94px';

type ProjectTab = 'runs' | 'resources' | 'people' | 'about';

const actionButton = (primary = false): React.CSSProperties => ({
  all: 'unset',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  padding: '6px 12px',
  borderRadius: 5,
  border: primary ? '1px solid var(--primary-500)' : '1px solid var(--border-default)',
  background: primary ? 'var(--primary-500)' : 'transparent',
  color: primary ? '#fff' : 'var(--fg-default)',
  boxShadow: primary ? 'inset 0 1px 0 rgba(255,255,255,0.12)' : undefined,
});

export const ProjectsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<ProjectTab>('runs');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [hoverId, setHoverId] = useState<number | null>(null);

  // Returning from a run: land on the project it came from.
  React.useEffect(() => {
    const incoming = (location.state as { projectId?: number } | null)?.projectId;
    if (typeof incoming === 'number') {
      setSelected(incoming);
      setTab('runs');
    }
  }, [location.state]);

  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => apiClient.listProjects() });
  const runsQuery = useQuery({ queryKey: ['runs', 'projects'], queryFn: () => apiClient.listRuns({ limit: 1000 }) });

  const projects = (projectsQuery.data ?? []) as Project[];
  const runs = (runsQuery.data?.runs ?? []) as (SimulationRun & { project_name?: string })[];

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

  const createProject = async () => {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      const created = await apiClient.createProject({
        name: newName.trim(),
        description: newDesc.trim() || undefined,
      } as never);
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      if (created && typeof created === 'object' && 'id' in created) {
        setSelected((created as Project).id);
      }
      setCreating(false);
      setNewName('');
      setNewDesc('');
    } finally {
      setBusy(false);
    }
  };

  const tabs: { key: ProjectTab; label: string; count?: number }[] = [
    { key: 'runs', label: 'Runs', count: activeRuns.length },
    { key: 'resources', label: 'Resources', count: 0 },
    { key: 'people', label: 'Collaborators', count: active?.collaborators?.length ?? 0 },
    { key: 'about', label: 'About' },
  ];

  return (
    <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '16px 24px', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flex: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={EYEBROW}>Projects</span>
          <span style={{ fontSize: 13, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
            <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-default)', fontWeight: 600 }}>{filtered.length}</b> projects ·{' '}
            <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-default)', fontWeight: 600 }}>{runs.length}</b> runs
          </span>
        </div>
        <button
          onClick={() => setCreating(true)}
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
          New project
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
                  onClick={() => {
                    setSelected(project.id);
                    setTab('runs');
                  }}
                  onMouseEnter={() => setHoverId(project.id)}
                  onMouseLeave={() => setHoverId(null)}
                  style={{
                    padding: '10px 16px 10px 13px',
                    borderBottom: `1px solid ${hoverId === project.id ? 'rgba(255,255,255,0.15)' : 'var(--border-subtle)'}`,
                    borderLeft: `3px solid ${isActive ? 'var(--primary-500)' : 'transparent'}`,
                    background:
                      hoverId === project.id
                        ? 'var(--primary-500)'
                        : isActive
                          ? 'var(--bg-selected)'
                          : 'transparent',
                    color: hoverId === project.id ? '#fff' : 'var(--fg-default)',
                    cursor: 'pointer',
                    lineHeight: 1.3,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                    transition: 'background 120ms cubic-bezier(0.4,0,0.2,1)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: hoverId === project.id ? '#fff' : isActive ? 'var(--fg-link-hover)' : 'var(--fg-link)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {project.name}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{project.run_count ?? projectRuns.length}</span>
                  </div>
                  {project.description && (
                    <div style={{ fontSize: 12, color: hoverId === project.id ? 'rgba(255,255,255,0.8)' : 'var(--fg-muted)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {project.description}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: hoverId === project.id ? 'rgba(255,255,255,0.9)' : 'var(--primary-100)', color: hoverId === project.id ? 'var(--primary-700)' : 'var(--primary-700)', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {initials(project.pi_name || 'Tessera')}
                    </span>
                    <span style={{ fontSize: 12, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                      {project.pi_name || '—'}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: hoverId === project.id ? 'rgba(255,255,255,0.8)' : 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
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
                        background: hoverId === project.id ? '#fff' : project.is_public ? 'var(--accent-300)' : 'var(--ink-100)',
                        color: hoverId === project.id ? 'var(--primary-700)' : project.is_public ? 'var(--accent-700)' : 'var(--ink-600)',
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
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 4, boxShadow: 'var(--shadow-1)', overflow: 'hidden' }}>
          {!active && <div style={{ padding: 32, fontSize: 13, color: 'var(--fg-muted)' }}>Select a project.</div>}

          {active && (
            <>
              <div style={{ flex: 'none', padding: '18px 24px 14px', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>
                  projects / {active.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px 16px', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                        {active.name}
                      </h1>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          fontSize: 11,
                          fontWeight: 500,
                          padding: '1px 8px',
                          borderRadius: 999,
                          background: active.is_public ? 'var(--accent-300)' : 'var(--ink-100)',
                          color: active.is_public ? 'var(--accent-700)' : 'var(--ink-600)',
                        }}
                      >
                        {active.is_public ? 'Public' : 'Private'}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--fg-muted)', maxWidth: '72ch' }}>
                      {active.description || 'No description yet.'}
                    </p>
                    {active.keywords?.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                        {active.keywords.map((keyword) => (
                          <span
                            key={keyword}
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 12,
                              padding: '3px 8px',
                              border: '1px solid var(--border-default)',
                              borderRadius: 4,
                              color: 'var(--fg-muted)',
                            }}
                          >
                            {keyword}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
                    <button onClick={() => navigate('/')} style={actionButton()}>
                      Open in datalake
                    </button>
                    <button onClick={() => navigate('/upload')} style={actionButton()}>
                      Upload run
                    </button>
                  </div>
                </div>
              </div>

              <div
                style={{
                  flex: 'none',
                  display: 'flex',
                  gap: 4,
                  borderBottom: '1px solid var(--border-default)',
                  padding: '0 24px',
                  background: 'var(--bg-surface)',
                }}
              >
                {tabs.map((item) => {
                  const isActive = tab === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => setTab(item.key)}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        padding: '10px 12px',
                        fontSize: 13,
                        fontWeight: isActive ? 600 : 500,
                        color: isActive ? 'var(--fg-default)' : 'var(--fg-muted)',
                        borderBottom: `2px solid ${isActive ? 'var(--primary-500)' : 'transparent'}`,
                        marginBottom: -1,
                        display: 'flex',
                        gap: 6,
                        alignItems: 'center',
                      }}
                    >
                      {item.label}
                      {item.count !== undefined && item.count > 0 && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>{item.count}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {tab === 'runs' && (
                  <>
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
                      const hovered = hoverId === run.id;
                      const muted = hovered ? 'rgba(255,255,255,0.8)' : 'var(--fg-muted)';
                      return (
                        <div
                          key={run.id}
                          onClick={() =>
                            navigate(`/runs/${run.id}`, {
                              state: {
                                from: 'projects',
                                projectId: active.id,
                                projectName: active.name,
                              },
                            })
                          }
                          onMouseEnter={() => setHoverId(run.id)}
                          onMouseLeave={() => setHoverId(null)}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: COLS,
                            alignItems: 'center',
                            cursor: 'pointer',
                            borderBottom: `1px solid ${hovered ? 'rgba(255,255,255,0.15)' : 'var(--border-subtle)'}`,
                            background: hovered ? 'var(--primary-500)' : 'transparent',
                            color: hovered ? '#fff' : 'var(--fg-default)',
                            lineHeight: 1.3,
                            transition: 'background 120ms cubic-bezier(0.4,0,0.2,1)',
                          }}
                        >
                          <div style={{ padding: '9px 16px', minWidth: 0 }}>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: hovered ? '#fff' : 'var(--fg-link)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {run.run_name}
                            </div>
                            <div style={{ fontSize: 11, color: muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {run.system?.composition}
                            </div>
                          </div>
                          <div style={{ padding: '0 12px' }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, padding: '1px 5px', border: `1px solid ${hovered ? 'rgba(255,255,255,0.6)' : 'var(--border-strong)'}`, borderRadius: 2, color: hovered ? '#fff' : 'var(--fg-default)' }}>
                              {run.engine?.name}
                            </span>
                          </div>
                          <div style={{ padding: '0 12px' }}>
                            <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: hovered ? '#fff' : METHOD_COLOR[method], color: hovered ? 'var(--primary-700)' : '#fff', whiteSpace: 'nowrap' }}>
                              {METHOD_LABEL[method]}
                            </span>
                          </div>
                          <div style={{ padding: '0 12px', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {fmtConditions(run.ensemble, run.temperature_target, run.pressure_target) || '—'}
                          </div>
                          <div style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'right' }}>{fmtLength(run.total_time)}</div>
                          <div style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'right' }}>{fmtAtoms(run.system?.n_atoms)}</div>
                          <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 2, background: hovered ? 'rgba(255,255,255,0.25)' : 'var(--border-default)', borderRadius: 1, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${quality}%`, background: hovered ? '#fff' : qualityColor(quality) }} />
                            </div>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: hovered ? '#fff' : 'var(--fg-muted)' }}>{quality}</span>
                          </div>
                        </div>
                      );
                    })}
                    {activeRuns.length === 0 && (
                      <div style={{ padding: 32, fontSize: 13, color: 'var(--fg-muted)' }}>This project has no runs yet.</div>
                    )}
                  </>
                )}

                {tab === 'resources' && (
                  <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>No linked resources yet.</span>
                    <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
                      Repositories, datasets and manuscripts attached to this project will appear here.
                    </span>
                  </div>
                )}

                {tab === 'people' && (
                  <div style={{ padding: '8px 0' }}>
                    {(active.collaborators ?? []).map((person) => (
                      <div key={person.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
                        <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--primary-100)', color: 'var(--primary-700)', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {initials(person.full_name || person.email)}
                        </span>
                        <span style={{ fontSize: 13 }}>{person.full_name || person.email}</span>
                        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{person.email}</span>
                        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          {person.role}
                        </span>
                      </div>
                    ))}
                    {(active.collaborators ?? []).length === 0 && (
                      <div style={{ padding: '24px 24px', fontSize: 13, color: 'var(--fg-muted)' }}>No collaborators yet.</div>
                    )}
                  </div>
                )}

                {tab === 'about' && (
                  <div style={{ padding: '18px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
                    {[
                      ['Lead', active.pi_name || '—'],
                      ['Institution', active.institution || '—'],
                      ['Funding', active.funding_source || '—'],
                      ['Grant', active.grant_number || '—'],
                      ['Created', fmtDate(active.created_at)],
                      ['Visibility', active.is_public ? 'Public' : 'Private'],
                      ['Runs', String(activeRuns.length)],
                      ['Collaborators', String(active.collaborators?.length ?? 0)],
                    ].map(([label, value]) => (
                      <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={EYEBROW}>{label}</span>
                        <span style={{ fontSize: 13 }}>{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {creating && (
        <div
          onClick={() => !busy && setCreating(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(13,17,23,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80 }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{ width: 420, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 6, boxShadow: 'var(--shadow-4)', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600 }}>New project</h2>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={EYEBROW}>Name</span>
              <input
                autoFocus
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                style={{ border: '1px solid var(--border-default)', borderRadius: 4, padding: '6px 8px', fontSize: 13, background: 'var(--bg-surface)', color: 'var(--fg-default)', fontFamily: 'var(--font-mono)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={EYEBROW}>Description</span>
              <input
                value={newDesc}
                onChange={(event) => setNewDesc(event.target.value)}
                style={{ border: '1px solid var(--border-default)', borderRadius: 4, padding: '6px 8px', fontSize: 13, background: 'var(--bg-surface)', color: 'var(--fg-default)' }}
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button onClick={() => setCreating(false)} style={actionButton()}>
                Cancel
              </button>
              <button onClick={createProject} style={actionButton(true)}>
                {busy ? 'Creating…' : 'Create project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default ProjectsPage;
