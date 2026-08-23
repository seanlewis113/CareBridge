import { api } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderCaregiverShell } from '../shared/shell';
import { navigate } from '../../shared/router';
import { el } from '../../shared/utils';
import { icon } from '../../shared/icons';
import { ensureTaskRealtime } from '../../shared/realtime';
import { taskHasAssignees } from '../../shared/taskAssignments';
import { renderCaregiverDashTaskPanel, sortCaregiverTasks } from './taskTable';
import { renderRecurringChecksSection } from './recurringChecks';
import { renderPrescriptionsSection } from './prescriptions';
import { renderDashboardScheduleEventRow } from '../../shared/calendarViews';
import { formatCalendarLastSynced, getLatestCalendarSyncAt } from '../../shared/calendarRecurrence';
import type { CalendarEvent } from '../../shared/types';

export async function renderCaregiverToday(): Promise<void> {
  const session = getSession();
  const profileId = session.profile?.id;

  const [events, tasks, assignments, checks, prescriptions] = await Promise.all([
    api.getUpcomingEvents(3),
    api.getTasks(),
    api.getTaskAssignments(),
    api.getRecurringChecksWithStatus(),
    api.getPrescriptionsWithStatus(),
  ]);

  const myTaskIds = new Set(
    assignments.filter((a) => a.profile_id === profileId).map((a) => a.task_id)
  );
  const assignedTasks = sortCaregiverTasks(
    tasks.filter((t) => myTaskIds.has(t.id) && t.status !== 'completed'),
    { search: '', statuses: new Set(['pending', 'in_progress']), sortKey: 'due', sortDir: 'asc' }
  );
  const availableTasks = sortCaregiverTasks(
    tasks.filter(
      (t) => t.open_slot && !taskHasAssignees(t.id, assignments) && t.status !== 'completed'
    ),
    { search: '', statuses: new Set(['pending', 'in_progress']), sortKey: 'due', sortDir: 'asc' }
  );
  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = events.filter((e) => e.start_at.startsWith(today));
  const uncheckedChecks = checks.filter((c) => !c.last_completion).length;
  const undosedMeds = prescriptions.filter((rx) => !rx.last_dose).length;

  const refresh = () => renderCaregiverToday();

  const content = el('div', { className: 'caregiver-dashboard' });

  const logVisitBtn = el('button', { className: 'btn btn-primary', type: 'button' },
    icon('pen-line'),
    'Log Visit'
  );
  logVisitBtn.addEventListener('click', () => navigate('/caregiver/visit'));

  content.append(
    el('div', { className: 'caregiver-dash-header' },
      el('h2', {}, 'Today'),
      logVisitBtn
    ),
    el('div', { className: 'dashboard-stats caregiver-dash-stats' },
      statCard(String(assignedTasks.length), 'My tasks', '/caregiver/tasks', 'clipboard-list'),
      statCard(String(availableTasks.length), 'Open slots', '/caregiver/tasks', 'users'),
      statCard(String(todayEvents.length), 'Events today', '/caregiver/calendar', 'calendar'),
      statCard(String(checks.length), 'Recurring checks', '/caregiver/visit', 'list',
        uncheckedChecks > 0 ? `${uncheckedChecks} unchecked` : undefined),
      statCard(String(prescriptions.length), 'Medications', '/caregiver/prescriptions', 'pill',
        undosedMeds > 0 ? `${undosedMeds} not logged` : undefined)
    ),
    el('div', { className: 'caregiver-dash-grid' },
      renderSchedulePanel(todayEvents),
      renderCaregiverDashTaskPanel({
        iconName: 'clipboard-list',
        title: 'My Tasks',
        tasks: assignedTasks,
        max: 4,
        viewAllPath: '/caregiver/tasks',
        profileId,
        refresh,
        emptyText: 'All caught up — no tasks assigned.',
      }),
      await renderRecurringChecksSection(refresh, { compact: true, max: 4 }),
      await renderPrescriptionsSection(refresh, { compact: true, max: 4 }),
      renderCaregiverDashTaskPanel({
        iconName: 'users',
        title: 'Available to Claim',
        tasks: availableTasks,
        max: 3,
        viewAllPath: '/caregiver/tasks',
        profileId,
        refresh,
        showClaim: true,
        isUnassigned: (task) => !taskHasAssignees(task.id, assignments),
        emptyText: 'No open tasks to claim.',
      })
    )
  );

  renderCaregiverShell(content, '/caregiver');
  ensureTaskRealtime(() => {
    void refresh();
  });
}

function statCard(
  value: string,
  label: string,
  path: string,
  iconName: string,
  hint?: string
): HTMLElement {
  const card = el('button', { type: 'button', className: 'stat-card stat-card-link' },
    el('div', { className: 'stat-card-header' },
      el('div', { className: 'stat-card-icon' }, icon(iconName))
    ),
    el('div', { className: 'value' }, value),
    el('div', { className: 'label' }, label),
    hint ? el('div', { className: 'stat-card-hint' }, hint) : null
  );
  card.addEventListener('click', () => navigate(path));
  return card;
}

function renderSchedulePanel(events: CalendarEvent[]): HTMLElement {
  const panel = el('section', { className: 'card caregiver-dash-panel' });
  const head = el('div', { className: 'caregiver-dash-panel-head' },
    el('div', { className: 'card-header' },
      el('div', { className: 'card-header-icon' }, icon('calendar')),
      el('h3', {}, 'Today\'s Schedule')
    )
  );
  const viewAll = el('button', { type: 'button', className: 'caregiver-dash-view-all' }, 'Calendar');
  viewAll.addEventListener('click', () => navigate('/caregiver/calendar'));
  head.append(viewAll);
  panel.append(head);
  const syncedAt = getLatestCalendarSyncAt(events);
  if (syncedAt) {
    panel.append(
      el('p', { className: 'calendar-last-synced calendar-last-synced--panel' },
        formatCalendarLastSynced(syncedAt)
      )
    );
  }

  if (events.length === 0) {
    panel.append(el('p', { className: 'caregiver-dash-empty' }, 'No events scheduled today.'));
    return panel;
  }

  const list = el('div', { className: 'caregiver-dash-list' });
  for (const event of events) {
    list.append(renderDashboardScheduleEventRow(event));
  }
  panel.append(list);
  return panel;
}
