import { api } from '../../shared/api';
import { renderAdminShell } from '../shared/shell';
import { el, formatDateTime, emptyState } from '../../shared/utils';
import { icon } from '../../shared/icons';
import { PERSONA_LABELS, type ActivityLog } from '../../shared/types';

const ACTION_LABELS: Record<string, string> = {
  'auth.sign_in': 'Signed in',
  'auth.sign_out': 'Signed out',
  'auth.persona_switch': 'Switched persona',
  'auth.invite_user': 'Invited user',
  'auth.pin_set': 'Updated PIN',
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
  'reminder.create': 'Created reminder',
  'reminder.update': 'Updated reminder',
  'reminder.delete': 'Deleted reminder',
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

function formatDetails(log: ActivityLog): string | null {
  const meta = log.metadata;
  if (!meta || Object.keys(meta).length === 0) return null;

  if (typeof meta.title === 'string') return meta.title;
  if (typeof meta.name === 'string') return meta.name;
  if (typeof meta.body === 'string') return meta.body;
  if (typeof meta.email === 'string') return meta.email;
  if (typeof meta.detail === 'string') return meta.detail;
  if (typeof meta.persona === 'string') return `Persona: ${PERSONA_LABELS[meta.persona as keyof typeof PERSONA_LABELS] ?? meta.persona}`;
  if (typeof meta.count === 'number') return `${meta.count} items`;
  if (Array.isArray(meta.fields)) return `Fields: ${meta.fields.join(', ')}`;

  const status = meta.status;
  if (typeof status === 'string') return `Status: ${status}`;

  return null;
}

export async function renderAdminActivity(): Promise<void> {
  const content = el('div', {});

  content.append(
    el('h2', {}, 'Activity Log'),
    el('p', { className: 'text-muted', style: 'margin-bottom:1rem' },
      'A record of actions taken by all users in the app.'
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
      const list = el('div', { className: 'activity-log-list' });
      for (const log of logs) {
        list.append(renderActivityEntry(log));
      }
      content.append(list);
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
  const details = formatDetails(log);
  const card = el('div', { className: 'card activity-log-entry' },
    el('div', { className: 'activity-log-header' },
      el('div', { className: 'activity-log-icon' }, icon('activity')),
      el('div', { className: 'activity-log-summary' },
        el('p', { className: 'activity-log-action' }, formatAction(log.action)),
        el('p', { className: 'activity-log-meta' },
          `${formatActor(log)} · ${formatDateTime(log.created_at)}`
        )
      )
    )
  );

  if (details) {
    card.append(el('p', { className: 'activity-log-details' }, details));
  }

  return card;
}
