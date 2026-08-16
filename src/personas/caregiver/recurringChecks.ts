import { api } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { el, emptyState, formatDate, daysSinceLabel } from '../../shared/utils';
import { icon } from '../../shared/icons';
import { navigate } from '../../shared/router';
import type { RecurringCheckWithStatus } from '../../shared/types';

export interface RecurringChecksSectionOptions {
  compact?: boolean;
  max?: number;
  readOnly?: boolean;
  viewAllPath?: string;
  viewAllLabel?: string;
}

export async function renderRecurringChecksSection(
  refresh: () => void | Promise<void>,
  options?: RecurringChecksSectionOptions
): Promise<HTMLElement> {
  const session = getSession();
  const profileId = session.profile?.id;
  const checks = await api.getRecurringChecksWithStatus();
  const compact = options?.compact ?? false;
  const max = options?.max ?? checks.length;

  if (compact) {
    return renderCompactRecurringChecks(checks, profileId, refresh, max, options);
  }

  const section = el('div', { className: 'recurring-checks-section' });
  section.append(
    el('h2', { className: 'section-title' }, icon('list'), 'Recurring Checks'),
    el('p', { className: 'section-hint' },
      'Verify these on every visit — mark complete so the family knows when each was last checked.'
    )
  );

  if (checks.length === 0) {
    section.append(emptyState(
      icon('check-circle'),
      'No checks set up',
      'Your admin can add recurring checks from the admin panel.'
    ));
    return section;
  }

  const list = el('div', { className: 'caregiver-task-list' });
  for (const check of checks) {
    list.append(renderRecurringCheckCard(check, profileId, refresh));
  }
  section.append(list);
  return section;
}

function renderCompactRecurringChecks(
  checks: RecurringCheckWithStatus[],
  profileId: string | undefined,
  refresh: () => void | Promise<void>,
  max: number,
  options?: RecurringChecksSectionOptions
): HTMLElement {
  const readOnly = options?.readOnly ?? false;
  const viewAllPath = options?.viewAllPath ?? '/caregiver/visit';
  const viewAllLabel = options?.viewAllLabel ?? 'Log visit';

  const panel = el('section', { className: 'card caregiver-dash-panel' });
  const head = el('div', { className: 'caregiver-dash-panel-head' },
    el('div', { className: 'card-header' },
      el('div', { className: 'card-header-icon' }, icon('list')),
      el('h3', {}, 'Recurring Checks')
    )
  );
  if (checks.length > 0) {
    const viewAll = el('button', { type: 'button', className: 'caregiver-dash-view-all' }, viewAllLabel);
    viewAll.addEventListener('click', () => navigate(viewAllPath));
    head.append(viewAll);
  }
  panel.append(head);

  if (checks.length === 0) {
    panel.append(el('p', { className: 'caregiver-dash-empty' }, 'No recurring checks set up.'));
    return panel;
  }

  const grid = el('div', {
    className: `caregiver-dash-check-grid${readOnly ? ' caregiver-dash-check-grid--readonly' : ''}`,
  });
  grid.append(
    el('div', { className: 'caregiver-dash-check-row caregiver-dash-check-row--head' },
      el('span', { className: 'caregiver-dash-check-col-check' }, 'Check'),
      el('span', { className: 'caregiver-dash-check-col-date' }, 'Last checked'),
      el('span', { className: 'caregiver-dash-check-col-by' }, 'By'),
      el('span', { className: 'caregiver-dash-check-col-days' }, 'Days ago'),
      readOnly ? null : el('span', { className: 'caregiver-dash-check-col-action' }, '')
    )
  );
  for (const check of checks.slice(0, max)) {
    grid.append(renderCompactRecurringCheckRow(check, profileId, refresh, readOnly));
  }
  panel.append(el('div', { className: 'caregiver-dash-check-table' }, grid));
  return panel;
}

function renderCompactRecurringCheckRow(
  check: RecurringCheckWithStatus,
  profileId: string | undefined,
  refresh: () => void | Promise<void>,
  readOnly = false
): HTMLElement {
  const completedAt = check.last_completion?.completed_at;
  const who = check.last_completion?.completed_by_profile?.display_name;

  let actionCell: HTMLElement | null = null;
  if (!readOnly) {
    const completeBtn = el('button', { className: 'btn btn-primary btn-sm', type: 'button' }, 'Mark Checked');
    completeBtn.addEventListener('click', async () => {
      if (!profileId) return;
      completeBtn.disabled = true;
      try {
        await api.completeRecurringCheck(check.id, profileId);
        await refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Could not record check');
        completeBtn.disabled = false;
      }
    });
    actionCell = el('span', { className: 'caregiver-dash-check-col-action' }, completeBtn);
  }

  return el('div', { className: 'caregiver-dash-check-row' },
    el('span', { className: 'caregiver-dash-check-col-check caregiver-dash-check-title' }, check.title),
    el('span', { className: 'caregiver-dash-check-col-date' },
      completedAt
        ? formatDate(completedAt)
        : el('span', { className: 'caregiver-dash-check-warn' }, '—')
    ),
    el('span', { className: 'caregiver-dash-check-col-by' },
      who
        ? who
        : el('span', { className: 'caregiver-dash-check-warn' }, '—')
    ),
    el('span', { className: 'caregiver-dash-check-col-days' },
      completedAt
        ? daysSinceLabel(completedAt)
        : el('span', { className: 'caregiver-dash-check-warn' }, 'Never')
    ),
    actionCell
  );
}

function renderRecurringCheckCard(
  check: RecurringCheckWithStatus,
  profileId: string | undefined,
  refresh: () => void | Promise<void>
): HTMLElement {
  const header = el('div', { className: 'caregiver-task-card-header' },
    el('h3', { className: 'caregiver-task-card-title' }, check.title)
  );

  const body = el('div', { className: 'caregiver-task-card-body' });
  if (check.description) {
    body.append(el('p', { className: 'caregiver-task-card-desc' }, check.description));
  }

  if (check.last_completion) {
    const who = check.last_completion.completed_by_profile?.display_name ?? 'Someone';
    const completedAt = check.last_completion.completed_at;
    body.append(
      el('p', { className: 'recurring-check-last' },
        `Last checked ${formatDate(completedAt)} by ${who} (${daysSinceLabel(completedAt)})`
      )
    );
  } else {
    body.append(el('p', { className: 'recurring-check-last recurring-check-never' }, 'Not yet checked'));
  }

  const card = el('div', { className: 'card task-card caregiver-task-card recurring-check-card' }, header, body);

  const actions = el('div', { className: 'task-actions caregiver-task-actions' });
  const completeBtn = el(
    'button',
    { className: 'btn btn-primary', type: 'button' },
    icon('check-circle'),
    'Mark checked'
  );
  completeBtn.addEventListener('click', async () => {
    if (!profileId) return;
    completeBtn.disabled = true;
    try {
      await api.completeRecurringCheck(check.id, profileId);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not record check');
      completeBtn.disabled = false;
    }
  });
  actions.append(completeBtn);
  card.append(actions);

  return card;
}
