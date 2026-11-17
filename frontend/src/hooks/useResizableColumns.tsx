import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Draggable column widths for a CSS-grid table.
 *
 * The grid starts on its designed template (mixed `fr`/`px`). The first drag
 * measures the columns as they are on screen and switches the whole grid to
 * pixel widths, so dragging one edge never reflows the others. Widths persist
 * per table in localStorage.
 *
 * Usage:
 *   const { template, headerRef, beginResize, reset } = useResizableColumns(key, COLS, 10);
 *   <div ref={headerRef} style={{ display: 'grid', gridTemplateColumns: template }}>
 *     {labels.map((label, i) => (
 *       <span style={{ position: 'relative' }}>
 *         {label}
 *         <ResizeHandle onPointerDown={beginResize(i)} onDoubleClick={reset} />
 *       </span>
 *     ))}
 *   </div>
 */
export function useResizableColumns(
  storageKey: string,
  defaultTemplate: string,
  columnCount: number
) {
  const [widths, setWidths] = useState<number[] | null>(null);
  const widthsRef = useRef<number[] | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (
        Array.isArray(parsed) &&
        parsed.length === columnCount &&
        parsed.every((value) => typeof value === 'number' && value >= 24)
      ) {
        setWidths(parsed as number[]);
        widthsRef.current = parsed as number[];
      }
    } catch {
      /* a corrupt preference is not worth failing the page for */
    }
  }, [storageKey, columnCount]);

  const template =
    widths && widths.length === columnCount
      ? widths.map((width) => `${Math.round(width)}px`).join(' ')
      : defaultTemplate;

  const save = useCallback(
    (next: number[]) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next.map(Math.round)));
      } catch {
        /* storage may be unavailable; the drag still works for this session */
      }
    },
    [storageKey]
  );

  const beginResize = (index: number) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const header = headerRef.current;
    if (!header) return;

    // Measure once, at drag start: the grid is still on its designed template.
    const cells = Array.from(header.children) as HTMLElement[];
    const measured = cells.map((cell) => cell.getBoundingClientRect().width);
    if (measured.length !== columnCount) return;

    const startX = event.clientX;
    const startWidth = measured[index];

    const onMove = (move: PointerEvent) => {
      const next = [...measured];
      next[index] = Math.max(48, startWidth + (move.clientX - startX));
      widthsRef.current = next;
      setWidths(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (widthsRef.current) save(widthsRef.current);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const reset = () => {
    setWidths(null);
    widthsRef.current = null;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  };

  return { template, headerRef, beginResize, reset, isCustom: Boolean(widths) };
}

/** A thin grab strip on a header cell's right edge. */
export const ResizeHandle: React.FC<{
  onPointerDown: (event: React.PointerEvent) => void;
  onDoubleClick?: () => void;
  accentColor?: string;
}> = ({ onPointerDown, onDoubleClick, accentColor = 'var(--border-strong)' }) => (
  <span
    role="separator"
    aria-orientation="vertical"
    onPointerDown={onPointerDown}
    onDoubleClick={onDoubleClick}
    title="Drag to resize · double-click to reset"
    style={{
      position: 'absolute',
      top: 0,
      right: -3,
      bottom: 0,
      width: 7,
      cursor: 'col-resize',
      touchAction: 'none',
      zIndex: 3,
      display: 'flex',
      justifyContent: 'center',
    }}
  >
    <span
      style={{
        width: 1,
        background: accentColor,
        opacity: 0.55,
        transition: 'opacity 120ms',
      }}
    />
  </span>
);
