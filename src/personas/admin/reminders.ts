import { api } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderAdminShell } from '../shared/shell';
import { el, showModal, confirmDialog } from '../../shared/utils';
import type { Reminder } from '../../shared/types';

export async function renderAdminReminders(): Promise<void> {
  const reminders = await api.getReminders();
  const content = el('div', {});

  content.append(
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem' },
      el('h2', {}, 'Family Reminders'),
      el('button', { className: 'btn btn-primary', type: 'button', id: 'new-reminder' }, '+ New Reminder')
    ),
    el('p', { style: 'color:var(--color-text-muted);margin-bottom:1rem' },
      'Reminders marked "Show on Mom\'s hub" appear on her tablet.'
    )
  );

  if (reminders.length === 0) {
    content.append(el('p', { className: 'empty-state' }, 'No reminders yet.'));
  } else {
    content.append(renderRemindersTable(reminders, () => renderAdminReminders()));
  }

  renderAdminShell(content, '/admin/reminders');

  document.getElementById('new-reminder')?.addEventListener('click', () => {
    const form = createReminderForm(async () => { close(); await renderAdminReminders(); });
    const close = showModal('New Reminder', form);
  });
}

function renderRemindersTable(reminders: Reminder[], refresh: () => void | Promise<void>): HTMLElement {
  const body = el('div', { className: 'admin-reminder-list card-table-body' });
  for (const reminder of reminders) {
    body.append(renderReminderRow(reminder, refresh));
  }

  return el('div', { className: 'card admin-reminder-table' },
    el('div', { className: 'card-table' },
      el('div', { className: 'card-table-header' },
        el('div', { className: 'card-table-row card-table-row--admin-reminder' },
          el('span', { className: 'card-table-label' }, 'Reminder'),
          el('span', { className: 'card-table-label' }, 'Flags'),
          el('span', { className: 'card-table-label' }, '')
        )
      ),
      body
    )
  );
}

function renderReminderRow(reminder: Reminder, refresh: () => void | Promise<void>): HTMLElement {
  const flags = el('div', { className: 'task-row-flag-badges' });
  flags.append(
    el('span', { className: `badge ${reminder.priority === 'high' ? 'badge-high' : ''}` }, reminder.priority)
  );
  if (reminder.show_on_mother_hub) {
    flags.append(el('span', { className: 'badge badge-completed' }, 'On Mom\'s hub'));
  }
  if (!reminder.active) {
    flags.append(el('span', { className: 'badge admin-rx-inactive-badge' }, 'Inactive'));
  }

  const editBtn = el('button', { className: 'btn btn-secondary', type: 'button' }, 'Edit');
  const deleteBtn = el('button', { className: 'btn btn-danger', type: 'button' }, 'Delete');
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const form = createReminderForm(async () => { close(); await refresh(); }, reminder);
    const close = showModal('Edit Reminder', form);
  });
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (await confirmDialog('Delete this reminder?')) {
      await api.deleteReminder(reminder.id);
      await refresh();
    }
  });

  const row = el('div', { className: 'admin-reminder-row card-table-row card-table-row--admin-reminder admin-task-row--clickable' },
    el('span', { className: 'admin-task-title' }, reminder.body),
    el('span', {}, flags),
    el('span', { className: 'card-table-actions' }, editBtn, deleteBtn)
  );

  row.addEventListener('click', () => {
    const form = createReminderForm(async () => { close(); await refresh(); }, reminder);
    const close = showModal('Edit Reminder', form);
  });

  return row;
}

function createReminderForm(onSuccess: () => void, existing?: Reminder): HTMLElement {
  const session = getSession();
  const form = el('form', { className: 'modal-body task-form' });

  form.append(
    el('div', { className: 'form-group' },
      el('label', { for: 'rem-body' }, 'Reminder text'),
      el('textarea', { id: 'rem-body', required: 'true' }, existing?.body ?? '')
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'rem-priority' }, 'Priority'),
      el('select', { id: 'rem-priority' },
        el('option', { value: 'low', selected: existing?.priority === 'low' ? 'true' : undefined }, 'Low'),
        el('option', { value: 'normal', selected: !existing || existing.priority === 'normal' ? 'true' : undefined }, 'Normal'),
        el('option', { value: 'high', selected: existing?.priority === 'high' ? 'true' : undefined }, 'High'),
      )
    ),
    el('div', { className: 'task-form-options' },
      el('label', { className: 'task-toggle-row', for: 'rem-hub' },
        el('input', { type: 'checkbox', id: 'rem-hub', checked: existing?.show_on_mother_hub !== false ? 'true' : undefined }),
        el('span', {}, 'Show on Mom\'s hub')
      ),
      el('label', { className: 'task-toggle-row', for: 'rem-active' },
        el('input', { type: 'checkbox', id: 'rem-active', checked: existing?.active !== false ? 'true' : undefined }),
        el('span', {}, 'Active')
      )
    ),
    el('button', { className: 'btn btn-primary btn-block', type: 'submit' }, existing ? 'Save' : 'Create')
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      body: (form.querySelector('#rem-body') as HTMLTextAreaElement).value.trim(),
      priority: (form.querySelector('#rem-priority') as HTMLSelectElement).value as Reminder['priority'],
      show_on_mother_hub: (form.querySelector('#rem-hub') as HTMLInputElement).checked,
      active: (form.querySelector('#rem-active') as HTMLInputElement).checked,
      created_by: session.profile?.id ?? null,
    };

    if (existing) {
      await api.updateReminder(existing.id, data);
    } else {
      await api.createReminder(data);
    }
    onSuccess();
  });

  return form;
}
