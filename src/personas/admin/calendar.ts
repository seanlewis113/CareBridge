import { api } from '../../shared/api';
import {
  getCalendarViewMode,
  renderCalendarGridView,
  renderCalendarListView,
  renderCalendarViewToggle,
} from '../../shared/calendarViews';
import { renderAdminShell } from '../shared/shell';
import { el, confirmDialog } from '../../shared/utils';
import { openEventEditorModal } from '../mother/add-event';
import type { CalendarEvent } from '../../shared/types';

export async function renderAdminCalendar(): Promise<void> {
  const content = el('div', {});
  let viewMode = getCalendarViewMode();
  const eventsContainer = el('div', {});

  const headerActions = el('div', { className: 'calendar-page-header-actions' });
  const viewToggleHost = el('div', {});
  const actionButtons = el('div', { style: 'display:flex;gap:0.5rem' },
    el('button', { className: 'btn btn-secondary', type: 'button', id: 'sync-google' }, 'Sync Google Calendar'),
    el('button', { className: 'btn btn-primary', type: 'button', id: 'add-event' }, '+ Add Event')
  );
  headerActions.append(viewToggleHost, actionButtons);

  content.append(
    el('div', { className: 'calendar-page-header' },
      el('h2', {}, 'Calendar'),
      headerActions
    )
  );

  const statusEl = el('p', { id: 'sync-status', style: 'font-size:0.85rem;color:var(--color-text-muted)' });
  content.append(statusEl, eventsContainer);

  const renderEvents = async () => {
    const events = await api.getCalendarEvents(new Date().toISOString());
    eventsContainer.replaceChildren();

    viewToggleHost.replaceChildren(renderCalendarViewToggle(viewMode, (mode) => {
      viewMode = mode;
      void renderEvents();
    }));

    const eventActions = {
      onEdit: async (event: CalendarEvent) => {
        await openEventEditorModal(event, renderEvents);
      },
      onDelete: async (event: CalendarEvent) => {
        if (await confirmDialog('Delete this event?')) {
          await api.deleteCalendarEvent(event.id);
          await renderEvents();
        }
      },
    };

    if (viewMode === 'grid') {
      const gridScroll = el('div', { className: 'calendar-page-grid-scroll' });
      gridScroll.append(renderCalendarGridView(events, eventActions));
      eventsContainer.append(gridScroll);
      return;
    }

    eventsContainer.append(renderCalendarListView(events, {
      showGoogleBadge: true,
      ...eventActions,
    }));
  };

  await renderEvents();
  renderAdminShell(content, '/admin/calendar');

  document.getElementById('add-event')?.addEventListener('click', () => {
    void openEventEditorModal(undefined, renderAdminCalendar);
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
