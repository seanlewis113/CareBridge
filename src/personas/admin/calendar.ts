import { api } from '../../shared/api';
import {
  getCalendarViewMode,
  renderCalendarGridView,
  renderCalendarListView,
  renderCalendarViewToggle,
} from '../../shared/calendarViews';
import { formatCalendarEventCountSummary, formatCalendarLastSynced, getLatestCalendarSyncAt } from '../../shared/calendarRecurrence';
import { renderAdminShell } from '../shared/shell';
import { el, confirmDialog, formatDateTime, showModal } from '../../shared/utils';
import { openEventEditorModal } from '../mother/add-event';
import type { CalendarEvent, CalendarSyncChangeItem, CalendarSyncChanges, CalendarSyncUpdatedItem } from '../../shared/types';

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
    statusEl.textContent = formatCalendarLastSynced(getLatestCalendarSyncAt(events));
    statusEl.style.color = 'var(--color-text-muted)';

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
      eventsContainer.append(renderCalendarGridView(events, { ...eventActions, scrollable: true, showLastSynced: false }));
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
    statusEl.style.color = 'var(--color-text-muted)';
    try {
      const { events, changes } = await api.syncCalendarFromGoogle();
      const changeCount = countSyncChanges(changes);
      const lastSynced = formatCalendarLastSynced(getLatestCalendarSyncAt(events));
      const eventCounts = formatCalendarEventCountSummary(events);
      if (changeCount === 0) {
        statusEl.textContent = `Google Calendar is up to date (${eventCounts}). ${lastSynced}.`;
      } else {
        statusEl.textContent = `Synced ${changeCount} change${changeCount === 1 ? '' : 's'} from Google Calendar. ${lastSynced}.`;
        showCalendarSyncReviewModal(changes);
      }
      await renderEvents();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      statusEl.textContent = `Google Calendar sync failed: ${message}`;
      statusEl.style.color = 'var(--color-danger, #c0392b)';
    }
  });
}

function countSyncChanges(changes: CalendarSyncChanges): number {
  return changes.added.length + changes.updated.length + changes.removed.length;
}

function formatEventSchedule(item: CalendarSyncChangeItem): string {
  const start = formatDateTime(item.start_at);
  if (item.start_at === item.end_at || item.end_at.startsWith(item.start_at.slice(0, 10))) {
    return start;
  }
  return `${start} – ${formatDateTime(item.end_at)}`;
}

function describeUpdatedChange(item: CalendarSyncUpdatedItem): string {
  const schedule = formatEventSchedule(item);
  const fields = item.changed_fields ?? [];

  if (fields.length === 1 && fields[0] === 'description') {
    return `${item.title} · ${schedule} (description updated)`;
  }

  if (!item.previous) return schedule;

  const previousSchedule = formatEventSchedule(item.previous);
  const titleChanged = fields.includes('title') || item.previous.title !== item.title;
  const scheduleChanged =
    fields.includes('start_at') ||
    fields.includes('end_at') ||
    previousSchedule !== schedule;

  if (titleChanged && scheduleChanged) {
    return `${item.title} · ${schedule} (was "${item.previous.title}" · ${previousSchedule})`;
  }
  if (titleChanged) {
    return `${item.title} (was "${item.previous.title}") · ${schedule}`;
  }
  if (scheduleChanged) {
    return `${item.title} · ${schedule} (was ${previousSchedule})`;
  }
  if (fields.includes('description')) {
    return `${item.title} · ${schedule} (description updated)`;
  }
  return `${item.title} · ${schedule}`;
}

function renderSyncChangeSection(
  label: string,
  items: CalendarSyncChangeItem[] | CalendarSyncUpdatedItem[],
  kind: 'added' | 'updated' | 'removed',
  describeItem?: (item: CalendarSyncChangeItem | CalendarSyncUpdatedItem) => string
): HTMLElement {
  const section = el('section', { className: `calendar-sync-review-section calendar-sync-review-section--${kind}` });
  section.append(
    el('h3', { className: 'calendar-sync-review-section-title' },
      el('span', { className: `calendar-sync-review-badge calendar-sync-review-badge--${kind}` }, label),
      `${items.length} ${items.length === 1 ? 'event' : 'events'}`
    )
  );

  const list = el('ul', { className: 'calendar-sync-review-list' });
  for (const item of items) {
    const text = describeItem ? describeItem(item) : `${item.title} · ${formatEventSchedule(item)}`;
    list.append(el('li', { className: 'calendar-sync-review-item' }, text));
  }
  section.append(list);
  return section;
}

function showCalendarSyncReviewModal(changes: CalendarSyncChanges): void {
  const changeCount = countSyncChanges(changes);
  const body = el('div', { className: 'calendar-sync-review modal-body' });

  body.append(
    el('p', { className: 'calendar-sync-review-summary' },
      `${changeCount} change${changeCount === 1 ? '' : 's'} imported from Google Calendar`
    )
  );

  if (changes.added.length > 0) {
    body.append(renderSyncChangeSection('Added', changes.added, 'added'));
  }
  if (changes.updated.length > 0) {
    body.append(renderSyncChangeSection('Updated', changes.updated, 'updated', describeUpdatedChange));
  }
  if (changes.removed.length > 0) {
    body.append(renderSyncChangeSection('Removed', changes.removed, 'removed'));
  }

  const doneBtn = el('button', { className: 'btn btn-primary', type: 'button' }, 'Done');
  const actions = el('div', { className: 'modal-actions' }, doneBtn);
  body.append(actions);

  const close = showModal('Google Calendar Sync', body);
  doneBtn.addEventListener('click', close);
  body.closest('.modal')?.classList.add('calendar-sync-review-shell');
}
