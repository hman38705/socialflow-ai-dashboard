import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

export type ComposerMode = 'create' | 'edit';

export type ComposerMediaType = 'image' | 'video' | 'gif' | 'document';

export interface ComposerMediaItem {
  id: string;
  type: ComposerMediaType;
  url: string;
  name: string;
  file?: File;
}

export interface ComposerDraft {
  content: string;
  platforms: string[];
  platformOverrides: Record<string, string>;
  media: ComposerMediaItem[];
  scheduledAt: string | null;
}

export interface ComposerPost {
  id: string;
  content: string;
  platforms?: string[];
  platformOverrides?: Record<string, string>;
  media?: ComposerMediaItem[];
  scheduledAt?: string | null;
}

/** The three ways a user can resolve a dirty-close prompt. */
export type CloseResolution = 'discard' | 'keep-editing' | 'save-draft';

const EMPTY_DRAFT: ComposerDraft = {
  content: '',
  platforms: [],
  platformOverrides: {},
  media: [],
  scheduledAt: null,
};

const draftFromPost = (post: ComposerPost): ComposerDraft => ({
  content: post.content,
  platforms: post.platforms ?? [],
  platformOverrides: post.platformOverrides ?? {},
  media: post.media ?? [],
  scheduledAt: post.scheduledAt ?? null,
});

const isDraftEmpty = (draft: ComposerDraft): boolean =>
  draft.content.trim().length === 0 &&
  draft.platforms.length === 0 &&
  draft.media.length === 0 &&
  Object.values(draft.platformOverrides).every((value) => value.trim().length === 0);

interface ComposerContextValue {
  isOpen: boolean;
  mode: ComposerMode;
  draft: ComposerDraft;
  targetPostId: string | null;
  /** True when the draft differs from what it was when the composer was opened. */
  isDirty: boolean;
  /** True while the dirty-close confirmation ("discard / keep editing / save draft") is showing. */
  isCloseConfirmOpen: boolean;
  openComposer: (post?: ComposerPost) => void;
  /** Requests the composer close. If the draft is dirty this opens the confirmation instead. */
  closeComposer: () => void;
  /** Resolves a pending close confirmation. */
  resolveCloseConfirm: (resolution: CloseResolution) => void;
  updateDraft: (patch: Partial<ComposerDraft>) => void;
  /** Saves the current draft (via onSaveDraft, if provided) and closes without confirmation. */
  saveDraft: () => void;
  /**
   * Clears the draft and closes without confirmation or saving — used both by the
   * discard resolution and by callers (e.g. after a successful publish/schedule) who
   * have already handled the draft's contents themselves.
   */
  discardAndClose: () => void;
}

const ComposerContext = createContext<ComposerContextValue | null>(null);

export interface ComposerProviderProps {
  children: React.ReactNode;
  /** Called when a draft is saved, either explicitly or via the dirty-close prompt. */
  onSaveDraft?: (draft: ComposerDraft, targetPostId: string | null) => void;
}

export const ComposerProvider: React.FC<ComposerProviderProps> = ({
  children,
  onSaveDraft,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<ComposerMode>('create');
  const [draft, setDraft] = useState<ComposerDraft>(EMPTY_DRAFT);
  const [targetPostId, setTargetPostId] = useState<string | null>(null);
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false);
  // Snapshot of the draft as it was when the composer was opened, used to detect dirtiness.
  const initialDraftRef = useRef<ComposerDraft>(EMPTY_DRAFT);

  const openComposer = useCallback((post?: ComposerPost) => {
    const nextDraft = post ? draftFromPost(post) : EMPTY_DRAFT;
    setMode(post ? 'edit' : 'create');
    setTargetPostId(post?.id ?? null);
    setDraft(nextDraft);
    initialDraftRef.current = nextDraft;
    setIsCloseConfirmOpen(false);
    setIsOpen(true);
  }, []);

  const reset = useCallback(() => {
    setIsOpen(false);
    setIsCloseConfirmOpen(false);
    setDraft(EMPTY_DRAFT);
    initialDraftRef.current = EMPTY_DRAFT;
    setMode('create');
    setTargetPostId(null);
  }, []);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initialDraftRef.current),
    [draft]
  );

  const closeComposer = useCallback(() => {
    if (!isDraftEmpty(draft) && isDirty) {
      setIsCloseConfirmOpen(true);
      return;
    }
    reset();
  }, [draft, isDirty, reset]);

  const resolveCloseConfirm = useCallback(
    (resolution: CloseResolution) => {
      if (resolution === 'keep-editing') {
        setIsCloseConfirmOpen(false);
        return;
      }
      if (resolution === 'save-draft') {
        onSaveDraft?.(draft, targetPostId);
      }
      reset();
    },
    [draft, onSaveDraft, reset, targetPostId]
  );

  const updateDraft = useCallback((patch: Partial<ComposerDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const saveDraft = useCallback(() => {
    onSaveDraft?.(draft, targetPostId);
    reset();
  }, [draft, onSaveDraft, reset, targetPostId]);

  const value = useMemo<ComposerContextValue>(
    () => ({
      isOpen,
      mode,
      draft,
      targetPostId,
      isDirty,
      isCloseConfirmOpen,
      openComposer,
      closeComposer,
      resolveCloseConfirm,
      updateDraft,
      saveDraft,
      discardAndClose: reset,
    }),
    [
      isOpen,
      mode,
      draft,
      targetPostId,
      isDirty,
      isCloseConfirmOpen,
      openComposer,
      closeComposer,
      resolveCloseConfirm,
      updateDraft,
      saveDraft,
      reset,
    ]
  );

  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>;
};

export const useComposer = (): ComposerContextValue => {
  const ctx = useContext(ComposerContext);
  if (!ctx) throw new Error('useComposer must be used within a ComposerProvider');
  return ctx;
};
