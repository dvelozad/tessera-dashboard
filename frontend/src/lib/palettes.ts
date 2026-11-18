/**
 * Colour palettes from the Tessera design handoff.
 *
 * Six light palettes (Observatory is the default token set; the rest are
 * Wes Anderson film palettes) and six dark ones (Observatory, the four film
 * palettes and Phosphor). A palette overrides the primary ramp plus the
 * surface/text tokens on <html>, so every screen follows it at once.
 */

export interface LightPalette {
  label: string;
  note?: string;
  base: string;
  chrome: string;
  canvas?: string;
  surface?: string;
  sunken?: string;
  border?: string;
  borderSubtle?: string;
  borderStrong?: string;
  fg?: string;
  muted?: string;
  subtle?: string;
}

export interface DarkPalette {
  label: string;
  note?: string;
  base: string;
  link: string;
  chrome: string;
  canvas: string;
  surface: string;
  sunken: string;
  border: string;
  borderSubtle: string;
  borderStrong: string;
  fg: string;
  muted: string;
  subtle: string;
}

export const LIGHT: Record<string, LightPalette> = {
  observatory: { label: 'Observatory', base: '#2f4ea8', chrome: '#0d1117' },
  budapest: {
    label: 'Budapest',
    note: 'Wes Anderson',
    base: '#a83e62',
    chrome: '#4a1f3a',
    canvas: '#f8ebee',
    surface: '#fffafa',
    sunken: '#f2dfe5',
    border: '#e5c9d2',
    borderSubtle: '#f0dde3',
    borderStrong: '#b8929f',
    fg: '#3a1c2c',
    muted: '#78526a',
    subtle: '#a48595',
  },
  darjeeling: {
    label: 'Darjeeling',
    note: 'Wes Anderson',
    base: '#0f6f6f',
    chrome: '#12393a',
    canvas: '#f5efe0',
    surface: '#fffcf3',
    sunken: '#ece3cc',
    border: '#dccfae',
    borderSubtle: '#ebe3cd',
    borderStrong: '#a8996f',
    fg: '#1f2a28',
    muted: '#5a6357',
    subtle: '#8b8f7d',
  },
  moonrise: {
    label: 'Moonrise',
    note: 'Wes Anderson',
    base: '#5d6c24',
    chrome: '#3b3a22',
    canvas: '#f1ecd6',
    surface: '#fbf8ea',
    sunken: '#e6dec1',
    border: '#d4c99e',
    borderSubtle: '#e6dec2',
    borderStrong: '#9e9268',
    fg: '#2b2716',
    muted: '#635d3d',
    subtle: '#938b67',
  },
  aquatic: {
    label: 'Aquatic',
    note: 'Wes Anderson',
    base: '#c23b2a',
    chrome: '#13324a',
    canvas: '#e9f2f6',
    surface: '#fbfdfe',
    sunken: '#d9e8ef',
    border: '#bed4df',
    borderSubtle: '#d9e8ef',
    borderStrong: '#7f9caf',
    fg: '#10222f',
    muted: '#4a6275',
    subtle: '#7e93a3',
  },
  fox: {
    label: 'Fox',
    note: 'Wes Anderson',
    base: '#b0581a',
    chrome: '#3a2414',
    canvas: '#f6ead6',
    surface: '#fffaf1',
    sunken: '#eddcc0',
    border: '#dfc6a0',
    borderSubtle: '#eddcc2',
    borderStrong: '#b0916a',
    fg: '#2e1f14',
    muted: '#6e5640',
    subtle: '#9c8269',
  },
};

export const DARK: Record<string, DarkPalette> = {
  observatory: {
    label: 'Observatory',
    base: '#4f6cbe',
    link: '#8aa1e3',
    chrome: '#06080b',
    canvas: '#0d1117',
    surface: '#15191f',
    sunken: '#0a0d12',
    border: '#2a313c',
    borderSubtle: '#1f242c',
    borderStrong: '#4a5360',
    fg: '#e6eaf0',
    muted: '#9aa3b1',
    subtle: '#6c7280',
  },
  budapest: {
    label: 'Budapest',
    note: 'Wes Anderson',
    base: '#b8476a',
    link: '#f0a3b8',
    chrome: '#140a15',
    canvas: '#1f1220',
    surface: '#2a1a2c',
    sunken: '#170c18',
    border: '#43293f',
    borderSubtle: '#331f33',
    borderStrong: '#6e4a68',
    fg: '#f6e6ea',
    muted: '#c9a6b4',
    subtle: '#8e6f80',
  },
  darjeeling: {
    label: 'Darjeeling',
    note: 'Wes Anderson',
    base: '#a2700f',
    link: '#ecc25a',
    chrome: '#071213',
    canvas: '#0e1d1f',
    surface: '#15292b',
    sunken: '#0a1617',
    border: '#26413f',
    borderSubtle: '#1c3234',
    borderStrong: '#4a6a66',
    fg: '#efe6d2',
    muted: '#b4b39a',
    subtle: '#7b8a7c',
  },
  moonrise: {
    label: 'Moonrise',
    note: 'Wes Anderson',
    base: '#b8572b',
    link: '#eba06e',
    chrome: '#100f09',
    canvas: '#1a1911',
    surface: '#25231a',
    sunken: '#13120c',
    border: '#3d3a28',
    borderSubtle: '#2e2c1f',
    borderStrong: '#6a6447',
    fg: '#f1e9d0',
    muted: '#bfb48e',
    subtle: '#857d5f',
  },
  aquatic: {
    label: 'Aquatic',
    note: 'Wes Anderson',
    base: '#c7412e',
    link: '#8ccfe6',
    chrome: '#060f17',
    canvas: '#0c1a26',
    surface: '#132536',
    sunken: '#08131d',
    border: '#24405a',
    borderSubtle: '#1a3247',
    borderStrong: '#46698a',
    fg: '#e8f0f5',
    muted: '#9fb6c6',
    subtle: '#6a8296',
  },
  phosphor: {
    label: 'Phosphor',
    base: '#16936a',
    link: '#5fd6a6',
    chrome: '#050a08',
    canvas: '#0b1210',
    surface: '#111c18',
    sunken: '#070d0b',
    border: '#1f3a30',
    borderSubtle: '#182c25',
    borderStrong: '#3c6455',
    fg: '#dff3ea',
    muted: '#93b3a6',
    subtle: '#618073',
  },
};

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

const SURF = [
  '--bg-canvas',
  '--bg-surface',
  '--bg-sunken',
  '--border-default',
  '--border-subtle',
  '--border-strong',
  '--divider',
  '--fg-default',
  '--fg-muted',
  '--fg-subtle',
];

/** Build a ten-step ramp around a base colour, as the prototype does. */
export function darkScale(base: string): string[] {
  return STEPS.map((_, index) => {
    if (index === 5) return base;
    if (index < 5) {
      return `color-mix(in oklch, ${base} ${100 - (5 - index) * 17}%, white)`;
    }
    return `color-mix(in oklch, ${base} ${100 - (index - 5) * 18}%, black)`;
  });
}

export function defaultPaletteFor(): string {
  return 'observatory';
}

/**
 * Apply a palette to an element (normally <html>) by setting the same custom
 * properties the design system reads.
 */
export function applyPalette(
  element: HTMLElement,
  mode: 'light' | 'dark',
  lightKey: string,
  darkKey: string
): void {
  const set = (name: string, value: string) => element.style.setProperty(name, value);
  element.style.colorScheme = mode === 'dark' ? 'dark' : 'light';

  if (mode === 'dark') {
    const palette = DARK[darkKey] || DARK.observatory;
    const ramp = darkScale(palette.base);
    STEPS.forEach((step, index) => set(`--primary-${step}`, ramp[index]));

    [
      palette.canvas,
      palette.surface,
      palette.sunken,
      palette.border,
      palette.borderSubtle,
      palette.borderStrong,
      palette.border,
      palette.fg,
      palette.muted,
      palette.subtle,
    ].forEach((value, index) => set(SURF[index], value));

    set('--chrome', palette.chrome);
    set('--border-focus', palette.base);
    set('--fg-link', palette.link);
    set('--fg-link-hover', `color-mix(in oklch, ${palette.link} 70%, white)`);
    set('--bg-hover', `color-mix(in oklch, ${palette.base} 14%, ${palette.surface})`);
    set('--bg-selected', `color-mix(in oklch, ${palette.base} 30%, ${palette.surface})`);
    set('--ink-100', palette.border);
    set('--ink-600', palette.muted);
    set('--primary-800', palette.link);
    return;
  }

  const palette = LIGHT[lightKey] || LIGHT.observatory;
  const ramp = darkScale(palette.base);
  STEPS.forEach((step, index) => set(`--primary-${step}`, ramp[index]));

  if (palette.canvas) {
    [
      palette.canvas,
      palette.surface,
      palette.sunken,
      palette.border,
      palette.borderSubtle,
      palette.borderStrong,
      palette.border,
      palette.fg,
      palette.muted,
      palette.subtle,
    ].forEach((value, index) => set(SURF[index], value as string));
    set('--ink-100', palette.sunken as string);
    set('--ink-600', palette.muted as string);
  } else {
    // Observatory is the stylesheet's own token set: drop the overrides.
    [...SURF, '--ink-100', '--ink-600'].forEach((name) => element.style.removeProperty(name));
  }

  const surface = palette.surface || '#ffffff';
  set('--chrome', palette.chrome);
  set('--border-focus', palette.base);
  set('--fg-link', ramp[6]);
  set('--fg-link-hover', ramp[7]);
  set('--primary-800', ramp[8]);
  set('--bg-hover', `color-mix(in oklch, ${palette.base} 8%, ${surface})`);
  set('--bg-selected', `color-mix(in oklch, ${palette.base} 20%, ${surface})`);
}

export interface PaletteChoice {
  key: string;
  label: string;
  note?: string;
  hex: string;
  swatch: string[];
  active: boolean;
}

/** The list the header menu renders for the current mode. */
export function paletteChoices(
  mode: 'light' | 'dark',
  lightKey: string,
  darkKey: string
): PaletteChoice[] {

  if (mode === 'dark') {
    return Object.entries(DARK).map(([key, palette]) => ({
      key,
      label: palette.label,
      note: palette.note,
      hex: palette.base,
      swatch: [palette.canvas, palette.surface, palette.base, palette.link, palette.fg],
      active: key === darkKey,
    }));
  }

  return Object.entries(LIGHT).map(([key, palette]) => ({
    key,
    label: palette.label,
    note: palette.note,
    hex: palette.base,
    swatch: [
      palette.canvas || '#f6f8fa',
      palette.surface || '#ffffff',
      palette.base,
      palette.chrome,
      palette.fg || '#181d23',
    ],
    active: key === lightKey,
  }));
}
