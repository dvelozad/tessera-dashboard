import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const ITEMS = [
  {
    label: 'Datalake',
    path: '/',
    match: (p: string) => p === '/' || p.startsWith('/runs'),
    icon: (
      <>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14a9 3 0 0 0 18 0V5" />
        <path d="M3 12a9 3 0 0 0 18 0" />
      </>
    ),
  },
  {
    label: 'Projects',
    path: '/projects',
    match: (p: string) => p.startsWith('/projects'),
    icon: <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />,
  },
  {
    label: 'Upload',
    path: '/upload',
    match: (p: string) => p.startsWith('/upload'),
    icon: (
      <>
        <path d="M12 13v8" />
        <path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2" />
        <path d="m8 17 4-4 4 4" />
      </>
    ),
  },
  {
    label: 'Account',
    path: '/admin/users',
    match: (p: string) => p.startsWith('/admin'),
    icon: (
      <>
        <circle cx="12" cy="8" r="5" />
        <path d="M20 21a8 8 0 0 0-16 0" />
      </>
    ),
  },
];

/** The handoff's 56px bottom tab bar, shown below 760px. */
export const MobileNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav
      style={{
        flex: 'none',
        display: 'flex',
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-default)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        position: 'sticky',
        bottom: 0,
        zIndex: 50,
      }}
    >
      {ITEMS.map((item) => {
        const active = item.match(location.pathname);
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            aria-current={active ? 'page' : undefined}
            style={{
              all: 'unset',
              cursor: 'pointer',
              flex: 1,
              height: 56,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              color: active ? 'var(--primary-500)' : 'var(--fg-muted)',
              fontSize: 11,
              fontWeight: active ? 600 : 500,
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {item.icon}
            </svg>
            {item.label}
          </button>
        );
      })}
    </nav>
  );
};
