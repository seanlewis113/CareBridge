import { api, isPrescriptionsSchemaReady } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderAdminShell } from '../shared/shell';
import { el, showModal, confirmDialog, formatDateTime } from '../../shared/utils';
import { icon } from '../../shared/icons';
import type { Prescription, PrescriptionWithStatus } from '../../shared/types';

export async function renderAdminPrescriptions(): Promise<void> {
  const prescriptions = await api.getPrescriptions();
  const withStatus = await api.getPrescriptionsWithStatus(false);
  const doseById = new Map(withStatus.map((rx) => [rx.id, rx.last_dose]));

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
      'Manage medications and dosages. Caregivers see active prescriptions and can log when each dose is given.'
    )
  );

  const list = el('div', {});
  if (prescriptions.length === 0) {
    list.append(el('p', { className: 'empty-state' }, 'No prescriptions yet.'));
  } else {
    for (const rx of prescriptions) {
      list.append(renderPrescriptionCard(rx, doseById.get(rx.id) ?? null, () => renderAdminPrescriptions()));
    }
  }
  content.append(list);

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

function renderPrescriptionCard(
  rx: Prescription,
  lastDose: PrescriptionWithStatus['last_dose'],
  refresh: () => void
): HTMLElement {
  const meta = el('div', { style: 'margin-top:0.35rem' });
  if (!rx.active) {
    meta.append(el('span', { className: 'badge', style: 'background:#eee' }, 'Inactive'));
  }
  meta.append(
    el('p', { style: 'margin:0.35rem 0 0;font-weight:500;color:var(--color-primary)' }, formatRxDetails(rx))
  );
  if (rx.instructions) {
    meta.append(
      el('p', { style: 'margin:0.25rem 0 0;color:var(--color-text-muted);font-size:0.95rem' },
        rx.instructions
      )
    );
  }
  if (rx.prescriber) {
    meta.append(
      el('p', { style: 'margin:0.25rem 0 0;color:var(--color-text-muted);font-size:0.9rem' },
        `Prescriber: ${rx.prescriber}`
      )
    );
  }
  if (lastDose) {
    const who = lastDose.administered_by_profile?.display_name ?? 'Someone';
    meta.append(
      el('p', { className: 'recurring-check-last', style: 'margin:0.35rem 0 0' },
        `Last dose ${formatDateTime(lastDose.administered_at)} by ${who}`
      )
    );
  } else if (rx.active) {
    meta.append(
      el('p', { className: 'recurring-check-never', style: 'margin:0.35rem 0 0' }, 'No doses logged yet')
    );
  }

  const card = el('div', { className: 'card', style: 'margin-bottom:0.75rem' },
    el('div', {},
      el('p', { style: 'margin:0;font-size:1.05rem;font-weight:600' }, rx.name),
      meta
    ),
    el('div', { className: 'task-actions' },
      el('button', { className: 'btn btn-secondary', type: 'button' }, 'Edit'),
      el('button', { className: 'btn btn-danger', type: 'button' }, 'Delete')
    )
  );

  card.querySelector('.btn-secondary')?.addEventListener('click', () => {
    const form = createPrescriptionForm(async () => { close(); await refresh(); }, rx);
    const close = showModal('Edit Prescription', form);
  });

  card.querySelector('.btn-danger')?.addEventListener('click', async () => {
    if (await confirmDialog(`Delete ${rx.name} and its dose history?`)) {
      await api.deletePrescription(rx.id);
      await refresh();
    }
  });

  return card;
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
    const data = {
      name: (form.querySelector('#rx-name') as HTMLInputElement).value.trim(),
      dosage: (form.querySelector('#rx-dosage') as HTMLInputElement).value.trim(),
      frequency: (form.querySelector('#rx-frequency') as HTMLInputElement).value.trim() || null,
      instructions: (form.querySelector('#rx-instructions') as HTMLTextAreaElement).value.trim() || null,
      prescriber: (form.querySelector('#rx-prescriber') as HTMLInputElement).value.trim() || null,
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
