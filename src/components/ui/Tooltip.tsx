import React, {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { computePlacement, type Side } from './overlayPosition';

// === Types

interface TooltipProps {
  /** Non-interactive tooltip content. */
  content: React.ReactNode;
  /** A single focusable trigger element that accepts a ref and ARIA props. */
  children: React.ReactElement;
  side?: Side;
  /** ms before opening on hover/focus. */
  openDelay?: number;
  /** ms before closing on blur/mouseleave. */
  closeDelay?: number;
}

type TriggerProps = React.HTMLAttributes<HTMLElement> & {
  'aria-describedby'?: string;
};

// === Component

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  side = 'top',
  openDelay = 300,
  closeDelay = 100,
}) => {
  const id = useId();
  const [open, setOpen] = useState<boolean>(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const scheduleOpen = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => setOpen(true), openDelay);
  }, [clearTimer, openDelay]);

  const scheduleClose = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => setOpen(false), closeDelay);
  }, [clearTimer, closeDelay]);

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tipRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const t = tipRef.current.getBoundingClientRect();
    const placement = computePlacement(
      { top: a.top, left: a.left, width: a.width, height: a.height },
      { width: t.width, height: t.height },
      side,
      { width: window.innerWidth, height: window.innerHeight },
    );
    setCoords({ top: placement.top, left: placement.left });
  }, [open, side, content]);

  const child = children as React.ReactElement<TriggerProps>;
  const p = child.props;

  const trigger = cloneElement(child, {
    ref: anchorRef,
    'aria-describedby': open ? id : p['aria-describedby'],
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      p.onMouseEnter?.(e);
      scheduleOpen();
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      p.onMouseLeave?.(e);
      scheduleClose();
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      p.onFocus?.(e);
      scheduleOpen();
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      p.onBlur?.(e);
      scheduleClose();
    },
  } as TriggerProps & { ref: React.Ref<HTMLElement> });

  return (
    <>
      {trigger}
      {open && (
        <div
          ref={tipRef}
          id={id}
          role="tooltip"
          className="fixed z-[120] max-w-xs rounded-lg bg-dark-elev border border-dark-border px-3 py-1.5 text-xs text-white/90 shadow-elev-2 pointer-events-none"
          style={{ top: coords.top, left: coords.left }}
        >
          {content}
        </div>
      )}
    </>
  );
};

export default Tooltip;
