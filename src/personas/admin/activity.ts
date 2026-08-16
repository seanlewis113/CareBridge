import { api } from '../../shared/api';
import { renderAdminShell } from '../shared/shell';
import { el, formatDateTime, emptyState } from '../../shared/utils';
import { icon } from '../../shared/icons';
import { isActivityReverted, isRevertible, revertActivity } from '../../shared/revertActivity';
import { PERSONA_LABELS, type ActivityLog } from '../../shared/types';

const ACTION_LABELS: Record<string, string> = {
  'auth.sign_in': 'Signed in',
  'auth.sign_out': 'Signed out',
  'auth.persona_switch': 'Switched persona',
  'auth.invite_user': 'Invited user',
  'auth.pin_set': 'Updated PIN',
  'auth.pin_verify': 'Verified PIN',
  'auth.pin_fail': 'Failed PIN entry',
  'auth.financial_unlock': 'Unlocked financials',
  'auth.financial_lock': 'Locked financials',
  'settings.update': 'Updated settings',
  'profile.upsert': 'Updated user profile',
  'calendar.create': 'Created calendar event',
  'calendar.update': 'Updated calendar event',
  'calendar.delete': 'Deleted calendar event',
  'calendar.sync': 'Synced Google Calendar',
  'calendar.oauth_connect': 'Connected Google Calendar',
  'task.create': 'Created task',
  'task.update': 'Updated task',
  'task.delete': 'Deleted task',
  'task.assign': 'Assigned task',
  'task.unassign': 'Unassigned task',
  'task.claim': 'Claimed task',
  'reminder.create': 'Created reminder',
  'reminder.update': 'Updated reminder',
  'reminder.delete': 'Deleted reminder',
  'recurring_check.create': 'Created recurring check',
  'recurring_check.update': 'Updated recurring check',
  'recurring_check.delete': 'Deleted recurring check',
  'recurring_check.complete': 'Completed recurring check',
  'visit_note.create': 'Logged visit note',
  'document.create': 'Uploaded document',
  'document.delete': 'Deleted document',
  'document.view': 'Viewed document',
  'family_update.create': 'Posted family update',
  'financial_account.update': 'Updated financial account',
  'financial.refresh_balance': 'Refreshed account balance',
  'financial.access': 'Financial access',
  'transaction.import': 'Imported transactions',
};

function formatAction(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/\./g, ' ').replace(/_/g, ' ');
}

function formatActor(log: ActivityLog): string {
  if (log.profile?.display_name) return log.profile.display_name;
  if (log.persona) return PERSONA_LABELS[log.persona];
  return 'Unknown';
}

function formatDetails(log: ActivityLog): string {
  const meta = log.metadata;
  if (!meta || Object.keys(meta).length === 0) return '—';

  if (typeof meta.title === 'string') return meta.title;
  if (typeof meta.display_name === 'string') return meta.display_name;
  if (typeof meta.name === 'string') return meta.name;
  if (typeof meta.body === 'string') return meta.body;
  if (typeof meta.email === 'string') return meta.email;
  if (typeof meta.detail === 'string') return meta.detail;
  if (typeof meta.persona === 'string') {
    return `Persona: ${PERSONA_LABELS[meta.persona as keyof typeof PERSONA_LABELS] ?? meta.persona}`;
  }
  if (typeof meta.count === 'number') return `${meta.count} items`;
  if (Array.isArray(meta.fields)) return `Fields: ${meta.fields.join(', ')}`;

  const snapshot = meta.snapshot;
  if (snapshot && typeof snapshot === 'object') {
    const snap = snapshot as Record<string, unknown>;
    if (typeof snap.title === 'string') return snap.title;
    if (typeof snap.body === 'string') return snap.body;
    if (typeof snap.name === 'string') return snap.name;
  }

  const status = meta.status;
  if (typeof status === 'string') return `Status: ${status}`;

  return '—';
}

export async function renderAdminActivity(): Promise<void> {
  const content = el('div', {});

  content.append(
    el('h2', {}, 'Activity Log'),
    el('p', { className: 'text-muted', style: 'margin-bottom:1rem' },
      'A record of actions taken by all users. Revertible actions can be undone from here.'
    )
  );

  try {
    const logs = await api.getActivityLogs();

    if (logs.length === 0) {
      content.append(emptyState(
        icon('activity'),
        'No activity yet',
        'Actions taken by users will appear here.'
      ));
    } else {
      const table = el('div', { className: 'card activity-log-table' },
        el('div', { className: 'card-table' },
          el('div', { className: 'card-table-header' },
            el('div', { className: 'card-table-row card-table-row--activity' },
              el('span', {}, 'Action'),
              el('span', {}, 'Detail'),
              el('span', {}, 'User'),
              el('span', {}, 'Time'),
              el('span', {}, '')
            )
          ),
          el('div', { className: 'activity-log-list card-table-body', id: 'activity-log-body' })
        )
      );
      const body = table.querySelector('#activity-log-body')!;
      for (const log of logs) {
        body.append(renderActivityEntry(log));
      }
      content.append(table);
    }
  } catch (err) {
    console.error('Failed to load activity log:', err);
    content.append(
      el('div', { className: 'card', style: 'border-color:var(--color-warning,#d97706)' },
        el('p', { style: 'margin:0;font-size:0.95rem' },
          'Could not load the activity log. Run the latest Supabase migrations (activity_log table) and refresh.'
        )
      )
    );
  }

  renderAdminShell(content, '/admin/activity');
}

function renderActivityEntry(log: ActivityLog): HTMLElement {
  const reverted = isActivityReverted(log);
  const canRevert = isRevertible(log);
  const entry = el('div', {
    className: `activity-log-entry card-table-row card-table-row--activity${reverted ? ' reverted' : ''}`,
  });

  const actionCell = el('span', { style: 'font-weight:600' }, formatAction(log.action));
  if (reverted) {
    actionCell.append(el('span', {
      className: 'card-table-muted',
      style: 'margin-left:0.35rem;font-weight:500',
    }, '(reverted)'));
  }

  entry.append(
    actionCell,
    el('span', { className: 'card-table-muted' }, formatDetails(log)),
    el('span', { className: 'card-table-muted' }, formatActor(log)),
    el('span', { className: 'card-table-muted' }, formatDateTime(log.created_at)),
    el('span', { className: 'card-table-actions' })
  );

  const actions = entry.querySelector('.card-table-actions')!;
  if (canRevert) {
    const btn = el('button', {
      className: 'btn btn-secondary activity-log-revert-btn',
      type: 'button',
    }, 'Revert');
    btn.addEventListener('click', async () => {
      if (!confirm('Revert this action?')) return;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        await revertActivity(log);
        await renderAdminActivity();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Revert';
        alert(err instanceof Error ? err.message : 'Could not revert this action.');
      }
    });
    actions.append(btn);
  }

  return entry;
}
