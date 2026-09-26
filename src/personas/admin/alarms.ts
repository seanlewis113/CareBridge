import { api } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { createClockPickerField } from '../../shared/clock-picker';
import { formatMotherAlarmSchedule } from '../../shared/motherAlarms';
import { renderAdminShell } from '../shared/shell';
import { el, showModal, confirmDialog } from '../../shared/utils';
import type { MotherAlarm, MotherAlarmDay } from '../../shared/types';

const DAY_OPTIONS: { value: MotherAlarmDay; label: string }[] = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

export async function renderAdminAlarms(): Promise<void> {
  const alarms = await api.getMotherAlarms();
  const content = el('div', {});

  content.append(
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem' },
      el('h2', {}, "Mom's Alarms"),
      el('button', { className: 'btn btn-primary', type: 'button', id: 'new-alarm' }, '+ New Alarm')
    ),
    el('p', { style: 'color:var(--color-text-muted);margin-bottom:1rem' },
      'At the scheduled time, Mom\'s tablet shows a full-screen reminder she must tap to dismiss — for routines like getting dressed.'
    )
  );

  if (alarms.length === 0) {
    content.append(el('p', { className: 'empty-state' }, 'No alarms yet.'));
  } else {
    content.append(renderAlarmsTable(alarms, () => renderAdminAlarms()));
  }

  renderAdminShell(content, '/admin/alarms');

  document.getElementById('new-alarm')?.addEventListener('click', () => {
    const form = createAlarmForm(async () => { close(); await renderAdminAlarms(); });
    const close = showModal('New Alarm', form);
  });
}

function renderAlarmsTable(alarms: MotherAlarm[], refresh: () => void | Promise<void>): HTMLElement {
  const body = el('div', { className: 'admin-alarm-list card-table-body' });
  for (const alarm of alarms) {
    body.append(renderAlarmRow(alarm, refresh));
  }

  return el('div', { className: 'card admin-alarm-table' },
    el('div', { className: 'card-table' },
      el('div', { className: 'card-table-header' },
        el('div', { className: 'card-table-row card-table-row--admin-alarm' },
          el('span', { className: 'card-table-label' }, 'Alarm'),
          el('span', { className: 'card-table-label' }, 'Schedule'),
          el('span', { className: 'card-table-label' }, 'Status'),
          el('span', { className: 'card-table-label' }, '')
        )
      ),
      body
    )
  );
}

function renderAlarmRow(alarm: MotherAlarm, refresh: () => void | Promise<void>): HTMLElement {
  const status = el('div', { className: 'task-row-flag-badges' });
  status.append(
    alarm.active
      ? el('span', { className: 'badge badge-completed' }, 'Active')
      : el('span', { className: 'badge admin-rx-inactive-badge' }, 'Paused')
  );

  const editBtn = el('button', { className: 'btn btn-secondary', type: 'button' }, 'Edit');
  const deleteBtn = el('button', { className: 'btn btn-danger', type: 'button' }, 'Delete');

  const openEdit = () => {
    const form = createAlarmForm(async () => { close(); await refresh(); }, alarm);
    const close = showModal('Edit Alarm', form);
  };

  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openEdit();
  });
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (await confirmDialog('Delete this alarm?')) {
      await api.deleteMotherAlarm(alarm.id);
      await refresh();
    }
  });

  const row = el('div', {
    className: 'admin-alarm-row card-table-row card-table-row--admin-alarm admin-task-row--clickable',
  },
    el('div', {},
      el('span', { className: 'admin-task-title' }, alarm.title),
      alarm.message
        ? el('p', { style: 'margin:0.25rem 0 0;color:var(--color-text-muted);font-size:0.9rem' }, alarm.message)
        : null
    ),
    el('span', {}, formatMotherAlarmSchedule(alarm)),
    el('span', {}, status),
    el('span', { className: 'card-table-actions' }, editBtn, deleteBtn)
  );

  row.addEventListener('click', openEdit);
  return row;
}

function readSelectedDays(form: HTMLElement): MotherAlarmDay[] {
  const days: MotherAlarmDay[] = [];
  for (const { value } of DAY_OPTIONS) {
    const input = form.querySelector(`#alarm-day-${value}`) as HTMLInputElement | null;
    if (input?.checked) days.push(value);
  }
  return days;
}

function createAlarmForm(onSuccess: () => void, existing?: MotherAlarm): HTMLElement {
  const session = getSession();
  const form = el('form', { className: 'modal-body task-form' });
  const defaultDays = existing?.days_of_week ?? [0, 1, 2, 3, 4, 5, 6];

  const { group: timeGroup, picker: timePicker } = createClockPickerField('Time', {
    id: 'alarm-time',
    value: existing?.time_of_day ?? '08:00',
    required: true,
    large: true,
  });

  const daysWrap = el('div', { className: 'form-group' },
    el('span', { className: 'form-label' }, 'Repeat on'),
    el('div', { className: 'alarm-day-picker' })
  );
  const dayPicker = daysWrap.querySelector('.alarm-day-picker')!;
  for (const { value, label } of DAY_OPTIONS) {
    dayPicker.append(
      el('label', { className: 'alarm-day-chip', for: `alarm-day-${value}` },
        el('input', {
          type: 'checkbox',
          id: `alarm-day-${value}`,
          checked: defaultDays.includes(value) ? 'true' : undefined,
        }),
        el('span', {}, label)
      )
    );
  }

  form.append(
    el('div', { className: 'form-group' },
      el('label', { for: 'alarm-title' }, 'Title'),
      el('input', {
        type: 'text',
        id: 'alarm-title',
        required: 'true',
        placeholder: 'Time to get dressed',
        value: existing?.title ?? '',
      })
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'alarm-message' }, 'Extra message (optional)'),
      el('textarea', { id: 'alarm-message', rows: '2' }, existing?.message ?? '')
    ),
    timeGroup,
    daysWrap,
    el('div', { className: 'task-form-options' },
      el('label', { className: 'task-toggle-row', for: 'alarm-active' },
        el('input', {
          type: 'checkbox',
          id: 'alarm-active',
          checked: existing?.active !== false ? 'true' : undefined,
        }),
        el('span', {}, 'Active')
      )
    ),
    el('button', { className: 'btn btn-primary btn-block', type: 'submit' }, existing ? 'Save' : 'Create')
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const days = readSelectedDays(form);
    if (days.length === 0) {
      window.alert('Choose at least one day for the alarm.');
      return;
    }
    const messageRaw = (form.querySelector('#alarm-message') as HTMLTextAreaElement).value.trim();
    const data = {
      title: (form.querySelector('#alarm-title') as HTMLInputElement).value.trim(),
      message: messageRaw || null,
      time_of_day: timePicker.getValue(),
      days_of_week: days,
      active: (form.querySelector('#alarm-active') as HTMLInputElement).checked,
      created_by: session.profile?.id ?? null,
    };

    if (existing) {
      await api.updateMotherAlarm(existing.id, data);
    } else {
      await api.createMotherAlarm(data);
    }
    onSuccess();
  });

  return form;
}
