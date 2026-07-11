import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { PostComposer } from '../components/PostComposer';

interface ComposerContextValue {
  openComposer: () => void;
  closeComposer: () => void;
}

const ComposerContext = createContext<ComposerContextValue | null>(null);

export const ComposerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const openComposer = useCallback(() => setOpen(true), []);
  const closeComposer = useCallback(() => setOpen(false), []);

  const value = useMemo<ComposerContextValue>(
    () => ({ openComposer, closeComposer }),
    [openComposer, closeComposer]
  );

  return (
    <ComposerContext.Provider value={value}>
      {children}
      <PostComposer open={open} onClose={closeComposer} />
    </ComposerContext.Provider>
  );
};

export const useComposer = (): ComposerContextValue => {
  const ctx = useContext(ComposerContext);
  if (!ctx) throw new Error('useComposer must be used within a ComposerProvider');
  return ctx;
};
