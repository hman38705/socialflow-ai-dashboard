import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  ComposerProvider,
  useComposer,
  type ComposerPost,
} from './ComposerContext';

const EXISTING_POST: ComposerPost = {
  id: 'post-1',
  content: 'Hello world',
  platforms: ['x'],
};

const Consumer: React.FC = () => {
  const { isOpen, mode, draft, targetPostId, isCloseConfirmOpen, openComposer, closeComposer, resolveCloseConfirm, updateDraft } =
    useComposer();
  return (
    <div>
      <div data-testid="state">
        {JSON.stringify({ isOpen, mode, targetPostId, content: draft.content, isCloseConfirmOpen })}
      </div>
      <button onClick={() => openComposer()}>open-create</button>
      <button onClick={() => openComposer(EXISTING_POST)}>open-edit</button>
      <button onClick={() => updateDraft({ content: 'dirty draft' })}>make-dirty</button>
      <button onClick={closeComposer}>close</button>
      <button onClick={() => resolveCloseConfirm('discard')}>resolve-discard</button>
      <button onClick={() => resolveCloseConfirm('keep-editing')}>resolve-keep</button>
      <button onClick={() => resolveCloseConfirm('save-draft')}>resolve-save</button>
    </div>
  );
};

describe('ComposerContext', () => {
  test('opens in create mode with an empty draft by default', () => {
    render(
      <ComposerProvider>
        <Consumer />
      </ComposerProvider>
    );

    act(() => {
      screen.getByText('open-create').click();
    });

    const state = JSON.parse(screen.getByTestId('state').textContent ?? '{}');
    expect(state).toMatchObject({ isOpen: true, mode: 'create', targetPostId: null, content: '' });
  });

  test('openComposer(post) enters edit mode with the post content and id', () => {
    render(
      <ComposerProvider>
        <Consumer />
      </ComposerProvider>
    );

    act(() => {
      screen.getByText('open-edit').click();
    });

    const state = JSON.parse(screen.getByTestId('state').textContent ?? '{}');
    expect(state).toMatchObject({
      isOpen: true,
      mode: 'edit',
      targetPostId: 'post-1',
      content: 'Hello world',
    });
  });

  test('closeComposer closes immediately when the draft is unchanged', () => {
    render(
      <ComposerProvider>
        <Consumer />
      </ComposerProvider>
    );

    act(() => {
      screen.getByText('open-create').click();
    });
    act(() => {
      screen.getByText('close').click();
    });

    const state = JSON.parse(screen.getByTestId('state').textContent ?? '{}');
    expect(state.isOpen).toBe(false);
    expect(state.isCloseConfirmOpen).toBe(false);
  });

  test('closeComposer opens a confirmation prompt when the draft has unsaved changes', () => {
    render(
      <ComposerProvider>
        <Consumer />
      </ComposerProvider>
    );

    act(() => {
      screen.getByText('open-create').click();
    });
    act(() => {
      screen.getByText('make-dirty').click();
    });
    act(() => {
      screen.getByText('close').click();
    });

    let state = JSON.parse(screen.getByTestId('state').textContent ?? '{}');
    expect(state.isOpen).toBe(true);
    expect(state.isCloseConfirmOpen).toBe(true);

    // "keep editing" dismisses the prompt without closing.
    act(() => {
      screen.getByText('resolve-keep').click();
    });
    state = JSON.parse(screen.getByTestId('state').textContent ?? '{}');
    expect(state.isOpen).toBe(true);
    expect(state.isCloseConfirmOpen).toBe(false);
  });

  test('resolveCloseConfirm("discard") clears the draft and closes', () => {
    render(
      <ComposerProvider>
        <Consumer />
      </ComposerProvider>
    );

    act(() => {
      screen.getByText('open-create').click();
    });
    act(() => {
      screen.getByText('make-dirty').click();
    });
    act(() => {
      screen.getByText('close').click();
    });
    act(() => {
      screen.getByText('resolve-discard').click();
    });

    const state = JSON.parse(screen.getByTestId('state').textContent ?? '{}');
    expect(state.isOpen).toBe(false);
    expect(state.content).toBe('');
  });

  test('resolveCloseConfirm("save-draft") invokes onSaveDraft and closes', () => {
    const onSaveDraft = vi.fn();
    render(
      <ComposerProvider onSaveDraft={onSaveDraft}>
        <Consumer />
      </ComposerProvider>
    );

    act(() => {
      screen.getByText('open-create').click();
    });
    act(() => {
      screen.getByText('make-dirty').click();
    });
    act(() => {
      screen.getByText('close').click();
    });
    act(() => {
      screen.getByText('resolve-save').click();
    });

    expect(onSaveDraft).toHaveBeenCalledTimes(1);
    expect(onSaveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'dirty draft' }),
      null
    );

    const state = JSON.parse(screen.getByTestId('state').textContent ?? '{}');
    expect(state.isOpen).toBe(false);
  });

  test('draft state survives a remount of route content while the provider stays mounted', () => {
    const RouteA: React.FC = () => {
      const { draft } = useComposer();
      return <div data-testid="route">route-a:{draft.content}</div>;
    };
    const RouteB: React.FC = () => {
      const { draft } = useComposer();
      return <div data-testid="route">route-b:{draft.content}</div>;
    };

    const { rerender } = render(
      <ComposerProvider>
        <Consumer />
        <RouteA />
      </ComposerProvider>
    );

    act(() => {
      screen.getByText('open-create').click();
    });
    act(() => {
      screen.getByText('make-dirty').click();
    });
    expect(screen.getByTestId('route')).toHaveTextContent('route-a:dirty draft');

    // Simulate navigating to a different route — the provider (and its state) stays mounted
    // above the router, only the route's own content unmounts/remounts.
    rerender(
      <ComposerProvider>
        <Consumer />
        <RouteB />
      </ComposerProvider>
    );

    expect(screen.getByTestId('route')).toHaveTextContent('route-b:dirty draft');
  });

  test('useComposer throws when used outside a ComposerProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const BadConsumer: React.FC = () => {
      useComposer();
      return null;
    };

    expect(() => render(<BadConsumer />)).toThrow(
      'useComposer must be used within a ComposerProvider'
    );

    spy.mockRestore();
  });
});
