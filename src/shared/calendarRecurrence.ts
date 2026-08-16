import type { CalendarEvent } from './types';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';

export interface EventRecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number;
  count?: number;
}

const RECURRENCE_PREFIX = '[[MC_RECURRENCE]]';
const DEFAULT_RECURRENCE_MONTHS = 18;
const UNTIMED_EVENT_DURATION_MS = 60 * 60 * 1000;

export function isMidnightTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T00:00:00/.test(value);
}

export function isUntimedEvent(event: Pick<CalendarEvent, 'start_at'>): boolean {
  return event.start_at.length === 10 || isMidnightTimestamp(event.start_at);
}

export function parseEventInstant(value: string): Date {
  if (value.length === 10 || isMidnightTimestamp(value)) {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

export function toIsoLocalSeconds(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
}

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysToDateKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
}

export interface EventDateSpan {
  startKey: string;
  endKey: string;
}

function diffDateKeys(startKey: string, endKey: string): number {
  const [startYear, startMonth, startDay] = startKey.split('-').map(Number);
  const [endYear, endMonth, endDay] = endKey.split('-').map(Number);
  const start = new Date(startYear, startMonth - 1, startDay);
  const end = new Date(endYear, endMonth - 1, endDay);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

export function getEventDateSpan(event: Pick<CalendarEvent, 'start_at' | 'end_at'>): EventDateSpan {
  const startKey = isUntimedEvent(event)
    ? event.start_at.slice(0, 10)
    : toLocalDateKey(new Date(event.start_at));

  if (event.start_at.length === 10) {
    const endExclusive = event.end_at.slice(0, 10);
    const endKey = addDaysToDateKey(endExclusive, -1);
    return { startKey, endKey: endKey < startKey ? startKey : endKey };
  }

  const endDateKey = event.end_at.slice(0, 10);

  if (isUntimedEvent(event)) {
    if (endDateKey <= startKey) {
      return { startKey, endKey: startKey };
    }
    if (isMidnightTimestamp(event.end_at)) {
      return { startKey, endKey: addDaysToDateKey(endDateKey, -1) };
    }
    if (diffDateKeys(startKey, endDateKey) <= 1) {
      return { startKey, endKey: startKey };
    }
    return { startKey, endKey: addDaysToDateKey(endDateKey, -1) };
  }

  const endKey = toLocalDateKey(new Date(event.end_at));
  return { startKey, endKey: endKey < startKey ? startKey : endKey };
}

function getUntimedEventDurationMs(event: Pick<CalendarEvent, 'start_at' | 'end_at'>): number {
  const span = getEventDateSpan(event);
  if (span.endKey <= span.startKey) {
    return UNTIMED_EVENT_DURATION_MS;
  }
  const start = parseEventInstant(span.startKey);
  const endExclusive = parseEventInstant(addDaysToDateKey(span.endKey, 1));
  return endExclusive.getTime() - start.getTime();
}

export function buildEventTimestamps(startDate: string, endDate: string, time: string): { start_at: string; end_at: string } {
  const safeTime = time || '00:00';
  const startAt = `${startDate}T${safeTime}:00`;

  if (!time) {
    if (endDate === startDate) {
      const end = parseEventInstant(startAt);
      end.setHours(end.getHours() + 1);
      return { start_at: startAt, end_at: toIsoLocalSeconds(end) };
    }
    return {
      start_at: startAt,
      end_at: `${addDaysToDateKey(endDate, 1)}T00:00:00`,
    };
  }

  if (endDate === startDate) {
    const end = parseEventInstant(startAt);
    end.setHours(end.getHours() + 1);
    return { start_at: startAt, end_at: toIsoLocalSeconds(end) };
  }

  const endAt = `${endDate}T${safeTime}:00`;
  const end = parseEventInstant(endAt);
  end.setHours(end.getHours() + 1);
  return { start_at: startAt, end_at: toIsoLocalSeconds(end) };
}

export function getEventPlainDescription(event: CalendarEvent): string {
  const description = event.description ?? '';
  if (!description.startsWith(RECURRENCE_PREFIX)) return description.trim();
  return description.split('\n').slice(1).join('\n').trim();
}

export function buildRecurringDescription(description: string | null, rule: EventRecurrenceRule | null): string | null {
  const plainDescription = (description ?? '').trim();
  if (!rule) return plainDescription || null;
  const payload = JSON.stringify(rule);
  return plainDescription
    ? `${RECURRENCE_PREFIX}${payload}\n${plainDescription}`
    : `${RECURRENCE_PREFIX}${payload}`;
}

export function parseRecurringRule(event: CalendarEvent): EventRecurrenceRule | null {
  const description = event.description ?? '';
  if (!description.startsWith(RECURRENCE_PREFIX)) return null;
  const firstLine = description.split('\n')[0]?.slice(RECURRENCE_PREFIX.length) ?? '';
  try {
    const parsed = JSON.parse(firstLine) as Partial<EventRecurrenceRule>;
    if (!parsed.frequency || !['daily', 'weekly', 'monthly'].includes(parsed.frequency)) return null;
    const interval = Number(parsed.interval);
    if (!Number.isFinite(interval) || interval < 1) return null;
    const hasCount = parsed.count != null;
    const count = hasCount ? Number(parsed.count) : undefined;
    if (hasCount && (!Number.isFinite(count) || count! < 1)) return null;
    return {
      frequency: parsed.frequency,
      interval: Math.floor(interval),
      ...(hasCount ? { count: Math.floor(count!) } : {}),
    };
  } catch {
    return null;
  }
}

export function expandRecurringEvents(events: CalendarEvent[], from?: string, to?: string): CalendarEvent[] {
  const fromDate = from ? new Date(from) : new Date();
  const toDate = to ? new Date(to) : new Date(fromDate.getFullYear(), fromDate.getMonth() + DEFAULT_RECURRENCE_MONTHS, fromDate.getDate());
  const expanded: CalendarEvent[] = [];

  for (const event of events) {
    const rule = parseRecurringRule(event);
    if (!rule) {
      if (isWithinRange(parseEventInstant(event.start_at), fromDate, toDate)) expanded.push(event);
      continue;
    }

    const startSeed = parseEventInstant(event.start_at);
    const durationMs = isUntimedEvent(event)
      ? getUntimedEventDurationMs(event)
      : parseEventInstant(event.end_at).getTime() - startSeed.getTime();
    const maxOccurrences = rule.count ?? Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < maxOccurrences; i++) {
      const occurrenceStart = addFrequency(startSeed, rule.frequency, i * rule.interval);
      if (occurrenceStart > toDate) break;
      if (occurrenceStart < fromDate) continue;
      const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
      expanded.push({
        ...event,
        id: i === 0 ? event.id : `${event.id}::${i}`,
        recurrence_source_id: event.id,
        recurrence_index: i,
        start_at: toIsoLocalSeconds(occurrenceStart),
        end_at: toIsoLocalSeconds(occurrenceEnd),
      });
    }
  }

  return expanded.sort((a, b) => a.start_at.localeCompare(b.start_at));
}

export function getSourceEventId(eventId: string): string {
  return eventId.split('::')[0];
}

function addFrequency(date: Date, frequency: RecurrenceFrequency, amount: number): Date {
  const copy = new Date(date);
  if (frequency === 'daily') {
    copy.setDate(copy.getDate() + amount);
    return copy;
  }
  if (frequency === 'weekly') {
    copy.setDate(copy.getDate() + amount * 7);
    return copy;
  }
  copy.setMonth(copy.getMonth() + amount);
  return copy;
}

function isWithinRange(date: Date, from: Date, to: Date): boolean {
  return date >= from && date <= to;
}
