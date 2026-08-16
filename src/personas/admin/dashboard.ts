import { api } from '../../shared/api';
import { renderAdminShell } from '../shared/shell';
import { el, formatCurrency, formatDate, emptyState } from '../../shared/utils';
import { icon } from '../../shared/icons';
import { navigate } from '../../shared/router';

export async function renderAdminDashboard(): Promise<void> {
  const [tasks, events, reminders, accounts, visitNotes, assignments] = await Promise.all([
    api.getTasks(),
    api.getUpcomingEvents(7),
    api.getReminders(),
    api.getFinancialAccounts(),
    api.getVisitNotes(),
    api.getTaskAssignments(),
  ]);

  const pendingTasks = tasks.filter((t) => t.status !== 'completed');
  const openSlots = tasks.filter(
    (t) => t.open_slot && !assignments.some((a) => a.task_id === t.id)
  );
  const chime = accounts.find((a) => a.institution.toLowerCase() === 'chime');

  const content = el('div', {});

  content.append(el('h2', {}, 'Dashboard'));

  const stats = el('div', { className: 'dashboard-stats' },
    statCard(String(pendingTasks.length), 'Pending tasks', '/admin/tasks', 'clipboard-list'),
    statCard(String(events.length), 'Events this week', '/admin/calendar', 'calendar'),
    statCard(String(reminders.filter((r) => r.active).length), 'Active reminders', '/admin/reminders', 'bell'),
    statCard(chime?.last_balance != null ? formatCurrency(chime.last_balance) : '—', 'Chime balance', '/admin/finance', 'dollar-sign')
  );
  content.append(stats);

  const quickActions = el('div', { className: 'quick-actions' });
  const actions = [
    { label: '+ New Task', path: '/admin/tasks', primary: true },
    { label: '+ Reminder', path: '/admin/reminders', primary: true },
    { label: 'Calendar', path: '/admin/calendar', primary: false },
    { label: 'Financials', path: '/admin/finance', primary: false },
  ];
  for (const action of actions) {
    const btn = el('button', {
      className: `btn ${action.primary ? 'btn-primary' : 'btn-secondary'}`,
      type: 'button',
    }, action.label);
    btn.addEventListener('click', () => navigate(action.path));
    quickActions.append(btn);
  }
  content.append(quickActions);

  if (openSlots.length > 0) {
    const openSection = el('section', { className: 'card card-accent-warning', style: 'margin-bottom:1rem' },
      el('div', { className: 'card-header' },
        el('div', { className: 'card-header-icon' }, icon('users')),
        el('h3', {}, 'Open slots needing volunteers')
      )
    );
    for (const task of openSlots) {
      openSection.append(el('p', {}, `${task.title} — due ${task.due_at ? formatDate(task.due_at) : 'soon'}`));
    }
    content.append(openSection);
  }

  const recentNotes = el('section', { className: 'card' },
    el('div', { className: 'card-header' },
      el('div', { className: 'card-header-icon' }, icon('file-text')),
      el('h3', {}, 'Recent visit notes')
    )
  );
  if (visitNotes.length === 0) {
    recentNotes.append(emptyState(
      icon('inbox'),
      'No visit notes yet',
      'Notes from caregivers will appear here.'
    ));
  } else {
    for (const note of visitNotes.slice(0, 3)) {
      recentNotes.append(
        el('div', { className: 'visit-note-card' },
          el('p', { className: 'visit-note-meta' },
            `${formatDate(note.visit_date)} — ${note.author?.display_name ?? 'Caregiver'}`
          ),
          el('p', {}, note.notes ?? note.concerns ?? 'Visit logged.')
        )
      );
    }
  }
  content.append(recentNotes);

  renderAdminShell(content, '/admin');
}

function statCard(value: string, label: string, path: string, iconName: 'clipboard-list' | 'calendar' | 'bell' | 'dollar-sign'): HTMLElement {
  const card = el('button', { type: 'button', className: 'stat-card stat-card-link' },
    el('div', { className: 'stat-card-header' },
      el('div', { className: 'stat-card-icon' }, icon(iconName))
    ),
    el('div', { className: 'value' }, value),
    el('div', { className: 'label' }, label)
  );
  card.addEventListener('click', () => navigate(path));
  return card;
}
