import { createContext, useContext, useEffect } from 'react';

/** Set by SettingsPage; sections report their dirty-form state into it. */
export const UnsavedChangesContext = createContext<(dirty: boolean) => void>(() => {});

/** Call with a form's dirty state so SettingsPage can prompt before a tab switch. */
export function useUnsavedChanges(dirty: boolean): void {
  const setDirty = useContext(UnsavedChangesContext);
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);
}
