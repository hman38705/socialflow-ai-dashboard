const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

const getLocalParts = (date: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
  };
};

export const formatScheduledTime = (
  isoString: string,
  timeZone: string,
  locale = 'en-US',
): string => {
  const date = new Date(isoString);
  const parts = getLocalParts(date, timeZone);

  const earlier = new Date(date.getTime() - HOUR);
  const earlierParts = getLocalParts(earlier, timeZone);
  const isAmbiguous =
    parts.hour === earlierParts.hour &&
    parts.minute === earlierParts.minute &&
    parts.second === earlierParts.second;

  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  let text = formatter.format(date);

  if (isAmbiguous) {
    const offsetFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    });
    const offsetParts = offsetFormatter.formatToParts(date);
    const offset = offsetParts.find((part) => part.type === 'timeZoneName')?.value ?? '';
    text += ` ${offset}`;
  }

  return text;
};

export const isLocalTimeValid = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): boolean => {
  const utcDate = new Date(Date.UTC(year, month, day, hour, minute, 0));
  const parts = getLocalParts(utcDate, timeZone);

  return (
    parts.year === year &&
    parts.month === month + 1 &&
    parts.day === day &&
    parts.hour === hour &&
    parts.minute === minute
  );
};

export const getAmbiguousLocalTimes = (utcIsoString: string, timeZone: string): string[] | null => {
  const date = new Date(utcIsoString);
  const parts = getLocalParts(date, timeZone);
  const earlier = new Date(date.getTime() - HOUR);
  const earlierParts = getLocalParts(earlier, timeZone);

  if (
    parts.hour === earlierParts.hour &&
    parts.minute === earlierParts.minute &&
    parts.second === earlierParts.second
  ) {
    return [`${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`];
  }

  return null;
};
