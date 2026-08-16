import { api } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { el, emptyState, formatDateTime } from '../../shared/utils';
import { icon } from '../../shared/icons';
import type { RecurringCheckWithStatus } from '../../shared/types';

export async function renderRecurringChecksSection(
  refresh: () => void | Promise<void>
): Promise<HTMLElement> {
  const session = getSession();
  const profileId = session.profile?.id;
  const checks = await api.getRecurringChecksWithStatus();

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
    body.append(
      el('p', { className: 'recurring-check-last' },
        `Last checked ${formatDateTime(check.last_completion.completed_at)} by ${who}`
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
