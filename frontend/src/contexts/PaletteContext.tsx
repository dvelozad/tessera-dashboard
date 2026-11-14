import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useThemeContext } from '@/contexts/ThemeContext';
import { applyPalette, paletteChoices, type PaletteChoice } from '@/lib/palettes';

const LIGHT_KEY = 'tessera_palette_light';
const DARK_KEY = 'tessera_palette_dark';

interface PaletteContextType {
  palette: string;
  darkPalette: string;
  choices: PaletteChoice[];
  setPalette: (key: string) => void;
  setDarkPalette: (key: string) => void;
}

const PaletteContext = createContext<PaletteContextType | undefined>(undefined);

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export const PaletteContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { mode } = useThemeContext();
  const [palette, setPaletteState] = useState(() => readStored(LIGHT_KEY, 'observatory'));
  const [darkPalette, setDarkPaletteState] = useState(() => readStored(DARK_KEY, 'observatory'));

  // Apply on mount and whenever the mode or either choice changes.
  useEffect(() => {
    applyPalette(document.documentElement, mode, palette, darkPalette);
  }, [mode, palette, darkPalette]);

  const setPalette = useCallback((key: string) => {
    setPaletteState(key);
    try {
      localStorage.setItem(LIGHT_KEY, key);
    } catch {
      /* private mode: keep the in-memory choice */
    }
  }, []);

  const setDarkPalette = useCallback((key: string) => {
    setDarkPaletteState(key);
    try {
      localStorage.setItem(DARK_KEY, key);
    } catch {
      /* private mode: keep the in-memory choice */
    }
  }, []);

  const choices = useMemo(
    () => paletteChoices(mode, palette, darkPalette),
    [mode, palette, darkPalette]
  );

  const value = useMemo(
    () => ({ palette, darkPalette, choices, setPalette, setDarkPalette }),
    [palette, darkPalette, choices, setPalette, setDarkPalette]
  );

  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
};

export function usePalette(): PaletteContextType {
  const context = useContext(PaletteContext);
  if (!context) {
    throw new Error('usePalette must be used inside PaletteContextProvider');
  }
  return context;
}
