import { api } from '../../shared/api';
import { renderCaregiverShell } from '../shared/shell';
import { el, formatDate, formatTime, showModal } from '../../shared/utils';
import { renderAddEventForm } from '../mother/add-event';

export async function renderCaregiverCalendar(): Promise<void> {
  const events = await api.getUpcomingEvents(14);
  const content = el('div', {});

  content.append(
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem' },
      el('h2', {}, 'Calendar'),
      el('button', { className: 'btn btn-primary', type: 'button', id: 'add-event' }, '+ Add Event')
    )
  );

  if (events.length === 0) {
    content.append(el('p', { className: 'empty-state' }, 'No upcoming events.'));
  } else {
    const grouped = groupByDay(events);
    for (const [day, dayEvents] of grouped) {
      const group = el('div', { className: 'calendar-day-group' }, el('h3', {}, formatDate(day + 'T12:00:00')));
      for (const event of dayEvents) {
        group.append(
          el('div', { className: 'list-item' },
            el('strong', {}, formatTime(event.start_at)),
            ' — ',
            event.title
          )
        );
      }
      content.append(el('div', { className: 'card', style: 'margin-bottom:0.75rem' }, group));
    }
  }

  renderCaregiverShell(content, '/caregiver/calendar');

  document.getElementById('add-event')?.addEventListener('click', () => {
    const form = renderAddEventForm(async () => { close(); await renderCaregiverCalendar(); });
    const close = showModal('Add Event', form);
  });
}

function groupByDay<T extends { start_at: string }>(items: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const day = item.start_at.slice(0, 10);
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(item);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}
