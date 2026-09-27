const TIME_ZONE = 'America/New_York';

const localPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  timeZoneName: 'shortOffset',
});

function partsFor(date) {
  return Object.fromEntries(localPartsFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
}

function offsetMinutesAt(date) {
  const offset = offsetFormatter.formatToParts(date).find(({ type }) => type === 'timeZoneName')?.value ?? '';
  const match = /^(?:GMT|UTC)(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/i.exec(offset);
  if (!match) throw new RangeError(`Cannot resolve ${TIME_ZONE} offset: ${offset}`);
  if (!match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -minutes : minutes;
}

export function toNewYorkDateTimeLocal(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) return '';
  const parts = partsFor(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function newYorkDateTimeLocalToIso(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new RangeError('Enter a valid Eastern date and time.');

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  const validCalendarTime = new Date(wallTime);

  if (
    year < 1000 ||
    validCalendarTime.getUTCFullYear() !== year ||
    validCalendarTime.getUTCMonth() !== month - 1 ||
    validCalendarTime.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    throw new RangeError('Enter a valid Eastern date and time.');
  }

  const offsets = new Set(
    [-36, -24, -12, 0, 12, 24, 36].map((hours) => offsetMinutesAt(new Date(wallTime + hours * 3600000))),
  );
  const matchingInstants = [...offsets]
    .map((offset) => new Date(wallTime - offset * 60000))
    .filter((date) => toNewYorkDateTimeLocal(date) === value)
    .sort((left, right) => left.valueOf() - right.valueOf());

  if (!matchingInstants.length) {
    throw new RangeError('That Eastern time does not exist because of the daylight-saving clock change.');
  }

  return matchingInstants[0].toISOString();
}

export function isPublishedAt(value, now = new Date()) {
  const publishedAt = Date.parse(value);
  return Number.isFinite(publishedAt) && publishedAt <= now.valueOf();
}

export function timeAgo(value, now = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return 'Time unavailable';
  if (date.valueOf() > now.valueOf()) return 'Scheduled';

  const minutes = Math.round((now.valueOf() - date.valueOf()) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString('en-US', { timeZone: TIME_ZONE, month: 'short', day: 'numeric' });
}
