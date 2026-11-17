import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useIsNarrow } from '@/hooks/useIsNarrow';
import { ResizeHandle, useResizableColumns } from '@/hooks/useResizableColumns';
import apiClient, { type RunGroup } from '@/services/api';
import type { Project, ProjectLink, SimulationRun } from '@/types/visualization';
import { EditProjectDialog } from '@/components/projects/EditProjectDialog';
import { EditRunDialog } from '@/components/browser/EditRunDialog';
import { ManageCampaignsDialog } from '@/components/projects/ManageCampaignsDialog';
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

const COLS = '32px minmax(150px,2fr) 96px 104px minmax(140px,1.4fr) 70px 64px 94px';

type ProjectTab = 'runs' | 'resources' | 'people' | 'about';

type ProjectRun = SimulationRun & {
  project_name?: string;
  group_id?: number | null;
  group_name?: string | null;
};

/** 'all', 'none' (ungrouped) or a campaign id. */
type CampaignFilter = 'all' | 'none' | number;

interface CampaignSection {
  key: string;
  filter: number | 'none';
  name: string;
  description: string | null;
  color: string | null;
  runs: ProjectRun[];
}

const chipStyle = (on: boolean): React.CSSProperties => ({
  all: 'unset',
  cursor: 'pointer',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 10px',
  borderRadius: 4,
  boxSizing: 'border-box',
  border: `1px solid ${on ? 'var(--primary-500)' : 'var(--border-default)'}`,
  background: on ? 'var(--primary-500)' : 'var(--bg-surface)',
  color: on ? '#fff' : 'var(--fg-default)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
});

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

/** Same button, but inverts to the primary colour on hover like the rows do. */
const ActionButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'outline' | 'primary';
}> = ({ children, onClick, variant = 'outline' }) => {
  const [hover, setHover] = useState(false);
  const primary = variant === 'primary';
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
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
        border: `1px solid ${primary || hover ? 'var(--primary-500)' : 'var(--border-default)'}`,
        background: primary
          ? hover
            ? 'var(--primary-600)'
            : 'var(--primary-500)'
          : hover
            ? 'var(--primary-500)'
            : 'transparent',
        color: primary || hover ? '#fff' : 'var(--fg-default)',
        boxShadow: primary ? 'inset 0 1px 0 rgba(255,255,255,0.12)' : undefined,
        transition: 'background 120ms, color 120ms, border-color 120ms',
      }}
    >
      {children}
    </button>
  );
};

export const ProjectsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const narrow = useIsNarrow();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<ProjectTab>('runs');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [editingRun, setEditingRun] = useState<ProjectRun | null>(null);
  // Run-table columns are draggable; widths persist per browser.
  const {
    template: runTableTemplate,
    headerRef: runHeaderRef,
    beginResize: beginColumnResize,
    reset: resetColumnWidths,
  } = useResizableColumns('tessera.projects.columns', COLS, 8);
  const [links, setLinks] = useState<ProjectLink[]>([]);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkType, setLinkType] = useState('github');
  const [runSearch, setRunSearch] = useState('');
  const [campaign, setCampaign] = useState<CampaignFilter>('all');
  const [newestFirst, setNewestFirst] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [runHoverId, setRunHoverId] = useState<number | null>(null);
  const [sectionHover, setSectionHover] = useState<string | null>(null);
  const [manageCampaignsOpen, setManageCampaignsOpen] = useState(false);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<number>>(new Set());
  const [movingRuns, setMovingRuns] = useState(false);

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
  const runs = (runsQuery.data?.runs ?? []) as ProjectRun[];

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
  const activeRuns = useMemo(
    () => runs.filter((run) => (active ? run.project_name === active.name : false)),
    [runs, active?.name]
  );

  const groupsQuery = useQuery({
    queryKey: ['project-groups', active?.id],
    queryFn: () => apiClient.listProjectGroups(active!.id),
    enabled: !!active,
  });

  const needle = runSearch.trim().toLowerCase();

  // A new project starts unfiltered and clears selections.
  React.useEffect(() => {
    setRunSearch('');
    setCampaign('all');
    setSelectedRunIds(new Set());
  }, [active?.id]);

  // If the active campaign filter is deleted, reset to 'all'.
  React.useEffect(() => {
    if (typeof campaign === 'number') {
      const groups = (groupsQuery.data ?? []) as RunGroup[];
      if (groups.length > 0 && !groups.some((g) => g.id === campaign)) {
        setCampaign('all');
      }
    }
  }, [campaign, groupsQuery.data]);

  const moveRuns = async (runIds: number[], targetGroupId: number | null) => {
    if (runIds.length === 0 || movingRuns) return;
    setMovingRuns(true);
    try {
      await Promise.all(runIds.map((id) => apiClient.setRunGroup(id, targetGroupId)));
      await queryClient.invalidateQueries({ queryKey: ['runs', 'projects'] });
      await queryClient.invalidateQueries({ queryKey: ['project-groups', active?.id] });
      setSelectedRunIds(new Set());
    } catch (err) {
      console.error('Failed to move runs:', err);
    } finally {
      setMovingRuns(false);
    }
  };

  const toggleRunSelect = (runId: number) => {
    setSelectedRunIds((current) => {
      const next = new Set(current);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const toggleSectionSelect = (sectionRuns: ProjectRun[]) => {
    setSelectedRunIds((current) => {
      const next = new Set(current);
      const allSelected = sectionRuns.length > 0 && sectionRuns.every((r) => next.has(r.id));
      if (allSelected) {
        sectionRuns.forEach((r) => next.delete(r.id));
      } else {
        sectionRuns.forEach((r) => next.add(r.id));
      }
      return next;
    });
  };

  const runView = useMemo(() => {
    const groups = [...((groupsQuery.data ?? []) as RunGroup[])].sort(
      (a, b) => a.position - b.position || a.name.localeCompare(b.name)
    );
    const time = (run: ProjectRun) => (run.created_at ? Date.parse(run.created_at) : NaN);
    const ordered = [...activeRuns].sort((a, b) => {
      const ta = time(a);
      const tb = time(b);
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return newestFirst ? tb - ta : ta - tb;
    });
    const searched = needle
      ? ordered.filter((run) =>
          [run.run_name, run.system?.composition, run.group_name, ...(run.tags ?? [])]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(needle)
        )
      : ordered;

    const sections: CampaignSection[] = groups.map((group) => ({
      key: `g${group.id}`,
      filter: group.id,
      name: group.name,
      description: group.description,
      color: group.color,
      runs: searched.filter((run) => run.group_id === group.id),
    }));
    // A run can point at a campaign the groups request has not returned yet.
    const known = new Set(groups.map((group) => group.id));
    for (const run of searched) {
      if (run.group_id == null || known.has(run.group_id)) continue;
      known.add(run.group_id);
      sections.push({
        key: `g${run.group_id}`,
        filter: run.group_id,
        name: run.group_name || `Campaign ${run.group_id}`,
        description: null,
        color: null,
        runs: searched.filter((other) => other.group_id === run.group_id),
      });
    }
    sections.push({
      key: 'none',
      filter: 'none',
      name: 'Ungrouped',
      description: null,
      color: null,
      runs: searched.filter((run) => run.group_id == null),
    });

    const hasCampaigns = sections.length > 1;
    const visible = sections.filter((section) => {
      if (campaign !== 'all') return section.filter === campaign;
      // Empty campaigns are shown while browsing, hidden while searching; Ungrouped only when it has runs.
      if (section.filter === 'none') return section.runs.length > 0;
      return !needle || section.runs.length > 0;
    });
    const shown = visible.reduce((sum, section) => sum + section.runs.length, 0);
    return { sections, visible, hasCampaigns, searchedCount: searched.length, shown };
  }, [activeRuns, groupsQuery.data, needle, newestFirst, campaign]);

  const shownRuns = useMemo(() => runView.visible.flatMap((s) => s.runs), [runView.visible]);
  const allShownSelected = shownRuns.length > 0 && shownRuns.every((r) => selectedRunIds.has(r.id));
  const someShownSelected = shownRuns.some((r) => selectedRunIds.has(r.id)) && !allShownSelected;

  const toggleSelectAllShown = () => {
    setSelectedRunIds((current) => {
      const next = new Set(current);
      if (allShownSelected) {
        shownRuns.forEach((r) => next.delete(r.id));
      } else {
        shownRuns.forEach((r) => next.add(r.id));
      }
      return next;
    });
  };

  React.useEffect(() => {
    if (!active) {
      setLinks([]);
      return;
    }
    apiClient
      .listProjectLinks(active.id)
      .then(setLinks)
      .catch(() => setLinks([]));
  }, [active?.id]);

  const addLink = async () => {
    if (!active || !linkLabel.trim() || !linkUrl.trim()) return;
    await apiClient.addProjectLink(active.id, {
      link_type: linkType,
      label: linkLabel.trim(),
      url: linkUrl.trim(),
    });
    setLinks(await apiClient.listProjectLinks(active.id));
    setLinkLabel('');
    setLinkUrl('');
  };

  const removeLink = async (id: number) => {
    if (!active) return;
    await apiClient.removeProjectLink(active.id, id);
    setLinks((current) => current.filter((link) => link.id !== id));
  };

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

  const stats = (() => {
    const temps = activeRuns
      .map((run) => run.temperature_target)
      .filter((value): value is number => typeof value === 'number');
    const atoms = activeRuns.map((run) => run.system?.n_atoms || 0).filter((value) => value > 0);
    const totalNs = activeRuns.reduce((sum, run) => sum + (run.total_time || 0), 0);
    const scores = activeRuns.map((run) => run.completeness_score || 0);
    return {
      engines: [...new Set(activeRuns.map((run) => run.engine?.name).filter(Boolean))],
      ensembles: [...new Set(activeRuns.map((run) => run.ensemble).filter(Boolean))],
      temperature:
        temps.length > 0
          ? `${Math.min(...temps)}–${Math.max(...temps)} K`
          : '—',
      totalTime: totalNs > 0 ? fmtLength(totalNs) : '—',
      atoms:
        atoms.length > 0
          ? `${fmtAtoms(Math.min(...atoms))}–${fmtAtoms(Math.max(...atoms))}`
          : '—',
      meanQuality: scores.length
        ? String(Math.round(scores.reduce((a, b) => a + b, 0) / scores.length))
        : '—',
      lastRun: activeRuns
        .map((run) => run.created_at)
        .filter(Boolean)
        .sort()
        .pop(),
    };
  })();

  const openRun = (run: ProjectRun) =>
    active &&
    navigate(`/runs/${run.id}`, {
      state: { from: 'projects', projectId: active.id, projectName: active.name },
    });

  // Desktop: the seven-column grid. Phone: the handoff's stacked three-line row.
  const renderRunRow = (run: ProjectRun) => {
    const method = methodOf(run.simulation_method);
    const quality = run.completeness_score ?? 0;
    const hovered = runHoverId === run.id;
    const muted = hovered ? 'rgba(255,255,255,0.8)' : 'var(--fg-muted)';
    const engineTag = (
      <span style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, padding: '1px 5px', border: `1px solid ${hovered ? 'rgba(255,255,255,0.6)' : 'var(--border-strong)'}`, borderRadius: 2, color: hovered ? '#fff' : 'var(--fg-default)' }}>
        {run.engine?.name}
      </span>
    );
    const methodPill = (
      <span style={{ flex: 'none', display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: hovered ? '#fff' : METHOD_COLOR[method], color: hovered ? 'var(--primary-700)' : '#fff', whiteSpace: 'nowrap' }}>
        {METHOD_LABEL[method]}
      </span>
    );
    const qualityBar = (
      <>
        <div style={{ flex: 1, minWidth: 24, height: 2, background: hovered ? 'rgba(255,255,255,0.25)' : 'var(--border-default)', borderRadius: 1, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${quality}%`, background: hovered ? '#fff' : qualityColor(quality) }} />
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: hovered ? '#fff' : 'var(--fg-muted)' }}>{quality}</span>
      </>
    );
    const conditions = fmtConditions(run.ensemble, run.temperature_target, run.pressure_target) || '—';
    const runLabels = run.tags ?? [];
    const editButton = (
      <button
        type="button"
        aria-label={`Edit run ${run.run_name}`}
        onClick={(event) => {
          // The row itself opens the run; editing is a separate intent.
          event.stopPropagation();
          setEditingRun(run);
        }}
        style={{
          all: 'unset',
          cursor: 'pointer',
          flex: 'none',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: hovered ? '#fff' : 'var(--fg-link)',
          border: `1px solid ${hovered ? 'rgba(255,255,255,0.6)' : 'var(--border-default)'}`,
          borderRadius: 3,
          padding: '1px 6px',
        }}
      >
        Edit
      </button>
    );
    return (
      <div
        key={run.id}
        data-run-row
        data-created={run.created_at}
        onClick={() => openRun(run)}
        onMouseEnter={() => setRunHoverId(run.id)}
        onMouseLeave={() => setRunHoverId(null)}
        style={{
          ...(narrow
            ? { display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 16px' }
            : { display: 'grid', gridTemplateColumns: runTableTemplate, alignItems: 'center' }),
          cursor: 'pointer',
          borderBottom: `1px solid ${hovered ? 'rgba(255,255,255,0.15)' : 'var(--border-subtle)'}`,
          background: hovered ? 'var(--primary-500)' : 'transparent',
          color: hovered ? '#fff' : 'var(--fg-default)',
          lineHeight: 1.3,
          transition: 'background 120ms cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        {narrow ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <input
                type="checkbox"
                checked={selectedRunIds.has(run.id)}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleRunSelect(run.id);
                }}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Select run ${run.run_name}`}
                style={{ cursor: 'pointer', margin: 0, flex: 'none' }}
              />
              <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: hovered ? '#fff' : 'var(--fg-link)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {run.run_name}
              </span>
              {engineTag}
              {methodPill}
              {editButton}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: muted, minWidth: 0 }}>
              <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{conditions}</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{fmtLength(run.total_time)}</span>
            </div>
            {runLabels.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minWidth: 0 }}>
                {runLabels.slice(0, 3).map((label) => (
                  <span
                    key={label}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 999,
                      border: `1px solid ${hovered ? 'rgba(255,255,255,0.6)' : 'var(--border-default)'}`,
                      color: hovered ? '#fff' : 'var(--fg-muted)',
                    }}
                  >
                    {label}
                  </span>
                ))}
                {runLabels.length > 3 && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: muted }}>
                    +{runLabels.length - 3}
                  </span>
                )}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11, color: muted, minWidth: 0 }}>
              <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{run.system?.composition}</span>
              <span style={{ flex: 'none', whiteSpace: 'nowrap' }}>· {fmtAtoms(run.system?.n_atoms)}</span>
              {qualityBar}
            </div>
          </>
        ) : (
          <>
            <div
              style={{ padding: '0 0 0 16px', display: 'flex', alignItems: 'center' }}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={selectedRunIds.has(run.id)}
                onChange={() => toggleRunSelect(run.id)}
                aria-label={`Select run ${run.run_name}`}
                style={{ cursor: 'pointer', margin: 0 }}
              />
            </div>
            <div style={{ padding: '9px 12px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <div style={{ minWidth: 0, flex: '1 1 auto', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: hovered ? '#fff' : 'var(--fg-link)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {run.run_name}
                </div>
                {editButton}
              </div>
              <div style={{ fontSize: 11, color: muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {run.system?.composition}
              </div>
              {runLabels.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
                  {runLabels.slice(0, 3).map((label) => (
                    <span
                      key={label}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        padding: '0 5px',
                        borderRadius: 999,
                        border: `1px solid ${hovered ? 'rgba(255,255,255,0.6)' : 'var(--border-default)'}`,
                        color: hovered ? '#fff' : 'var(--fg-muted)',
                      }}
                    >
                      {label}
                    </span>
                  ))}
                  {runLabels.length > 3 && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: muted }}>
                      +{runLabels.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div style={{ padding: '0 12px' }}>{engineTag}</div>
            <div style={{ padding: '0 12px' }}>{methodPill}</div>
            <div style={{ padding: '0 12px', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{conditions}</div>
            <div style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'right' }}>{fmtLength(run.total_time)}</div>
            <div style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'right' }}>{fmtAtoms(run.system?.n_atoms)}</div>
            <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>{qualityBar}</div>
          </>
        )}
      </div>
    );
  };

  const renderSection = (section: CampaignSection) => {
    const collapseKey = `${active?.id}:${section.key}`;
    const isCollapsed = !!collapsed[collapseKey];
    const hovered = sectionHover === section.key;
    const descId = `campaign-desc-${section.key}`;
    const allSectionSelected = section.runs.length > 0 && section.runs.every((r) => selectedRunIds.has(r.id));
    const someSectionSelected = section.runs.some((r) => selectedRunIds.has(r.id)) && !allSectionSelected;

    return (
      <section key={section.key} aria-label={section.name}>
        <div
          data-campaign={section.name}
          data-count={section.runs.length}
          aria-expanded={!isCollapsed}
          aria-describedby={section.description ? descId : undefined}
          onClick={() => setCollapsed((current) => ({ ...current, [collapseKey]: !isCollapsed }))}
          onMouseEnter={() => setSectionHover(section.key)}
          onMouseLeave={() => setSectionHover(null)}
          style={{
            boxSizing: 'border-box',
            cursor: 'pointer',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: narrow ? '10px 16px' : '9px 16px',
            minHeight: narrow ? 44 : undefined,
            background: hovered ? 'var(--bg-hover)' : 'var(--bg-canvas)',
            borderBottom: '1px solid var(--border-default)',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={allSectionSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSectionSelected;
            }}
            onChange={(e) => {
              e.stopPropagation();
              toggleSectionSelect(section.runs);
            }}
            onClick={(e) => e.stopPropagation()}
            title={`Select all runs in ${section.name}`}
            aria-label={`Select all runs in ${section.name}`}
            style={{ cursor: 'pointer', margin: 0, flex: 'none' }}
          />
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--fg-muted)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flex: 'none', transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 120ms' }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {section.color && (
                <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 1, background: section.color }} />
              )}
              <span
                style={{
                  minWidth: 0,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  fontWeight: 600,
                  color: section.filter === 'none' ? 'var(--fg-muted)' : 'var(--fg-default)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {section.name}
              </span>
              <span style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>
                {section.runs.length} {section.runs.length === 1 ? 'run' : 'runs'}
              </span>
            </span>
            {section.description && (
              <span id={descId} style={{ fontSize: 12, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {section.description}
              </span>
            )}
          </span>
        </div>
        {!isCollapsed && section.runs.map(renderRunRow)}
        {!isCollapsed && section.runs.length === 0 && (
          <div style={{ padding: '10px 16px 10px 38px', fontSize: 12, color: 'var(--fg-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
            No runs in this campaign yet.
          </div>
        )}
      </section>
    );
  };

  const chipCount = (filter: CampaignFilter) =>
    filter === 'all'
      ? runView.searchedCount
      : runView.sections.find((section) => section.filter === filter)?.runs.length ?? 0;

  const chips: { filter: CampaignFilter; label: string }[] = runView.hasCampaigns
    ? [
        { filter: 'all', label: 'All' },
        ...runView.sections
          .filter((section) => section.filter !== 'none')
          .map((section) => ({ filter: section.filter as number, label: section.name })),
        ...(activeRuns.some((run) => run.group_id == null)
          ? [{ filter: 'none' as const, label: 'Ungrouped' }]
          : []),
      ]
    : [];

  const selectCampaign = (filter: CampaignFilter) => {
    setCampaign(filter);
    if (filter !== 'all' && active) {
      const key = `${active.id}:${filter === 'none' ? 'none' : `g${filter}`}`;
      setCollapsed((current) => ({ ...current, [key]: false }));
    }
  };

  const campaignLabel =
    campaign === 'all' ? null : chips.find((chip) => chip.filter === campaign)?.label ?? null;

  const tabs: { key: ProjectTab; label: string; count?: number }[] = [
    { key: 'runs', label: 'Runs', count: activeRuns.length },
    { key: 'resources', label: 'Resources', count: links.length },
    { key: 'people', label: 'Collaborators', count: active?.collaborators?.length ?? 0 },
    { key: 'about', label: 'About' },
  ];

  return (
    <main style={{ flex: narrow ? '1 0 auto' : 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '16px 24px', gap: 12 }}>
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

      <div style={{ flex: narrow ? 'none' : 1, minHeight: 0, display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : '340px minmax(0,1fr)', gap: 16 }}>
        {/* Project list */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: narrow ? 320 : undefined, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 4, boxShadow: 'var(--shadow-1)', overflow: 'hidden' }}>
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
                    <ActionButton
                      onClick={() => navigate('/', { state: { projectName: active.name } })}
                    >
                      Show in datalake
                    </ActionButton>
                    <ActionButton onClick={() => setEditing(active)}>Edit</ActionButton>
                    <ActionButton variant="primary" onClick={() => navigate('/upload')}>
                      Upload run
                    </ActionButton>
                  </div>
                </div>
              </div>

              <div
                style={{
                  flex: 'none',
                  display: 'flex',
                  gap: 4,
                  borderBottom: '1px solid var(--border-default)',
                  padding: narrow ? '0 12px' : '0 24px',
                  background: 'var(--bg-surface)',
                  overflowX: narrow ? 'auto' : undefined,
                  scrollbarWidth: 'none',
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
                        marginBottom: narrow ? 0 : -1,
                        flex: 'none',
                        whiteSpace: 'nowrap',
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

              {tab === 'runs' && activeRuns.length > 0 && (
                <div
                  style={{
                    flex: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    padding: narrow ? '10px 16px' : '10px 24px',
                    borderBottom: '1px solid var(--border-default)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: '1 1 auto', maxWidth: narrow ? undefined : 360, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, height: narrow ? 40 : 32, padding: '0 10px', border: '1px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-surface)', boxSizing: 'border-box' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--fg-muted)" strokeWidth="1.5" strokeLinecap="round" style={{ flex: 'none' }}>
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.3-4.3" />
                      </svg>
                      <input
                        value={runSearch}
                        onChange={(e) => setRunSearch(e.target.value)}
                        placeholder={narrow ? 'Search runs' : 'Filter by name, composition, campaign, tag'}
                        aria-label="Filter runs"
                        style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: narrow ? 16 : 13, color: 'var(--fg-default)', fontFamily: 'var(--font-sans)' }}
                      />
                      {runSearch && (
                        <button
                          type="button"
                          onClick={() => setRunSearch('')}
                          aria-label="Clear run filter"
                          style={{ all: 'unset', cursor: 'pointer', flex: 'none', color: 'var(--fg-muted)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      data-sort
                      onClick={() => setNewestFirst((value) => !value)}
                      title="Sort by upload date"
                      style={{ ...chipStyle(false), height: narrow ? 40 : 32, fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)', marginLeft: narrow ? 0 : 'auto' }}
                    >
                      {newestFirst ? 'Newest' : 'Oldest'}
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-default)' }}>{newestFirst ? '↓' : '↑'}</span>
                    </button>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      flexWrap: narrow ? 'nowrap' : 'wrap',
                    }}
                  >
                    <div
                      role="group"
                      aria-label="Campaign"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexWrap: narrow ? 'nowrap' : 'wrap',
                        overflowX: narrow ? 'auto' : undefined,
                        scrollbarWidth: 'none',
                        margin: narrow ? '0 -16px' : undefined,
                        padding: narrow ? '0 16px' : undefined,
                      }}
                    >
                      {chips.map((chip) => {
                        const on = campaign === chip.filter;
                        return (
                          <button
                            key={String(chip.filter)}
                            type="button"
                            data-chip={chip.label}
                            aria-pressed={on}
                            onClick={() => selectCampaign(chip.filter)}
                            style={{ ...chipStyle(on), height: narrow ? 32 : 28, fontStyle: chip.filter === 'none' ? 'italic' : undefined }}
                          >
                            {chip.label}
                            <span style={{ opacity: 0.7, fontWeight: 500 }}>{chipCount(chip.filter)}</span>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setManageCampaignsOpen(true)}
                        title="Manage campaigns"
                        style={{
                          ...chipStyle(false),
                          height: narrow ? 32 : 28,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          color: 'var(--fg-muted)',
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                        </svg>
                        <span>Manage campaigns</span>
                      </button>
                    </div>
                  </div>

                  {selectedRunIds.size > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '6px 10px',
                        background: 'var(--bg-sunken)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 4,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--fg-default)' }}>
                          {selectedRunIds.size} {selectedRunIds.size === 1 ? 'run' : 'runs'} selected
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedRunIds(new Set())}
                          style={{
                            all: 'unset',
                            cursor: 'pointer',
                            color: 'var(--fg-muted)',
                            fontSize: 12,
                            textDecoration: 'underline',
                          }}
                        >
                          Deselect all
                        </button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Move to:</span>
                        <select
                          disabled={movingRuns}
                          value=""
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!val) return;
                            const targetGroupId = val === 'none' ? null : Number(val);
                            moveRuns(Array.from(selectedRunIds), targetGroupId);
                          }}
                          style={{
                            padding: '3px 8px',
                            fontSize: 12,
                            fontFamily: 'var(--font-mono)',
                            borderRadius: 4,
                            border: '1px solid var(--border-default)',
                            background: 'var(--bg-surface)',
                            color: 'var(--fg-default)',
                            cursor: movingRuns ? 'wait' : 'pointer',
                          }}
                        >
                          <option value="" disabled>Select campaign…</option>
                          {((groupsQuery.data ?? []) as RunGroup[]).map((g) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                          <option value="none">Ungrouped</option>
                        </select>
                        {movingRuns && (
                          <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                            Moving…
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {tab === 'runs' && (
                  <>
                    {!narrow && activeRuns.length > 0 && runView.shown > 0 && (
                      <div ref={runHeaderRef} style={{ display: 'grid', gridTemplateColumns: runTableTemplate, background: 'var(--bg-sunken)', borderBottom: '1px solid var(--border-default)', position: 'sticky', top: 0, zIndex: 1 }}>
                        <div style={{ padding: '8px 0 8px 16px', display: 'flex', alignItems: 'center' }}>
                          <input
                            type="checkbox"
                            checked={allShownSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = someShownSelected;
                            }}
                            onChange={toggleSelectAllShown}
                            aria-label="Select all shown runs"
                            title="Select all shown runs"
                            style={{ cursor: 'pointer', margin: 0 }}
                          />
                        </div>
                        {['Run', 'Engine', 'Method', 'Conditions', 'Length', 'Atoms', 'Quality'].map((label, index) => (
                          <span
                            key={label}
                            style={{
                              ...EYEBROW,
                              position: 'relative',
                              padding: '8px 12px',
                              textAlign: index >= 4 ? 'right' : 'left',
                            }}
                          >
                            {label}
                            {index < 6 && (
                              <ResizeHandle
                                onPointerDown={beginColumnResize(index + 1)}
                                onDoubleClick={resetColumnWidths}
                              />
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                    {runView.shown > 0 &&
                      (runView.hasCampaigns
                        ? runView.visible.map(renderSection)
                        : runView.visible.flatMap((section) => section.runs.map(renderRunRow)))}
                    {activeRuns.length === 0 && (
                      <div style={{ padding: 32, fontSize: 13, color: 'var(--fg-muted)' }}>This project has no runs yet.</div>
                    )}
                    {activeRuns.length > 0 && runView.shown === 0 && (
                      <div style={{ padding: narrow ? '24px 16px' : 32, fontSize: 13, color: 'var(--fg-muted)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
                        <span>
                          {needle && campaignLabel
                            ? <>No runs in <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-default)' }}>{campaignLabel}</b> match “{runSearch.trim()}”.</>
                            : needle
                              ? <>No runs match “{runSearch.trim()}”.</>
                              : <>No runs in <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-default)' }}>{campaignLabel}</b>.</>}
                        </span>
                        <ActionButton
                          onClick={() => {
                            setRunSearch('');
                            setCampaign('all');
                          }}
                        >
                          Clear filters
                        </ActionButton>
                      </div>
                    )}
                  </>
                )}

                {tab === 'resources' && (
                  <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <span style={EYEBROW}>Linked resources</span>

                    {links.length === 0 && (
                      <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
                        No linked resources yet. Add the repository, dataset or manuscript below.
                      </span>
                    )}

                    {links.map((link) => (
                      <div
                        key={link.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 10px',
                          border: '1px solid var(--border-default)',
                          borderRadius: 4,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            color: 'var(--fg-muted)',
                            minWidth: 64,
                          }}
                        >
                          {link.link_type}
                        </span>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            flex: 1,
                            fontSize: 13,
                            color: 'var(--fg-link)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {link.label}
                        </a>
                        <button
                          onClick={() => removeLink(link.id)}
                          aria-label={`Remove ${link.label}`}
                          style={{ all: 'unset', cursor: 'pointer', color: 'var(--fg-muted)', fontSize: 13 }}
                        >
                          ×
                        </button>
                      </div>
                    ))}

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                      <select
                        value={linkType}
                        onChange={(event) => setLinkType(event.target.value)}
                        style={{
                          border: '1px solid var(--border-default)',
                          borderRadius: 4,
                          padding: '6px 8px',
                          fontSize: 12,
                          background: 'var(--bg-surface)',
                          color: 'var(--fg-default)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        <option value="github">github</option>
                        <option value="overleaf">overleaf</option>
                        <option value="dataset">dataset</option>
                        <option value="url">url</option>
                      </select>
                      <input
                        value={linkLabel}
                        onChange={(event) => setLinkLabel(event.target.value)}
                        placeholder="label (dvelozad/arepas)"
                        style={{ flex: '1 1 180px', border: '1px solid var(--border-default)', borderRadius: 4, padding: '6px 8px', fontSize: 13, background: 'var(--bg-surface)', color: 'var(--fg-default)' }}
                      />
                      <input
                        value={linkUrl}
                        onChange={(event) => setLinkUrl(event.target.value)}
                        placeholder="https://…"
                        style={{ flex: '2 1 260px', border: '1px solid var(--border-default)', borderRadius: 4, padding: '6px 8px', fontSize: 13, background: 'var(--bg-surface)', color: 'var(--fg-default)', fontFamily: 'var(--font-mono)' }}
                      />
                      <ActionButton onClick={addLink}>Add link</ActionButton>
                    </div>
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
                      ['Engines', stats.engines.join(' · ') || '—'],
                      ['Ensembles', stats.ensembles.join(' · ') || '—'],
                      ['Temperature range', stats.temperature],
                      ['Simulated time', stats.totalTime],
                      ['System size', stats.atoms],
                      ['Mean quality', stats.meanQuality],
                      ['Last run', stats.lastRun ? fmtDate(stats.lastRun) : '—'],
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

      {editing && (
        <EditProjectDialog
          project={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (data) => {
            await apiClient.updateProject(editing.id, data);
            await queryClient.invalidateQueries({ queryKey: ['projects'] });
            await queryClient.invalidateQueries({ queryKey: ['runs', 'projects'] });
            setEditing(null);
          }}
        />
      )}

      {editingRun && (
        <EditRunDialog
          open={Boolean(editingRun)}
          run={editingRun}
          onClose={() => setEditingRun(null)}
          onSave={async (data) => {
            await apiClient.updateRun(editingRun.id, data);
          }}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['runs'] });
            await queryClient.invalidateQueries({ queryKey: ['runs', 'projects'] });
          }}
        />
      )}

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

      {manageCampaignsOpen && active && (
        <ManageCampaignsDialog
          project={active}
          groups={(groupsQuery.data ?? []) as RunGroup[]}
          runs={activeRuns}
          onClose={() => setManageCampaignsOpen(false)}
          onRefresh={async () => {
            await queryClient.invalidateQueries({ queryKey: ['project-groups', active.id] });
            await queryClient.invalidateQueries({ queryKey: ['runs', 'projects'] });
          }}
        />
      )}
    </main>
  );
};

export default ProjectsPage;
