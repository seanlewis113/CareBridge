import { api } from '../../shared/api';
import { buildRecurringDescription, type EventRecurrenceRule } from '../../shared/calendarRecurrence';
import { createClockPickerField } from '../../shared/clock-picker';
import { el, todayISO } from '../../shared/utils';

export function renderAddEventForm(onSuccess: () => void): HTMLElement {
  const form = el('form', { className: 'mother-add-form modal-body' });

  const titleGroup = el('div', { className: 'form-group' },
    el('label', { for: 'event-title' }, 'What is it?'),
    el('input', { type: 'text', id: 'event-title', required: 'true', placeholder: 'Doctor visit, lunch with Sarah...' })
  );

  const dateGroup = el('div', { className: 'form-group' },
    el('label', { for: 'event-date' }, 'Date'),
    el('input', { type: 'date', id: 'event-date', required: 'true', value: todayISO() })
  );

  const { group: timeGroup } = createClockPickerField('Time', {
    id: 'event-time',
    value: '',
    required: false,
  });
  const dateTimeRow = el('div', { className: 'form-row-two mother-add-date-time-row' }, dateGroup, timeGroup);

  const recurrenceSelect = el('select', { id: 'event-recurrence' },
    el('option', { value: 'none' }, 'Does not repeat'),
    el('option', { value: 'daily' }, 'Every day'),
    el('option', { value: 'weekly' }, 'Every week'),
    el('option', { value: 'monthly' }, 'Every month')
  ) as HTMLSelectElement;
  const recurrenceGroup = el('div', { className: 'form-group' },
    el('label', { for: 'event-recurrence' }, 'Repeat'),
    recurrenceSelect
  );
  const noEndDateCheckbox = el('input', {
    type: 'checkbox',
    id: 'event-recurrence-no-end',
  }) as HTMLInputElement;
  const occurrenceInput = el('input', {
    type: 'number',
    id: 'event-recurrence-count',
    min: '2',
    max: '365',
    value: '26',
  }) as HTMLInputElement;
  const occurrenceCountRow = el('div', { id: 'event-recurrence-count-row' },
    el('label', { for: 'event-recurrence-count' }, 'How many times'),
    occurrenceInput
  );
  const occurrenceGroup = el('div', { className: 'form-group' },
    el('label', { className: 'task-toggle-row', for: 'event-recurrence-no-end' },
      noEndDateCheckbox,
      el('span', {}, 'No end date')
    ),
    occurrenceCountRow
  );
  occurrenceGroup.style.display = 'none';
  const syncRecurrenceFields = () => {
    const repeats = recurrenceSelect.value !== 'none';
    occurrenceGroup.style.display = repeats ? '' : 'none';
    occurrenceCountRow.style.display = noEndDateCheckbox.checked ? 'none' : '';
  };
  recurrenceSelect.addEventListener('change', syncRecurrenceFields);
  noEndDateCheckbox.addEventListener('change', syncRecurrenceFields);

  const errorEl = el('p', { style: 'color:var(--color-danger);display:none' });
  const submitBtn = el('button', { className: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Save Event');

  form.append(titleGroup, dateTimeRow, recurrenceGroup, occurrenceGroup, errorEl, submitBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = (form.querySelector('#event-title') as HTMLInputElement).value.trim();
    const date = (form.querySelector('#event-date') as HTMLInputElement).value;
    const time = (form.querySelector('#event-time') as HTMLInputElement).value.trim();
    const recurrenceValue = recurrenceSelect.value;
    const noEndDate = noEndDateCheckbox.checked;
    const recurrenceCount = Math.max(2, Math.min(365, Number.parseInt(occurrenceInput.value || '26', 10) || 26));
    const safeTime = time || '00:00';
    const startAt = `${date}T${safeTime}:00`;
    const endDate = new Date(startAt);
    endDate.setHours(endDate.getHours() + 1);
    const recurrenceRule: EventRecurrenceRule | null = recurrenceValue === 'none'
      ? null
      : {
          frequency: recurrenceValue as EventRecurrenceRule['frequency'],
          interval: 1,
          ...(noEndDate ? {} : { count: recurrenceCount }),
        };

    try {
      await api.createCalendarEvent({
        title,
        start_at: startAt,
        end_at: endDate.toISOString().slice(0, 19),
        description: buildRecurringDescription(null, recurrenceRule),
        google_event_id: null,
        created_by: null,
      });
      onSuccess();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Could not save event';
      errorEl.style.display = 'block';
    }
  });

  return form;
}
