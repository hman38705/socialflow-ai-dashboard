import React, { useMemo, useState } from 'react';
import type { PostingSlot, PostingScheduleProps } from '../../types/scheduler';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MINUTE = 60_000;

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const hasGapViolation = (slots: PostingSlot[], minGapMinutes: number): boolean => {
  const dayMap = new Map<number, PostingSlot[]>();

  slots.forEach((slot) => {
    const existing = dayMap.get(slot.day) ?? [];
    existing.push(slot);
    dayMap.set(slot.day, existing);
  });

  dayMap.forEach((daySlots) => {
    const sorted = daySlots.slice().sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

    for (let i = 1; i < sorted.length; i += 1) {
      const previous = timeToMinutes(sorted[i - 1].time);
      const current = timeToMinutes(sorted[i].time);
      if (current - previous < minGapMinutes) {
        return true;
      }
    }
  });

  return false;
};

const hasDuplicateSlot = (slots: PostingSlot[]): boolean => {
  const seen = new Set<string>();
  for (const slot of slots) {
    const key = `${slot.day}-${slot.time}-${slot.platform}`;
    if (seen.has(key)) {
      return true;
    }
    seen.add(key);
  }
  return false;
};

const getNextTenSlots = (slots: PostingSlot[]): Date[] => {
  if (slots.length === 0) {
    return [];
  }

  const now = new Date();
  const results: Date[] = [];
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  const currentWeekStart = new Date(startOfWeek);
  currentWeekStart.setDate(startOfWeek.getDate() - now.getDay());

  let weekOffset = 0;
  let checked = 0;

  while (results.length < 10 && weekOffset < 52) {
    for (let day = 0; day < 7; day += 1) {
      const daySlots = slots
        .filter((slot) => slot.day === day)
        .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

      daySlots.forEach((slot) => {
        const [hours, minutes] = slot.time.split(':').map(Number);
        const candidate = new Date(currentWeekStart);
        candidate.setDate(currentWeekStart.getDate() + day + weekOffset * 7);
        candidate.setHours(hours, minutes, 0, 0);

        if (candidate > now) {
          results.push(candidate);
        }
      });
    }

    weekOffset += 1;
  }

  return results.slice(0, 10);
};

export const PostingSchedule: React.FC<PostingScheduleProps> = ({
  slots,
  onChange,
  minGapMinutes,
  platforms,
}) => {
  const [internalSlots, setInternalSlots] = useState<PostingSlot[]>([]);
  const [selectedDay, setSelectedDay] = useState<number>(new Date().getDay());
  const [newTime, setNewTime] = useState('09:00');
  const [newPlatform, setNewPlatform] = useState(platforms[0] ?? '');
  const [copyTarget, setCopyTarget] = useState<number | null>(null);

  const activeSlots = slots ?? internalSlots;

  const gapViolation = useMemo(
    () => hasGapViolation(activeSlots, minGapMinutes),
    [activeSlots, minGapMinutes],
  );

  const duplicateViolation = useMemo(() => hasDuplicateSlot(activeSlots), [activeSlots]);

  const nextTen = useMemo(() => getNextTenSlots(activeSlots), [activeSlots]);

  const updateSlots = (next: PostingSlot[]) => {
    if (onChange) {
      onChange(next);
    } else {
      setInternalSlots(next);
    }
  };

  const addSlot = () => {
    if (!newTime || !newPlatform) {
      return;
    }

    const newSlot: PostingSlot = {
      id: generateId(),
      day: selectedDay,
      time: newTime,
      platform: newPlatform,
    };

    const next = [...activeSlots, newSlot];
    if (hasDuplicateSlot(next)) {
      alert('Duplicate slot detected for this day/time/platform.');
      return;
    }

    updateSlots(next);
  };

  const removeSlot = (id: string) => {
    updateSlots(activeSlots.filter((slot) => slot.id !== id));
  };

  const copyDay = () => {
    if (copyTarget === null) {
      return;
    }

    const sourceSlots = activeSlots.filter((slot) => slot.day === selectedDay);
    const next = activeSlots.filter((slot) => slot.day !== copyTarget);
    const copied = sourceSlots.map((slot) => ({
      ...slot,
      id: generateId(),
      day: copyTarget,
    }));
    updateSlots([...next, ...copied]);
    setCopyTarget(null);
  };

  const clearDay = (day: number) => {
    updateSlots(activeSlots.filter((slot) => slot.day !== day));
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h2 className="text-lg font-semibold text-white">Weekly Posting Schedule</h2>
        <p className="text-sm text-gray-400">
          Define recurring slots per platform. Minimum gap: {minGapMinutes} minutes.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {DAYS.map((dayName, index) => {
          const daySlots = activeSlots
            .filter((slot) => slot.day === index)
            .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

          return (
            <div
              key={index}
              className={`rounded-lg border p-3 ${
                selectedDay === index
                  ? 'border-blue-500 bg-gray-800'
                  : 'border-gray-700 bg-gray-900'
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setSelectedDay(index)}
                  className="text-sm font-medium text-white"
                >
                  {dayName}
                </button>
                <button
                  type="button"
                  onClick={() => clearDay(index)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Clear
                </button>
              </div>

              <div className="space-y-1">
                {daySlots.map((slot) => (
                  <div
                    key={slot.id}
                    className="flex items-center justify-between rounded bg-gray-800 px-2 py-1"
                  >
                    <span className="text-xs text-gray-300">
                      {slot.time} · {slot.platform}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSlot(slot.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {daySlots.length === 0 && <p className="text-xs text-gray-500">No slots</p>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
        <h3 className="text-sm font-medium text-white">Add Slot for {DAYS[selectedDay]}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="time"
            value={newTime}
            onChange={(event) => setNewTime(event.target.value)}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white"
          />
          <select
            value={newPlatform}
            onChange={(event) => setNewPlatform(event.target.value)}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white"
          >
            {platforms.map((platform) => (
              <option key={platform} value={platform}>
                {platform}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addSlot}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500"
          >
            Add
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-400">Copy {DAYS[selectedDay]} to:</span>
          {DAYS.map((dayName, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setCopyTarget(index)}
              disabled={copyTarget === index}
              className={`rounded px-2 py-1 text-xs ${
                copyTarget === index
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {dayName}
            </button>
          ))}
          <button
            type="button"
            onClick={copyDay}
            disabled={copyTarget === null}
            className="rounded bg-gray-700 px-3 py-1 text-xs text-white hover:bg-gray-600 disabled:opacity-50"
          >
            Copy
          </button>
        </div>
      </div>

      {(gapViolation || duplicateViolation) && (
        <div className="rounded-lg border border-yellow-600 bg-yellow-900/30 p-3 text-sm text-yellow-300">
          {gapViolation && <p>Minimum gap violation detected between slots on the same day.</p>}
          {duplicateViolation && <p>Duplicate slot detected for a day/time/platform.</p>}
        </div>
      )}

      <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
        <h3 className="text-sm font-medium text-white">Next 10 Slots</h3>
        <ul className="mt-2 space-y-1">
          {nextTen.map((date, index) => (
            <li key={index} className="text-xs text-gray-300">
              {date.toLocaleString()}
            </li>
          ))}
          {nextTen.length === 0 && <li className="text-xs text-gray-500">No upcoming slots.</li>}
        </ul>
      </div>
    </div>
  );
};
