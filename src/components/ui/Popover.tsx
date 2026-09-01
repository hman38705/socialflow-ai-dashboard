import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { computePlacement, type Side } from './overlayPosition';

// === Types

interface PopoverProps {
  /** Renders the trigger. `props` must be spread onto a focusable element. */
  trigger: (props: {
    ref: React.Ref<HTMLButtonElement>;
    onClick: () => void;
    'aria-expanded': boolean;
    'aria-haspopup': 'dialog';
    'aria-controls': string;
  }) => React.ReactNode;
  children: React.ReactNode;
  side?: Side;
}

// === Component

export const Popover: React.FC<PopoverProps> = ({ trigger, children, side = 'bottom' }) => {
  const id = useId();
  const [open, setOpen] = useState<boolean>(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        close();
      }
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !panelRef.current) return;
    const a = triggerRef.current.getBoundingClientRect();
    const panel = panelRef.current.getBoundingClientRect();
    const placement = computePlacement(
      { top: a.top, left: a.left, width: a.width, height: a.height },
      { width: panel.width, height: panel.height },
      side,
      { width: window.innerWidth, height: window.innerHeight },
    );
    setCoords({ top: placement.top, left: placement.left });
    panelRef.current.focus();
  }, [open, side]);

  return (
    <>
      {trigger({
        ref: triggerRef,
        onClick: () => setOpen((v) => !v),
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        'aria-controls': id,
      })}
      {open && (
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          tabIndex={-1}
          className="fixed z-[120] rounded-xl bg-dark-elev border border-dark-border p-3 shadow-elev-2 outline-none"
          style={{ top: coords.top, left: coords.left }}
        >
          {children}
        </div>
      )}
    </>
  );
};

export default Popover;
