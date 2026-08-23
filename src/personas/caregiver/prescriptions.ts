import { api } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderCaregiverShell } from '../shared/shell';
import { el, emptyState, formatDate, daysSinceLabel } from '../../shared/utils';
import { icon } from '../../shared/icons';
import { navigate } from '../../shared/router';
import { ensureTaskRealtime } from '../../shared/realtime';
import type { PrescriptionWithStatus } from '../../shared/types';

export interface PrescriptionsSectionOptions {
  compact?: boolean;
  max?: number;
  readOnly?: boolean;
  viewAllPath?: string;
  viewAllLabel?: string;
}

export async function renderCaregiverPrescriptionsPage(): Promise<void> {
  const content = el('div', {});
  content.append(
    el('h2', {}, icon('pill'), ' Medications'),
    el('p', { style: 'color:var(--color-text-muted);margin-bottom:1rem' },
      'Current prescriptions and dosages. Log each dose when administered.'
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
  const session = getSession();
  const profileId = session.profile?.id;
  const prescriptions = await api.getPrescriptionsWithStatus();
  const compact = options?.compact ?? false;
  const max = options?.max ?? prescriptions.length;

  if (compact) {
    return renderCompactPrescriptions(prescriptions, profileId, refresh, max, options);
  }

  const section = el('div', { className: 'prescriptions-section' });
  section.append(
    el('h2', { className: 'section-title' }, icon('pill'), ' Medications'),
    el('p', { className: 'section-hint' },
      'Review dosages and log when each medication is given.'
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

  const list = el('div', { className: 'caregiver-task-list' });
  for (const rx of prescriptions) {
    list.append(renderPrescriptionCard(rx, profileId, refresh));
  }
  section.append(list);
  return section;
}

function formatRxSummary(rx: PrescriptionWithStatus): string {
  const parts = [rx.dosage];
  if (rx.frequency) parts.push(rx.frequency);
  return parts.join(' · ');
}

function renderCompactPrescriptions(
  prescriptions: PrescriptionWithStatus[],
  profileId: string | undefined,
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
      el('span', { className: 'caregiver-dash-check-col-date' }, 'Last dose'),
      el('span', { className: 'caregiver-dash-check-col-by' }, 'By'),
      readOnly ? null : el('span', { className: 'caregiver-dash-check-col-action' }, '')
    )
  );
  for (const rx of prescriptions.slice(0, max)) {
    grid.append(renderCompactPrescriptionRow(rx, profileId, refresh, readOnly));
  }
  panel.append(el('div', { className: 'caregiver-dash-check-table' }, grid));
  return panel;
}

function renderCompactPrescriptionRow(
  rx: PrescriptionWithStatus,
  profileId: string | undefined,
  refresh: () => void | Promise<void>,
  readOnly = false
): HTMLElement {
  const administeredAt = rx.last_dose?.administered_at;
  const who = rx.last_dose?.administered_by_profile?.display_name;

  let actionCell: HTMLElement | null = null;
  if (!readOnly) {
    const doseBtn = el('button', { className: 'btn btn-primary btn-sm', type: 'button' }, 'Log dose');
    doseBtn.addEventListener('click', async () => {
      if (!profileId) return;
      doseBtn.disabled = true;
      try {
        await api.logPrescriptionDose(rx.id, profileId);
        await refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Could not log dose');
        doseBtn.disabled = false;
      }
    });
    actionCell = el('span', { className: 'caregiver-dash-check-col-action' }, doseBtn);
  }

  return el('div', { className: 'caregiver-dash-check-row' },
    el('span', { className: 'caregiver-dash-check-col-check caregiver-dash-check-title' }, rx.name),
    el('span', { className: 'caregiver-dash-rx-col-dosage' }, formatRxSummary(rx)),
    el('span', { className: 'caregiver-dash-check-col-date' },
      administeredAt
        ? formatDate(administeredAt)
        : el('span', { className: 'caregiver-dash-check-warn' }, '—')
    ),
    el('span', { className: 'caregiver-dash-check-col-by' },
      who
        ? who
        : el('span', { className: 'caregiver-dash-check-warn' }, '—')
    ),
    actionCell
  );
}

function renderPrescriptionCard(
  rx: PrescriptionWithStatus,
  profileId: string | undefined,
  refresh: () => void | Promise<void>
): HTMLElement {
  const header = el('div', { className: 'caregiver-task-card-header' },
    el('h3', { className: 'caregiver-task-card-title' }, rx.name)
  );

  const body = el('div', { className: 'caregiver-task-card-body' });
  body.append(
    el('p', { className: 'caregiver-rx-dosage', style: 'font-weight:600;color:var(--color-primary)' },
      formatRxSummary(rx)
    )
  );
  if (rx.instructions) {
    body.append(el('p', { className: 'caregiver-task-card-desc' }, rx.instructions));
  }
  if (rx.prescriber) {
    body.append(
      el('p', { className: 'caregiver-task-card-desc', style: 'font-size:0.9rem' },
        `Prescriber: ${rx.prescriber}`
      )
    );
  }

  if (rx.last_dose) {
    const who = rx.last_dose.administered_by_profile?.display_name ?? 'Someone';
    const administeredAt = rx.last_dose.administered_at;
    body.append(
      el('p', { className: 'recurring-check-last' },
        `Last dose ${formatDate(administeredAt)} by ${who} (${daysSinceLabel(administeredAt)})`
      )
    );
  } else {
    body.append(el('p', { className: 'recurring-check-last recurring-check-never' }, 'No doses logged yet'));
  }

  const card = el('div', { className: 'card task-card caregiver-task-card prescription-card' }, header, body);

  const actions = el('div', { className: 'task-actions caregiver-task-actions' });
  const doseBtn = el(
    'button',
    { className: 'btn btn-primary', type: 'button' },
    icon('check-circle'),
    'Log dose'
  );
  doseBtn.addEventListener('click', async () => {
    if (!profileId) return;
    doseBtn.disabled = true;
    try {
      await api.logPrescriptionDose(rx.id, profileId);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not log dose');
      doseBtn.disabled = false;
    }
  });
  actions.append(doseBtn);
  card.append(actions);

  return card;
}
