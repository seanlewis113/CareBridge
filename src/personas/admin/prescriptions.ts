import { api, isPrescriptionsSchemaReady } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderAdminShell } from '../shared/shell';
import { el, showModal, confirmDialog, formatDate } from '../../shared/utils';
import { icon } from '../../shared/icons';
import {
  prescriptionRefillBadge,
  prescriptionRefillLabel,
} from '../../shared/prescriptionRefill';
import type { Prescription } from '../../shared/types';

export async function renderAdminPrescriptions(): Promise<void> {
  const prescriptions = await api.getPrescriptions();

  const content = el('div', {});

  if (!isPrescriptionsSchemaReady()) {
    content.append(
      el('div', {
        className: 'card',
        style: 'margin-bottom:1rem;padding:1rem;background:#fff8e6;border:1px solid #f0d78c',
      },
        el('p', { style: 'margin:0;font-weight:600' }, 'Database setup required'),
        el('p', { style: 'margin:0.5rem 0 0;color:var(--color-text-muted)' },
          'Run the Prescriptions migration in your Supabase SQL editor: '
        ),
        el('code', { style: 'display:block;margin-top:0.35rem;font-size:0.85rem' },
          'supabase/migrations/20260822180000_prescriptions.sql'
        ),
        el('p', { style: 'margin:0.5rem 0 0;color:var(--color-text-muted);font-size:0.9rem' },
          'Or run the Rx Tracker section at the end of supabase/run-in-sql-editor.sql, then refresh this page.'
        )
      )
    );
  }

  content.append(
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem' },
      el('h2', {}, icon('pill'), ' Rx Tracker'),
      el('button', { className: 'btn btn-primary', type: 'button', id: 'new-rx' }, '+ New Prescription')
    ),
    el('p', { style: 'color:var(--color-text-muted);margin-bottom:1rem' },
      'Manage medications and refill dates. Caregivers see active prescriptions and update when each Rx is filled.'
    )
  );

  if (prescriptions.length === 0) {
    content.append(el('p', { className: 'empty-state' }, 'No prescriptions yet.'));
  } else {
    content.append(renderPrescriptionsTable(prescriptions, () => renderAdminPrescriptions()));
  }

  renderAdminShell(content, '/admin/prescriptions');

  document.getElementById('new-rx')?.addEventListener('click', () => {
    const form = createPrescriptionForm(async () => { close(); await renderAdminPrescriptions(); });
    const close = showModal('New Prescription', form);
  });
}

function formatRxDetails(rx: Prescription): string {
  const parts = [rx.dosage];
  if (rx.frequency) parts.push(rx.frequency);
  return parts.join(' · ');
}

function renderPrescriptionsTable(
  prescriptions: Prescription[],
  refresh: () => void | Promise<void>
): HTMLElement {
  const body = el('div', { className: 'admin-rx-list card-table-body' });
  for (const rx of prescriptions) {
    body.append(renderPrescriptionRow(rx, refresh));
  }

  return el('div', { className: 'card admin-rx-table' },
    el('div', { className: 'card-table' },
      el('div', { className: 'card-table-header' },
        el('div', { className: 'card-table-row card-table-row--admin-rx' },
          el('span', { className: 'card-table-label' }, 'Medication'),
          el('span', { className: 'card-table-label' }, 'Dosage'),
          el('span', { className: 'card-table-label' }, 'Next refill'),
          el('span', { className: 'card-table-label' }, 'Last filled'),
          el('span', { className: 'card-table-label' }, '')
        )
      ),
      body
    )
  );
}

function renderPrescriptionRow(rx: Prescription, refresh: () => void | Promise<void>): HTMLElement {
  const nameCell = el('span', { className: 'admin-task-title' }, rx.name);
  if (rx.instructions) {
    nameCell.append(
      el('span', { className: 'admin-task-checklist-hint card-table-muted' }, rx.instructions)
    );
  }
  if (rx.prescriber) {
    nameCell.append(
      el('span', { className: 'admin-task-checklist-hint card-table-muted' }, rx.prescriber)
    );
  }
  if (!rx.active) {
    nameCell.append(el('span', { className: 'badge admin-rx-inactive-badge' }, 'Inactive'));
  }

  const nextRefillCell = el('span', { className: 'admin-rx-refill-cell' },
    prescriptionRefillBadge(rx.next_refill_date ?? null),
    el('span', { className: 'admin-rx-refill-detail' },
      rx.next_refill_date
        ? formatDate(rx.next_refill_date)
        : el('span', { className: 'card-table-muted' }, '—'),
      el('span', { className: 'card-table-muted admin-rx-refill-hint' },
        prescriptionRefillLabel(rx.next_refill_date ?? null)
      )
    )
  );

  const editBtn = el('button', { className: 'btn btn-secondary', type: 'button' }, 'Edit');
  const deleteBtn = el('button', { className: 'btn btn-danger', type: 'button' }, 'Delete');
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const form = createPrescriptionForm(async () => { close(); await refresh(); }, rx);
    const close = showModal('Edit Prescription', form);
  });
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (await confirmDialog(`Delete ${rx.name}?`)) {
      await api.deletePrescription(rx.id);
      await refresh();
    }
  });

  const row = el('div', { className: 'admin-rx-row card-table-row card-table-row--admin-rx' },
    nameCell,
    el('span', { className: 'admin-rx-dosage' }, formatRxDetails(rx)),
    nextRefillCell,
    el('span', {},
      rx.last_refill_date
        ? formatDate(rx.last_refill_date)
        : el('span', { className: 'card-table-muted' }, '—')
    ),
    el('span', { className: 'card-table-actions' }, editBtn, deleteBtn)
  );

  row.addEventListener('click', () => {
    const form = createPrescriptionForm(async () => { close(); await refresh(); }, rx);
    const close = showModal('Edit Prescription', form);
  });

  return row;
}

function createPrescriptionForm(onSuccess: () => void, existing?: Prescription): HTMLElement {
  const session = getSession();
  const form = el('form', { className: 'modal-body task-form' });

  form.append(
    el('div', { className: 'form-group' },
      el('label', { for: 'rx-name' }, 'Medication name'),
      el('input', {
        type: 'text',
        id: 'rx-name',
        required: 'true',
        placeholder: 'e.g. Lisinopril',
        value: existing?.name ?? '',
      })
    ),
    el('div', { className: 'form-row-two' },
      el('div', { className: 'form-group' },
        el('label', { for: 'rx-dosage' }, 'Dosage'),
        el('input', {
          type: 'text',
          id: 'rx-dosage',
          required: 'true',
          placeholder: 'e.g. 10 mg, 1 tablet',
          value: existing?.dosage ?? '',
        })
      ),
      el('div', { className: 'form-group' },
        el('label', { for: 'rx-frequency' }, 'Frequency'),
        el('input', {
          type: 'text',
          id: 'rx-frequency',
          placeholder: 'e.g. Twice daily',
          value: existing?.frequency ?? '',
        })
      )
    ),
    el('div', { className: 'form-row-two' },
      el('div', { className: 'form-group' },
        el('label', { for: 'rx-next-refill' }, 'Next refill due'),
        el('input', {
          type: 'date',
          id: 'rx-next-refill',
          value: existing?.next_refill_date ?? '',
        })
      ),
      el('div', { className: 'form-group' },
        el('label', { for: 'rx-last-refill' }, 'Last filled (optional)'),
        el('input', {
          type: 'date',
          id: 'rx-last-refill',
          value: existing?.last_refill_date ?? '',
        })
      )
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'rx-instructions' }, 'Instructions (optional)'),
      el('textarea', { id: 'rx-instructions', placeholder: 'With food, special handling...' },
        existing?.instructions ?? '')
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'rx-prescriber' }, 'Prescriber (optional)'),
      el('input', {
        type: 'text',
        id: 'rx-prescriber',
        placeholder: 'e.g. Dr. Smith',
        value: existing?.prescriber ?? '',
      })
    ),
    el('div', { className: 'task-form-options' },
      el('label', { className: 'task-toggle-row', for: 'rx-active' },
        el('input', {
          type: 'checkbox',
          id: 'rx-active',
          checked: existing?.active !== false ? 'true' : undefined,
        }),
        el('span', {}, 'Active (visible to caregivers)')
      )
    ),
    el('button', { className: 'btn btn-primary btn-block', type: 'submit' }, existing ? 'Save' : 'Create')
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nextRefill = (form.querySelector('#rx-next-refill') as HTMLInputElement).value.trim();
    const lastRefill = (form.querySelector('#rx-last-refill') as HTMLInputElement).value.trim();
    const data = {
      name: (form.querySelector('#rx-name') as HTMLInputElement).value.trim(),
      dosage: (form.querySelector('#rx-dosage') as HTMLInputElement).value.trim(),
      frequency: (form.querySelector('#rx-frequency') as HTMLInputElement).value.trim() || null,
      instructions: (form.querySelector('#rx-instructions') as HTMLTextAreaElement).value.trim() || null,
      prescriber: (form.querySelector('#rx-prescriber') as HTMLInputElement).value.trim() || null,
      next_refill_date: nextRefill || null,
      last_refill_date: lastRefill || null,
      active: (form.querySelector('#rx-active') as HTMLInputElement).checked,
      created_by: session.profile?.id ?? null,
    };

    if (existing) {
      await api.updatePrescription(existing.id, data);
    } else {
      await api.createPrescription(data);
    }
    onSuccess();
  });

  return form;
}
