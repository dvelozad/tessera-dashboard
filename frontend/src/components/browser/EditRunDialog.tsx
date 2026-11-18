import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  Alert,
  Box,
  MenuItem,
  InputAdornment,
  useMediaQuery,
} from '@mui/material';
import { apiClient, type RunGroup } from '@/services/api';
import { EYEBROW } from '@/lib/design';
import type { Project, RunUpdate, SimulationRun } from '@/types/visualization';

interface EditRunDialogProps {
  open: boolean;
  run: SimulationRun | null;
  onClose: () => void;
  onSave: (data: RunUpdate) => Promise<void>;
  /** Called once everything (metadata, campaign, labels) has been written. */
  onSaved?: () => void | Promise<void>;
}

type FieldKey = Exclude<keyof RunUpdate, 'run_name' | 'description'>;

interface FieldDef {
  key: FieldKey;
  label: string;
  kind: 'enum' | 'number' | 'int' | 'text';
  options?: string[];
  unit?: string;
}

const SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Method',
    fields: [
      // The timestep means nothing without this, so it leads the section.
      { key: 'units', label: 'Unit system', kind: 'enum', options: ['real', 'metal', 'si', 'cgs', 'electron', 'micro', 'nano', 'lj', 'gromacs'] },
      { key: 'timestep', label: 'Timestep', kind: 'number', unit: 'in the unit system' },
      { key: 'simulation_method', label: 'Simulation method', kind: 'enum', options: ['ATOMISTIC', 'H_ADRESS', 'COARSE_GRAINED', 'UNITED_ATOM', 'MONTE_CARLO'] },
      { key: 'ensemble', label: 'Ensemble', kind: 'enum', options: ['NVE', 'NVT', 'NPT', 'NPH', 'MUVT', 'NVT_NVE'] },
      { key: 'atom_style', label: 'Atom style', kind: 'enum', options: ['atomic', 'bond', 'angle', 'molecular', 'full', 'charge', 'dipole', 'sphere', 'ellipsoid', 'full/gc/HAdResS'] },
      { key: 'integrator', label: 'Integrator', kind: 'enum', options: ['VERLET', 'VELOCITY_VERLET', 'LEAP_FROG', 'RESPA', 'RATTLE', 'SHAKE', 'MD', 'MD_VV', 'SD'] },
      { key: 'thermostat', label: 'Thermostat', kind: 'enum', options: ['NONE', 'NOSE_HOOVER', 'BERENDSEN', 'LANGEVIN', 'V_RESCALE', 'ANDERSEN', 'BUSSI', 'CSVR'] },
      { key: 'barostat', label: 'Barostat', kind: 'enum', options: ['NONE', 'NOSE_HOOVER', 'BERENDSEN', 'PARRINELLO_RAHMAN', 'MTTK', 'LANGEVIN'] },
      { key: 'coulomb_method', label: 'Coulomb method', kind: 'enum', options: ['CUTOFF', 'EWALD', 'PPPM', 'PME', 'P3M', 'REACTION_FIELD', 'NONE'] },
    ],
  },
  {
    title: 'Conditions',
    fields: [
      { key: 'temperature_target', label: 'Temperature', kind: 'number', unit: 'K' },
      { key: 'pressure_target', label: 'Pressure', kind: 'number', unit: 'bar' },
      { key: 'n_steps', label: 'Steps', kind: 'int' },
      { key: 'total_time', label: 'Simulated time', kind: 'number', unit: 'ns' },
    ],
  },
  {
    title: 'Cutoffs',
    fields: [
      { key: 'cutoff_coulomb', label: 'Coulomb cutoff', kind: 'number', unit: 'Å' },
      { key: 'cutoff_vdw', label: 'VdW cutoff', kind: 'number', unit: 'Å' },
    ],
  },
  {
    title: 'Provenance',
    fields: [
      { key: 'slurm_job_id', label: 'SLURM job ID', kind: 'text' },
      { key: 'compute_node', label: 'Compute node', kind: 'text' },
    ],
  },
];

const LJ_FIELDS: FieldDef[] = [
  { key: 'lj_length_nm', label: 'σ (length scale)', kind: 'number', unit: 'nm' },
  { key: 'lj_time_ps', label: 'τ (time scale)', kind: 'number', unit: 'ps' },
];

const ALL_FIELDS = [...SECTIONS.flatMap((section) => section.fields), ...LJ_FIELDS];
const FIELD_LABEL: Record<string, string> = {
  run_name: 'Run name',
  description: 'Description',
  ...Object.fromEntries(ALL_FIELDS.map((field) => [field.key, field.label])),
};

const emptyValues = () =>
  Object.fromEntries(ALL_FIELDS.map((field) => [field.key, ''])) as Record<FieldKey, string>;

/** Enum values come back lower-case from the API; match them to the option spelling. */
const matchOption = (field: FieldDef, value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value);
  return field.options?.find((option) => option.toLowerCase() === raw.toLowerCase()) ?? raw;
};

const currentText = (field: FieldDef, value: unknown): string => {
  if (value === null || value === undefined || value === '') return 'not set';
  if (field.kind === 'enum') return matchOption(field, value) ?? 'not set';
  return field.unit ? `${value} ${field.unit}` : String(value);
};

/** Turns a FastAPI error body into per-field messages plus anything left over. */
const parseApiError = (err: any): { form: string; fields: Record<string, string> } => {
  const detail = err?.response?.data?.detail;
  const fields: Record<string, string> = {};
  const rest: string[] = [];
  if (typeof detail === 'string') {
    // e.g. "thermostat must be one of: none, nose_hoover, ..."
    const field = detail.match(/^(\w+)\s/)?.[1];
    if (field && field in FIELD_LABEL) fields[field] = detail;
    else rest.push(detail);
  } else if (Array.isArray(detail)) {
    for (const item of detail) {
      const field = Array.isArray(item?.loc) ? String(item.loc[item.loc.length - 1]) : '';
      const msg = String(item?.msg ?? 'Invalid value');
      if (field in FIELD_LABEL) fields[field] = msg;
      else rest.push(field ? `${field}: ${msg}` : msg);
    }
  } else if (detail && typeof detail === 'object') {
    rest.push(JSON.stringify(detail));
  }
  if (!rest.length && !Object.keys(fields).length) {
    rest.push(err?.message || 'Failed to update run');
  }
  const named = Object.keys(fields).map((key) => FIELD_LABEL[key]);
  const form = [
    named.length ? `The server rejected ${named.join(', ')}.` : '',
    ...rest,
  ]
    .filter(Boolean)
    .join(' ');
  return { form, fields };
};

export const EditRunDialog: React.FC<EditRunDialogProps> = ({ open, run, onClose, onSave, onSaved }) => {
  const phone = useMediaQuery('(max-width:599px)');
  const [runName, setRunName] = useState('');
  const [description, setDescription] = useState('');
  const [values, setValues] = useState<Record<FieldKey, string>>(emptyValues);
  const [current, setCurrent] = useState<SimulationRun | null>(run);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Organisation: the project and campaign this run belongs to, and its labels.
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [initialProjectId, setInitialProjectId] = useState<number | null>(null);
  const [groups, setGroups] = useState<RunGroup[]>([]);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [initialGroupId, setInitialGroupId] = useState<number | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [initialLabels, setInitialLabels] = useState<string[]>([]);
  const [labelDraft, setLabelDraft] = useState('');

  useEffect(() => {
    if (run) {
      setRunName(run.run_name || '');
      setDescription(run.description || '');
      setCurrent(run);
    }
  }, [run]);

  // Each opening starts blank and reads the stored values fresh, so "current" is never stale.
  useEffect(() => {
    if (!open || !run) return;
    setValues(emptyValues());
    setFieldErrors({});
    setError('');
    let cancelled = false;
    apiClient
      .getRun(run.id)
      .then((fresh) => {
        if (cancelled) return;
        setCurrent(fresh);
        setRunName(fresh.run_name || '');
        setDescription(fresh.description || '');
        setGroupId(fresh.group_id ?? null);
        setInitialGroupId(fresh.group_id ?? null);
        setProjectId(fresh.project_id ?? null);
        setInitialProjectId(fresh.project_id ?? null);
        setLabels(fresh.tags ?? []);
        setInitialLabels(fresh.tags ?? []);
        // The campaigns offered are the ones of the run's own project.
        if (fresh.project_id) {
          apiClient
            .listProjectGroups(fresh.project_id)
            .then((loaded) => {
              if (!cancelled) setGroups(loaded);
            })
            .catch(() => {
              if (!cancelled) setGroups([]);
            });
        } else {
          setGroups([]);
        }
      })
      .catch(() => undefined);
    apiClient
      .listProjects()
      .then((loaded) => {
        if (!cancelled) setProjects(loaded);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    setLabelDraft('');
    return () => {
      cancelled = true;
    };
  }, [open, run?.id]);

  const stored = (key: string): unknown => (current as Record<string, unknown> | null)?.[key];

  // Only fields that differ from what is stored are sent.
  const buildPatch = (): { patch: RunUpdate; invalid: Record<string, string> } => {
    const patch: Record<string, string | number> = {};
    const invalid: Record<string, string> = {};
    if (runName.trim() !== (current?.run_name || '')) patch.run_name = runName.trim();
    if (description !== (current?.description || '')) patch.description = description;
    for (const field of ALL_FIELDS) {
      const raw = values[field.key].trim();
      if (!raw) continue;
      const was = stored(field.key);
      if (field.kind === 'enum') {
        if (matchOption(field, was) !== raw) patch[field.key] = raw;
      } else if (field.kind === 'text') {
        if (raw !== String(was ?? '')) patch[field.key] = raw;
      } else {
        const num = Number(raw);
        if (!Number.isFinite(num)) invalid[field.key] = 'Enter a number';
        else if (field.kind === 'int' && !Number.isInteger(num)) invalid[field.key] = 'Enter a whole number';
        else if (num !== was) patch[field.key] = num;
      }
    }
    return { patch: patch as RunUpdate, invalid };
  };

  const { patch: pending, invalid: pendingInvalid } = buildPatch();
  const metadataChanges = Object.keys(pending).length;

  const unitsField = SECTIONS[0].fields.find((field) => field.key === 'units')!;
  const storedUnits = matchOption(unitsField, stored('units')) ?? '';
  // What the run will be recorded as if this dialog is saved.
  const effectiveUnits = values.units.trim() || storedUnits;

  // Campaign and labels travel on their own endpoints, so they are applied
  // after the metadata patch and counted separately for "Save".
  const projectChanged = projectId !== initialProjectId;
  const groupChanged = groupId !== initialGroupId;
  const labelsToAdd = labels.filter((label) => !initialLabels.includes(label));
  const labelsToRemove = initialLabels.filter((label) => !labels.includes(label));
  const organisationChanges =
    (projectChanged ? 1 : 0) +
    (groupChanged ? 1 : 0) +
    labelsToAdd.length +
    labelsToRemove.length;
  const changeCount = metadataChanges + organisationChanges;

  /** Changing the project offers that project's campaigns and drops the old one. */
  const handleProjectChange = (nextId: number | null) => {
    setProjectId(nextId);
    setGroupId(null);
    setGroups([]);
    if (nextId === null) return;
    apiClient
      .listProjectGroups(nextId)
      .then(setGroups)
      .catch(() => setGroups([]));
  };

  const handleSave = async () => {
    if (!runName.trim()) {
      setFieldErrors({ run_name: 'Run name is required' });
      return;
    }
    if (Object.keys(pendingInvalid).length) {
      setFieldErrors(pendingInvalid);
      return;
    }
    // A run without a unit system cannot state what its timestep means.
    if (!effectiveUnits) {
      setFieldErrors({ units: 'Unit system is required' });
      return;
    }
    if (!changeCount || !run) return;

    setSaving(true);
    setError('');
    setFieldErrors({});

    try {
      if (metadataChanges) await onSave(pending);
      if (projectChanged) {
        // One call carries both, because a campaign is only valid inside the
        // project it belongs to.
        await apiClient.setRunPlacement(run.id, {
          project_id: projectId ?? undefined,
          group_id: groupId,
        });
      } else if (groupChanged) {
        await apiClient.setRunGroup(run.id, groupId);
      }
      for (const label of labelsToAdd) await apiClient.addRunTag(run.id, label);
      for (const label of labelsToRemove) await apiClient.removeRunTag(run.id, label);
      await onSaved?.();
      onClose();
    } catch (err: any) {
      const parsed = parseApiError(err);
      setError(parsed.form);
      setFieldErrors(parsed.fields);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      setError('');
      setFieldErrors({});
      onClose();
    }
  };

  const setValue = (key: FieldKey, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const renderField = (field: FieldDef) => {
    const was = currentText(field, stored(field.key));
    const value = values[field.key];
    const changed = field.key in pending;
    const helperText = fieldErrors[field.key] || pendingInvalid[field.key] || (changed ? `Was: ${was}` : ' ');
    const common = {
      label: field.label,
      fullWidth: true,
      size: 'small' as const,
      value,
      disabled: saving,
      error: !!(fieldErrors[field.key] || pendingInvalid[field.key]),
      helperText,
      InputLabelProps: { shrink: true },
    };

    if (field.kind === 'enum') {
      return (
        <TextField
          key={field.key}
          {...common}
          select
          onChange={(e) => setValue(field.key, e.target.value)}
          SelectProps={{
            displayEmpty: true,
            renderValue: (selected) =>
              selected ? (
                String(selected)
              ) : (
                // Same treatment as the numeric placeholders, so stored values read alike.
                <span style={{ opacity: 0.42 }}>{was}</span>
              ),
          }}
        >
          <MenuItem value="">
            <span style={{ color: 'var(--fg-muted)' }}>Keep current ({was})</span>
          </MenuItem>
          {field.options!.map((option) => (
            <MenuItem key={option} value={option} sx={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              {option}
            </MenuItem>
          ))}
        </TextField>
      );
    }

    const storedValue = stored(field.key);
    return (
      <TextField
        key={field.key}
        {...common}
        type={field.kind === 'text' ? 'text' : 'number'}
        placeholder={storedValue === null || storedValue === undefined || storedValue === '' ? 'not set' : String(storedValue)}
        onChange={(e) => setValue(field.key, e.target.value)}
        inputProps={{
          step: field.kind === 'int' ? 1 : 'any',
          inputMode: field.kind === 'int' ? 'numeric' : field.kind === 'number' ? 'decimal' : undefined,
          style: { fontFamily: 'var(--font-mono)' },
        }}
        InputProps={
          field.unit
            ? { endAdornment: <InputAdornment position="end">{field.unit}</InputAdornment> }
            : undefined
        }
      />
    );
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth fullScreen={phone}>
      <DialogTitle>Edit Simulation Run</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {error && (
            <Alert severity="error" onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          <Stack spacing={1.5}>
            <Box component="span" sx={EYEBROW}>Identity</Box>
            <TextField
              label="Run Name"
              required
              fullWidth
              size="small"
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              disabled={saving}
              error={!!fieldErrors.run_name}
              helperText={fieldErrors.run_name || 'Name of this simulation run'}
            />
            <TextField
              label="Description"
              multiline
              rows={3}
              fullWidth
              size="small"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
              error={!!fieldErrors.description}
              helperText={fieldErrors.description || 'Optional description of the simulation'}
            />
          </Stack>

          <Box component="p" sx={{ m: 0, fontSize: 13, color: 'var(--fg-muted)' }}>
            Grey values are what is stored now. Leave a field empty to keep it.
            A simulated time you enter is kept as stated; otherwise it is derived
            from the unit system, the timestep and the step count.
          </Box>

          {SECTIONS.map((section) => (
            <Stack key={section.title} spacing={1.5}>
              <Box component="span" sx={EYEBROW}>{section.title}</Box>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: phone ? '1fr' : 'repeat(2, minmax(0, 1fr))',
                  columnGap: 2,
                  rowGap: 0.5,
                }}
              >
                {section.fields.map(renderField)}
              </Box>
            </Stack>
          ))}

          {effectiveUnits === 'lj' && (
            <Stack spacing={1.5}>
              <Box component="span" sx={EYEBROW}>Reduced units</Box>
              <Box component="p" sx={{ m: 0, fontSize: 12, color: 'var(--fg-muted)' }}>
                Reduced units carry no intrinsic length or time. σ and τ are the
                mapping you chose; without them the simulated time and the
                obleas analyses of this run have no physical meaning.
              </Box>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: phone ? '1fr' : 'repeat(2, minmax(0, 1fr))',
                  columnGap: 2,
                  rowGap: 0.5,
                }}
              >
                {LJ_FIELDS.map(renderField)}
              </Box>
            </Stack>
          )}

          <Stack spacing={1.5}>
            <Box component="span" sx={EYEBROW}>Organisation</Box>
            <TextField
              select
              label="Project"
              fullWidth
              size="small"
              value={projectId === null ? '' : String(projectId)}
              disabled={saving}
              onChange={(e) => handleProjectChange(e.target.value === '' ? null : Number(e.target.value))}
              helperText="Moving a run to another project clears its campaign unless you pick one there."
              InputLabelProps={{ shrink: true }}
            >
              {projectId === null && (
                <MenuItem value="">
                  <span style={{ color: 'var(--fg-muted)' }}>No project</span>
                </MenuItem>
              )}
              {projects.map((project) => (
                <MenuItem key={project.id} value={String(project.id)} sx={{ fontSize: 13 }}>
                  {project.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Campaign"
              fullWidth
              size="small"
              value={groupId === null ? '' : String(groupId)}
              disabled={saving}
              onChange={(e) => setGroupId(e.target.value === '' ? null : Number(e.target.value))}
              helperText={
                groups.length
                  ? 'A campaign is a named sub-division of the project.'
                  : 'This run has no project, so there are no campaigns to choose from.'
              }
              InputLabelProps={{ shrink: true }}
            >
              <MenuItem value="">
                <span style={{ color: 'var(--fg-muted)' }}>Ungrouped</span>
              </MenuItem>
              {groups.map((group) => (
                <MenuItem key={group.id} value={String(group.id)} sx={{ fontSize: 13 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      marginRight: 8,
                      background: group.color || 'var(--border-strong)',
                    }}
                  />
                  {group.name}
                </MenuItem>
              ))}
            </TextField>

            <Box>
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 0.75,
                  alignItems: 'center',
                  minHeight: 32,
                }}
              >
                {labels.length === 0 && (
                  <Box component="span" sx={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                    No labels yet.
                  </Box>
                )}
                {labels.map((label) => (
                  <Box
                    key={label}
                    component="span"
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.75,
                      border: '1px solid var(--border-default)',
                      borderRadius: '999px',
                      padding: '2px 8px 2px 10px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      background: 'var(--bg-sunken)',
                    }}
                  >
                    {label}
                    <Box
                      component="button"
                      type="button"
                      aria-label={`Remove label ${label}`}
                      disabled={saving}
                      onClick={() => setLabels((prev) => prev.filter((item) => item !== label))}
                      sx={{
                        all: 'unset',
                        cursor: 'pointer',
                        lineHeight: 1,
                        opacity: 0.6,
                        '&:hover': { opacity: 1 },
                      }}
                    >
                      ×
                    </Box>
                  </Box>
                ))}
              </Box>
              <Box
                component="form"
                onSubmit={(event: React.FormEvent) => {
                  event.preventDefault();
                  const label = labelDraft.trim();
                  if (!label) return;
                  setLabels((prev) =>
                    prev.some((item) => item.toLowerCase() === label.toLowerCase())
                      ? prev
                      : [...prev, label]
                  );
                  setLabelDraft('');
                }}
                sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1 }}
              >
                <TextField
                  size="small"
                  value={labelDraft}
                  disabled={saving}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  placeholder="Add a label (e.g. validated, needs-review)"
                  inputProps={{ style: { fontFamily: 'var(--font-mono)', fontSize: 12 } }}
                  sx={{ flex: 1 }}
                />
                <Button type="submit" size="small" disabled={saving || !labelDraft.trim()}>
                  Add label
                </Button>
              </Box>
            </Box>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Box component="span" sx={{ mr: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>
          {changeCount === 0 ? 'No changes' : `${changeCount} ${changeCount === 1 ? 'change' : 'changes'}`}
        </Box>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving || changeCount === 0}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
