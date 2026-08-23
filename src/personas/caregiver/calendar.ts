import { api } from '../../shared/api';
import {
  getCalendarViewMode,
  renderCalendarGridView,
  renderCalendarListView,
  renderCalendarViewToggle,
} from '../../shared/calendarViews';
import { renderCaregiverShell } from '../shared/shell';
import { el } from '../../shared/utils';
import { openEventEditorModal } from '../mother/add-event';
import type { CalendarEvent } from '../../shared/types';

export async function renderCaregiverCalendar(): Promise<void> {
  const content = el('div', {});
  let viewMode = getCalendarViewMode();
  const eventsContainer = el('div', {});

  const headerActions = el('div', { className: 'calendar-page-header-actions' });
  const viewToggleHost = el('div', {});
  const addBtn = el('button', { className: 'btn btn-primary', type: 'button', id: 'add-event' }, '+ Add Event');
  headerActions.append(viewToggleHost, addBtn);

  content.append(
    el('div', { className: 'calendar-page-header' },
      el('h2', {}, 'Calendar'),
      headerActions
    ),
    eventsContainer
  );

  const renderEvents = async () => {
    const events = await api.getCalendarDisplayEvents();
    eventsContainer.replaceChildren();

    viewToggleHost.replaceChildren(renderCalendarViewToggle(viewMode, (mode) => {
      viewMode = mode;
      void renderEvents();
    }));

    const onEdit = async (event: CalendarEvent) => {
      await openEventEditorModal(event, renderEvents);
    };

    if (viewMode === 'grid') {
      eventsContainer.append(renderCalendarGridView(events, { onEdit }));
      return;
    }

    eventsContainer.append(renderCalendarListView(events, { wrapInCard: true, onEdit }));
  };

  await renderEvents();
  renderCaregiverShell(content, '/caregiver/calendar');

  document.getElementById('add-event')?.addEventListener('click', () => {
    void openEventEditorModal(undefined, renderCaregiverCalendar);
  });
}
