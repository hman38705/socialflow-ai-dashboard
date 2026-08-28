import React, { useState } from 'react';
import { Platform } from '../../types';
import { BulkActionResult } from '../../types/post';

type PendingAction = 'delete' | 'reschedule' | 'changePlatform' | null;

export interface BulkActionsBarProps {
  /** Ids selected in the list. Survives pagination — the parent owns this state, not the list page. */
  selectedIds: string[];
  onClearSelection: () => void;
  onBulkDelete?: (ids: string[]) => Promise<BulkActionResult[]>;
  onBulkReschedule?: (ids: string[], scheduledAt: string) => Promise<BulkActionResult[]>;
  onBulkChangePlatform?: (ids: string[], platform: Platform) => Promise<BulkActionResult[]>;
  /** Called after an action settles so the parent can leave failed rows selected. */
  onActionComplete?: (result: { action: PendingAction; succeededIds: string[]; failedIds: string[] }) => void;
  className?: string;
}

const PLATFORM_OPTIONS = Object.values(Platform);

function summarize(results: BulkActionResult[], verbPast: string): string {
  const succeeded = results.filter((result) => result.success).length;
  return `${succeeded} of ${results.length} ${verbPast}`;
}

/**
 * Selection toolbar for bulk post actions: delete, reschedule, and change
 * platform, each gated behind a confirmation that states the exact count.
 * Partial failures are reported per-item and the failed ids stay selected.
 */
export function BulkActionsBar({
  selectedIds,
  onClearSelection,
  onBulkDelete,
  onBulkReschedule,
  onBulkChangePlatform,
  onActionComplete,
  className,
}: BulkActionsBarProps) {
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState('');
  const [targetPlatform, setTargetPlatform] = useState<Platform>(PLATFORM_OPTIONS[0]);

  if (selectedIds.length === 0) {
    return null;
  }

  const runAction = async (
    action: PendingAction,
    verbPast: string,
    handler: () => Promise<BulkActionResult[]>,
  ) => {
    setIsRunning(true);
    setResultMessage(null);
    try {
      const results = await handler();
      const succeededIds = results.filter((result) => result.success).map((result) => result.id);
      const failedIds = results.filter((result) => !result.success).map((result) => result.id);
      setResultMessage(summarize(results, verbPast));
      onActionComplete?.({ action, succeededIds, failedIds });
    } finally {
      setIsRunning(false);
      setPendingAction(null);
    }
  };

  const cancelPending = () => setPendingAction(null);

  return (
    <div
      role="toolbar"
      aria-label="Bulk post actions"
      className={`flex flex-wrap items-center gap-3 rounded-lg border border-dark-border bg-dark-surface p-3 ${className ?? ''}`}
    >
      <span className="text-sm font-medium text-white">{selectedIds.length} selected</span>

      {pendingAction === null && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!onBulkDelete || isRunning}
            onClick={() => setPendingAction('delete')}
            className="rounded px-2 py-1 text-sm text-trend-down disabled:opacity-30"
          >
            Delete
          </button>
          <button
            type="button"
            disabled={!onBulkReschedule || isRunning}
            onClick={() => setPendingAction('reschedule')}
            className="rounded px-2 py-1 text-sm text-primary-blue disabled:opacity-30"
          >
            Reschedule
          </button>
          <button
            type="button"
            disabled={!onBulkChangePlatform || isRunning}
            onClick={() => setPendingAction('changePlatform')}
            className="rounded px-2 py-1 text-sm text-primary-blue disabled:opacity-30"
          >
            Change platform
          </button>
          <button type="button" onClick={onClearSelection} className="rounded px-2 py-1 text-sm text-gray-subtext">
            Clear selection
          </button>
        </div>
      )}

      {pendingAction === 'delete' && (
        <div className="flex items-center gap-2 text-sm">
          <span>Delete {selectedIds.length} posts?</span>
          <button
            type="button"
            disabled={isRunning}
            onClick={() => runAction('delete', 'deleted', () => onBulkDelete!(selectedIds))}
            className="text-trend-down underline"
          >
            Confirm
          </button>
          <button type="button" onClick={cancelPending} className="text-gray-subtext underline">
            Cancel
          </button>
        </div>
      )}

      {pendingAction === 'reschedule' && (
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="bulk-reschedule-at" className="text-gray-subtext">
            Reschedule {selectedIds.length} posts to
          </label>
          <input
            id="bulk-reschedule-at"
            type="datetime-local"
            value={rescheduleAt}
            onChange={(event) => setRescheduleAt(event.target.value)}
            className="rounded border border-dark-border bg-dark-bg px-2 py-1 text-white"
          />
          <button
            type="button"
            disabled={isRunning || !rescheduleAt}
            onClick={() =>
              runAction('reschedule', 'rescheduled', () =>
                onBulkReschedule!(selectedIds, new Date(rescheduleAt).toISOString()),
              )
            }
            className="text-primary-blue underline disabled:opacity-30"
          >
            Confirm
          </button>
          <button type="button" onClick={cancelPending} className="text-gray-subtext underline">
            Cancel
          </button>
        </div>
      )}

      {pendingAction === 'changePlatform' && (
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="bulk-target-platform" className="text-gray-subtext">
            Move {selectedIds.length} posts to
          </label>
          <select
            id="bulk-target-platform"
            value={targetPlatform}
            onChange={(event) => setTargetPlatform(event.target.value as Platform)}
            className="rounded border border-dark-border bg-dark-bg px-2 py-1 text-white"
          >
            {PLATFORM_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={isRunning}
            onClick={() =>
              runAction('changePlatform', `moved to ${targetPlatform}`, () =>
                onBulkChangePlatform!(selectedIds, targetPlatform),
              )
            }
            className="text-primary-blue underline"
          >
            Confirm
          </button>
          <button type="button" onClick={cancelPending} className="text-gray-subtext underline">
            Cancel
          </button>
        </div>
      )}

      {resultMessage && (
        <span role="status" className="text-xs text-gray-subtext">
          {resultMessage}
        </span>
      )}
    </div>
  );
}

export default BulkActionsBar;
