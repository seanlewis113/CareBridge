import { api } from '../../shared/api';
import { renderAdminShell } from '../shared/shell';
import { el, formatDate, formatTime, showModal, confirmDialog } from '../../shared/utils';
import { renderAddEventForm } from '../mother/add-event';

export async function renderAdminCalendar(): Promise<void> {
  const content = el('div', {});

  content.append(
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem' },
      el('h2', {}, 'Calendar'),
      el('div', { style: 'display:flex;gap:0.5rem' },
        el('button', { className: 'btn btn-secondary', type: 'button', id: 'sync-google' }, 'Sync Google Calendar'),
        el('button', { className: 'btn btn-primary', type: 'button', id: 'add-event' }, '+ Add Event')
      )
    )
  );

  const statusEl = el('p', { id: 'sync-status', style: 'font-size:0.85rem;color:var(--color-text-muted)' });
  content.append(statusEl);

  const events = await api.getUpcomingEvents(30);
  const list = el('div', {});

  if (events.length === 0) {
    list.append(el('p', { className: 'empty-state' }, 'No upcoming events.'));
  } else {
    const grouped = groupByDay(events);
    for (const [day, dayEvents] of grouped) {
      const group = el('div', { className: 'calendar-day-group' }, el('h3', {}, formatDate(day + 'T12:00:00')));
      for (const event of dayEvents) {
        const row = el('div', { className: 'list-item' },
          el('div', {},
            el('strong', {}, formatTime(event.start_at)),
            ' — ',
            event.title,
            event.google_event_id ? el('span', { style: 'font-size:0.8rem;color:var(--color-text-muted);margin-left:0.5rem' }, '(Google)') : null
          ),
          el('button', { className: 'btn btn-danger', type: 'button', style: 'padding:0.35rem 0.75rem;min-height:auto' }, 'Delete')
        );
        row.querySelector('button')?.addEventListener('click', async () => {
          if (await confirmDialog('Delete this event?')) {
            await api.deleteCalendarEvent(event.id);
            await renderAdminCalendar();
          }
        });
        group.append(row);
      }
      list.append(group);
    }
  }
  content.append(list);

  renderAdminShell(content, '/admin/calendar');

  document.getElementById('add-event')?.addEventListener('click', () => {
    const form = renderAddEventForm(async () => { close(); await renderAdminCalendar(); });
    const close = showModal('Add Event', form);
  });

  document.getElementById('sync-google')?.addEventListener('click', async () => {
    statusEl.textContent = 'Syncing...';
    try {
      const synced = await api.syncCalendarFromGoogle();
      statusEl.textContent = `Synced ${synced.length} events from Google Calendar.`;
      await renderAdminCalendar();
    } catch {
      statusEl.textContent = 'Google Calendar sync requires Supabase configuration. Events are stored locally in demo mode.';
    }
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
