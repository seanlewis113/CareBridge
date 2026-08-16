import { api } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderAdminShell } from '../shared/shell';
import { createClockPickerField } from '../../shared/clock-picker';
import { el, formatDate, showModal, confirmDialog } from '../../shared/utils';
import { PERSONA_LABELS, type Task, type Profile, type Persona, type TaskAssignment } from '../../shared/types';
import { getTaskAssigneeIds } from '../../shared/taskAssignments';

type TaskFlagFilter = 'all' | 'open_slot' | 'visit' | 'mom_hub';
type TaskSortKey = 'title' | 'status' | 'assigned' | 'due' | 'created';

const TASK_STATUSES: Task['status'][] = ['pending', 'in_progress', 'completed'];
const DEFAULT_VISIBLE_STATUSES = new Set<Task['status']>(['pending', 'in_progress']);

const STATUS_FILTER_LABELS: Record<Task['status'], string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
};

interface TaskListState {
  search: string;
  statuses: Set<Task['status']>;
  assignee: 'all' | 'unassigned' | string;
  flag: TaskFlagFilter;
  sortKey: TaskSortKey;
  sortDir: 'asc' | 'desc';
}

const DEFAULT_TASK_LIST_STATE: TaskListState = {
  search: '',
  statuses: new Set(DEFAULT_VISIBLE_STATUSES),
  assignee: 'all',
  flag: 'all',
  sortKey: 'due',
  sortDir: 'asc',
};

const STATUS_ORDER: Record<Task['status'], number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
};

export async function renderAdminTasks(): Promise<void> {
  let listState: TaskListState = {
    ...DEFAULT_TASK_LIST_STATE,
    statuses: new Set(DEFAULT_VISIBLE_STATUSES),
  };
  const content = el('div', {});

  const render = async () => {
    const [tasks, profiles, assignments] = await Promise.all([
      api.getTasks(),
      api.getProfiles(),
      api.getTaskAssignments(),
    ]);

    const filtered = filterTasks(tasks, listState, assignments);
    const sorted = sortTasks(filtered, listState, profiles, assignments);
    const hasActiveFilters =
      listState.search.trim() !== '' ||
      !statusesMatchDefault(listState.statuses) ||
      listState.assignee !== 'all' ||
      listState.flag !== 'all';

    const listSection = el('div', { className: 'admin-task-section' });
    if (tasks.length === 0) {
      listSection.append(el('p', { className: 'empty-state' }, 'No tasks yet. Create one to assign to caregivers.'));
    } else {
      const summary = el('p', { className: 'admin-task-summary card-table-muted' },
        hasActiveFilters
          ? `Showing ${sorted.length} of ${tasks.length} tasks`
          : `${tasks.length} task${tasks.length === 1 ? '' : 's'}`
      );

      if (sorted.length === 0) {
        listSection.append(
          summary,
          el('p', { className: 'empty-state' }, 'No tasks match your filters.')
        );
      } else {
        const table = el('div', { className: 'card admin-task-table' },
          el('div', { className: 'card-table' },
            el('div', { className: 'card-table-header' },
              el('div', { className: 'card-table-row card-table-row--admin-task' },
                renderSortHeader('title', 'Task', listState, updateState),
                renderSortHeader('status', 'Status', listState, updateState),
                renderSortHeader('assigned', 'Assigned', listState, updateState),
                renderSortHeader('due', 'Due', listState, updateState),
                el('span', {}, 'Flags'),
                el('span', {}, '')
              )
            ),
            el('div', { className: 'admin-task-list card-table-body' })
          )
        );
        const body = table.querySelector('.admin-task-list')!;
        for (const task of sorted) {
          body.append(renderTaskRow(task, profiles, assignments, render));
        }
        listSection.append(summary, table);
      }
    }

    const newTaskBtn = el('button', { className: 'btn btn-primary', type: 'button' }, '+ New Task');
    newTaskBtn.addEventListener('click', () => {
      const form = createTaskForm(profiles, async () => { close(); await render(); });
      const close = showModal('New Task', form);
    });

    content.replaceChildren(
      el('div', { className: 'admin-task-page-header' },
        el('h2', {}, 'Tasks'),
        newTaskBtn
      ),
      renderTaskToolbar(listState, profiles, hasActiveFilters, updateState),
      listSection
    );
  };

  function updateState(patch: Partial<TaskListState>): void {
    listState = { ...listState, ...patch };
    void render();
  }

  await render();
  renderAdminShell(content, '/admin/tasks');
}

function renderTaskToolbar(
  state: TaskListState,
  profiles: Profile[],
  hasActiveFilters: boolean,
  onChange: (patch: Partial<TaskListState>) => void
): HTMLElement {
  const search = el('input', {
    type: 'search',
    className: 'admin-task-filter-input',
    placeholder: 'Search tasks…',
    value: state.search,
    'aria-label': 'Search tasks',
  }) as HTMLInputElement;
  search.addEventListener('input', () => onChange({ search: search.value }));

  const statusToggles = el('div', { className: 'admin-task-status-toggles', role: 'group', 'aria-label': 'Filter by status' });
  for (const status of TASK_STATUSES) {
    const active = state.statuses.has(status);
    const btn = el('button', {
      type: 'button',
      className: active ? 'active' : '',
      'aria-pressed': active ? 'true' : 'false',
    }, STATUS_FILTER_LABELS[status]);
    btn.addEventListener('click', () => {
      const next = new Set(state.statuses);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      onChange({ statuses: next });
    });
    statusToggles.append(btn);
  }

  const assignee = el('select', { className: 'admin-task-filter-select', 'aria-label': 'Filter by assignee' },
    el('option', { value: 'all' }, 'All assignees'),
    el('option', { value: 'unassigned' }, 'Unassigned')
  ) as HTMLSelectElement;
  for (const profile of profiles.filter((p) => p.persona !== 'mother')) {
    assignee.append(el('option', { value: profile.id }, profile.display_name));
  }
  assignee.value = state.assignee;
  assignee.addEventListener('change', () => onChange({ assignee: assignee.value }));

  const flag = el('select', { className: 'admin-task-filter-select', 'aria-label': 'Filter by flag' },
    el('option', { value: 'all' }, 'All flags'),
    el('option', { value: 'open_slot' }, 'Open slot'),
    el('option', { value: 'visit' }, 'Visit'),
    el('option', { value: 'mom_hub' }, 'Mom hub')
  ) as HTMLSelectElement;
  flag.value = state.flag;
  flag.addEventListener('change', () => onChange({ flag: flag.value as TaskFlagFilter }));

  const toolbar = el('div', { className: 'admin-task-toolbar' },
    search,
    statusToggles,
    assignee,
    flag
  );

  const clearBtn = el('button', {
    type: 'button',
    className: 'btn btn-secondary admin-task-clear-filters',
    disabled: hasActiveFilters ? undefined : 'true',
    'aria-disabled': hasActiveFilters ? 'false' : 'true',
  }, 'Clear filters');
  clearBtn.addEventListener('click', () => onChange({
    search: '',
    statuses: new Set(DEFAULT_VISIBLE_STATUSES),
    assignee: 'all',
    flag: 'all',
  }));
  toolbar.append(clearBtn);

  return toolbar;
}

function renderSortHeader(
  key: TaskSortKey,
  label: string,
  state: TaskListState,
  onChange: (patch: Partial<TaskListState>) => void
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
      sortDir: key === 'due' || key === 'created' ? 'desc' : 'asc',
    });
  });

  return btn;
}

function filterTasks(
  tasks: Task[],
  state: TaskListState,
  assignments: TaskAssignment[]
): Task[] {
  const query = state.search.trim().toLowerCase();

  return tasks.filter((task) => {
    if (!state.statuses.has(task.status)) return false;

    const assignedIds = getTaskAssigneeIds(task.id, assignments);
    if (state.assignee === 'unassigned' && assignedIds.length > 0) return false;
    if (state.assignee !== 'all' && state.assignee !== 'unassigned' && !assignedIds.includes(state.assignee)) {
      return false;
    }

    if (state.flag === 'open_slot' && !task.open_slot) return false;
    if (state.flag === 'visit' && !task.visit_specific) return false;
    if (state.flag === 'mom_hub' && !task.show_on_mother_hub) return false;

    if (query) {
      const haystack = `${task.title} ${task.description ?? ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

function statusesMatchDefault(statuses: Set<Task['status']>): boolean {
  if (statuses.size !== DEFAULT_VISIBLE_STATUSES.size) return false;
  for (const status of DEFAULT_VISIBLE_STATUSES) {
    if (!statuses.has(status)) return false;
  }
  return true;
}

function sortTasks(
  tasks: Task[],
  state: TaskListState,
  profiles: Profile[],
  assignments: TaskAssignment[]
): Task[] {
  const dir = state.sortDir === 'asc' ? 1 : -1;

  const assigneeLabel = (task: Task): string => {
    const ids = getTaskAssigneeIds(task.id, assignments);
    const names = profiles
      .filter((p) => ids.includes(p.id))
      .map((p) => p.display_name)
      .sort((a, b) => a.localeCompare(b));
    return names[0] ?? '';
  };

  return [...tasks].sort((a, b) => {
    let cmp = 0;

    switch (state.sortKey) {
      case 'title':
        cmp = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
        break;
      case 'status':
        cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        break;
      case 'assigned':
        cmp = assigneeLabel(a).localeCompare(assigneeLabel(b), undefined, { sensitivity: 'base' });
        break;
      case 'due': {
        const aDue = a.due_at ? new Date(a.due_at).getTime() : null;
        const bDue = b.due_at ? new Date(b.due_at).getTime() : null;
        if (aDue === null && bDue === null) cmp = 0;
        else if (aDue === null) cmp = 1;
        else if (bDue === null) cmp = -1;
        else cmp = aDue - bDue;
        break;
      }
      case 'created':
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        break;
    }

    if (cmp !== 0) return cmp * dir;
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  });
}

function openTaskEditorModal(
  task: Task,
  profiles: Profile[],
  assignedIds: string[],
  refresh: () => void | Promise<void>
): void {
  const form = createTaskForm(
    profiles,
    async () => { close(); await refresh(); },
    task,
    assignedIds,
    async () => {
      if (!await confirmDialog('Delete this task?')) return;
      await api.deleteTask(task.id);
      close();
      await refresh();
    }
  );
  const close = showModal('Edit Task', form);
}

function renderTaskRow(
  task: Task,
  profiles: Profile[],
  assignments: TaskAssignment[],
  refresh: () => void | Promise<void>
): HTMLElement {
  const assignedIds = getTaskAssigneeIds(task.id, assignments);
  const assignedNames = profiles.filter((p) => assignedIds.includes(p.id)).map((p) => p.display_name);
  const flagBadges = el('div', { className: 'task-row-flag-badges' });
  if (task.open_slot) flagBadges.append(el('span', { className: 'badge badge-pending' }, 'Open slot'));
  if (task.visit_specific) flagBadges.append(el('span', { className: 'badge task-badge-visit' }, 'Visit'));
  if (task.show_on_mother_hub) flagBadges.append(el('span', { className: 'badge badge-completed' }, 'Mom hub'));
  if (flagBadges.childElementCount === 0) {
    flagBadges.append(el('span', { className: 'card-table-muted' }, '—'));
  }

  const actions = el('div', { className: 'card-table-actions' });
  if (task.status !== 'completed') {
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

  const row = el('div', { className: 'admin-task-row card-table-row card-table-row--admin-task admin-task-row--clickable' },
    titleCell,
    el('span', {},
      el('span', { className: `badge badge-${task.status === 'completed' ? 'completed' : 'pending'}` }, statusLabel)
    ),
    el('span', {},
      assignedNames.length > 0
        ? assignedNames.join(', ')
        : el('span', { className: 'card-table-muted' }, 'Unassigned')
    ),
    el('span', {},
      task.due_at
        ? formatDate(task.due_at)
        : el('span', { className: 'card-table-muted' }, '—')
    ),
    el('span', {}, flagBadges),
    actions
  );
  row.addEventListener('click', () => openTaskEditorModal(task, profiles, assignedIds, refresh));
  return row;
}

function createTaskForm(
  profiles: Profile[],
  onSuccess: () => void,
  existing?: Task,
  assignedIds: string[] = [],
  onDelete?: () => void | Promise<void>
): HTMLElement {
  const session = getSession();
  const form = el('form', { className: 'modal-body task-form' });

  const dueDateValue = existing?.due_at?.slice(0, 10) ?? '';
  const dueTimeValue = existing?.due_at?.slice(11, 16) ?? '';

  const optionsGroup = el('div', { className: 'task-form-options' },
    toggleField('Visit-specific task', 'task-visit', existing?.visit_specific ?? false),
    toggleField('Open slot (anyone can claim)', 'task-open', existing?.open_slot ?? false),
    toggleField('Show on mother dashboard', 'task-mother-hub', existing?.show_on_mother_hub !== false),
  );
  const dueFieldsRow = el(
    'div',
    { className: 'task-form-due-row' },
    field('Date', 'date', 'task-due-date', dueDateValue),
    createClockPickerField('Due time', { id: 'task-due-time', value: dueTimeValue }).group,
  );

  form.append(
    field('Title', 'text', 'task-title', existing?.title ?? '', true),
    field('Description', 'textarea', 'task-desc', existing?.description ?? ''),
    dueFieldsRow,
    optionsGroup,
  );

  const assignGroup = el('div', { className: 'form-group caregiver-select-group' },
    el('label', { for: 'task-assign' }, 'Assign to'),
    el('button', { type: 'button', id: 'task-assign-toggle', className: 'caregiver-select-toggle' }, 'Select people'),
    el('div', { id: 'task-assign-menu', className: 'caregiver-select-menu', hidden: 'true' }),
    el('small', { className: 'input-hint' }, 'Choose one or more people. Their names appear on Mom\'s dashboard.')
  );
  const assignToggle = assignGroup.querySelector('#task-assign-toggle') as HTMLButtonElement;
  const assignMenu = assignGroup.querySelector('#task-assign-menu') as HTMLDivElement;
  const caregivers = profiles.filter((p) => p.persona !== 'mother');
  const selectedCaregiverIds = new Set(assignedIds);

  const updateAssignLabel = () => {    if (selectedCaregiverIds.size === 0) {
      assignToggle.textContent = 'Select people';
      return;
    }
    const names = caregivers
      .filter((p) => selectedCaregiverIds.has(p.id))
      .map((p) => p.display_name);
    assignToggle.textContent = `${names.length} selected: ${names.join(', ')}`;
  };

  assignToggle.addEventListener('click', () => {
    const isOpen = !assignMenu.hidden;
    assignMenu.hidden = isOpen;
    assignToggle.classList.toggle('open', !isOpen);
  });

  form.addEventListener('click', (event) => {
    if (!assignGroup.contains(event.target as Node)) {
      assignMenu.hidden = true;
      assignToggle.classList.remove('open');
    }
  });

  for (const p of caregivers) {
    const row = el(
      'label',
      { className: 'caregiver-select-option' },
      el('input', { type: 'checkbox', value: p.id, checked: assignedIds.includes(p.id) ? 'true' : undefined }),
      el('span', {}, formatUserOptionLabel(p))
    );
    const checkbox = row.querySelector('input') as HTMLInputElement;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedCaregiverIds.add(p.id);
      } else {
        selectedCaregiverIds.delete(p.id);
      }
      updateAssignLabel();
    });
    assignMenu.append(row);
  }
  if (caregivers.length === 0) {
    assignToggle.disabled = true;
    assignToggle.textContent = 'No people available';
  }
  updateAssignLabel();
  form.append(assignGroup);
  const checklistGroup = el('div', { className: 'form-group' },
    el('label', { for: 'task-checklist' }, 'Checklist items (one per line)'),
    el('textarea', { id: 'task-checklist', placeholder: 'Check milk\nBuy fruit' },
      existing?.checklist.map((c) => c.text).join('\n') ?? ''
    )
  );
  form.append(checklistGroup);

  const errorEl = el('p', { style: 'color:var(--color-danger);display:none' });
  const footer = el('div', { className: 'task-form-footer' },
    el('button', { className: 'btn btn-primary btn-block', type: 'submit' }, existing ? 'Save' : 'Create Task')
  );
  if (existing && onDelete) {
    const deleteBtn = el('button', { className: 'btn btn-danger btn-block', type: 'button' }, 'Delete task');
    deleteBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await onDelete();
    });
    footer.append(deleteBtn);
  }
  form.append(errorEl, footer);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = val('task-title');
    const dueDate = val('task-due-date');
    const dueTime = val('task-due-time');
    const showOnMotherHub = checked('task-mother-hub');    const isOpenSlot = checked('task-open');

    if (dueDate && !dueTime) {
      errorEl.textContent = 'Please select a due time, or clear the due date.';
      errorEl.style.display = 'block';
      return;
    }
    if (showOnMotherHub && !isOpenSlot && selectedCaregiverIds.size === 0) {      errorEl.textContent = 'Assign this task to someone, mark it as an open slot, or turn off "Show on mother dashboard".';
      errorEl.style.display = 'block';
      return;
    }
    const checklistText = val('task-checklist');
    const checklist = checklistText
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text) => ({ id: crypto.randomUUID(), text, done: false }));

    const taskData = {
      title,
      description: val('task-desc') || null,
      due_at: dueDate && dueTime
        ? new Date(`${dueDate}T${dueTime}`).toISOString()
        : null,
      visit_specific: checked('task-visit'),
      open_slot: checked('task-open'),
      show_on_mother_hub: checked('task-mother-hub'),
      status: existing?.status ?? 'pending' as const,
      checklist,
      created_by: session.profile?.id ?? null,
      claimed_by: null,
    };
    try {
      let taskId = existing?.id;
      if (existing) {
        await api.updateTask(existing.id, taskData);
      } else {
        const created = await api.createTask(taskData);
        taskId = created.id;
      }

      if (taskId) {
        const selected = [...selectedCaregiverIds];
        const currentAssignments = existing
          ? (await api.getTaskAssignments()).filter((a) => a.task_id === taskId)
          : [];

        for (const a of currentAssignments) {
          if (!selected.includes(a.profile_id)) {
            await api.unassignTask(taskId, a.profile_id);
          }
        }
        for (const profileId of selected) {
          if (!currentAssignments.some((a) => a.profile_id === profileId)) {
            await api.assignTask(taskId, profileId);
          }
        }
      }

      onSuccess();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Failed to save';
      errorEl.style.display = 'block';
    }
  });

  return form;
}

function formatUserOptionLabel(profile: Profile): string {
  const role = PERSONA_LABELS[profile.persona as Persona];
  return `${profile.display_name} (${role})`;
}

function field(label: string, type: string, id: string, value: string, required = false): HTMLElement {
  const group = el('div', { className: 'form-group' }, el('label', { for: id }, label));
  if (type === 'textarea') {
    const ta = el('textarea', { id }) as HTMLTextAreaElement;
    ta.value = value;
    group.append(ta);
  } else {
    group.append(el('input', { type, id, value, required: required ? 'true' : undefined }));
  }
  return group;
}

function toggleField(label: string, id: string, checked: boolean): HTMLElement {
  return el(
    'label',
    { className: 'task-toggle-row', for: id },
    el('input', { type: 'checkbox', id, checked: checked ? 'true' : undefined }),
    el('span', {}, label)
  );
}

function val(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  return el?.value ?? '';
}

function checked(id: string): boolean {
  return (document.getElementById(id) as HTMLInputElement)?.checked ?? false;
}
