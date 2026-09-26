import { api } from '../../shared/api';
import { renderCaregiverShell } from '../shared/shell';
import { el, emptyState, formatDate, showModal, todayISO } from '../../shared/utils';
import { icon } from '../../shared/icons';
import { navigate } from '../../shared/router';
import { ensureTaskRealtime } from '../../shared/realtime';
import {
  prescriptionRefillBadge,
  prescriptionRefillUrgency,
} from '../../shared/prescriptionRefill';
import type { Prescription } from '../../shared/types';

export interface PrescriptionsSectionOptions {
  compact?: boolean;
  max?: number;
  readOnly?: boolean;
  viewAllPath?: string;
  viewAllLabel?: string;
}

function defaultNextRefillDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

function showRefillModal(rx: Prescription, refresh: () => void | Promise<void>): void {
  const form = el('form', { className: 'modal-body task-form' });
  const nextInput = el('input', {
    type: 'date',
    id: 'rx-next-refill',
    required: 'true',
    value: rx.next_refill_date && rx.next_refill_date >= todayISO() ? rx.next_refill_date : defaultNextRefillDate(),
  }) as HTMLInputElement;
  const pickedUpToday = el('input', {
    type: 'checkbox',
    id: 'rx-picked-up-today',
    checked: 'true',
  }) as HTMLInputElement;

  form.append(
    el('p', { style: 'color:var(--color-text-muted);margin:0 0 1rem' },
      `Set when ${rx.name} will need to be refilled again.`
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'rx-next-refill' }, 'Next refill due'),
      nextInput
    ),
    el('div', { className: 'task-form-options' },
      el('label', { className: 'task-toggle-row', for: 'rx-picked-up-today' },
        pickedUpToday,
        el('span', {}, 'Picked up or filled today')
      )
    ),
    el('button', { className: 'btn btn-primary btn-block', type: 'submit' }, 'Save')
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nextDate = nextInput.value;
    if (!nextDate) return;
    try {
      if (pickedUpToday.checked) {
        await api.recordPrescriptionRefill(rx.id, nextDate);
      } else {
        await api.updatePrescription(rx.id, { next_refill_date: nextDate });
      }
      close();
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not save refill date');
    }
  });

  const close = showModal(`Refill — ${rx.name}`, form);
}

export async function renderCaregiverPrescriptionsPage(): Promise<void> {
  const content = el('div', {});
  content.append(
    el('h2', {}, icon('pill'), ' Medications'),
    el('p', { style: 'color:var(--color-text-muted);margin-bottom:1rem' },
      'Current prescriptions and when each one needs to be refilled.'
    ),
    await renderPrescriptionsSection(() => renderCaregiverPrescriptionsPage())
  );
  renderCaregiverShell(content, '/caregiver/prescriptions');
  ensureTaskRealtime(() => {
    void renderCaregiverPrescriptionsPage();
  });
}

export async function renderPrescriptionsSection(
  refresh: () => void | Promise<void>,
  options?: PrescriptionsSectionOptions
): Promise<HTMLElement> {
  const prescriptions = await api.getPrescriptionsWithStatus();
  const compact = options?.compact ?? false;
  const max = options?.max ?? prescriptions.length;

  if (compact) {
    return renderCompactPrescriptions(prescriptions, refresh, max, options);
  }

  const section = el('div', { className: 'prescriptions-section' });
  section.append(
    el('h2', { className: 'section-title' }, icon('pill'), ' Medications'),
    el('p', { className: 'section-hint' },
      'Review refill dates and update when you pick up a new supply.'
    )
  );

  if (prescriptions.length === 0) {
    section.append(emptyState(
      icon('pill'),
      'No prescriptions set up',
      'Your admin can add medications from the Rx Tracker in the admin panel.'
    ));
    return section;
  }

  section.append(renderPrescriptionsTable(prescriptions, refresh));
  return section;
}

function renderPrescriptionsTable(
  prescriptions: Prescription[],
  refresh: () => void | Promise<void>
): HTMLElement {
  const body = el('div', { className: 'admin-task-list card-table-body' });
  for (const rx of prescriptions) {
    body.append(renderPrescriptionTableRow(rx, refresh));
  }

  return el('div', { className: 'card admin-task-table' },
    el('div', { className: 'card-table' },
      el('div', { className: 'card-table-header' },
        el('div', { className: 'card-table-row card-table-row--caregiver-rx' },
          el('span', { className: 'card-table-label' }, 'Medication'),
          el('span', { className: 'card-table-label' }, 'Dosage'),
          el('span', { className: 'card-table-label' }, 'Next refill'),
          el('span', { className: 'card-table-label' }, 'Status'),
          el('span', { className: 'card-table-label' }, '')
        )
      ),
      body
    )
  );
}

function renderPrescriptionTableRow(
  rx: Prescription,
  refresh: () => void | Promise<void>
): HTMLElement {
  const titleCell = el('span', { className: 'admin-task-title' }, rx.name);
  if (rx.instructions) {
    titleCell.title = rx.instructions;
    titleCell.append(
      el('span', { className: 'admin-task-checklist-hint card-table-muted' }, rx.instructions)
    );
  }

  const urgency = prescriptionRefillUrgency(rx.next_refill_date);
  const statusCell = el('span', {},
    urgency === 'unset'
      ? el('span', { className: 'card-table-muted' }, 'Set date')
      : prescriptionRefillBadge(rx.next_refill_date)
  );

  const refillBtn = el('button', { className: 'btn btn-primary', type: 'button' }, 'Refill');
  refillBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showRefillModal(rx, refresh);
  });

  const row = el('div', {
    className: 'admin-task-row card-table-row card-table-row--caregiver-rx admin-task-row--clickable',
  },
    titleCell,
    el('span', { className: 'admin-rx-dosage' }, formatRxSummary(rx)),
    el('span', {},
      rx.next_refill_date
        ? formatDate(rx.next_refill_date)
        : el('span', { className: 'card-table-muted' }, '—')
    ),
    statusCell,
    el('span', { className: 'card-table-actions' }, refillBtn)
  );

  row.addEventListener('click', () => showRefillModal(rx, refresh));
  return row;
}

function formatRxSummary(rx: Prescription): string {
  const parts = [rx.dosage];
  if (rx.frequency) parts.push(rx.frequency);
  return parts.join(' · ');
}

function renderCompactPrescriptions(
  prescriptions: Prescription[],
  refresh: () => void | Promise<void>,
  max: number,
  options?: PrescriptionsSectionOptions
): HTMLElement {
  const readOnly = options?.readOnly ?? false;
  const viewAllPath = options?.viewAllPath ?? '/caregiver/prescriptions';
  const viewAllLabel = options?.viewAllLabel ?? 'View all';

  const panel = el('section', { className: 'card caregiver-dash-panel' });
  const head = el('div', { className: 'caregiver-dash-panel-head' },
    el('div', { className: 'card-header' },
      el('div', { className: 'card-header-icon' }, icon('pill')),
      el('h3', {}, 'Medications')
    )
  );
  if (prescriptions.length > 0) {
    const viewAll = el('button', { type: 'button', className: 'caregiver-dash-view-all' }, viewAllLabel);
    viewAll.addEventListener('click', () => navigate(viewAllPath));
    head.append(viewAll);
  }
  panel.append(head);

  if (prescriptions.length === 0) {
    panel.append(el('p', { className: 'caregiver-dash-empty' }, 'No prescriptions set up.'));
    return panel;
  }

  const grid = el('div', {
    className: `caregiver-dash-check-grid caregiver-dash-rx-grid${readOnly ? ' caregiver-dash-check-grid--readonly' : ''}`,
  });
  grid.append(
    el('div', { className: 'caregiver-dash-check-row caregiver-dash-check-row--head' },
      el('span', { className: 'caregiver-dash-check-col-check' }, 'Medication'),
      el('span', { className: 'caregiver-dash-rx-col-dosage' }, 'Dosage'),
      el('span', { className: 'caregiver-dash-check-col-date' }, 'Refill'),
      el('span', { className: 'caregiver-dash-check-col-by' }, 'Status'),
      readOnly ? null : el('span', { className: 'caregiver-dash-check-col-action' }, '')
    )
  );
  for (const rx of prescriptions.slice(0, max)) {
    grid.append(renderCompactPrescriptionRow(rx, refresh, readOnly));
  }
  panel.append(el('div', { className: 'caregiver-dash-check-table' }, grid));
  return panel;
}

function renderCompactPrescriptionRow(
  rx: Prescription,
  refresh: () => void | Promise<void>,
  readOnly = false
): HTMLElement {
  let actionCell: HTMLElement | null = null;
  if (!readOnly) {
    const refillBtn = el('button', { className: 'btn btn-primary btn-sm', type: 'button' }, 'Refill');
    refillBtn.addEventListener('click', () => showRefillModal(rx, refresh));
    actionCell = el('span', { className: 'caregiver-dash-check-col-action' }, refillBtn);
  }

  const urgency = prescriptionRefillUrgency(rx.next_refill_date);

  return el('div', { className: 'caregiver-dash-check-row' },
    el('span', { className: 'caregiver-dash-check-col-check caregiver-dash-check-title' }, rx.name),
    el('span', { className: 'caregiver-dash-rx-col-dosage' }, formatRxSummary(rx)),
    el('span', { className: 'caregiver-dash-check-col-date' },
      rx.next_refill_date
        ? formatDate(rx.next_refill_date)
        : el('span', { className: 'caregiver-dash-check-warn' }, '—')
    ),
    el('span', { className: 'caregiver-dash-check-col-by' },
      urgency === 'unset'
        ? el('span', { className: 'caregiver-dash-check-warn' }, 'Set date')
        : prescriptionRefillBadge(rx.next_refill_date)
    ),
    actionCell
  );
}

