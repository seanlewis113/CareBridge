import { api } from '../../shared/api';
import { renderAdminShell } from '../shared/shell';
import { el, formatCurrency, formatDate, formatRelativeTime } from '../../shared/utils';
import { icon } from '../../shared/icons';
import { navigate } from '../../shared/router';
import { ensureTaskRealtime } from '../../shared/realtime';
import { sortCaregiverTasks } from '../caregiver/taskTable';
import { renderRecurringChecksSection } from '../caregiver/recurringChecks';
import { formatAction, formatActor, formatDetails } from './activity';
import { isRevertible } from '../../shared/revertActivity';
import { renderDashboardScheduleEventRow } from '../../shared/calendarViews';
import { formatCalendarLastSynced, getLatestCalendarSyncAt } from '../../shared/calendarRecurrence';
import type { ActivityLog, CalendarEvent, Task } from '../../shared/types';

export async function renderAdminDashboard(): Promise<void> {
  const refresh = () => renderAdminDashboard();

  const [tasks, events, reminders, accounts, assignments, checks, activityLogs] = await Promise.all([
    api.getTasks(),
    api.getUpcomingEvents(3),
    api.getReminders(),
    api.getFinancialAccounts(),
    api.getTaskAssignments(),
    api.getRecurringChecksWithStatus(),
    api.getActivityLogs(50).catch(() => [] as ActivityLog[]),
  ]);

  const pendingTasks = tasks.filter((t) => t.status !== 'completed');
  const openSlots = tasks.filter(
    (t) => t.open_slot && !assignments.some((a) => a.task_id === t.id) && t.status !== 'completed'
  );
  const urgentTasks = sortCaregiverTasks(
    pendingTasks,
    { search: '', statuses: new Set(['pending', 'in_progress']), sortKey: 'due', sortDir: 'asc' }
  );
  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = events.filter((e) => e.start_at.startsWith(today));
  const uncheckedChecks = checks.filter((c) => !c.last_completion).length;
  const activeReminders = reminders.filter((r) => r.active).length;
  const chime = accounts.find((a) => a.institution.toLowerCase() === 'chime');

  const content = el('div', { className: 'admin-dashboard' });

  content.append(
    el('div', { className: 'caregiver-dash-header' },
      el('h2', {}, 'Dashboard')
    ),
    el('div', { className: 'dashboard-stats caregiver-dash-stats' },
      statCard(String(pendingTasks.length), 'Pending tasks', '/admin/tasks', 'clipboard-list'),
      statCard(
        String(openSlots.length),
        'Open slots',
        '/admin/tasks',
        'users',
        openSlots.length > 0 ? 'Need volunteers' : undefined
      ),
      statCard(String(todayEvents.length), 'Events today', '/admin/calendar', 'calendar'),
      statCard(
        String(checks.length),
        'Recurring checks',
        '/admin/checks',
        'list',
        uncheckedChecks > 0 ? `${uncheckedChecks} unchecked` : undefined
      ),
      statCard(
        activeReminders > 0 ? String(activeReminders) : '—',
        'Active reminders',
        '/admin/reminders',
        'bell'
      ),
      statCard(
        chime?.last_balance != null ? formatCurrency(chime.last_balance) : '—',
        'Chime balance',
        '/admin/finance',
        'dollar-sign'
      )
    )
  );

  if (openSlots.length > 0) {
    const names = openSlots.slice(0, 2).map((t) => t.title).join(', ');
    const extra = openSlots.length > 2 ? ` +${openSlots.length - 2} more` : '';
    content.append(
      el('div', { className: 'admin-dash-alert' },
        icon('users'),
        el('span', {},
          el('strong', {}, `${openSlots.length} open slot${openSlots.length === 1 ? '' : 's'}: `),
          `${names}${extra}`
        )
      )
    );
  }

  const grid = el('div', { className: 'caregiver-dash-grid admin-dash-grid' },
    renderSchedulePanel(todayEvents),
    renderTaskPanel(urgentTasks),
    await renderRecurringChecksSection(refresh, {
      compact: true,
      max: 4,
      readOnly: true,
      viewAllPath: '/admin/checks',
      viewAllLabel: 'Manage',
    }),
    renderActivityPanel(activityLogs.filter(isRevertible).slice(0, 5))
  );
  content.append(grid);

  renderAdminShell(content, '/admin');
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
  viewAll.addEventListener('click', () => navigate('/admin/calendar'));
  head.append(viewAll);
  panel.append(head);
  panel.append(
    el('p', { className: 'calendar-last-synced calendar-last-synced--panel' },
      formatCalendarLastSynced(getLatestCalendarSyncAt(events))
    )
  );

  if (events.length === 0) {
    panel.append(el('p', { className: 'caregiver-dash-empty' }, 'No events scheduled today.'));
    return panel;
  }

  const list = el('div', { className: 'caregiver-dash-list' });
  for (const event of events.slice(0, 5)) {
    list.append(renderDashboardScheduleEventRow(event));
  }
  panel.append(list);
  return panel;
}

function renderTaskPanel(tasks: Task[]): HTMLElement {
  const panel = el('section', { className: 'card caregiver-dash-panel' });
  const head = el('div', { className: 'caregiver-dash-panel-head' },
    el('div', { className: 'card-header' },
      el('div', { className: 'card-header-icon' }, icon('clipboard-list')),
      el('h3', {}, 'Priority Tasks')
    )
  );
  const viewAll = el('button', { type: 'button', className: 'caregiver-dash-view-all' }, 'View all');
  viewAll.addEventListener('click', () => navigate('/admin/tasks'));
  head.append(viewAll);
  panel.append(head);

  if (tasks.length === 0) {
    panel.append(el('p', { className: 'caregiver-dash-empty' }, 'All tasks are complete.'));
    return panel;
  }

  const list = el('div', { className: 'caregiver-dash-list' });
  for (const task of tasks.slice(0, 5)) {
    const title = el('button', {
      type: 'button',
      className: 'caregiver-dash-row-title caregiver-dash-row-title-btn',
    }, task.title);
    title.addEventListener('click', () => navigate('/admin/tasks'));

    const metaClass = task.status === 'in_progress'
      ? 'caregiver-dash-row-meta caregiver-dash-row-meta--warn'
      : 'caregiver-dash-row-meta';
    const metaLabel = task.status === 'in_progress' ? 'In progress' : (task.due_at ? formatDate(task.due_at) : '—');

    list.append(
      el('div', { className: 'caregiver-dash-row' },
        title,
        el('span', { className: metaClass }, metaLabel)
      )
    );
  }
  panel.append(list);
  return panel;
}

function renderActivityPanel(logs: ActivityLog[]): HTMLElement {
  const panel = el('section', { className: 'card caregiver-dash-panel' });
  const head = el('div', { className: 'caregiver-dash-panel-head' },
    el('div', { className: 'card-header' },
      el('div', { className: 'card-header-icon' }, icon('activity')),
      el('h3', {}, 'Recent Activity')
    )
  );
  const viewAll = el('button', { type: 'button', className: 'caregiver-dash-view-all' }, 'View all');
  viewAll.addEventListener('click', () => navigate('/admin/activity'));
  head.append(viewAll);
  panel.append(head);

  if (logs.length === 0) {
    panel.append(el('p', { className: 'caregiver-dash-empty' }, 'No revertible activity right now.'));
    return panel;
  }

  const list = el('div', { className: 'caregiver-dash-list admin-dash-activity-list' });
  for (const log of logs) {
    list.append(
      el('div', { className: 'caregiver-dash-row admin-dash-activity-row' },
        el('span', { className: 'admin-dash-activity-action' }, formatAction(log.action)),
        el('span', { className: 'admin-dash-activity-detail' }, formatDetails(log)),
        el('span', { className: 'caregiver-dash-row-meta' }, formatActor(log)),
        el('span', { className: 'caregiver-dash-time admin-dash-activity-time' }, formatRelativeTime(log.created_at))
      )
    );
  }
  panel.append(list);
  return panel;
}
