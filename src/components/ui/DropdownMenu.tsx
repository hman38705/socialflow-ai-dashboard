import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// === Types

export interface DropdownAction {
  type?: 'item';
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Renders in the rose accent and is announced as destructive. */
  destructive?: boolean;
}

export interface DropdownSeparator {
  type: 'separator';
}

export type DropdownItem = DropdownAction | DropdownSeparator;

interface DropdownMenuProps {
  /** Renders the trigger; spread `props` onto a focusable button. */
  trigger: (props: {
    ref: React.Ref<HTMLButtonElement>;
    onClick: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    'aria-controls': string;
  }) => React.ReactNode;
  items: DropdownItem[];
  /** Accessible name for the menu. */
  label: string;
}

// === Helpers

function isAction(item: DropdownItem): item is DropdownAction {
  return item.type !== 'separator';
}

// === Component

export const DropdownMenu: React.FC<DropdownMenuProps> = ({ trigger, items, label }) => {
  const id = useId();
  const [open, setOpen] = useState<boolean>(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const typeahead = useRef<{ buffer: string; timer: ReturnType<typeof setTimeout> | null }>({
    buffer: '',
    timer: null,
  });

  // Indices of items that keyboard navigation may land on (actions, enabled or not
  // present in the DOM — disabled items are skipped per the ARIA menu pattern).
  const navigableIndices = useMemo(
    () =>
      items.map((item, i) => (isAction(item) && !item.disabled ? i : -1)).filter((i) => i !== -1),
    [items],
  );

  const closeAndRestore = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    triggerRef.current?.focus();
  }, []);

  const openAt = useCallback((index: number) => {
    setOpen(true);
    setActiveIndex(index);
  }, []);

  const collapse = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const toggle = useCallback(() => {
    if (open) collapse();
    else openAt(navigableIndices[0] ?? -1);
  }, [open, collapse, openAt, navigableIndices]);

  useLayoutEffect(() => {
    if (open && activeIndex >= 0) {
      itemRefs.current[activeIndex]?.focus();
    }
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      const menu = document.getElementById(id);
      if (!menu?.contains(target) && !triggerRef.current?.contains(target)) {
        collapse();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, id, collapse]);

  useEffect(() => {
    const ta = typeahead.current;
    return () => {
      if (ta.timer) clearTimeout(ta.timer);
    };
  }, []);

  const moveFocus = useCallback(
    (direction: 1 | -1) => {
      if (navigableIndices.length === 0) return;
      const current = navigableIndices.indexOf(activeIndex);
      const next =
        current === -1
          ? direction === 1
            ? 0
            : navigableIndices.length - 1
          : (current + direction + navigableIndices.length) % navigableIndices.length;
      setActiveIndex(navigableIndices[next]);
    },
    [navigableIndices, activeIndex],
  );

  const runTypeahead = useCallback(
    (char: string) => {
      const ta = typeahead.current;
      if (ta.timer) clearTimeout(ta.timer);
      ta.buffer += char.toLowerCase();
      ta.timer = setTimeout(() => {
        ta.buffer = '';
      }, 500);

      const match = navigableIndices.find((i) => {
        const item = items[i];
        return isAction(item) && item.label.toLowerCase().startsWith(ta.buffer);
      });
      if (match !== undefined) setActiveIndex(match);
    },
    [navigableIndices, items],
  );

  const onTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openAt(navigableIndices[0] ?? -1);
      }
    },
    [navigableIndices, openAt],
  );

  const onMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          closeAndRestore();
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveFocus(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveFocus(-1);
          break;
        case 'Home':
          e.preventDefault();
          setActiveIndex(navigableIndices[0] ?? -1);
          break;
        case 'End':
          e.preventDefault();
          setActiveIndex(navigableIndices[navigableIndices.length - 1] ?? -1);
          break;
        case 'Tab':
          collapse();
          break;
        default:
          if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            runTypeahead(e.key);
          }
      }
    },
    [closeAndRestore, moveFocus, navigableIndices, runTypeahead],
  );

  itemRefs.current = [];

  return (
    <>
      {trigger({
        ref: triggerRef,
        onClick: toggle,
        onKeyDown: onTriggerKeyDown,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': id,
      })}
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="fixed z-[120] min-w-[12rem] rounded-xl bg-dark-elev border border-dark-border p-1 shadow-elev-2"
        >
          {items.map((item, i) => {
            if (!isAction(item)) {
              return <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-dark-border" />;
            }
            return (
              <button
                key={item.label}
                ref={(node) => {
                  itemRefs.current[i] = node;
                }}
                type="button"
                role="menuitem"
                tabIndex={i === activeIndex ? 0 : -1}
                aria-disabled={item.disabled || undefined}
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return;
                  item.onSelect();
                  closeAndRestore();
                }}
                className={`flex w-full items-center rounded-lg px-3 py-2 text-sm text-left transition-colors disabled:opacity-40 ${
                  item.destructive
                    ? 'text-primary-rose hover:bg-primary-rose/10'
                    : 'text-white/90 hover:bg-white/10'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
};

export default DropdownMenu;
