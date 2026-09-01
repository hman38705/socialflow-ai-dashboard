import { computePresetRange } from '../DateRangePicker';

// Helper: build a Date at midnight local time
function localDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

describe('computePresetRange', () => {
  // ── Today ────────────────────────────────────────────────────────────────
  it('today: from and to are the same calendar day', () => {
    const today = localDate(2026, 8, 29);
    const range = computePresetRange('today', today)!;
    expect(range.from.getFullYear()).toBe(2026);
    expect(range.from.getMonth()).toBe(7); // 0-indexed August
    expect(range.from.getDate()).toBe(29);
    expect(range.to.getDate()).toBe(29);
    expect(range.from.getHours()).toBe(0);
    expect(range.to.getHours()).toBe(23);
  });

  // ── 7d ───────────────────────────────────────────────────────────────────
  it('7d: from is 6 days before today (inclusive)', () => {
    const today = localDate(2026, 8, 29);
    const range = computePresetRange('7d', today)!;
    expect(range.from).toEqual(localDate(2026, 8, 23));
    expect(range.to.getDate()).toBe(29);
  });

  // ── 28d ──────────────────────────────────────────────────────────────────
  it('28d: from is 27 days before today (inclusive)', () => {
    const today = localDate(2026, 8, 29);
    const range = computePresetRange('28d', today)!;
    expect(range.from).toEqual(localDate(2026, 8, 2));
    expect(range.to.getDate()).toBe(29);
  });

  // ── This month ────────────────────────────────────────────────────────────
  it('this-month: from is the 1st of current month', () => {
    const today = localDate(2026, 8, 29);
    const range = computePresetRange('this-month', today)!;
    expect(range.from).toEqual(localDate(2026, 8, 1));
    expect(range.to.getDate()).toBe(29);
  });

  it('this-month: from is the 1st of current month when today is March 1', () => {
    const today = localDate(2026, 3, 1);
    const range = computePresetRange('this-month', today)!;
    expect(range.from).toEqual(localDate(2026, 3, 1));
    expect(range.to.getDate()).toBe(1);
    expect(range.to.getMonth()).toBe(2); // March = 2
  });

  // ── Last month ────────────────────────────────────────────────────────────
  it('last-month: correct first and last day of previous month', () => {
    const today = localDate(2026, 8, 29);
    const range = computePresetRange('last-month', today)!;
    expect(range.from).toEqual(localDate(2026, 7, 1));
    expect(range.to.getMonth()).toBe(6); // July = 6
    expect(range.to.getDate()).toBe(31); // July has 31 days
  });

  it('last-month: handles January → wraps to December of previous year', () => {
    const today = localDate(2026, 1, 15);
    const range = computePresetRange('last-month', today)!;
    expect(range.from.getFullYear()).toBe(2025);
    expect(range.from.getMonth()).toBe(11); // December
    expect(range.from.getDate()).toBe(1);
    expect(range.to.getDate()).toBe(31); // December has 31 days
  });

  it('last-month: handles month boundary on March 1 → February', () => {
    const today = localDate(2026, 3, 1);
    const range = computePresetRange('last-month', today)!;
    expect(range.from.getMonth()).toBe(1); // February
    expect(range.from.getDate()).toBe(1);
    expect(range.to.getMonth()).toBe(1);
    expect(range.to.getDate()).toBe(28); // 2026 is not a leap year
  });

  // ── 90d ──────────────────────────────────────────────────────────────────
  it('90d: from is 89 days before today', () => {
    const today = localDate(2026, 8, 29);
    const range = computePresetRange('90d', today)!;
    const expectedFrom = new Date(today);
    expectedFrom.setDate(expectedFrom.getDate() - 89);
    expect(range.from.getFullYear()).toBe(expectedFrom.getFullYear());
    expect(range.from.getMonth()).toBe(expectedFrom.getMonth());
    expect(range.from.getDate()).toBe(expectedFrom.getDate());
  });

  // ── Custom returns null ───────────────────────────────────────────────────
  it('custom: returns null (no pre-computed range)', () => {
    const range = computePresetRange('custom', localDate(2026, 8, 29));
    expect(range).toBeNull();
  });

  // ── Ranges are inclusive ──────────────────────────────────────────────────
  it('from is always start-of-day (00:00:00)', () => {
    const today = localDate(2026, 8, 29);
    const range = computePresetRange('7d', today)!;
    expect(range.from.getHours()).toBe(0);
    expect(range.from.getMinutes()).toBe(0);
    expect(range.from.getSeconds()).toBe(0);
  });

  it('to is always end-of-day (23:59:59)', () => {
    const today = localDate(2026, 8, 29);
    const range = computePresetRange('7d', today)!;
    expect(range.to.getHours()).toBe(23);
    expect(range.to.getMinutes()).toBe(59);
    expect(range.to.getSeconds()).toBe(59);
  });
});
