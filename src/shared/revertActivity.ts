import { api } from './api';
import type {
  ActivityLog,
  AppSettings,
  CalendarEvent,
  FinancialAccount,
  Reminder,
  Task,
} from './types';

function metaSnapshot<T>(log: ActivityLog): T | null {
  const snapshot = log.metadata?.snapshot;
  return snapshot && typeof snapshot === 'object' ? (snapshot as T) : null;
}

function metaPrevious<T extends object>(log: ActivityLog): Partial<T> | null {
  const previous = log.metadata?.previous;
  return previous && typeof previous === 'object' ? (previous as Partial<T>) : null;
}

export function isActivityReverted(log: ActivityLog): boolean {
  return log.metadata?.reverted === true;
}

export function isRevertible(log: ActivityLog): boolean {
  if (isActivityReverted(log)) return false;

  switch (log.action) {
    case 'task.create':
    case 'reminder.create':
    case 'calendar.create':
    case 'document.create':
    case 'family_update.create':
      return !!log.entity_id;
    case 'task.delete':
    case 'reminder.delete':
    case 'calendar.delete':
      return !!metaSnapshot(log);
    case 'task.update':
    case 'reminder.update':
    case 'calendar.update':
    case 'financial_account.update':
    case 'settings.update':
      return !!metaPrevious(log);
    case 'task.assign':
    case 'task.unassign':
      return !!log.entity_id && typeof log.metadata?.profile_id === 'string';
    default:
      return false;
  }
}

export async function revertActivity(log: ActivityLog): Promise<void> {
  if (!isRevertible(log)) {
    throw new Error('This action cannot be reverted.');
  }

  switch (log.action) {
    case 'task.create':
      await api.deleteTask(log.entity_id!);
      break;
    case 'task.delete':
      await api.restoreTask(metaSnapshot<Task>(log)!);
      break;
    case 'task.update':
      await api.updateTask(log.entity_id!, metaPrevious<Task>(log)!);
      break;
    case 'task.assign':
      await api.unassignTask(log.entity_id!, log.metadata.profile_id as string);
      break;
    case 'task.unassign':
      await api.assignTask(log.entity_id!, log.metadata.profile_id as string);
      break;
    case 'calendar.create':
      await api.deleteCalendarEvent(log.entity_id!);
      break;
    case 'calendar.delete':
      await api.restoreCalendarEvent(metaSnapshot<CalendarEvent>(log)!);
      break;
    case 'calendar.update':
      await api.updateCalendarEvent(log.entity_id!, metaPrevious<CalendarEvent>(log)!);
      break;
    case 'reminder.create':
      await api.deleteReminder(log.entity_id!);
      break;
    case 'reminder.delete':
      await api.restoreReminder(metaSnapshot<Reminder>(log)!);
      break;
    case 'reminder.update':
      await api.updateReminder(log.entity_id!, metaPrevious<Reminder>(log)!);
      break;
    case 'document.create':
      await api.deleteDocument(log.entity_id!);
      break;
    case 'family_update.create':
      await api.deleteFamilyUpdate(log.entity_id!);
      break;
    case 'financial_account.update':
      await api.updateFinancialAccount(log.entity_id!, metaPrevious<FinancialAccount>(log)!);
      break;
    case 'settings.update':
      await api.updateSettings(metaPrevious<AppSettings>(log)!);
      break;
    default:
      throw new Error('This action cannot be reverted.');
  }

  await api.markActivityReverted(log.id);
}
