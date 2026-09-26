import { api, isRecurringChecksSchemaReady } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderAdminShell } from '../shared/shell';
import { el, showModal, confirmDialog, formatDateTime } from '../../shared/utils';
import { createStockLevelButtons, stockLevelBadge } from '../../shared/recurringCheckStock';
import type { RecurringCheck, RecurringCheckWithStatus } from '../../shared/types';

export async function renderAdminChecks(): Promise<void> {
  const session = getSession();
  const profileId = session.profile?.id;
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
      'Checks on every visit — staples, supplies, and routine verifications. Log Full, Low, or Out when you or a caregiver checks each item.'
    )
  );

  if (checks.length === 0) {
    content.append(el('p', { className: 'empty-state' }, 'No recurring checks yet.'));
  } else {
    content.append(renderChecksTable(checks, statusById, profileId, () => renderAdminChecks()));
  }

  renderAdminShell(content, '/admin/checks');

  document.getElementById('new-check')?.addEventListener('click', () => {
    const form = createCheckForm(async () => { close(); await renderAdminChecks(); });
    const close = showModal('New Recurring Check', form);
  });
}

function renderChecksTable(
  checks: RecurringCheck[],
  statusById: Map<string, RecurringCheckWithStatus['last_completion']>,
  profileId: string | undefined,
  refresh: () => void | Promise<void>
): HTMLElement {
  const body = el('div', { className: 'admin-check-list card-table-body' });
  for (const check of checks) {
    body.append(renderCheckRow(check, statusById.get(check.id) ?? null, profileId, refresh));
  }

  return el('div', { className: 'card admin-check-table' },
    el('div', { className: 'card-table' },
      el('div', { className: 'card-table-header' },
        el('div', { className: 'card-table-row card-table-row--admin-check' },
          el('span', { className: 'card-table-label' }, 'Check'),
          el('span', { className: 'card-table-label' }, 'Stock'),
          el('span', { className: 'card-table-label' }, 'Last checked'),
          el('span', { className: 'card-table-label' }, 'Update'),
          el('span', { className: 'card-table-label' }, '')
        )
      ),
      body
    )
  );
}

function renderCheckRow(
  check: RecurringCheck,
  lastCompletion: RecurringCheckWithStatus['last_completion'],
  profileId: string | undefined,
  refresh: () => void | Promise<void>
): HTMLElement {
  const titleCell = el('span', { className: 'admin-task-title' }, check.title);
  if (check.description) {
    titleCell.title = check.description;
    titleCell.append(
      el('span', { className: 'admin-task-checklist-hint card-table-muted' }, check.description)
    );
  }
  if (!check.active) {
    titleCell.append(el('span', { className: 'badge admin-rx-inactive-badge' }, 'Inactive'));
  }

  const stockCell = el('span', {});
  if (lastCompletion) {
    stockCell.append(stockLevelBadge(lastCompletion.stock_level));
  } else if (check.active) {
    stockCell.append(el('span', { className: 'recurring-check-never card-table-muted' }, 'Not checked'));
  } else {
    stockCell.append(el('span', { className: 'card-table-muted' }, '—'));
  }

  const lastCell = el('span', { className: 'admin-task-title' });
  if (lastCompletion) {
    const who = lastCompletion.completed_by_profile?.display_name ?? 'Someone';
    lastCell.append(
      el('span', {}, formatDateTime(lastCompletion.completed_at)),
      el('span', { className: 'admin-task-checklist-hint card-table-muted' }, who)
    );
  } else {
    lastCell.append(el('span', { className: 'card-table-muted' }, '—'));
  }

  const editBtn = el('button', { className: 'btn btn-secondary', type: 'button' }, 'Edit');
  const deleteBtn = el('button', { className: 'btn btn-danger', type: 'button' }, 'Delete');
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const form = createCheckForm(async () => { close(); await refresh(); }, check);
    const close = showModal('Edit Recurring Check', form);
  });
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (await confirmDialog('Delete this recurring check and its history?')) {
      await api.deleteRecurringCheck(check.id);
      await refresh();
    }
  });

  const updateCell = el('span', { className: 'card-table-actions admin-check-stock-actions' });
  if (check.active) {
    updateCell.append(createStockLevelButtons(check.id, profileId, refresh, 'sm'));
  } else {
    updateCell.append(el('span', { className: 'card-table-muted' }, '—'));
  }

  const row = el('div', { className: 'admin-check-row card-table-row card-table-row--admin-check admin-task-row--clickable' },
    titleCell,
    stockCell,
    lastCell,
    updateCell,
    el('span', { className: 'card-table-actions' }, editBtn, deleteBtn)
  );

  row.addEventListener('click', () => {
    const form = createCheckForm(async () => { close(); await refresh(); }, check);
    const close = showModal('Edit Recurring Check', form);
  });

  return row;
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
