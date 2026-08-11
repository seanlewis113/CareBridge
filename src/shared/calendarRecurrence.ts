import type { CalendarEvent } from './types';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';

export interface EventRecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number;
  count: number;
}

const RECURRENCE_PREFIX = '[[MC_RECURRENCE]]';
const DEFAULT_RECURRENCE_MONTHS = 18;

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
    const count = Number(parsed.count);
    if (!Number.isFinite(interval) || interval < 1) return null;
    if (!Number.isFinite(count) || count < 1) return null;
    return {
      frequency: parsed.frequency,
      interval: Math.floor(interval),
      count: Math.floor(count),
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
      if (isWithinRange(new Date(event.start_at), fromDate, toDate)) expanded.push(event);
      continue;
    }

    const startSeed = new Date(event.start_at);
    const endSeed = new Date(event.end_at);
    for (let i = 0; i < rule.count; i++) {
      const occurrenceStart = addFrequency(startSeed, rule.frequency, i * rule.interval);
      if (occurrenceStart > toDate) break;
      if (occurrenceStart < fromDate) continue;
      const durationMs = endSeed.getTime() - startSeed.getTime();
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

function toIsoLocalSeconds(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
}
