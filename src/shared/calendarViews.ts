import type { CalendarEvent } from './types';
import { el, formatDate, formatTime } from './utils';
import { icon, type IconName } from './icons';

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

export function groupEventsByDay(events: CalendarEvent[]): [string, CalendarEvent[]][] {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const day = event.start_at.slice(0, 10);
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
    const subtitle = el(
      'p',
      { className: 'app-calendar-subtitle' },
      `${events.length} upcoming ${events.length === 1 ? 'event' : 'events'}`
    );
    const todayBtn = el(
      'button',
      { className: 'app-calendar-today-btn', type: 'button', 'aria-label': 'Jump to today' },
      'Today'
    );
    todayBtn.addEventListener('click', () => scrollCalendarToToday(wrap));
    header.append(subtitle, todayBtn);
    wrap.append(header);
  }

  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const day = event.start_at.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(event);
  }

  const monthsWrap = el('div', { className: 'app-calendar-months' });
  for (const monthStart of buildMonthStarts(now, events)) {
    monthsWrap.append(renderCalendarMonth(monthStart, byDay, now, options));
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
      const details = el('div', {},
        el('strong', {}, formatTime(event.start_at)),
        ' — ',
        event.title,
        options.showGoogleBadge && event.google_event_id
          ? el('span', { style: 'font-size:0.8rem;color:var(--color-text-muted);margin-left:0.5rem' }, '(Google)')
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

function buildMonthStarts(now: Date, events: CalendarEvent[]): Date[] {
  const starts: Date[] = [];
  const monthStartNow = new Date(now.getFullYear(), now.getMonth(), 1);
  const eventMonths = events.map((event) => {
    const date = new Date(event.start_at);
    return new Date(date.getFullYear(), date.getMonth(), 1);
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

function renderCalendarMonth(
  monthStart: Date,
  eventsByDay: Map<string, CalendarEvent[]>,
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
  const firstWeekday = monthStart.getDay();
  for (let i = 0; i < firstWeekday; i++) {
    grid.append(el('div', { className: 'app-calendar-day app-calendar-day--blank', 'aria-hidden': 'true' }));
  }

  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {
    const dayDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), dayNumber);
    const key = dayDate.toISOString().slice(0, 10);
    const dayEvents = eventsByDay.get(key) ?? [];
    const isToday = key === now.toISOString().slice(0, 10);
    const isPast = dayDate < new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const isInCurrentWeek = isDateInCurrentWeek(dayDate, now);

    const dayCell = el('div', {
      className: `app-calendar-day${isToday ? ' app-calendar-day--today' : ''}${isPast ? ' app-calendar-day--past' : ''}${isInCurrentWeek ? ' app-calendar-day--current-week' : ''}`,
    });
    dayCell.append(el('div', { className: 'app-calendar-day-number' }, String(dayNumber)));

    if (dayEvents.length > 0) {
      const eventsList = el('div', { className: 'app-calendar-day-events' });
      for (const event of dayEvents) {
        const eventNode = options.onEdit
          ? el('button', {
            type: 'button',
            className: 'app-calendar-day-event app-calendar-day-event--clickable',
            'aria-label': `Edit ${event.title}`,
          },
            el('span', { className: 'app-calendar-day-event-time' }, formatTime(event.start_at)),
            el('span', { className: 'app-calendar-day-event-title' }, event.title)
          )
          : el('div', { className: 'app-calendar-day-event' },
            el('span', { className: 'app-calendar-day-event-time' }, formatTime(event.start_at)),
            el('span', { className: 'app-calendar-day-event-title' }, event.title)
          );
        if (options.onEdit) {
          eventNode.addEventListener('click', () => void options.onEdit!(event));
        }
        eventsList.append(eventNode);
      }
      dayCell.append(eventsList);
    }

    grid.append(dayCell);
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
