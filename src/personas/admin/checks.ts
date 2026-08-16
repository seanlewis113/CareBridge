import { api, isRecurringChecksSchemaReady } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderAdminShell } from '../shared/shell';
import { el, showModal, confirmDialog, formatDateTime } from '../../shared/utils';
import type { RecurringCheck, RecurringCheckWithStatus } from '../../shared/types';

export async function renderAdminChecks(): Promise<void> {
  const checks = await api.getRecurringChecks();
  const checksWithStatus = await api.getRecurringChecksWithStatus(false);
  const statusById = new Map(checksWithStatus.map((c) => [c.id, c.last_completion]));

  const content = el('div', {});

  if (!isRecurringChecksSchemaReady()) {
    content.append(
      el('div', {
        className: 'card',
        style: 'margin-bottom:1rem;padding:1rem;background:#fff8e6;border:1px solid #f0d78c',
      },
        el('p', { style: 'margin:0;font-weight:600' }, 'Database setup required'),
        el('p', { style: 'margin:0.5rem 0 0;color:var(--color-text-muted)' },
          'Run the Recurring Checks migration in your Supabase SQL editor: '
        ),
        el('code', { style: 'display:block;margin-top:0.35rem;font-size:0.85rem' },
          'supabase/migrations/20260816100000_recurring_checks.sql'
        ),
        el('p', { style: 'margin:0.5rem 0 0;color:var(--color-text-muted);font-size:0.9rem' },
          'Or run the recurring checks section at the end of supabase/run-in-sql-editor.sql, then refresh this page.'
        )
      )
    );
  }

  content.append(
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem' },
      el('h2', {}, 'Recurring Checks'),
      el('button', { className: 'btn btn-primary', type: 'button', id: 'new-check' }, '+ New Check')
    ),
    el('p', { style: 'color:var(--color-text-muted);margin-bottom:1rem' },
      'Checks caregivers see on every visit — staples, supplies, and routine verifications. Last-checked times update when a caregiver marks one complete.'
    )
  );

  const list = el('div', {});
  if (checks.length === 0) {
    list.append(el('p', { className: 'empty-state' }, 'No recurring checks yet.'));
  } else {
    for (const check of checks) {
      list.append(renderCheckCard(check, statusById.get(check.id) ?? null, () => renderAdminChecks()));
    }
  }
  content.append(list);

  renderAdminShell(content, '/admin/checks');

  document.getElementById('new-check')?.addEventListener('click', () => {
    const form = createCheckForm(async () => { close(); await renderAdminChecks(); });
    const close = showModal('New Recurring Check', form);
  });
}

function renderCheckCard(
  check: RecurringCheck,
  lastCompletion: RecurringCheckWithStatus['last_completion'],
  refresh: () => void
): HTMLElement {
  const meta = el('div', { style: 'margin-top:0.35rem' });
  if (!check.active) {
    meta.append(el('span', { className: 'badge', style: 'background:#eee' }, 'Inactive'));
  }
  if (lastCompletion) {
    const who = lastCompletion.completed_by_profile?.display_name ?? 'Someone';
    meta.append(
      el('p', { className: 'recurring-check-last', style: 'margin:0.35rem 0 0' },
        `Last checked ${formatDateTime(lastCompletion.completed_at)} by ${who}`
      )
    );
  } else if (check.active) {
    meta.append(
      el('p', { className: 'recurring-check-never', style: 'margin:0.35rem 0 0' }, 'Not yet checked')
    );
  }

  const card = el('div', { className: 'card', style: 'margin-bottom:0.75rem' },
    el('div', {},
      el('p', { style: 'margin:0;font-size:1.05rem;font-weight:600' }, check.title),
      check.description
        ? el('p', { style: 'margin:0.35rem 0 0;color:var(--color-text-muted)' }, check.description)
        : null,
      meta
    ),
    el('div', { className: 'task-actions' },
      el('button', { className: 'btn btn-secondary', type: 'button' }, 'Edit'),
      el('button', { className: 'btn btn-danger', type: 'button' }, 'Delete')
    )
  );

  card.querySelector('.btn-secondary')?.addEventListener('click', () => {
    const form = createCheckForm(async () => { close(); await refresh(); }, check);
    const close = showModal('Edit Recurring Check', form);
  });

  card.querySelector('.btn-danger')?.addEventListener('click', async () => {
    if (await confirmDialog('Delete this recurring check and its history?')) {
      await api.deleteRecurringCheck(check.id);
      await refresh();
    }
  });

  return card;
}

function createCheckForm(onSuccess: () => void, existing?: RecurringCheck): HTMLElement {
  const session = getSession();
  const form = el('form', { className: 'modal-body task-form' });

  form.append(
    el('div', { className: 'form-group' },
      el('label', { for: 'check-title' }, 'Title'),
      el('input', {
        type: 'text',
        id: 'check-title',
        required: 'true',
        placeholder: 'e.g. Toilet paper stocked',
        value: existing?.title ?? '',
      })
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'check-desc' }, 'Description (optional)'),
      el('textarea', { id: 'check-desc', placeholder: 'What should caregivers look for?' },
        existing?.description ?? '')
    ),
    el('div', { className: 'task-form-options' },
      el('label', { className: 'task-toggle-row', for: 'check-active' },
        el('input', {
          type: 'checkbox',
          id: 'check-active',
          checked: existing?.active !== false ? 'true' : undefined,
        }),
        el('span', {}, 'Active (shown to caregivers)')
      )
    ),
    el('button', { className: 'btn btn-primary btn-block', type: 'submit' }, existing ? 'Save' : 'Create')
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      title: (form.querySelector('#check-title') as HTMLInputElement).value.trim(),
      description: (form.querySelector('#check-desc') as HTMLTextAreaElement).value.trim() || null,
      active: (form.querySelector('#check-active') as HTMLInputElement).checked,
      created_by: session.profile?.id ?? null,
    };

    if (existing) {
      await api.updateRecurringCheck(existing.id, data);
    } else {
      await api.createRecurringCheck(data);
    }
    onSuccess();
  });

  return form;
}
