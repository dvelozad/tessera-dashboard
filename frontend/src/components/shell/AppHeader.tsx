import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useThemeContext } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePalette } from '@/contexts/PaletteContext';
import { initials } from '@/lib/design';

const NAV = [
  { label: 'Datalake', path: '/' },
  { label: 'Projects', path: '/projects' },
  { label: 'Tools', path: '/tools' },
  { label: 'Wiki / Docs', path: '/wiki' },
  { label: 'About', path: '/about' },
];

const LogoMark: React.FC = () => (
  <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden>
    {[4, 14, 24].map((y) =>
      [4, 14, 24].map((x) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="4"
          height="4"
          rx="0.5"
          fill={x === 14 && y === 14 ? '#1fb878' : 'currentColor'}
        />
      ))
    )}
  </svg>
);

export const AppHeader: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, toggleTheme } = useThemeContext();
  const { user, logout } = useAuth();
  const { choices, setPalette, setDarkPalette } = usePalette();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <header
      style={{
        flex: 'none',
        height: 56,
        background: 'var(--chrome, #0d1117)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 24px',
        color: '#fff',
        position: 'relative',
        zIndex: 30,
      }}
    >
      <div
        onClick={() => navigate('/')}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
      >
        <LogoMark />
        <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>Tessera</span>
      </div>

      <nav style={{ display: 'flex', gap: 2, flex: 1, marginLeft: 8, height: 56 }}>
        {NAV.map((item) => {
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                all: 'unset',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '0 14px',
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                color: active ? '#fff' : 'rgba(255,255,255,0.62)',
                borderBottom: `2px solid ${active ? 'var(--primary-500)' : 'transparent'}`,
                boxSizing: 'border-box',
                height: 56,
                whiteSpace: 'nowrap',
              }}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      <button
        onClick={() => navigate('/upload')}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--primary-500)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          padding: '6px 12px',
          borderRadius: 5,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 13v8" />
          <path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2" />
          <path d="m8 17 4-4 4 4" />
        </svg>
        Upload
      </button>

      <div ref={menuRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Theme"
          style={{
            all: 'unset',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: 8,
            borderRadius: 4,
            color: 'rgba(255,255,255,0.7)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
            <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
            <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
            <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z" />
          </svg>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: 'var(--primary-400)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.3)',
            }}
          />
        </button>

        {menuOpen && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 44,
              width: 264,
              background: 'var(--bg-surface)',
              color: 'var(--fg-default)',
              border: '1px solid var(--border-default)',
              borderRadius: 6,
              boxShadow: 'var(--shadow-3)',
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              zIndex: 60,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>
              Mode
            </span>
            <div style={{ display: 'flex', border: '1px solid var(--border-default)', borderRadius: 4, overflow: 'hidden' }}>
              {(['light', 'dark'] as const).map((option) => {
                const active = mode === option;
                return (
                  <button
                    key={option}
                    onClick={() => {
                      if (!active) toggleTheme();
                    }}
                    style={{
                      all: 'unset',
                      cursor: 'pointer',
                      flex: 1,
                      textAlign: 'center',
                      fontSize: 13,
                      fontWeight: 500,
                      padding: '5px 0',
                      background: active ? 'var(--primary-600)' : 'transparent',
                      color: active ? '#fff' : 'var(--fg-muted)',
                    }}
                  >
                    {option === 'light' ? 'Light' : 'Dark'}
                  </button>
                );
              })}
            </div>

            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--fg-muted)',
              }}
            >
              Palette
            </span>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '0 -6px' }}>
              {choices.map((option) => (
                <button
                  key={option.key}
                  onClick={() =>
                    mode === 'dark' ? setDarkPalette(option.key) : setPalette(option.key)
                  }
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: 6,
                    borderRadius: 4,
                    background: option.active ? 'var(--bg-hover)' : 'transparent',
                  }}
                >
                  <span style={{ display: 'flex', borderRadius: 2, overflow: 'hidden', flex: 'none' }}>
                    {option.swatch.map((color, index) => (
                      <span key={index} style={{ width: 12, height: 20, background: color }} />
                    ))}
                  </span>
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: option.active ? 600 : 400,
                        color: 'var(--fg-default)',
                      }}
                    >
                      {option.label}
                    </span>
                    {option.note && (
                      <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{option.note}</span>
                    )}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--fg-muted)',
                    }}
                  >
                    {option.hex}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div
        onClick={() => navigate('/admin/users')}
        title={user?.email || 'Account'}
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'var(--primary-500)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12.8,
          fontWeight: 500,
          cursor: 'pointer',
          flex: 'none',
        }}
      >
        {initials(user?.full_name || user?.email)}
      </div>

      <button
        onClick={logout}
        style={{
          all: 'unset',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
          color: 'rgba(255,255,255,0.55)',
        }}
      >
        Sign out
      </button>
    </header>
  );
};
