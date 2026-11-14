import React, { ReactNode, useEffect } from 'react';
import { Box } from '@mui/material';
import { AppHeader } from '@/components/shell/AppHeader';
import { useThemeContext } from '@/contexts/ThemeContext';

interface AppLayoutProps {
  children: ReactNode;
}

const FOOTER_HEIGHT = 28;

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const { mode } = useThemeContext();

  // The Voxel tokens key off [data-theme] on <html>.
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <AppHeader />
      <Box
        component="main"
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          pb: `${FOOTER_HEIGHT}px`,
          background: 'var(--bg-canvas)',
          color: 'var(--fg-default)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {children}
      </Box>
      <Box
        component="footer"
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: FOOTER_HEIGHT,
          zIndex: (theme) => theme.zIndex.drawer + 2,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: '18px',
          borderTop: '1px solid var(--divider)',
          background: 'var(--bg-canvas)',
          fontFamily: 'var(--font-mono)',
          fontSize: '9.5px',
          fontWeight: 500,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          color: 'var(--fg-muted)',
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#1fb878',
            boxShadow: '0 0 0 3px rgba(31,184,120,0.12)',
            flex: 'none',
          }}
        />
        <span style={{ color: 'var(--fg-default)', fontWeight: 600 }}>AREPAS</span>
      </Box>
    </Box>
  );
};
