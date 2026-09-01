import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface DateRange {
  from: Date;
  to: Date;
}

type PresetKey = 'today' | '7d' | '28d' | '90d' | 'this-month' | 'last-month' | 'custom';

interface Preset {
  key: PresetKey;
  label: string;
}

const PRESETS: Preset[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '28d', label: 'Last 28 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'custom', label: 'Custom' },
];

// ─── Date helpers (all local-timezone aware) ──────────────────────────────────
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fromYMD(s: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return null;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return isNaN(d.getTime()) ? null : d;
}

export function computePresetRange(key: PresetKey, today = new Date()): DateRange | null {
  const todayStart = startOfDay(today);
  const todayEnd = endOfDay(today);
  switch (key) {
    case 'today':
      return { from: todayStart, to: todayEnd };
    case '7d':
      return { from: startOfDay(addDays(today, -6)), to: todayEnd };
    case '28d':
      return { from: startOfDay(addDays(today, -27)), to: todayEnd };
    case '90d':
      return { from: startOfDay(addDays(today, -89)), to: todayEnd };
    case 'this-month':
      return { from: startOfMonth(today), to: todayEnd };
    case 'last-month': {
      const firstOfThisMonth = startOfMonth(today);
      const lastMonthDate = addDays(firstOfThisMonth, -1);
      return { from: startOfMonth(lastMonthDate), to: endOfMonth(lastMonthDate) };
    }
    default:
      return null;
  }
}

function detectPreset(range: DateRange, today = new Date()): PresetKey | null {
  for (const p of PRESETS) {
    if (p.key === 'custom') continue;
    const candidate = computePresetRange(p.key, today);
    if (candidate && isSameDay(candidate.from, range.from) && isSameDay(candidate.to, range.to)) {
      return p.key;
    }
  }
  return null;
}

function formatRange(range: DateRange): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const f = new Intl.DateTimeFormat('en-US', opts);
  if (isSameDay(range.from, range.to)) return f.format(range.from);
  return `${f.format(range.from)} – ${f.format(range.to)}`;
}

// ─── Calendar helpers ─────────────────────────────────────────────────────────
function buildMonthGrid(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// ─── Styles (inline, matching the dark theme from tailwind.config.js) ─────────
const styles = {
  wrapper: {
    position: 'relative' as const,
    display: 'inline-block',
    fontFamily: 'Fira Sans, system-ui, sans-serif',
  },
  trigger: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    background: 'rgba(18,23,40,0.72)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    color: '#e2e8f0',
    cursor: 'pointer',
    fontSize: 14,
    minWidth: 220,
    justifyContent: 'space-between' as const,
  },
  panel: {
    position: 'absolute' as const,
    top: 'calc(100% + 6px)',
    left: 0,
    zIndex: 100,
    background: '#0C1122',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    boxShadow: '0 24px 48px rgba(0,0,0,0.45)',
    padding: 16,
    minWidth: 640,
    display: 'flex',
    gap: 16,
    flexWrap: 'wrap' as const,
  },
  presets: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    minWidth: 130,
  },
  presetBtn: (active: boolean) => ({
    padding: '7px 12px',
    textAlign: 'left' as const,
    background: active ? '#4f83ff' : 'transparent',
    border: active ? '1px solid #4f83ff' : '1px solid transparent',
    borderRadius: 6,
    color: active ? '#fff' : '#94a3b8',
    cursor: 'pointer',
    fontSize: 13,
    transition: 'background 0.15s',
  }),
  calendars: {
    display: 'flex',
    gap: 20,
    flex: 1,
  },
  calendar: {
    flex: 1,
    minWidth: 200,
  },
  calHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between' as const,
    marginBottom: 8,
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: 600,
  },
  navBtn: {
    background: 'transparent',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: 16,
    lineHeight: 1,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 2,
  },
  dayLabel: {
    textAlign: 'center' as const,
    fontSize: 11,
    color: '#64748b',
    padding: '2px 0',
  },
};

interface DayCellProps {
  date: Date;
  from: Date | null;
  to: Date | null;
  hovered: Date | null;
  today: Date;
  onSelect: (d: Date) => void;
  onHover: (d: Date | null) => void;
}

function DayCell({ date, from, to, hovered, today, onSelect, onHover }: DayCellProps) {
  const isToday = isSameDay(date, today);
  const isFuture = date > today;
  const isStart = from && isSameDay(date, from);
  const isEnd = to && isSameDay(date, to);
  const isSelected = isStart || isEnd;

  const rangeEnd = to ?? hovered;
  const inRange =
    from &&
    rangeEnd &&
    date > (from < rangeEnd ? from : rangeEnd) &&
    date < (from < rangeEnd ? rangeEnd : from);

  const isDisabled = isFuture || (from && !to && date < from);

  const cellStyle: React.CSSProperties = {
    textAlign: 'center',
    padding: '5px 2px',
    fontSize: 12,
    borderRadius: 4,
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.3 : 1,
    background: isSelected ? '#4f83ff' : inRange ? 'rgba(79,131,255,0.18)' : 'transparent',
    color: isSelected ? '#fff' : isToday ? '#22d3ee' : '#e2e8f0',
    fontWeight: isToday ? 700 : 400,
    outline: 'none',
  };

  return (
    <button
      type="button"
      style={cellStyle}
      disabled={!!isDisabled}
      aria-disabled={!!isDisabled}
      aria-pressed={!!isSelected}
      aria-label={`${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${isStart ? ', range start' : isEnd ? ', range end' : ''}`}
      onClick={() => !isDisabled && onSelect(date)}
      onMouseEnter={() => !isDisabled && onHover(date)}
      onMouseLeave={() => onHover(null)}
    >
      {date.getDate()}
    </button>
  );
}

interface MonthCalendarProps {
  year: number;
  month: number;
  from: Date | null;
  to: Date | null;
  hovered: Date | null;
  today: Date;
  onSelect: (d: Date) => void;
  onHover: (d: Date | null) => void;
  onPrev?: () => void;
  onNext?: () => void;
  showPrev?: boolean;
  showNext?: boolean;
  id: string;
}

function MonthCalendar({
  year,
  month,
  from,
  to,
  hovered,
  today,
  onSelect,
  onHover,
  onPrev,
  onNext,
  showPrev,
  showNext,
  id,
}: MonthCalendarProps) {
  const cells = buildMonthGrid(year, month);

  return (
    <div style={styles.calendar} role="group" aria-labelledby={`cal-title-${id}`}>
      <div style={styles.calHeader}>
        {showPrev ? (
          <button type="button" style={styles.navBtn} onClick={onPrev} aria-label="Previous month">
            ‹
          </button>
        ) : (
          <span style={{ width: 24 }} />
        )}
        <span id={`cal-title-${id}`}>
          {MONTH_NAMES[month]} {year}
        </span>
        {showNext ? (
          <button type="button" style={styles.navBtn} onClick={onNext} aria-label="Next month">
            ›
          </button>
        ) : (
          <span style={{ width: 24 }} />
        )}
      </div>
      <div style={styles.grid} role="grid" aria-label={`${MONTH_NAMES[month]} ${year}`}>
        {DAY_NAMES.map((d) => (
          <div key={d} style={styles.dayLabel} role="columnheader" aria-label={d}>
            {d}
          </div>
        ))}
        {cells.map((date, i) =>
          date ? (
            <DayCell
              key={i}
              date={date}
              from={from}
              to={to}
              hovered={hovered}
              today={today}
              onSelect={onSelect}
              onHover={onHover}
            />
          ) : (
            <div key={i} />
          ),
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface DateRangePickerProps {
  value?: DateRange;
  onChange?: (range: DateRange) => void;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const today = startOfDay(new Date());
  const defaultRange: DateRange = computePresetRange('7d', today)!;

  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<Date | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // ── Resolve current range from URL or prop or default ──
  const resolveRange = useCallback((): DateRange => {
    if (value) return value;
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const fromDate = fromParam ? fromYMD(fromParam) : null;
    const toDate = toParam ? fromYMD(toParam) : null;
    if (fromDate && toDate && fromDate <= toDate) return { from: fromDate, to: toDate };
    return defaultRange;
  }, [value, searchParams]);

  const [range, setRange] = useState<DateRange>(resolveRange);

  // Init URL params on mount if not set
  useEffect(() => {
    if (!searchParams.get('from') && !searchParams.get('to')) {
      const initial = resolveRange();
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('from', toYMD(initial.from));
          next.set('to', toYMD(initial.to));
          return next;
        },
        { replace: true },
      );
    }
  }, []); // intentionally run once on mount only

  // Sync from URL → state when URL changes externally
  useEffect(() => {
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const fromDate = fromParam ? fromYMD(fromParam) : null;
    const toDate = toParam ? fromYMD(toParam) : null;
    if (fromDate && toDate && fromDate <= toDate) {
      setRange({ from: fromDate, to: toDate });
    }
  }, [searchParams]);

  // Calendar navigation state
  const [calYear, setCalYear] = useState(() => today.getFullYear());
  const [calMonth, setCalMonth] = useState(() => today.getMonth());

  // Pending selection state (click-start → click-end)
  const [pendingFrom, setPendingFrom] = useState<Date | null>(null);

  const activePreset = detectPreset(range, today);

  const secondYear = calMonth === 11 ? calYear + 1 : calYear;
  const secondMonth = (calMonth + 1) % 12;

  // ── Apply a committed range ──
  const applyRange = useCallback(
    (newRange: DateRange) => {
      setRange(newRange);
      setPendingFrom(null);
      if (!value) {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set('from', toYMD(newRange.from));
            next.set('to', toYMD(newRange.to));
            return next;
          },
          { replace: false },
        );
      }
      onChange?.(newRange);
      setOpen(false);
    },
    [onChange, setSearchParams, value],
  );

  // ── Preset click ──
  const handlePreset = (key: PresetKey) => {
    if (key === 'custom') {
      setOpen(true);
      setPendingFrom(null);
      return;
    }
    const computed = computePresetRange(key, today);
    if (computed) applyRange(computed);
  };

  // ── Calendar day click ──
  const handleDaySelect = (date: Date) => {
    if (!pendingFrom) {
      setPendingFrom(date);
    } else {
      const from = pendingFrom <= date ? pendingFrom : date;
      const to = pendingFrom <= date ? date : pendingFrom;
      applyRange({ from: startOfDay(from), to: endOfDay(to) });
    }
  };

  // ── Keyboard navigation ──
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!open) return;
    // Arrow keys and PageUp/Down are handled by native focus movement
    // We intercept Escape to close
    if (event.key === 'Escape') {
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  // ── Click outside to close ──
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setPendingFrom(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const displayLabel = activePreset ? PRESETS.find((p) => p.key === activePreset)!.label : 'Custom';
  const displayRange = formatRange(range);

  return (
    <div style={styles.wrapper}>
      <button
        ref={triggerRef}
        type="button"
        style={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Date range: ${displayRange}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          <span style={{ fontWeight: 600, marginRight: 6, color: '#4f83ff' }}>{displayLabel}</span>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>{displayRange}</span>
        </span>
        <span aria-hidden="true" style={{ color: '#64748b', fontSize: 10 }}>
          ▾
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Select date range"
          aria-modal="true"
          style={styles.panel}
          onKeyDown={handleKeyDown}
        >
          {/* Presets column */}
          <div style={styles.presets} role="group" aria-label="Date range presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                style={styles.presetBtn(preset.key !== 'custom' && activePreset === preset.key)}
                onClick={() => handlePreset(preset.key)}
                aria-pressed={preset.key !== 'custom' && activePreset === preset.key}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Two-month calendar */}
          <div style={styles.calendars}>
            <MonthCalendar
              id="left"
              year={calYear}
              month={calMonth}
              from={pendingFrom ?? range.from}
              to={pendingFrom ? null : range.to}
              hovered={hovered}
              today={today}
              onSelect={handleDaySelect}
              onHover={setHovered}
              showPrev
              onPrev={() => {
                if (calMonth === 0) {
                  setCalMonth(11);
                  setCalYear((y) => y - 1);
                } else setCalMonth((m) => m - 1);
              }}
            />
            <MonthCalendar
              id="right"
              year={secondYear}
              month={secondMonth}
              from={pendingFrom ?? range.from}
              to={pendingFrom ? null : range.to}
              hovered={hovered}
              today={today}
              onSelect={handleDaySelect}
              onHover={setHovered}
              showNext
              onNext={() => {
                if (calMonth === 11) {
                  setCalMonth(0);
                  setCalYear((y) => y + 1);
                } else setCalMonth((m) => m + 1);
              }}
            />
          </div>

          {/* Pending selection hint */}
          {pendingFrom && (
            <div
              style={{
                width: '100%',
                fontSize: 12,
                color: '#94a3b8',
                paddingTop: 4,
              }}
              aria-live="polite"
            >
              Start:{' '}
              {pendingFrom.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}{' '}
              — click an end date
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DateRangePicker;
