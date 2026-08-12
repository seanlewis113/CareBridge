import { api } from '../../shared/api';
import {
  buildRecurringDescription,
  getEventPlainDescription,
  getSourceEventId,
  parseRecurringRule,
  type EventRecurrenceRule,
} from '../../shared/calendarRecurrence';
import { createClockPickerField } from '../../shared/clock-picker';
import type { CalendarEvent } from '../../shared/types';
import { el, showModal, todayISO } from '../../shared/utils';

export interface EventFormOptions {
  event?: CalendarEvent;
  onSuccess: () => void;
}

export function renderAddEventForm(onSuccess: () => void): HTMLElement {
  return renderEventForm({ onSuccess });
}

export function renderEventForm({ event, onSuccess }: EventFormOptions): HTMLElement {
  const isEdit = !!event;
  const recurrenceRule = event ? parseRecurringRule(event) : null;
  const plainDescription = event ? getEventPlainDescription(event) : '';
  const startDate = event?.start_at.slice(0, 10) ?? todayISO();
  const startTime = event?.start_at.slice(11, 16) ?? '';

  const form = el('form', { className: 'mother-add-form modal-body' });

  const titleGroup = el('div', { className: 'form-group' },
    el('label', { for: 'event-title' }, 'What is it?'),
    el('input', {
      type: 'text',
      id: 'event-title',
      required: 'true',
      placeholder: 'Doctor visit, lunch with Sarah...',
      value: event?.title ?? '',
    })
  );

  const dateGroup = el('div', { className: 'form-group' },
    el('label', { for: 'event-date' }, 'Date'),
    el('input', { type: 'date', id: 'event-date', required: 'true', value: startDate })
  );

  const { group: timeGroup } = createClockPickerField('Time', {
    id: 'event-time',
    value: startTime,
    required: false,
  });
  const dateTimeRow = el('div', { className: 'form-row-two mother-add-date-time-row' }, dateGroup, timeGroup);

  const recurrenceSelect = el('select', { id: 'event-recurrence' },
    el('option', { value: 'none' }, 'Does not repeat'),
    el('option', { value: 'daily' }, 'Every day'),
    el('option', { value: 'weekly' }, 'Every week'),
    el('option', { value: 'monthly' }, 'Every month')
  ) as HTMLSelectElement;
  if (recurrenceRule) recurrenceSelect.value = recurrenceRule.frequency;
  const recurrenceGroup = el('div', { className: 'form-group' },
    el('label', { for: 'event-recurrence' }, 'Repeat'),
    recurrenceSelect
  );
  const noEndDateCheckbox = el('input', {
    type: 'checkbox',
    id: 'event-recurrence-no-end',
  }) as HTMLInputElement;
  if (recurrenceRule && recurrenceRule.count == null) noEndDateCheckbox.checked = true;
  const occurrenceInput = el('input', {
    type: 'number',
    id: 'event-recurrence-count',
    min: '2',
    max: '365',
    value: String(recurrenceRule?.count ?? 26),
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
  occurrenceGroup.style.display = recurrenceRule ? '' : 'none';
  const syncRecurrenceFields = () => {
    const repeats = recurrenceSelect.value !== 'none';
    occurrenceGroup.style.display = repeats ? '' : 'none';
    occurrenceCountRow.style.display = noEndDateCheckbox.checked ? 'none' : '';
  };
  recurrenceSelect.addEventListener('change', syncRecurrenceFields);
  noEndDateCheckbox.addEventListener('change', syncRecurrenceFields);
  syncRecurrenceFields();

  if (isEdit && recurrenceRule) {
    form.append(
      el('p', { style: 'font-size:0.85rem;color:var(--color-text-muted);margin:0 0 0.75rem' },
        'Changes apply to the full repeating series.'
      )
    );
  }

  const errorEl = el('p', { style: 'color:var(--color-danger);display:none' });
  const submitBtn = el('button', {
    className: 'btn btn-primary btn-block btn-lg',
    type: 'submit',
  }, isEdit ? 'Save Changes' : 'Save Event');

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
    const nextRecurrenceRule: EventRecurrenceRule | null = recurrenceValue === 'none'
      ? null
      : {
          frequency: recurrenceValue as EventRecurrenceRule['frequency'],
          interval: 1,
          ...(noEndDate ? {} : { count: recurrenceCount }),
        };

    try {
      const description = buildRecurringDescription(plainDescription || null, nextRecurrenceRule);
      if (isEdit && event) {
        await api.updateCalendarEvent(getSourceEventId(event.id), {
          title,
          start_at: startAt,
          end_at: endDate.toISOString().slice(0, 19),
          description,
        });
      } else {
        await api.createCalendarEvent({
          title,
          start_at: startAt,
          end_at: endDate.toISOString().slice(0, 19),
          description,
          google_event_id: null,
          created_by: null,
        });
      }
      onSuccess();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Could not save event';
      errorEl.style.display = 'block';
    }
  });

  return form;
}

export async function openEventEditorModal(
  event: CalendarEvent | undefined,
  onSuccess: () => void | Promise<void>
): Promise<void> {
  let source = event;
  if (event) {
    const loaded = await api.getCalendarEvent(event.id);
    if (!loaded) {
      alert('This event could not be found. It may have been deleted.');
      return;
    }
    source = loaded;
  }

  const form = renderEventForm({
    event: source,
    onSuccess: () => {
      close();
      void onSuccess();
    },
  });
  const close = showModal(event ? 'Edit Event' : 'Add Event', form);
}
