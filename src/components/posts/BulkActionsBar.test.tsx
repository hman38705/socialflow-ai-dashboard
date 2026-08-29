import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BulkActionResult } from '../../types/post';
import { BulkActionsBar } from './BulkActionsBar';

describe('BulkActionsBar', () => {
  it('renders nothing when no rows are selected', () => {
    const { container } = render(
      <BulkActionsBar selectedIds={[]} onClearSelection={vi.fn()} onBulkDelete={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the selected count once at least one row is selected', () => {
    render(<BulkActionsBar selectedIds={['a', 'b', 'c']} onClearSelection={vi.fn()} onBulkDelete={vi.fn()} />);
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('confirms before calling the bulk delete handler, summarizing the exact count', () => {
    const onBulkDelete = vi.fn().mockResolvedValue([]);
    render(<BulkActionsBar selectedIds={['a', 'b']} onClearSelection={vi.fn()} onBulkDelete={onBulkDelete} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete 2 posts?')).toBeInTheDocument();
    expect(onBulkDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onBulkDelete).toHaveBeenCalledWith(['a', 'b']);
  });

  it('reports partial failures and leaves the failed ids for the parent to keep selected', async () => {
    const ids = Array.from({ length: 9 }, (_, index) => `post-${index}`);
    const results: BulkActionResult[] = ids.map((id, index) => ({
      id,
      success: index < 7,
      error: index < 7 ? undefined : 'Conflict',
    }));
    const onBulkReschedule = vi.fn().mockResolvedValue(results);
    const onActionComplete = vi.fn();

    render(
      <BulkActionsBar
        selectedIds={ids}
        onClearSelection={vi.fn()}
        onBulkReschedule={onBulkReschedule}
        onActionComplete={onActionComplete}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }));
    fireEvent.change(screen.getByLabelText(/Reschedule 9 posts to/), {
      target: { value: '2026-02-01T10:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('7 of 9 rescheduled'));

    expect(onActionComplete).toHaveBeenCalledWith({
      action: 'reschedule',
      succeededIds: ids.slice(0, 7),
      failedIds: ids.slice(7),
    });
  });

  it('stays selected across a simulated page change since selection is fully controlled by the parent', () => {
    const { rerender } = render(
      <BulkActionsBar selectedIds={['a', 'b']} onClearSelection={vi.fn()} onBulkDelete={vi.fn()} />,
    );
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    // Parent re-renders with the same selection after paginating — the bar must not reset it.
    rerender(<BulkActionsBar selectedIds={['a', 'b']} onClearSelection={vi.fn()} onBulkDelete={vi.fn()} />);
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });
});
