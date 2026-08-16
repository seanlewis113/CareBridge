import { api } from '../../shared/api';
import { navigate } from '../../shared/router';
import { icon } from '../../shared/icons';
import { el, formatDate, showModal } from '../../shared/utils';
import type { Task } from '../../shared/types';

export type CaregiverTaskSortKey = 'title' | 'status' | 'due';

export interface CaregiverTaskListState {
  search: string;
  statuses: Set<Task['status']>;
  sortKey: CaregiverTaskSortKey;
  sortDir: 'asc' | 'desc';
}

export const DEFAULT_CAREGIVER_VISIBLE_STATUSES = new Set<Task['status']>(['pending', 'in_progress']);

export const DEFAULT_CAREGIVER_TASK_LIST_STATE: CaregiverTaskListState = {
  search: '',
  statuses: new Set(DEFAULT_CAREGIVER_VISIBLE_STATUSES),
  sortKey: 'due',
  sortDir: 'asc',
};

const TASK_STATUSES: Task['status'][] = ['pending', 'in_progress', 'completed'];

const STATUS_FILTER_LABELS: Record<Task['status'], string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
};

const STATUS_ORDER: Record<Task['status'], number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
};

export interface CaregiverTaskRowOptions {
  profileId?: string;
  refresh: () => void | Promise<void>;
  showClaim?: boolean;
  isUnassigned?: boolean;
}

export function statusesMatchCaregiverDefault(statuses: Set<Task['status']>): boolean {
  if (statuses.size !== DEFAULT_CAREGIVER_VISIBLE_STATUSES.size) return false;
  for (const status of DEFAULT_CAREGIVER_VISIBLE_STATUSES) {
    if (!statuses.has(status)) return false;
  }
  return true;
}

export function filterCaregiverTasks(tasks: Task[], state: CaregiverTaskListState): Task[] {
  const query = state.search.trim().toLowerCase();
  return tasks.filter((task) => {
    if (!state.statuses.has(task.status)) return false;
    if (!query) return true;
    const haystack = [task.title, task.description ?? ''].join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

export function sortCaregiverTasks(tasks: Task[], state: CaregiverTaskListState): Task[] {
  const sorted = [...tasks];
  const dir = state.sortDir === 'asc' ? 1 : -1;

  sorted.sort((a, b) => {
    switch (state.sortKey) {
      case 'title':
        return dir * a.title.localeCompare(b.title);
      case 'status':
        return dir * (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
      case 'due':
        const aDue = a.due_at ?? '';
        const bDue = b.due_at ?? '';
        if (!aDue && !bDue) return 0;
        if (!aDue) return 1;
        if (!bDue) return -1;
        return dir * aDue.localeCompare(bDue);
      default:
        return 0;
    }
  });

  return sorted;
}

export function renderCaregiverTaskToolbar(
  state: CaregiverTaskListState,
  hasActiveFilters: boolean,
  onChange: (patch: Partial<CaregiverTaskListState>) => void
): HTMLElement {
  const search = el('input', {
    type: 'search',
    className: 'admin-task-filter-input',
    placeholder: 'Search tasks…',
    value: state.search,
    'aria-label': 'Search tasks',
  }) as HTMLInputElement;
  search.addEventListener('input', () => onChange({ search: search.value }));

  const statusToggles = el('div', {
    className: 'admin-task-status-toggles',
    role: 'group',
    'aria-label': 'Filter by status',
  });
  for (const status of TASK_STATUSES) {
    const active = state.statuses.has(status);
    const btn = el('button', {
      type: 'button',
      className: active ? 'active' : '',
      'aria-pressed': String(active),
    }, STATUS_FILTER_LABELS[status]);
    btn.addEventListener('click', () => {
      const next = new Set(state.statuses);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      onChange({ statuses: next });
    });
    statusToggles.append(btn);
  }

  const clearBtn = el('button', {
    type: 'button',
    className: 'btn btn-secondary admin-task-clear-filters',
    hidden: hasActiveFilters ? undefined : 'true',
  }, 'Clear filters');
  clearBtn.addEventListener('click', () => onChange({
    search: '',
    statuses: new Set(DEFAULT_CAREGIVER_VISIBLE_STATUSES),
  }));

  return el('div', { className: 'admin-task-toolbar' }, search, statusToggles, clearBtn);
}

export function renderCaregiverTaskListSection(
  tasks: Task[],
  allTasks: Task[],
  state: CaregiverTaskListState,
  onStateChange: (patch: Partial<CaregiverTaskListState>) => void,
  rowOptions: CaregiverTaskRowOptions,
  emptyAllMessage = 'No tasks assigned to you.',
  emptyMessage = 'No tasks match your filters.'
): HTMLElement {
  const hasActiveFilters =
    state.search.trim() !== '' || !statusesMatchCaregiverDefault(state.statuses);

  const section = el('div', { className: 'admin-task-section' });

  if (allTasks.length === 0) {
    section.append(el('p', { className: 'empty-state' }, emptyAllMessage));
    return section;
  }

  const summary = el('p', { className: 'admin-task-summary card-table-muted' },
    hasActiveFilters
      ? `Showing ${tasks.length} of ${allTasks.length} tasks`
      : `${allTasks.length} task${allTasks.length === 1 ? '' : 's'}`
  );

  if (tasks.length === 0) {
    section.append(summary, el('p', { className: 'empty-state' }, emptyMessage));
    return section;
  }

  const table = el('div', { className: 'card admin-task-table' },
    el('div', { className: 'card-table' },
      el('div', { className: 'card-table-header' },
        el('div', { className: 'card-table-row card-table-row--caregiver-task' },
          renderSortHeader('title', 'Task', state, onStateChange),
          renderSortHeader('status', 'Status', state, onStateChange),
          renderSortHeader('due', 'Due', state, onStateChange),
          el('span', {}, 'Flags'),
          el('span', {}, '')
        )
      ),
      el('div', { className: 'admin-task-list card-table-body' })
    )
  );

  const body = table.querySelector('.admin-task-list')!;
  const refreshWithSort = async () => {
    await rowOptions.refresh();
  };

  for (const task of tasks) {
    body.append(renderCaregiverTaskRow(task, rowOptions, () => refreshWithSort()));
  }

  section.append(summary, table);
  return section;
}

function renderSortHeader(
  key: CaregiverTaskSortKey,
  label: string,
  state: CaregiverTaskListState,
  onChange: (patch: Partial<CaregiverTaskListState>) => void
): HTMLButtonElement {
  const active = state.sortKey === key;
  const indicator = active ? (state.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
  const btn = el('button', {
    type: 'button',
    className: `admin-task-sort-btn${active ? ' active' : ''}`,
    'aria-label': `Sort by ${label}`,
  }, `${label}${indicator}`) as HTMLButtonElement;

  btn.addEventListener('click', () => {
    if (state.sortKey === key) {
      onChange({ sortDir: state.sortDir === 'asc' ? 'desc' : 'asc' });
      return;
    }
    onChange({
      sortKey: key,
      sortDir: key === 'due' ? 'asc' : 'asc',
    });
  });

  return btn;
}

export function renderCaregiverTaskRow(
  task: Task,
  options: CaregiverTaskRowOptions,
  refresh: () => void | Promise<void>
): HTMLElement {
  const { profileId, showClaim = false, isUnassigned = false } = options;

  const flagBadges = el('div', { className: 'task-row-flag-badges' });
  if (task.open_slot) flagBadges.append(el('span', { className: 'badge badge-pending' }, 'Open slot'));
  if (task.visit_specific) flagBadges.append(el('span', { className: 'badge task-badge-visit' }, 'Visit'));
  if (flagBadges.childElementCount === 0) {
    flagBadges.append(el('span', { className: 'card-table-muted' }, '—'));
  }

  const actions = el('div', { className: 'card-table-actions' });

  if (showClaim && task.open_slot && isUnassigned) {
    const claimBtn = el('button', { className: 'btn btn-secondary', type: 'button' }, 'Claim');
    claimBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!profileId) return;
      try {
        await api.claimTask(task.id, profileId);
        await refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Unable to claim task');
      }
    });
    actions.append(claimBtn);
  } else if (task.status !== 'completed') {
    const completeBtn = el('button', { className: 'btn btn-primary', type: 'button' }, 'Mark complete');
    completeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.updateTask(task.id, { status: 'completed' });
      await refresh();
    });
    actions.append(completeBtn);
  }

  const titleCell = el('span', { className: 'admin-task-title' }, task.title);
  if (task.description) {
    titleCell.title = task.description;
  }
  if (task.checklist.length > 0) {
    const done = task.checklist.filter((c) => c.done).length;
    titleCell.append(
      el('span', { className: 'admin-task-checklist-hint card-table-muted' },
        `${done}/${task.checklist.length} checklist`
      )
    );
  }

  const statusLabel = task.status === 'in_progress' ? 'In progress' : task.status;

  const row = el('div', {
    className: 'admin-task-row card-table-row card-table-row--caregiver-task admin-task-row--clickable',
  },
    titleCell,
    el('span', {},
      el('span', { className: `badge badge-${task.status === 'completed' ? 'completed' : 'pending'}` }, statusLabel)
    ),
    el('span', {},
      task.due_at
        ? formatDate(task.due_at)
        : el('span', { className: 'card-table-muted' }, '—')
    ),
    el('span', {}, flagBadges),
    actions
  );

  row.addEventListener('click', () => openCaregiverTaskModal(task, refresh));
  return row;
}

function openCaregiverTaskModal(task: Task, refresh: () => void | Promise<void>): void {
  const body = el('div', { className: 'modal-body' });

  if (task.description) {
    body.append(el('p', { className: 'caregiver-task-card-desc' }, task.description));
  }

  if (task.due_at) {
    body.append(el('p', { className: 'caregiver-task-card-due' }, `Due ${formatDate(task.due_at)}`));
  }

  if (task.checklist.length > 0) {
    const checklist = el('div', { className: 'caregiver-task-checklist' });
    for (const item of task.checklist) {
      const row = el('div', { className: 'checklist-item' });
      const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
      cb.checked = item.done;
      cb.addEventListener('change', async () => {
        const updated = task.checklist.map((c) =>
          c.id === item.id ? { ...c, done: cb.checked } : c
        );
        const allDone = updated.every((c) => c.done);
        await api.updateTask(task.id, {
          checklist: updated,
          status: allDone ? 'completed' : 'in_progress',
        });
        await refresh();
      });
      row.append(cb, item.text);
      checklist.append(row);
    }
    body.append(checklist);
  }

  if (body.childElementCount === 0) {
    body.append(el('p', { className: 'card-table-muted' }, 'No additional details.'));
  }

  showModal(task.title, body);
}

export interface CaregiverDashTaskPanelOptions {
  iconName: string;
  title: string;
  tasks: Task[];
  max?: number;
  viewAllPath?: string;
  profileId?: string;
  refresh: () => void | Promise<void>;
  showClaim?: boolean;
  isUnassigned?: (task: Task) => boolean;
  emptyText?: string;
}

export function renderCaregiverDashTaskPanel(options: CaregiverDashTaskPanelOptions): HTMLElement {
  const {
    iconName,
    title,
    tasks,
    max = 3,
    viewAllPath,
    profileId,
    refresh,
    showClaim = false,
    isUnassigned = () => true,
    emptyText = 'Nothing here.',
  } = options;

  const panel = el('section', { className: 'card caregiver-dash-panel' });
  const head = el('div', { className: 'caregiver-dash-panel-head' },
    el('div', { className: 'card-header' },
      el('div', { className: 'card-header-icon' }, icon(iconName)),
      el('h3', {}, title)
    )
  );
  if (viewAllPath && tasks.length > 0) {
    const viewAll = el('button', { type: 'button', className: 'caregiver-dash-view-all' }, 'View all');
    viewAll.addEventListener('click', () => navigate(viewAllPath));
    head.append(viewAll);
  }
  panel.append(head);

  if (tasks.length === 0) {
    panel.append(el('p', { className: 'caregiver-dash-empty' }, emptyText));
    return panel;
  }

  const list = el('div', { className: 'caregiver-dash-list' });
  for (const task of tasks.slice(0, max)) {
    list.append(renderCaregiverDashTaskRow(task, {
      profileId,
      refresh,
      showClaim,
      isUnassigned: isUnassigned(task),
    }));
  }
  panel.append(list);
  return panel;
}

function renderCaregiverDashTaskRow(
  task: Task,
  options: {
    profileId?: string;
    refresh: () => void | Promise<void>;
    showClaim?: boolean;
    isUnassigned?: boolean;
  }
): HTMLElement {
  const { profileId, refresh, showClaim = false, isUnassigned = true } = options;

  const title = el('button', {
    type: 'button',
    className: 'caregiver-dash-row-title caregiver-dash-row-title-btn',
  }, task.title);
  title.addEventListener('click', () => openCaregiverTaskModal(task, refresh));

  const meta = el('span', { className: 'caregiver-dash-row-meta' },
    task.due_at ? formatDate(task.due_at) : '—'
  );

  const row = el('div', { className: 'caregiver-dash-row' }, title, meta);

  if (showClaim && task.open_slot && isUnassigned) {
    const claimBtn = el('button', { className: 'btn btn-secondary', type: 'button' }, 'Claim');
    claimBtn.addEventListener('click', async () => {
      if (!profileId) return;
      try {
        await api.claimTask(task.id, profileId);
        await refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Unable to claim task');
      }
    });
    row.append(claimBtn);
  } else if (task.status !== 'completed') {
    const completeBtn = el('button', { className: 'btn btn-primary', type: 'button' }, 'Done');
    completeBtn.addEventListener('click', async () => {
      await api.updateTask(task.id, { status: 'completed' });
      await refresh();
    });
    row.append(completeBtn);
  }

  return row;
}
