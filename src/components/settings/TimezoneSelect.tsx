import React, { useMemo } from 'react';

const FALLBACK_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney',
];

export interface TimezoneSelectProps {
  value: string;
  onChange: (timeZone: string) => void;
}

export const TimezoneSelect: React.FC<TimezoneSelectProps> = ({ value, onChange }) => {
  const timezones = useMemo(() => {
    if (typeof Intl !== 'undefined' && Intl.supportedValuesOf) {
      try {
        return Intl.supportedValuesOf('timeZone') as string[];
      } catch {
        // ignore
      }
    }
    return FALLBACK_TIMEZONES;
  }, []);

  const label = useMemo(() => {
    try {
      return new Intl.DisplayNames(['en'], { type: 'timeZone' }).of(value) ?? value;
    } catch {
      return value;
    }
  }, [value]);

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-gray-400" htmlFor="timezone-select">
        Timezone
      </label>
      <select
        id="timezone-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white"
      >
        {timezones.map((tz) => (
          <option key={tz} value={tz}>
            {tz}
          </option>
        ))}
      </select>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
};
