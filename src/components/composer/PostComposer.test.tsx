import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComposerProvider, useComposer } from '../../contexts/ComposerContext';
import { PostComposer, validateComposerDraft, effectiveContentFor } from './PostComposer';

// Opens the composer in create mode as soon as it mounts, so each test starts from an open dialog.
const AutoOpen: React.FC = () => {
  const { openComposer } = useComposer();
  React.useEffect(() => {
    openComposer();
  }, [openComposer]);
  return null;
};

const renderComposer = (props?: React.ComponentProps<typeof PostComposer>) =>
  render(
    <ComposerProvider>
      <AutoOpen />
      <PostComposer {...props} />
    </ComposerProvider>
  );

describe('validateComposerDraft', () => {
  const baseDraft = {
    content: 'Hello world',
    platforms: ['x'] as string[],
    platformOverrides: {},
    media: [],
    scheduledAt: null,
  };

  test('requires at least one platform', () => {
    const issues = validateComposerDraft({ ...baseDraft, platforms: [] });
    expect(issues.some((i) => i.message.includes('Select at least one platform'))).toBe(true);
  });

  test('flags empty content per platform', () => {
    const issues = validateComposerDraft({ ...baseDraft, content: '   ' });
    expect(issues.some((i) => i.message.includes('add some content'))).toBe(true);
  });

  test('flags content over the platform limit', () => {
    const issues = validateComposerDraft({ ...baseDraft, content: 'x'.repeat(281) });
    expect(issues.some((i) => i.message.includes('character limit'))).toBe(true);
  });

  test('flags unsupported media types for the platform', () => {
    const issues = validateComposerDraft({
      ...baseDraft,
      platforms: ['tiktok'],
      media: [{ id: '1', type: 'image', url: 'blob:x', name: 'a.png' }],
    });
    expect(issues.some((i) => i.message.includes("doesn't support"))).toBe(true);
  });

  test('passes for valid single-platform draft', () => {
    expect(validateComposerDraft(baseDraft)).toEqual([]);
  });
});

describe('effectiveContentFor', () => {
  test('falls back to shared content when no override is set', () => {
    const draft = { content: 'shared', platforms: ['x'], platformOverrides: {}, media: [], scheduledAt: null };
    expect(effectiveContentFor(draft, 'x')).toBe('shared');
  });

  test('uses the per-platform override when present', () => {
    const draft = {
      content: 'shared',
      platforms: ['x'],
      platformOverrides: { x: 'custom for x' },
      media: [],
      scheduledAt: null,
    };
    expect(effectiveContentFor(draft, 'x')).toBe('custom for x');
  });
});

describe('PostComposer', () => {
  test('renders nothing when the composer is closed', () => {
    render(
      <ComposerProvider>
        <PostComposer />
      </ComposerProvider>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('renders the dialog when opened via context', () => {
    renderComposer();
    expect(screen.getByRole('dialog', { name: 'Create new post' })).toBeInTheDocument();
  });

  test('toggling a platform selects it and shows the character counter', () => {
    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'X' }));
    expect(screen.getByRole('button', { name: 'X' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('0 / 280')).toBeInTheDocument();
  });

  test('publishing without a selected platform shows a validation error and does not submit', () => {
    const onPublish = vi.fn();
    renderComposer({ onPublish });
    fireEvent.click(screen.getByRole('button', { name: 'Publish Now' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Select at least one platform');
    expect(onPublish).not.toHaveBeenCalled();
  });

  test('publishing a valid draft calls onPublish and closes the composer', () => {
    const onPublish = vi.fn();
    renderComposer({ onPublish });

    fireEvent.click(screen.getByRole('button', { name: 'X' }));
    fireEvent.change(screen.getByPlaceholderText(/Write your caption/), {
      target: { value: 'Shipping something new #launch' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish Now' }));

    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onPublish.mock.calls[0][0]).toMatchObject({ content: 'Shipping something new #launch' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('scheduling toggles the date/time fields and calls onSchedule on submit', () => {
    const onSchedule = vi.fn();
    renderComposer({ onSchedule });

    fireEvent.click(screen.getByRole('button', { name: 'X' }));
    fireEvent.change(screen.getByPlaceholderText(/Write your caption/), {
      target: { value: 'Scheduled post' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(screen.getByText('Date')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Schedule Post' }));
    expect(onSchedule).toHaveBeenCalledTimes(1);
  });

  test('closing with unsaved changes shows the discard/keep-editing/save-draft prompt', () => {
    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'X' }));
    fireEvent.change(screen.getByPlaceholderText(/Write your caption/), {
      target: { value: 'Draft in progress' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('Escape triggers the same dirty-close confirmation flow', () => {
    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'X' }));
    fireEvent.change(screen.getByPlaceholderText(/Write your caption/), {
      target: { value: 'Draft in progress' },
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
  });
});
