import { api } from '../../shared/api';
import {
  buildEventTimestamps,
  buildRecurringDescription,
  getEventDateSpan,
  getEventPlainDescription,
  getSourceEventId,
  isUntimedEvent,
  parseRecurringRule,
  toLocalTimeInput,
  type EventRecurrenceRule,
} from '../../shared/calendarRecurrence';
import { createClockPickerField } from '../../shared/clock-picker';
import type { CalendarEvent } from '../../shared/types';
import { el, showModal, todayISO } from '../../shared/utils';

export interface EventFormOptions {
  event?: CalendarEvent;
  occurrence?: CalendarEvent;
  onSuccess: () => void;
}

export function renderAddEventForm(onSuccess: () => void): HTMLElement {
  return renderEventForm({ onSuccess });
}

export function renderEventForm({ event, occurrence, onSuccess }: EventFormOptions): HTMLElement {
  const isEdit = !!event;
  const displayEvent = occurrence ?? event;
  const recurrenceRule = event ? parseRecurringRule(event) : null;
  const plainDescription = event ? getEventPlainDescription(event) : '';
  const eventSpan = displayEvent ? getEventDateSpan(displayEvent) : null;
  const startDate = eventSpan?.startKey ?? todayISO();
  const endDate = eventSpan?.endKey ?? startDate;
  const startTime = displayEvent && !isUntimedEvent(displayEvent) ? toLocalTimeInput(displayEvent.start_at) : '';

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

  const startDateInput = el('input', {
    type: 'date',
    id: 'event-start-date',
    required: 'true',
    value: startDate,
  }) as HTMLInputElement;
  const endDateInput = el('input', {
    type: 'date',
    id: 'event-end-date',
    required: 'true',
    value: endDate,
    min: startDate,
  }) as HTMLInputElement;
  const startDateGroup = el('div', { className: 'form-group' },
    el('label', { for: 'event-start-date' }, 'Start date'),
    startDateInput
  );
  const endDateGroup = el('div', { className: 'form-group' },
    el('label', { for: 'event-end-date' }, 'End date'),
    endDateInput
  );
  const dateRow = el('div', { className: 'form-row-two mother-add-date-time-row' }, startDateGroup, endDateGroup);

  const { group: timeGroup, picker: timePicker } = createClockPickerField('Time', {
    id: 'event-time',
    value: startTime,
    required: false,
  });
  const syncDateBounds = () => {
    endDateInput.min = startDateInput.value;
    if (endDateInput.value && endDateInput.value < startDateInput.value) {
      endDateInput.value = startDateInput.value;
    }
  };
  startDateInput.addEventListener('change', syncDateBounds);
  syncDateBounds();

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

  form.append(titleGroup, dateRow, timeGroup, recurrenceGroup, occurrenceGroup, errorEl, submitBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = (form.querySelector('#event-title') as HTMLInputElement).value.trim();
    const startDateValue = startDateInput.value;
    const endDateValue = endDateInput.value;
    const time = timePicker.getValue().trim();
    const recurrenceValue = recurrenceSelect.value;
    const noEndDate = noEndDateCheckbox.checked;
    const recurrenceCount = Math.max(2, Math.min(365, Number.parseInt(occurrenceInput.value || '26', 10) || 26));

    if (endDateValue < startDateValue) {
      errorEl.textContent = 'End date must be on or after the start date.';
      errorEl.style.display = 'block';
      return;
    }

    const { start_at: startAt, end_at: endAt } = buildEventTimestamps(startDateValue, endDateValue, time);
    const datesUnchanged = startDateValue === startDate && endDateValue === endDate;
    const seriesTimestamps = recurrenceRule && datesUnchanged && event
      ? { start_at: event.start_at, end_at: event.end_at }
      : { start_at: startAt, end_at: endAt };
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
          start_at: seriesTimestamps.start_at,
          end_at: seriesTimestamps.end_at,
          description,
        });
      } else {
        await api.createCalendarEvent({
          title,
          start_at: seriesTimestamps.start_at,
          end_at: seriesTimestamps.end_at,
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
  let source: CalendarEvent | undefined;
  let occurrence: CalendarEvent | undefined;

  if (event) {
    const loaded = await api.getCalendarEvent(event.id);
    if (!loaded) {
      alert('This event could not be found. It may have been deleted.');
      return;
    }
    source = loaded;
    const clickedOccurrence = event.id !== getSourceEventId(event.id)
      || (event.recurrence_index != null && event.recurrence_index > 0);
    occurrence = clickedOccurrence ? event : undefined;
  }

  const form = renderEventForm({
    event: source,
    occurrence,
    onSuccess: () => {
      close();
      void onSuccess();
    },
  });
  const close = showModal(event ? 'Edit Event' : 'Add Event', form);
}
