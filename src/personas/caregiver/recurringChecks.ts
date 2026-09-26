import { api } from '../../shared/api';
import { getSession } from '../../shared/auth';
import {
  RECURRING_CHECK_STOCK_OPTIONS,
  stockLevelBadge,
  stockLevelLabel,
} from '../../shared/recurringCheckStock';
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
      'Verify these on every visit — choose Full, Low, or Out so the family knows current stock.'
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
    className: `caregiver-dash-check-grid caregiver-dash-check-grid--stock${readOnly ? ' caregiver-dash-check-grid--readonly' : ''}`,
  });
  grid.append(
    el('div', { className: 'caregiver-dash-check-row caregiver-dash-check-row--head' },
      el('span', { className: 'caregiver-dash-check-col-check' }, 'Check'),
      el('span', { className: 'caregiver-dash-check-col-stock' }, 'Stock'),
      el('span', { className: 'caregiver-dash-check-col-date' }, 'Last checked'),
      el('span', { className: 'caregiver-dash-check-col-by' }, 'By'),
      el('span', { className: 'caregiver-dash-check-col-days' }, 'Days ago'),
      readOnly ? null : el('span', { className: 'caregiver-dash-check-col-action' }, 'Update')
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
  const stock = check.last_completion?.stock_level;

  let actionCell: HTMLElement | null = null;
  if (!readOnly) {
    actionCell = el('span', { className: 'caregiver-dash-check-col-action' },
      createStockLevelButtons(check.id, profileId, refresh, 'sm')
    );
  }

  return el('div', { className: 'caregiver-dash-check-row' },
    el('span', { className: 'caregiver-dash-check-col-check caregiver-dash-check-title' }, check.title),
    el('span', { className: 'caregiver-dash-check-col-stock' },
      stock
        ? stockLevelBadge(stock)
        : el('span', { className: 'caregiver-dash-check-warn' }, '—')
    ),
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
    const stock = check.last_completion.stock_level;
    body.append(
      el('p', { className: 'recurring-check-last' },
        `Stock: ${stockLevelLabel(stock)} · Last checked ${formatDate(completedAt)} by ${who} (${daysSinceLabel(completedAt)})`
      ),
      stockLevelBadge(stock)
    );
  } else {
    body.append(el('p', { className: 'recurring-check-last recurring-check-never' }, 'Not yet checked'));
  }

  const card = el('div', { className: 'card task-card caregiver-task-card recurring-check-card' }, header, body);

  const actions = el('div', { className: 'task-actions caregiver-task-actions recurring-check-stock-actions' });
  actions.append(
    el('span', { className: 'recurring-check-stock-actions-label' }, 'Current stock:'),
    createStockLevelButtons(check.id, profileId, refresh)
  );
  card.append(actions);

  return card;
}

function createStockLevelButtons(
  checkId: string,
  profileId: string | undefined,
  refresh: () => void | Promise<void>,
  size: 'sm' | 'md' = 'md'
): HTMLElement {
  const wrap = el('div', { className: `stock-level-buttons stock-level-buttons--${size}` });
  for (const opt of RECURRING_CHECK_STOCK_OPTIONS) {
    const btn = el(
      'button',
      {
        type: 'button',
        className: `btn stock-level-btn stock-level-btn--${opt.value}${size === 'sm' ? ' btn-sm' : ''}`,
      },
      opt.label
    );
    btn.addEventListener('click', async () => {
      if (!profileId) return;
      wrap.querySelectorAll('button').forEach((b) => { (b as HTMLButtonElement).disabled = true; });
      try {
        await api.completeRecurringCheck(checkId, profileId, opt.value);
        await refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Could not record check');
        wrap.querySelectorAll('button').forEach((b) => { (b as HTMLButtonElement).disabled = false; });
      }
    });
    wrap.append(btn);
  }
  return wrap;
}
