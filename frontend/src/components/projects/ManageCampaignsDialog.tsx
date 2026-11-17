import React, { useState } from 'react';
import apiClient, { type RunGroup } from '@/services/api';
import type { Project, SimulationRun } from '@/types/visualization';
import { EYEBROW } from '@/lib/design';

export const CAMPAIGN_PALETTE = [
  '#2563eb', // Blue
  '#0d9488', // Teal
  '#16a34a', // Green
  '#ca8a04', // Amber
  '#ea580c', // Orange
  '#dc2626', // Red
  '#7c3aed', // Purple
  '#ec4899', // Pink
  '#475569', // Slate
];

const actionButton = (primary = false): React.CSSProperties => ({
  all: 'unset',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  padding: '4px 10px',
  borderRadius: 4,
  border: primary ? '1px solid var(--primary-500)' : '1px solid var(--border-default)',
  background: primary ? 'var(--primary-500)' : 'transparent',
  color: primary ? '#fff' : 'var(--fg-default)',
  boxShadow: primary ? 'inset 0 1px 0 rgba(255,255,255,0.12)' : undefined,
});

const dangerButton = (): React.CSSProperties => ({
  all: 'unset',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  padding: '4px 10px',
  borderRadius: 4,
  border: '1px solid var(--critical-500)',
  background: 'var(--critical-500)',
  color: '#fff',
});

const ColorPicker: React.FC<{
  value: string | null;
  onChange: (color: string | null) => void;
}> = ({ value, onChange }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
    {CAMPAIGN_PALETTE.map((c) => {
      const selected = value?.toLowerCase() === c.toLowerCase();
      return (
        <button
          key={c}
          type="button"
          onClick={() => onChange(selected ? null : c)}
          title={selected ? 'Deselect colour' : c}
          style={{
            all: 'unset',
            cursor: 'pointer',
            width: 16,
            height: 16,
            borderRadius: 3,
            background: c,
            boxSizing: 'border-box',
            border: selected ? '2px solid var(--fg-default)' : '1px solid rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: selected ? 'scale(1.15)' : 'none',
          }}
        />
      );
    })}
    {value && (
      <button
        type="button"
        onClick={() => onChange(null)}
        title="Clear colour"
        style={{
          all: 'unset',
          cursor: 'pointer',
          fontSize: 11,
          color: 'var(--fg-muted)',
          padding: '0 4px',
          textDecoration: 'underline',
        }}
      >
        clear
      </button>
    )}
  </div>
);

interface Props {
  project: Project;
  groups: RunGroup[];
  runs: (SimulationRun & { group_id?: number | null })[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export const ManageCampaignsDialog: React.FC<Props> = ({
  project,
  groups,
  runs,
  onClose,
  onRefresh,
}) => {
  // Create form state
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createColor, setCreateColor] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Edit in-place state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editColor, setEditColor] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const getRunCount = (groupId: number) => runs.filter((r) => r.group_id === groupId).length;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = createName.trim();
    if (!name) {
      setCreateError('Campaign name is required.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await apiClient.createProjectGroup(project.id, {
        name,
        description: createDesc.trim() || undefined,
        color: createColor || undefined,
      });
      setCreateName('');
      setCreateDesc('');
      setCreateColor(null);
      await onRefresh();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409) {
        setCreateError(detail || 'A campaign with that name exists');
      } else {
        setCreateError(detail || 'Failed to create campaign.');
      }
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (group: RunGroup) => {
    setEditingId(group.id);
    setEditName(group.name);
    setEditDesc(group.description || '');
    setEditColor(group.color);
    setEditError(null);
    setDeletingId(null);
  };

  const handleSaveEdit = async (groupId: number) => {
    const name = editName.trim();
    if (!name) {
      setEditError('Campaign name is required.');
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      await apiClient.updateProjectGroup(project.id, groupId, {
        name,
        description: editDesc.trim() || undefined,
        color: editColor ?? undefined,
      });
      setEditingId(null);
      await onRefresh();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409) {
        setEditError(detail || 'A campaign with that name exists');
      } else {
        setEditError(detail || 'Failed to update campaign.');
      }
    } finally {
      setSaving(false);
    }
  };

  const startDelete = (groupId: number) => {
    setDeletingId(groupId);
    setDeleteError(null);
    setEditingId(null);
  };

  const handleConfirmDelete = async (groupId: number) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiClient.deleteProjectGroup(project.id, groupId);
      setDeletingId(null);
      await onRefresh();
    } catch (err: any) {
      setDeleteError(err?.response?.data?.detail || 'Failed to delete campaign.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(13,17,23,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 80,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 580,
          maxWidth: '100%',
          maxHeight: '88vh',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 6,
          boxShadow: 'var(--shadow-4)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-default)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flex: 'none',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600 }}>
              Manage campaigns
            </h2>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>
              {project.name}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ all: 'unset', cursor: 'pointer', fontSize: 18, color: 'var(--fg-muted)', padding: '0 4px' }}
          >
            ×
          </button>
        </div>

        {/* Content body */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {/* Create form */}
          <form
            onSubmit={handleCreate}
            style={{
              padding: '16px 20px',
              background: 'var(--bg-sunken)',
              borderBottom: '1px solid var(--border-default)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <span style={EYEBROW}>New campaign</span>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                value={createName}
                onChange={(e) => {
                  setCreateName(e.target.value);
                  if (createError) setCreateError(null);
                }}
                placeholder="Campaign name (e.g. CAL)"
                required
                style={{
                  flex: '1 1 180px',
                  border: '1px solid var(--border-default)',
                  borderRadius: 4,
                  padding: '6px 8px',
                  fontSize: 13,
                  fontFamily: 'var(--font-mono)',
                  background: 'var(--bg-surface)',
                  color: 'var(--fg-default)',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Colour:</span>
                <ColorPicker value={createColor} onChange={setCreateColor} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                placeholder="Optional description"
                style={{
                  flex: 1,
                  border: '1px solid var(--border-default)',
                  borderRadius: 4,
                  padding: '6px 8px',
                  fontSize: 13,
                  background: 'var(--bg-surface)',
                  color: 'var(--fg-default)',
                }}
              />
              <button
                type="submit"
                disabled={creating || !createName.trim()}
                style={{
                  ...actionButton(true),
                  opacity: creating || !createName.trim() ? 0.6 : 1,
                }}
              >
                {creating ? 'Creating…' : 'Create campaign'}
              </button>
            </div>
            {createError && (
              <span style={{ fontSize: 12, color: 'var(--critical-500)', marginTop: 2 }}>
                {createError}
              </span>
            )}
          </form>

          {/* Campaign list */}
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={EYEBROW}>
              Campaigns ({groups.length})
            </span>

            {groups.length === 0 && (
              <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--fg-muted)' }}>
                No campaigns defined yet for this project.
              </div>
            )}

            {groups.map((group) => {
              const count = getRunCount(group.id);
              const isEditing = editingId === group.id;
              const isDeleting = deletingId === group.id;

              if (isDeleting) {
                return (
                  <div
                    key={group.id}
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--critical-500)',
                      borderRadius: 4,
                      padding: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <span style={{ fontSize: 13, color: 'var(--fg-default)', lineHeight: 1.4 }}>
                      Delete campaign <b style={{ fontFamily: 'var(--font-mono)' }}>{group.name}</b>? Its{' '}
                      <b>{count} {count === 1 ? 'run' : 'runs'}</b> will not be deleted; they will become{' '}
                      <i style={{ color: 'var(--fg-muted)' }}>Ungrouped</i>.
                    </span>
                    {deleteError && (
                      <span style={{ fontSize: 12, color: 'var(--critical-500)' }}>
                        {deleteError}
                      </span>
                    )}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => setDeletingId(null)}
                        disabled={deleting}
                        style={actionButton()}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmDelete(group.id)}
                        disabled={deleting}
                        style={dangerButton()}
                      >
                        {deleting ? 'Deleting…' : 'Delete campaign'}
                      </button>
                    </div>
                  </div>
                );
              }

              if (isEditing) {
                return (
                  <div
                    key={group.id}
                    style={{
                      background: 'var(--bg-sunken)',
                      border: '1px solid var(--primary-500)',
                      borderRadius: 4,
                      padding: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input
                        value={editName}
                        onChange={(e) => {
                          setEditName(e.target.value);
                          if (editError) setEditError(null);
                        }}
                        required
                        placeholder="Campaign name"
                        style={{
                          flex: '1 1 140px',
                          border: '1px solid var(--border-default)',
                          borderRadius: 4,
                          padding: '4px 8px',
                          fontSize: 13,
                          fontFamily: 'var(--font-mono)',
                          background: 'var(--bg-surface)',
                          color: 'var(--fg-default)',
                        }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Colour:</span>
                        <ColorPicker value={editColor} onChange={setEditColor} />
                      </div>
                    </div>
                    <input
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Optional description"
                      style={{
                        border: '1px solid var(--border-default)',
                        borderRadius: 4,
                        padding: '4px 8px',
                        fontSize: 12,
                        background: 'var(--bg-surface)',
                        color: 'var(--fg-default)',
                      }}
                    />
                    {editError && (
                      <span style={{ fontSize: 12, color: 'var(--critical-500)' }}>
                        {editError}
                      </span>
                    )}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        disabled={saving}
                        style={actionButton()}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(group.id)}
                        disabled={saving || !editName.trim()}
                        style={actionButton(true)}
                      >
                        {saving ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={group.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    border: '1px solid var(--border-default)',
                    borderRadius: 4,
                    background: 'var(--bg-surface)',
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: group.color || 'var(--border-strong)',
                      flex: 'none',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--fg-default)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {group.name}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                        {count} {count === 1 ? 'run' : 'runs'}
                      </span>
                    </div>
                    {group.description && (
                      <span
                        style={{
                          fontSize: 12,
                          color: 'var(--fg-muted)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {group.description}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                    <button
                      type="button"
                      onClick={() => startEdit(group)}
                      style={actionButton()}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => startDelete(group.id)}
                      style={{
                        ...actionButton(),
                        color: 'var(--critical-500)',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border-default)',
            background: 'var(--bg-sunken)',
            display: 'flex',
            justifyContent: 'flex-end',
            flex: 'none',
          }}
        >
          <button type="button" onClick={onClose} style={actionButton()}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
