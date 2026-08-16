import { api } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderAdminShell } from '../shared/shell';
import { createClockPickerField } from '../../shared/clock-picker';
import { el, formatDate, showModal, confirmDialog } from '../../shared/utils';
import { PERSONA_LABELS, type Task, type Profile, type Persona, type TaskAssignment } from '../../shared/types';
import { getTaskAssigneeIds } from '../../shared/taskAssignments';
export async function renderAdminTasks(): Promise<void> {
  const [tasks, profiles, assignments] = await Promise.all([
    api.getTasks(),
    api.getProfiles(),
    api.getTaskAssignments(),
  ]);

  const content = el('div', {});
  content.append(
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem' },
      el('h2', {}, 'Tasks'),
      el('button', { className: 'btn btn-primary', type: 'button', id: 'new-task' }, '+ New Task')
    )
  );

  const list = el('div', { className: 'admin-task-list' });
  if (tasks.length === 0) {
    list.append(el('p', { className: 'empty-state' }, 'No tasks yet. Create one to assign to caregivers.'));
  } else {
    for (const task of tasks) {
      list.append(renderTaskCard(task, profiles, assignments, () => renderAdminTasks()));
    }
  }
  content.append(list);

  renderAdminShell(content, '/admin/tasks');

  document.getElementById('new-task')?.addEventListener('click', () => {
    const form = createTaskForm(profiles, async () => {
      close();
      await renderAdminTasks();
    });
    const close = showModal('New Task', form);
  });
}

function renderTaskCard(
  task: Task,
  profiles: Profile[],
  assignments: TaskAssignment[],
  refresh: () => void
): HTMLElement {  const assignedIds = getTaskAssigneeIds(task.id, assignments);
  const assignedNames = profiles.filter((p) => assignedIds.includes(p.id)).map((p) => p.display_name);
  const flagBadges = el('div', { className: 'task-card-flag-badges' });
  if (task.open_slot) flagBadges.append(el('span', { className: 'badge badge-pending' }, 'Open slot'));
  if (task.visit_specific) flagBadges.append(el('span', { className: 'badge task-badge-visit' }, 'Visit'));
  if (task.show_on_mother_hub) flagBadges.append(el('span', { className: 'badge badge-completed' }, 'Mom hub'));
  if (flagBadges.childElementCount === 0) {
    flagBadges.append(el('span', { className: 'card-table-muted' }, '—'));
  }

  const actions = el('div', { className: 'card-table-actions' },
    el('button', { className: 'btn btn-secondary', type: 'button' }, 'Edit'),
    el('button', { className: 'btn btn-danger', type: 'button' }, 'Delete')
  );

  actions.querySelector('.btn-secondary')?.addEventListener('click', () => {
    const form = createTaskForm(profiles, async () => { close(); await refresh(); }, task, assignedIds);
    const close = showModal('Edit Task', form);
  });

  actions.querySelector('.btn-danger')?.addEventListener('click', async () => {
    if (await confirmDialog('Delete this task?')) {
      await api.deleteTask(task.id);
      await refresh();
    }
  });

  const header = el('div', { className: 'task-card-header' },
    el('h3', { className: 'task-card-title' }, task.title),
    actions
  );

  const cardChildren: HTMLElement[] = [header];

  if (task.description) {
    cardChildren.push(el('p', { className: 'task-card-description' }, task.description));
  }

  const table = el('div', { className: 'card-table task-card-table' },
    el('div', { className: 'card-table-header' },
      el('div', { className: 'card-table-row card-table-row--admin-task' },
        el('span', {}, 'Status'),
        el('span', {}, 'Assigned'),
        el('span', {}, 'Due'),
        el('span', {}, 'Flags')
      )
    ),
    el('div', { className: 'card-table-body' },
      el('div', { className: 'card-table-row card-table-row--admin-task' },
        el('span', {},
          el('span', { className: `badge badge-${task.status === 'completed' ? 'completed' : 'pending'}` }, task.status)
        ),
        el('span', {},
          assignedNames.length > 0
            ? assignedNames.join(', ')
            : el('span', { className: 'card-table-muted' }, 'Unassigned')
        ),
        el('span', {},          task.due_at
            ? formatDate(task.due_at)
            : el('span', { className: 'card-table-muted' }, '—')
        ),
        el('span', {}, flagBadges)
      )
    )
  );
  cardChildren.push(table);

  if (task.checklist.length > 0) {
    const checklist = el('div', { className: 'task-card-checklist' });
    for (const item of task.checklist) {
      checklist.append(
        el('div', { className: 'checklist-item checklist-item--compact' },
          el('input', { type: 'checkbox', checked: item.done ? 'true' : undefined, disabled: 'true' }),
          item.text
        )
      );
    }
    cardChildren.push(checklist);
  }

  return el('div', { className: 'card task-card' }, ...cardChildren);
}

function createTaskForm(
  profiles: Profile[],
  onSuccess: () => void,
  existing?: Task,
  assignedIds: string[] = []
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
  form.append(errorEl, el('button', { className: 'btn btn-primary btn-block', type: 'submit' }, existing ? 'Save' : 'Create Task'));

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
