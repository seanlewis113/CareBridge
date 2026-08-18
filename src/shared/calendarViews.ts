import type { CalendarEvent } from './types';
import { el, formatDate, formatTime } from './utils';
import { icon, type IconName } from './icons';
import {
  formatCalendarLastSynced,
  formatEventSyncedLabel,
  formatEventSyncedTitle,
  getEventDateSpan,
  getLatestCalendarSyncAt,
} from './calendarRecurrence';

interface EventSpan {
  startKey: string;
  endKey: string;
}

interface WeekDay {
  key: string;
  dayNumber: number;
  inMonth: boolean;
}

interface WeekSegment {
  event: CalendarEvent;
  startCol: number;
  endCol: number;
  lane: number;
  showTitle: boolean;
  isStart: boolean;
  isEnd: boolean;
}

const VIEW_KEY = 'moms-care-calendar-view';

export type CalendarViewMode = 'list' | 'grid';

export function getCalendarViewMode(): CalendarViewMode {
  return sessionStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
}

export function setCalendarViewMode(mode: CalendarViewMode): void {
  sessionStorage.setItem(VIEW_KEY, mode);
}

export interface CalendarListOptions {
  onDelete?: (event: CalendarEvent) => void | Promise<void>;
  onEdit?: (event: CalendarEvent) => void | Promise<void>;
  showGoogleBadge?: boolean;
  wrapInCard?: boolean;
}

export interface CalendarGridOptions {
  showToolbar?: boolean;
  scrollable?: boolean;
  onEdit?: (event: CalendarEvent) => void | Promise<void>;
}

export function renderCalendarLastSyncedMeta(events: CalendarEvent[]): HTMLElement {
  const syncedAt = getLatestCalendarSyncAt(events);
  return el(
    'p',
    { className: 'calendar-last-synced' },
    formatCalendarLastSynced(syncedAt)
  );
}

export function groupEventsByDay(events: CalendarEvent[]): [string, CalendarEvent[]][] {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const day = getEventDateSpan(event).startKey;
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(event);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function scrollCalendarToToday(container: HTMLElement): void {
  const todayEl = container.querySelector('.app-calendar-day--today');
  if (!todayEl) return;

  const scrollContainer = container.querySelector('.calendar-page-grid-scroll');
  if (scrollContainer instanceof HTMLElement) {
    const todayRect = todayEl.getBoundingClientRect();
    const scrollRect = scrollContainer.getBoundingClientRect();
    scrollContainer.scrollTop += todayRect.top - scrollRect.top - scrollRect.height / 2 + todayRect.height / 2;
    return;
  }

  todayEl.scrollIntoView({ block: 'center', inline: 'nearest' });
}

export function renderCalendarViewToggle(
  activeMode: CalendarViewMode,
  onChange: (mode: CalendarViewMode) => void
): HTMLElement {
  const group = el('div', { className: 'calendar-view-toggle', role: 'group', 'aria-label': 'Calendar view' });

  const makeBtn = (mode: CalendarViewMode, label: string, iconName: IconName) => {
    const btn = el('button', {
      type: 'button',
      className: `calendar-view-toggle-btn${activeMode === mode ? ' active' : ''}`,
      'aria-pressed': String(activeMode === mode),
      'aria-label': label,
    },
      icon(iconName),
      el('span', {}, label)
    );
    btn.addEventListener('click', () => {
      if (activeMode === mode) return;
      setCalendarViewMode(mode);
      onChange(mode);
    });
    return btn;
  };

  group.append(makeBtn('grid', 'Calendar', 'calendar'), makeBtn('list', 'List', 'list'));
  return group;
}

export function renderCalendarGridView(events: CalendarEvent[], options: CalendarGridOptions = {}): HTMLElement {
  const showToolbar = options.showToolbar !== false;
  const now = new Date();
  const wrap = el('div', { className: 'app-calendar-panel' });

  if (events.length === 0) {
    wrap.append(el('p', { className: 'empty-state' }, 'No upcoming events.'));
    return wrap;
  }

  if (showToolbar) {
    const header = el('div', { className: 'app-calendar-toolbar' });
    const toolbarMeta = el('div', { className: 'app-calendar-toolbar-meta' });
    toolbarMeta.append(
      el(
        'p',
        { className: 'app-calendar-subtitle' },
        `${events.length} upcoming ${events.length === 1 ? 'event' : 'events'}`
      ),
      renderCalendarLastSyncedMeta(events)
    );
    const todayBtn = el(
      'button',
      { className: 'app-calendar-today-btn', type: 'button', 'aria-label': 'Jump to today' },
      'Today'
    );
    todayBtn.addEventListener('click', () => scrollCalendarToToday(wrap));
    header.append(toolbarMeta, todayBtn);
    wrap.append(header);
  }

  const byDay = buildSingleDayEventMap(events);

  const monthsWrap = el('div', { className: 'app-calendar-months' });
  for (const monthStart of buildMonthStarts(now, events)) {
    monthsWrap.append(renderCalendarMonth(monthStart, byDay, events, now, options));
  }

  if (options.scrollable) {
    const scrollArea = el('div', { className: 'calendar-page-grid-scroll' });
    scrollArea.append(monthsWrap);
    wrap.append(scrollArea);
  } else {
    wrap.append(monthsWrap);
  }

  requestAnimationFrame(() => scrollCalendarToToday(wrap));
  return wrap;
}

export function renderCalendarListView(events: CalendarEvent[], options: CalendarListOptions = {}): HTMLElement {
  const wrap = el('div', { className: 'app-calendar-list' });

  if (events.length === 0) {
    wrap.append(el('p', { className: 'empty-state' }, 'No upcoming events.'));
    return wrap;
  }

  for (const [day, dayEvents] of groupEventsByDay(events)) {
    const group = el('div', { className: 'calendar-day-group' }, el('h3', {}, formatDate(day + 'T12:00:00')));
    for (const event of dayEvents) {
      const syncedLabel = formatEventSyncedLabel(event);
      const details = el('div', { className: 'calendar-list-item-details' },
        el('div', { className: 'calendar-list-item-main' },
          el('strong', {}, formatTime(event.start_at)),
          ' — ',
          event.title,
          options.showGoogleBadge && event.google_event_id
            ? el('span', { style: 'font-size:0.8rem;color:var(--color-text-muted);margin-left:0.5rem' }, '(Google)')
            : null
        ),
        syncedLabel
          ? el('span', { className: 'calendar-event-synced' }, syncedLabel)
          : null
      );

      const rowChildren: (HTMLElement | null)[] = [details];
      const actions = el('div', { className: 'calendar-list-item-actions' });

      if (options.onEdit) {
        const editBtn = el('button', {
          className: 'btn btn-secondary',
          type: 'button',
          style: 'padding:0.35rem 0.75rem;min-height:auto',
        }, 'Edit');
        editBtn.addEventListener('click', () => void options.onEdit!(event));
        actions.append(editBtn);
      }

      if (options.onDelete) {
        const deleteBtn = el('button', {
          className: 'btn btn-danger',
          type: 'button',
          style: 'padding:0.35rem 0.75rem;min-height:auto',
        }, 'Delete');
        deleteBtn.addEventListener('click', () => void options.onDelete!(event));
        actions.append(deleteBtn);
      }

      if (actions.childElementCount > 0) rowChildren.push(actions);

      group.append(el('div', { className: 'list-item' }, ...rowChildren.filter(Boolean) as HTMLElement[]));
    }

    const node = options.wrapInCard
      ? el('div', { className: 'card', style: 'margin-bottom:0.75rem' }, group)
      : group;
    wrap.append(node);
  }

  return wrap;
}

export function renderDashboardScheduleEventRow(event: CalendarEvent): HTMLElement {
  const syncedLabel = formatEventSyncedLabel(event);
  const titleCell = el('span', { className: 'caregiver-dash-row-title' }, event.title);
  if (syncedLabel) {
    titleCell.append(el('span', { className: 'calendar-event-synced' }, syncedLabel));
  }
  return el('div', { className: 'caregiver-dash-row caregiver-dash-row--schedule' },
    el('span', { className: 'caregiver-dash-time' }, formatTime(event.start_at)),
    titleCell
  );
}

function buildMonthStarts(now: Date, events: CalendarEvent[]): Date[] {
  const starts: Date[] = [];
  const monthStartNow = new Date(now.getFullYear(), now.getMonth(), 1);
  const eventMonths = events.flatMap((event) => {
    const { startKey, endKey } = getEventSpan(event);
    const startDate = parseDateKey(startKey);
    const endDate = parseDateKey(endKey);
    return [
      new Date(startDate.getFullYear(), startDate.getMonth(), 1),
      new Date(endDate.getFullYear(), endDate.getMonth(), 1),
    ];
  });
  const earliest = [monthStartNow, ...eventMonths].reduce((min, current) => (current < min ? current : min));
  const latest = [monthStartNow, ...eventMonths].reduce((max, current) => (current > max ? current : max));

  let cursor = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
  while (cursor <= latest) {
    starts.push(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return starts;
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function getEventSpan(event: CalendarEvent): EventSpan {
  return getEventDateSpan(event);
}

function isMultiDayEvent(event: CalendarEvent): boolean {
  const { startKey, endKey } = getEventSpan(event);
  return endKey > startKey;
}

function getWeekLaneCount(week: WeekDay[], events: CalendarEvent[]): number {
  const segments = assignWeekLanes(buildWeekSegments(week, events));
  return segments.reduce((max, segment) => Math.max(max, segment.lane + 1), 0);
}

function buildSingleDayEventMap(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    if (isMultiDayEvent(event)) continue;
    const day = getEventDateSpan(event).startKey;
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(event);
  }
  return map;
}

function buildMonthWeeks(monthStart: Date): WeekDay[][] {
  const weeks: WeekDay[][] = [];
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const firstWeekday = monthStart.getDay();
  let week: WeekDay[] = [];

  for (let i = 0; i < firstWeekday; i++) {
    week.push({ key: '', dayNumber: 0, inMonth: false });
  }

  for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {
    const dayDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), dayNumber);
    week.push({ key: toLocalDateKey(dayDate), dayNumber, inMonth: true });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }

  if (week.length > 0) {
    while (week.length < 7) {
      week.push({ key: '', dayNumber: 0, inMonth: false });
    }
    weeks.push(week);
  }

  return weeks;
}

function buildWeekSegments(week: WeekDay[], events: CalendarEvent[]): Omit<WeekSegment, 'lane'>[] {
  const inMonthDays = week.filter((day) => day.inMonth);
  if (inMonthDays.length === 0) return [];

  const weekStartKey = inMonthDays[0].key;
  const weekEndKey = inMonthDays[inMonthDays.length - 1].key;
  const segments: Omit<WeekSegment, 'lane'>[] = [];

  for (const event of events) {
    if (!isMultiDayEvent(event)) continue;
    const { startKey, endKey } = getEventSpan(event);
    if (endKey < weekStartKey || startKey > weekEndKey) continue;

    const segmentStartKey = startKey > weekStartKey ? startKey : weekStartKey;
    const segmentEndKey = endKey < weekEndKey ? endKey : weekEndKey;
    const startCol = week.findIndex((day) => day.key === segmentStartKey);
    const endCol = week.findIndex((day) => day.key === segmentEndKey);
    if (startCol < 0 || endCol < 0) continue;

    segments.push({
      event,
      startCol,
      endCol,
      showTitle: segmentStartKey === startKey,
      isStart: segmentStartKey === startKey,
      isEnd: segmentEndKey === endKey,
    });
  }

  return segments.sort((a, b) => {
    if (a.startCol !== b.startCol) return a.startCol - b.startCol;
    const aLength = a.endCol - a.startCol;
    const bLength = b.endCol - b.startCol;
    return bLength - aLength;
  });
}

function assignWeekLanes(segments: Omit<WeekSegment, 'lane'>[]): WeekSegment[] {
  const laneEnds: number[] = [];
  const placed: WeekSegment[] = [];

  for (const segment of segments) {
    let lane = laneEnds.findIndex((endCol) => endCol < segment.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(segment.endCol);
    } else {
      laneEnds[lane] = segment.endCol;
    }
    placed.push({ ...segment, lane });
  }

  return placed;
}

function getEventToneClass(seed: string | number): string {
  const value = typeof seed === 'number'
    ? seed
    : seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return `app-calendar-event-tone-${Math.abs(value) % 4}`;
}

function renderGridDayEvent(event: CalendarEvent, options: CalendarGridOptions): HTMLElement {
  const toneClass = getEventToneClass(event.id);
  const eventTitle = formatEventSyncedTitle(event);
  const eventNode = options.onEdit
    ? el('button', {
      type: 'button',
      className: `app-calendar-day-event app-calendar-day-event--clickable ${toneClass}`,
      'aria-label': `Edit ${eventTitle}`,
      title: eventTitle,
    },
      el('span', { className: 'app-calendar-day-event-title' }, event.title)
    )
    : el('div', {
      className: `app-calendar-day-event ${toneClass}`,
      title: eventTitle,
    },
      el('span', { className: 'app-calendar-day-event-title' }, event.title)
    );

  if (options.onEdit) {
    eventNode.addEventListener('click', () => void options.onEdit!(event));
  }

  return eventNode;
}

function renderWeekSpanEvent(segment: WeekSegment, options: CalendarGridOptions): HTMLElement {
  const classes = [
    'app-calendar-span-event',
    getEventToneClass(segment.lane),
    segment.isStart ? 'app-calendar-span-event--start' : 'app-calendar-span-event--continue',
    segment.isEnd ? 'app-calendar-span-event--end' : 'app-calendar-span-event--extend',
    options.onEdit ? 'app-calendar-span-event--clickable' : '',
  ].filter(Boolean).join(' ');

  const eventTitle = formatEventSyncedTitle(segment.event);
  const eventNode = options.onEdit
    ? el('button', {
      type: 'button',
      className: classes,
      style: `grid-column:${segment.startCol + 1} / ${segment.endCol + 2}; grid-row:${segment.lane + 1};`,
      'aria-label': `Edit ${eventTitle}`,
      title: eventTitle,
    },
      segment.showTitle
        ? el('span', { className: 'app-calendar-span-event-title' }, segment.event.title)
        : null
    )
    : el('div', {
      className: classes,
      style: `grid-column:${segment.startCol + 1} / ${segment.endCol + 2}; grid-row:${segment.lane + 1};`,
      title: eventTitle,
    },
      segment.showTitle
        ? el('span', { className: 'app-calendar-span-event-title' }, segment.event.title)
        : null
    );

  if (options.onEdit) {
    eventNode.addEventListener('click', () => void options.onEdit!(segment.event));
  }

  return eventNode;
}

function renderCalendarWeek(
  week: WeekDay[],
  eventsByDay: Map<string, CalendarEvent[]>,
  allEvents: CalendarEvent[],
  now: Date,
  options: CalendarGridOptions = {}
): HTMLElement {
  const laneCount = getWeekLaneCount(week, allEvents);
  const segments = assignWeekLanes(buildWeekSegments(week, allEvents));
  const weekEl = el('div', {
    className: 'app-calendar-week',
    style: laneCount > 0 ? `--span-lanes:${laneCount}` : undefined,
  });

  for (const day of week) {
    if (!day.inMonth) {
      weekEl.append(el('div', { className: 'app-calendar-day app-calendar-day--blank', 'aria-hidden': 'true' }));
      continue;
    }

    const dayDate = parseDateKey(day.key);
    const dayEvents = eventsByDay.get(day.key) ?? [];
    const isToday = day.key === toLocalDateKey(now);
    const isPast = dayDate < new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const isInCurrentWeek = isDateInCurrentWeek(dayDate, now);

    const dayCell = el('div', {
      className: `app-calendar-day${isToday ? ' app-calendar-day--today' : ''}${isPast ? ' app-calendar-day--past' : ''}${isInCurrentWeek ? ' app-calendar-day--current-week' : ''}`,
    });
    dayCell.append(el('div', { className: 'app-calendar-day-number' }, String(day.dayNumber)));

    if (dayEvents.length > 0) {
      const eventsList = el('div', { className: 'app-calendar-day-events' });
      for (const event of dayEvents) {
        eventsList.append(renderGridDayEvent(event, options));
      }
      dayCell.append(eventsList);
    }

    weekEl.append(dayCell);
  }

  if (segments.length > 0) {
    const barsRow = el('div', { className: 'app-calendar-week-bars' });
    for (const segment of segments) {
      barsRow.append(renderWeekSpanEvent(segment, options));
    }
    weekEl.append(barsRow);
  }

  return weekEl;
}

function renderCalendarMonth(
  monthStart: Date,
  eventsByDay: Map<string, CalendarEvent[]>,
  allEvents: CalendarEvent[],
  now: Date,
  options: CalendarGridOptions = {}
): HTMLElement {
  const monthCard = el('section', { className: 'app-calendar-month' });
  const monthTitle = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  monthCard.append(el('h3', { className: 'app-calendar-month-title' }, monthTitle));

  const weekdays = el('div', { className: 'app-calendar-weekdays' });
  for (const label of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
    weekdays.append(el('span', { className: 'app-calendar-weekday' }, label));
  }
  monthCard.append(weekdays);

  const grid = el('div', { className: 'app-calendar-grid' });
  for (const week of buildMonthWeeks(monthStart)) {
    grid.append(renderCalendarWeek(week, eventsByDay, allEvents, now, options));
  }

  monthCard.append(grid);
  return monthCard;
}

function isDateInCurrentWeek(date: Date, today: Date): boolean {
  const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  const endOfWeek = new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() + 7);
  const candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return candidate >= startOfWeek && candidate < endOfWeek;
}
