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
import { apiClient } from '@/services/api';
import { EYEBROW } from '@/lib/design';
import type { RunUpdate, SimulationRun } from '@/types/visualization';

interface EditRunDialogProps {
  open: boolean;
  run: SimulationRun | null;
  onClose: () => void;
  onSave: (data: RunUpdate) => Promise<void>;
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
      { key: 'timestep', label: 'Timestep', kind: 'number', unit: 'fs' },
      { key: 'n_steps', label: 'Steps', kind: 'int' },
      { key: 'total_time', label: 'Total time', kind: 'number', unit: 'ns' },
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

const ALL_FIELDS = SECTIONS.flatMap((section) => section.fields);
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

export const EditRunDialog: React.FC<EditRunDialogProps> = ({ open, run, onClose, onSave }) => {
  const phone = useMediaQuery('(max-width:599px)');
  const [runName, setRunName] = useState('');
  const [description, setDescription] = useState('');
  const [values, setValues] = useState<Record<FieldKey, string>>(emptyValues);
  const [current, setCurrent] = useState<SimulationRun | null>(run);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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
      })
      .catch(() => undefined);
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
  const changeCount = Object.keys(pending).length;

  const handleSave = async () => {
    if (!runName.trim()) {
      setFieldErrors({ run_name: 'Run name is required' });
      return;
    }
    if (Object.keys(pendingInvalid).length) {
      setFieldErrors(pendingInvalid);
      return;
    }
    if (!changeCount) return;

    setSaving(true);
    setError('');
    setFieldErrors({});

    try {
      await onSave(pending);
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
