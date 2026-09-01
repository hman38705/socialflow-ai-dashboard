import React, { useCallback, useId, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';

// === Types

export interface TabDef {
  id: string;
  label: React.ReactNode;
  content: React.ReactNode;
}

interface TabsProps {
  tabs: TabDef[];
  defaultTabId?: string;
  /** When set, the active tab id is mirrored to this URL search param. */
  urlParam?: string;
}

// === Component

export const Tabs: React.FC<TabsProps> = ({ tabs, defaultTabId, urlParam }) => {
  const baseId = useId();
  const [searchParams, setSearchParams] = useSearchParams();

  const fromUrl = urlParam ? searchParams.get(urlParam) : null;
  const initial =
    (fromUrl && tabs.some((t) => t.id === fromUrl) && fromUrl) || defaultTabId || tabs[0]?.id;

  const [activeId, setActiveId] = useState<string>(initial);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const activate = useCallback(
    (id: string) => {
      setActiveId(id);
      if (urlParam) {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set(urlParam, id);
            return next;
          },
          { replace: true },
        );
      }
    },
    [urlParam, setSearchParams],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    const index = tabs.findIndex((t) => t.id === activeId);
    let nextIndex: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
        nextIndex = (index + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        nextIndex = (index - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    // Roving focus only; activation stays manual (Enter/Space on the focused tab).
    tabRefs.current.get(tabs[nextIndex].id)?.focus();
  };

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return (
    <div>
      <div
        role="tablist"
        className="relative flex gap-1 border-b border-dark-border"
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node) tabRefs.current.set(tab.id, node);
                else tabRefs.current.delete(tab.id);
              }}
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => activate(tab.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  activate(tab.id);
                }
              }}
              className={`relative px-3 py-2 text-sm font-medium transition-colors ${
                selected ? 'text-white' : 'text-gray-subtext hover:text-white/80'
              }`}
            >
              {tab.label}
              {selected && (
                <motion.div
                  layoutId={`${baseId}-underline`}
                  className="absolute inset-x-0 -bottom-px h-0.5 bg-primary-blue"
                />
              )}
            </button>
          );
        })}
      </div>

      {active && (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${active.id}`}
          aria-labelledby={`${baseId}-tab-${active.id}`}
          tabIndex={0}
          className="pt-4 outline-none"
        >
          {active.content}
        </div>
      )}
    </div>
  );
};

export default Tabs;
