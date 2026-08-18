import { getSupabase as getSupabaseClient, isSupabaseConfigured } from './supabase';
import { notifyLocalDataChange } from './realtime';
import { loadLocalStore, saveLocalStore } from './localStore';
import { expandRecurringEvents, getSourceEventId } from './calendarRecurrence';
import type {
  ActivityLog,
  AppSettings,
  CalendarEvent,
  CalendarSyncChanges,
  CalendarSyncResult,
  Document,
  FamilyUpdate,
  FinancialAccount,
  Persona,
  Profile,
  Reminder,
  RecurringCheck,
  RecurringCheckCompletion,
  RecurringCheckWithStatus,
  ResponsibilityArea,
  ResponsibilityAssignment,
  MotherHubTask,
  Task,
  TaskAssignment,
  Transaction,
  VisitNote,
} from './types';
import { isHiddenTransaction, isMotherHubHiddenTransaction } from './transactionFilters';

type TableName = keyof ReturnType<typeof loadLocalStore>;

function db() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getSupabaseClient() as any;
}

function getLocal<T extends TableName>(table: T) {
  return loadLocalStore()[table];
}

function updateLocal<T extends TableName>(table: T, updater: (items: LocalStore[T]) => LocalStore[T]) {
  const store = loadLocalStore();
  store[table] = updater(store[table] as LocalStore[T]);
  saveLocalStore(store);
  return store[table];
}

type LocalStore = ReturnType<typeof loadLocalStore>;

const SESSION_KEY = 'moms-care-session';

function isMotherDeviceSession(): boolean {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const session = JSON.parse(raw) as { persona?: string; motherPinVerified?: boolean };
    return session.persona === 'mother' && session.motherPinVerified === true;
  } catch {
    return false;
  }
}

interface ActivityContext {
  profileId: string | null;
  persona: Persona | null;
}

let activityContext: ActivityContext = { profileId: null, persona: null };

let recurringChecksSchemaReady = !isSupabaseConfigured;
let responsibilitySchemaReady = !isSupabaseConfigured;

export function isRecurringChecksSchemaReady(): boolean {
  return recurringChecksSchemaReady;
}

export function isResponsibilitySchemaReady(): boolean {
  return responsibilitySchemaReady;
}

function isMissingDbTableError(error: unknown, tableHint?: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string; details?: string };
  const text = `${e.message ?? ''} ${e.details ?? ''}`.toLowerCase();
  const tableMatch = tableHint
    ? text.includes(tableHint) && text.includes('does not exist')
    : text.includes('recurring_check') && text.includes('does not exist');
  return (
    e.code === 'PGRST205' ||
    e.code === '42P01' ||
    tableMatch ||
    text.includes('could not find the table')
  );
}

export function setActivityContext(ctx: ActivityContext): void {
  activityContext = ctx;
}

function pickPrevious<T extends object>(before: T, updates: Partial<T>): Partial<T> {
  const previous = {} as Partial<T>;
  for (const key of Object.keys(updates) as (keyof T)[]) {
    previous[key] = before[key];
  }
  return previous;
}

function resolveTaskHelperName(
  task: Task,
  profiles: Profile[],
  assignments: TaskAssignment[]
): string | null {
  const assignedIds = assignments
    .filter((a) => a.task_id === task.id)
    .map((a) => a.profile_id);
  const names = profiles
    .filter((p) => assignedIds.includes(p.id))
    .map((p) => p.display_name);

  if (names.length === 1) return names[0];
  if (names.length > 1) return names.join(' & ');
  return null;
}

export const api = {
  async getSettings(): Promise<AppSettings> {
    if (isSupabaseConfigured) {
      const { data: authData } = await getSupabaseClient().auth.getSession();
      if (!authData.session && isMotherDeviceSession()) {
        const { data, error } = await db().rpc('get_mother_hub_settings');
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) throw new Error('App settings not found');
        return {
          id: 'default',
          mother_name: row.mother_name,
          text_scale: row.text_scale,
          mother_pin_hash: null,
          admin_switch_pin_hash: null,
          financial_pin_hash: null,
          google_calendar_id: null,
          google_refresh_token: null,
        };
      }

      const { data, error } = await db()
        .from('app_settings')
        .select('*')
        .eq('id', 'default')
        .single();
      if (error) throw error;
      return data as AppSettings;
    }
    return getLocal('settings');
  },

  async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    if (isSupabaseConfigured) {
      const before = await this.getSettings();
      const { data, error } = await db()
        .from('app_settings')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', 'default')
        .select()
        .single();
      if (error) throw error;
      await this.logActivity('settings.update', {
        metadata: { fields: Object.keys(updates), previous: pickPrevious(before, updates) },
      });
      return data as AppSettings;
    }
    const settings = { ...getLocal('settings'), ...updates };
    updateLocal('settings', () => settings);
    return settings;
  },

  async getProfiles(): Promise<Profile[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('profiles').select('*').order('display_name');
      if (error) throw error;
      return data as Profile[];
    }
    return getLocal('profiles');
  },

  async getProfile(id: string): Promise<Profile | null> {
    const profiles = await this.getProfiles();
    return profiles.find((p) => p.id === id) ?? null;
  },

  async upsertProfile(profile: Profile): Promise<Profile> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('profiles').upsert(profile).select().single();
      if (error) throw error;
      await this.logActivity('profile.upsert', {
        entityType: 'profile',
        entityId: profile.id,
        metadata: { display_name: profile.display_name, persona: profile.persona },
      });
      return data as Profile;
    }
    updateLocal('profiles', (items) => {
      const idx = items.findIndex((p) => p.id === profile.id);
      if (idx >= 0) items[idx] = profile;
      else items.push(profile);
      return items;
    });
    return profile;
  },

  async getUpcomingEvents(days = 7): Promise<CalendarEvent[]> {
    const now = new Date();
    const end = new Date(now.getTime() + days * 86400000);
    return this.getCalendarEvents(now.toISOString(), end.toISOString());
  },

  async getCalendarEvents(from?: string, to?: string): Promise<CalendarEvent[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('calendar_events').select('*').order('start_at');
      if (error) throw error;
      return expandRecurringEvents(data as CalendarEvent[], from, to);
    }
    const events = getLocal('calendar_events');
    return expandRecurringEvents(events, from, to);
  },

  async getCalendarEvent(id: string): Promise<CalendarEvent | null> {
    const sourceId = getSourceEventId(id);
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('calendar_events').select('*').eq('id', sourceId).single();
      if (error) return null;
      return data as CalendarEvent;
    }
    return getLocal('calendar_events').find((e) => e.id === sourceId) ?? null;
  },

  async createCalendarEvent(event: Omit<CalendarEvent, 'id' | 'created_at' | 'synced_at'>): Promise<CalendarEvent> {
    const newEvent: CalendarEvent = {
      ...event,
      id: crypto.randomUUID(),
      synced_at: null,
      created_at: new Date().toISOString(),
    };

    if (isSupabaseConfigured) {
      const { data, error } = await db().from('calendar_events').insert(newEvent).select().single();
      if (error) throw error;
      const created = data as CalendarEvent;
      await this.syncEventToGoogle(created);
      await this.logActivity('calendar.create', {
        entityType: 'calendar_event',
        entityId: created.id,
        metadata: { title: created.title },
      });
      return created;
    }

    updateLocal('calendar_events', (items) => [...items, newEvent]);
    return newEvent;
  },

  async updateCalendarEvent(id: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent> {
    if (isSupabaseConfigured) {
      const { data: before, error: beforeError } = await db()
        .from('calendar_events')
        .select('*')
        .eq('id', id)
        .single();
      if (beforeError) throw beforeError;
      const { data, error } = await db()
        .from('calendar_events')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      const updated = data as CalendarEvent;
      await this.syncEventToGoogle(updated);
      await this.logActivity('calendar.update', {
        entityType: 'calendar_event',
        entityId: id,
        metadata: { changes: updates, previous: pickPrevious(before as CalendarEvent, updates) },
      });
      return data as CalendarEvent;
    }
    let updated!: CalendarEvent;
    updateLocal('calendar_events', (items) =>
      items.map((e) => {
        if (e.id === id) {
          updated = { ...e, ...updates };
          return updated;
        }
        return e;
      })
    );
    return updated;
  },

  async deleteCalendarEvent(id: string): Promise<void> {
    const sourceId = getSourceEventId(id);
    if (isSupabaseConfigured) {
      const { data: snapshot, error: fetchError } = await db()
        .from('calendar_events')
        .select('*')
        .eq('id', sourceId)
        .single();
      if (fetchError) throw fetchError;
      const { error } = await db().from('calendar_events').delete().eq('id', sourceId);
      if (error) throw error;
      await this.logActivity('calendar.delete', {
        entityType: 'calendar_event',
        entityId: sourceId,
        metadata: { snapshot, title: (snapshot as CalendarEvent).title },
      });
      return;
    }
    updateLocal('calendar_events', (items) => items.filter((e) => e.id !== sourceId));
  },

  async restoreCalendarEvent(snapshot: CalendarEvent): Promise<CalendarEvent> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('calendar_events').insert(snapshot).select().single();
      if (error) throw error;
      await this.logActivity('calendar.create', {
        entityType: 'calendar_event',
        entityId: (data as CalendarEvent).id,
        metadata: { title: snapshot.title, restored: true },
      });
      return data as CalendarEvent;
    }
    updateLocal('calendar_events', (items) => [...items, snapshot]);
    return snapshot;
  },

  async syncCalendarFromGoogle(): Promise<CalendarSyncResult> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().functions.invoke('google-calendar-sync', {
        body: { action: 'pull' },
      });
      const payload = (data ?? {}) as {
        events?: CalendarEvent[];
        changes?: CalendarSyncChanges;
        error?: string;
      };
      if (payload.error) {
        throw new Error(payload.error);
      }
      if (error) {
        const context = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
        if (context?.json) {
          try {
            const errBody = await context.json();
            if (errBody?.error) throw new Error(errBody.error);
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr;
          }
        }
        throw error;
      }
      const events = (payload.events ?? []) as CalendarEvent[];
      const changes = payload.changes ?? { added: [], updated: [], removed: [] };
      await this.logActivity('calendar.sync', {
        metadata: {
          event_count: events.length,
          added: changes.added.length,
          updated: changes.updated.length,
          removed: changes.removed.length,
        },
      });
      return { events, changes };
    }
    const events = await this.getCalendarEvents();
    return { events, changes: { added: [], updated: [], removed: [] } };
  },

  async syncEventToGoogle(event: CalendarEvent): Promise<void> {
    if (!isSupabaseConfigured) return;
    await db().functions.invoke('google-calendar-sync', {
      body: { action: 'push', event },
    });
  },

  async getTasks(): Promise<Task[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('tasks').select('*').order('due_at');
      if (error) throw error;
      return (data ?? []).map((t: Task) => ({
        ...t,
        checklist: Array.isArray(t.checklist) ? t.checklist : [],
        show_on_mother_hub: t.show_on_mother_hub !== false,
      })) as Task[];
    }
    return getLocal('tasks').map((t) => ({
      ...t,
      show_on_mother_hub: t.show_on_mother_hub !== false,
    }));
  },

  async createTask(task: Omit<Task, 'id' | 'created_at'>): Promise<Task> {
    const newTask: Task = { ...task, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('tasks').insert(newTask).select().single();
      if (error) throw error;
      await this.logActivity('task.create', {
        entityType: 'task',
        entityId: (data as Task).id,
        metadata: { title: newTask.title },
      });
      return { ...(data as Task), checklist: newTask.checklist, show_on_mother_hub: (data as Task).show_on_mother_hub !== false };
    }
    updateLocal('tasks', (items) => [...items, newTask]);
    notifyLocalDataChange('tasks');
    return newTask;
  },

  async updateTask(id: string, updates: Partial<Task>): Promise<Task> {
    if (isSupabaseConfigured) {
      const { data: before, error: beforeError } = await db().from('tasks').select('*').eq('id', id).single();
      if (beforeError) throw beforeError;
      const { data, error } = await db().from('tasks').update(updates).eq('id', id).select().single();
      if (error) throw error;
      await this.logActivity('task.update', {
        entityType: 'task',
        entityId: id,
        metadata: { changes: updates, previous: pickPrevious(before as Task, updates) },
      });
      return data as Task;
    }
    let updated!: Task;
    updateLocal('tasks', (items) =>
      items.map((t) => {
        if (t.id === id) {
          updated = { ...t, ...updates };
          return updated;
        }
        return t;
      })
    );
    notifyLocalDataChange('tasks');
    return updated;
  },

  async deleteTask(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { data: snapshot, error: fetchError } = await db().from('tasks').select('*').eq('id', id).single();
      if (fetchError) throw fetchError;
      const { error } = await db().from('tasks').delete().eq('id', id);
      if (error) throw error;
      await this.logActivity('task.delete', {
        entityType: 'task',
        entityId: id,
        metadata: { snapshot, title: (snapshot as Task).title },
      });
      return;
    }
    const snapshot = getLocal('tasks').find((t) => t.id === id);
    updateLocal('tasks', (items) => items.filter((t) => t.id !== id));
    updateLocal('task_assignments', (items) => items.filter((a) => a.task_id !== id));
    if (snapshot) {
      await this.logActivity('task.delete', {
        entityType: 'task',
        entityId: id,
        metadata: { snapshot, title: snapshot.title },
      });
    }
    notifyLocalDataChange('tasks');
  },

  async restoreTask(snapshot: Task): Promise<Task> {
    const task: Task = {
      ...snapshot,
      checklist: Array.isArray(snapshot.checklist) ? snapshot.checklist : [],
      show_on_mother_hub: snapshot.show_on_mother_hub !== false,
    };
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('tasks').insert(task).select().single();
      if (error) throw error;
      await this.logActivity('task.create', {
        entityType: 'task',
        entityId: (data as Task).id,
        metadata: { title: task.title, restored: true },
      });
      return { ...(data as Task), checklist: task.checklist, show_on_mother_hub: task.show_on_mother_hub };
    }
    updateLocal('tasks', (items) => [...items, task]);
    return task;
  },

  async getTaskAssignments(): Promise<TaskAssignment[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('task_assignments').select('*');
      if (error) throw error;
      return data as TaskAssignment[];
    }
    return getLocal('task_assignments');
  },

  async assignTask(
    taskId: string,
    profileId: string,
    options?: { log?: boolean }
  ): Promise<TaskAssignment> {
    const profile = await this.getProfile(profileId);
    const existingAssignments = await this.getTaskAssignments();
    const existing = existingAssignments.find(
      (a) => a.task_id === taskId && a.profile_id === profileId
    );
    if (existing) return existing;

    const assignment: TaskAssignment = { id: crypto.randomUUID(), task_id: taskId, profile_id: profileId };
    const shouldLog = options?.log !== false;
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('task_assignments').insert(assignment).select().single();
      if (error) throw error;
      if (shouldLog) {
        await this.logActivity('task.assign', {
          entityType: 'task',
          entityId: taskId,
          metadata: {
            profile_id: profileId,
            display_name: profile?.display_name ?? 'Unknown',
          },
        });
      }
      return data as TaskAssignment;
    }
    updateLocal('task_assignments', (items) => [...items, assignment]);
    if (shouldLog) {
      await this.logActivity('task.assign', {
        entityType: 'task',
        entityId: taskId,
        metadata: {
          profile_id: profileId,
          display_name: profile?.display_name ?? 'Unknown',
        },
      });
    }
    notifyLocalDataChange('task_assignments');
    return assignment;
  },

  async unassignTask(taskId: string, profileId: string): Promise<void> {
    const profile = await this.getProfile(profileId);
    if (isSupabaseConfigured) {
      const { error } = await db()
        .from('task_assignments')
        .delete()
        .eq('task_id', taskId)
        .eq('profile_id', profileId);
      if (error) throw error;
      await this.logActivity('task.unassign', {
        entityType: 'task',
        entityId: taskId,
        metadata: {
          profile_id: profileId,
          display_name: profile?.display_name ?? 'Unknown',
        },
      });
      return;
    }
    updateLocal('task_assignments', (items) =>
      items.filter((a) => !(a.task_id === taskId && a.profile_id === profileId))
    );
    await this.logActivity('task.unassign', {
      entityType: 'task',
      entityId: taskId,
      metadata: {
        profile_id: profileId,
        display_name: profile?.display_name ?? 'Unknown',
      },
    });
    notifyLocalDataChange('task_assignments');
  },

  async claimTask(taskId: string, profileId: string): Promise<Task> {
    const profile = await this.getProfile(profileId);
    const [tasks, assignments] = await Promise.all([this.getTasks(), this.getTaskAssignments()]);
    const existing = tasks.find((t) => t.id === taskId);
    if (!existing) throw new Error('Task not found');

    const taskAssignments = assignments.filter((a) => a.task_id === taskId);
    if (taskAssignments.length > 0 && !taskAssignments.some((a) => a.profile_id === profileId)) {
      throw new Error('This task has already been claimed by someone else');
    }

    if (!taskAssignments.some((a) => a.profile_id === profileId)) {
      await this.assignTask(taskId, profileId, { log: false });
      await this.logActivity('task.claim', {
        entityType: 'task',
        entityId: taskId,
        metadata: {
          profile_id: profileId,
          display_name: profile?.display_name ?? 'Unknown',
        },
      });
    }

    return existing;
  },

  async getMotherHubTasks(): Promise<MotherHubTask[]> {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await db().rpc('get_mother_hub_tasks');
        if (!error) return (data ?? []) as MotherHubTask[];
      } catch {
        // Fall back if migration not applied yet
      }
    }

    const [tasks, profiles, assignments] = await Promise.all([
      this.getTasks(),
      this.getProfiles(),
      this.getTaskAssignments(),
    ]);

    return tasks
      .filter((t) => t.status !== 'completed' && t.show_on_mother_hub !== false)
      .sort((a, b) => {
        if (!a.due_at) return 1;
        if (!b.due_at) return -1;
        return a.due_at.localeCompare(b.due_at);
      })
      .map((task) => ({
        id: task.id,
        title: task.title,
        due_at: task.due_at,
        open_slot: task.open_slot,
        helper_name: resolveTaskHelperName(task, profiles, assignments),
      }))
      .filter((task) => task.helper_name || task.open_slot);
  },

  async getReminders(): Promise<Reminder[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('reminders').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as Reminder[];
    }
    return getLocal('reminders');
  },

  async createReminder(reminder: Omit<Reminder, 'id' | 'created_at'>): Promise<Reminder> {
    const newReminder: Reminder = {
      ...reminder,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('reminders').insert(newReminder).select().single();
      if (error) throw error;
      await this.logActivity('reminder.create', {
        entityType: 'reminder',
        entityId: (data as Reminder).id,
        metadata: { body: newReminder.body },
      });
      return data as Reminder;
    }
    updateLocal('reminders', (items) => [newReminder, ...items]);
    return newReminder;
  },

  async updateReminder(id: string, updates: Partial<Reminder>): Promise<Reminder> {
    if (isSupabaseConfigured) {
      const { data: before, error: beforeError } = await db().from('reminders').select('*').eq('id', id).single();
      if (beforeError) throw beforeError;
      const { data, error } = await db().from('reminders').update(updates).eq('id', id).select().single();
      if (error) throw error;
      await this.logActivity('reminder.update', {
        entityType: 'reminder',
        entityId: id,
        metadata: { changes: updates, previous: pickPrevious(before as Reminder, updates) },
      });
      return data as Reminder;
    }
    let updated!: Reminder;
    updateLocal('reminders', (items) =>
      items.map((r) => {
        if (r.id === id) {
          updated = { ...r, ...updates };
          return updated;
        }
        return r;
      })
    );
    return updated;
  },

  async deleteReminder(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { data: snapshot, error: fetchError } = await db().from('reminders').select('*').eq('id', id).single();
      if (fetchError) throw fetchError;
      const { error } = await db().from('reminders').delete().eq('id', id);
      if (error) throw error;
      await this.logActivity('reminder.delete', {
        entityType: 'reminder',
        entityId: id,
        metadata: { snapshot, body: (snapshot as Reminder).body },
      });
      return;
    }
    updateLocal('reminders', (items) => items.filter((r) => r.id !== id));
  },

  async restoreReminder(snapshot: Reminder): Promise<Reminder> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('reminders').insert(snapshot).select().single();
      if (error) throw error;
      await this.logActivity('reminder.create', {
        entityType: 'reminder',
        entityId: (data as Reminder).id,
        metadata: { body: snapshot.body, restored: true },
      });
      return data as Reminder;
    }
    updateLocal('reminders', (items) => [snapshot, ...items]);
    return snapshot;
  },

  async getRecurringChecks(): Promise<RecurringCheck[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db()
        .from('recurring_checks')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) {
        if (isMissingDbTableError(error)) {
          recurringChecksSchemaReady = false;
          return [];
        }
        throw error;
      }
      recurringChecksSchemaReady = true;
      return data as RecurringCheck[];
    }
    return getLocal('recurring_checks') ?? [];
  },

  async getRecurringChecksWithStatus(activeOnly = true): Promise<RecurringCheckWithStatus[]> {
    const checks = await this.getRecurringChecks();
    const visible = activeOnly ? checks.filter((c) => c.active) : checks;

    if (isSupabaseConfigured) {
      if (!recurringChecksSchemaReady) {
        return visible.map((check) => ({ ...check, last_completion: null }));
      }
      const { data, error } = await db()
        .from('recurring_check_completions')
        .select('*, completed_by_profile:profiles!completed_by(*)')
        .order('completed_at', { ascending: false });
      if (error) {
        if (isMissingDbTableError(error)) {
          recurringChecksSchemaReady = false;
          return visible.map((check) => ({ ...check, last_completion: null }));
        }
        throw error;
      }
      const completions = data as RecurringCheckCompletion[];
      return visible.map((check) => {
        const last = completions.find((c) => c.check_id === check.id);
        return { ...check, last_completion: last ?? null };
      });
    }

    const completions = getLocal('recurring_check_completions') ?? [];
    const profiles = getLocal('profiles');
    return visible.map((check) => {
      const last = completions
        .filter((c) => c.check_id === check.id)
        .sort((a, b) => b.completed_at.localeCompare(a.completed_at))[0];
      return {
        ...check,
        last_completion: last
          ? {
              ...last,
              completed_by_profile: profiles.find((p) => p.id === last.completed_by),
            }
          : null,
      };
    });
  },

  async createRecurringCheck(
    check: Omit<RecurringCheck, 'id' | 'created_at'>
  ): Promise<RecurringCheck> {
    const newCheck: RecurringCheck = {
      ...check,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    if (isSupabaseConfigured) {
      if (!recurringChecksSchemaReady) {
        throw new Error(
          'Recurring Checks tables are not set up yet. Run supabase/migrations/20260816100000_recurring_checks.sql in the Supabase SQL editor.'
        );
      }
      const { data, error } = await db()
        .from('recurring_checks')
        .insert(newCheck)
        .select()
        .single();
      if (error) {
        if (isMissingDbTableError(error)) {
          recurringChecksSchemaReady = false;
          throw new Error(
            'Recurring Checks tables are not set up yet. Run supabase/migrations/20260816100000_recurring_checks.sql in the Supabase SQL editor.'
          );
        }
        throw error;
      }
      await this.logActivity('recurring_check.create', {
        entityType: 'recurring_check',
        entityId: (data as RecurringCheck).id,
        metadata: { title: newCheck.title },
      });
      return data as RecurringCheck;
    }
    updateLocal('recurring_checks', (items) => [...items, newCheck]);
    notifyLocalDataChange('recurring_checks');
    return newCheck;
  },

  async updateRecurringCheck(
    id: string,
    updates: Partial<RecurringCheck>
  ): Promise<RecurringCheck> {
    if (isSupabaseConfigured) {
      const { data: before, error: beforeError } = await db()
        .from('recurring_checks')
        .select('*')
        .eq('id', id)
        .single();
      if (beforeError) throw beforeError;
      const { data, error } = await db()
        .from('recurring_checks')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      await this.logActivity('recurring_check.update', {
        entityType: 'recurring_check',
        entityId: id,
        metadata: { changes: updates, previous: pickPrevious(before as RecurringCheck, updates) },
      });
      return data as RecurringCheck;
    }
    let updated!: RecurringCheck;
    updateLocal('recurring_checks', (items) =>
      items.map((c) => {
        if (c.id === id) {
          updated = { ...c, ...updates };
          return updated;
        }
        return c;
      })
    );
    notifyLocalDataChange('recurring_checks');
    return updated;
  },

  async deleteRecurringCheck(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { data: snapshot, error: fetchError } = await db()
        .from('recurring_checks')
        .select('*')
        .eq('id', id)
        .single();
      if (fetchError) throw fetchError;
      const { error } = await db().from('recurring_checks').delete().eq('id', id);
      if (error) throw error;
      await this.logActivity('recurring_check.delete', {
        entityType: 'recurring_check',
        entityId: id,
        metadata: { snapshot, title: (snapshot as RecurringCheck).title },
      });
      return;
    }
    updateLocal('recurring_checks', (items) => items.filter((c) => c.id !== id));
    updateLocal('recurring_check_completions', (items) =>
      items.filter((c) => c.check_id !== id)
    );
    notifyLocalDataChange('recurring_checks');
  },

  async completeRecurringCheck(
    checkId: string,
    profileId: string,
    notes?: string | null
  ): Promise<RecurringCheckCompletion> {
    const completion: RecurringCheckCompletion = {
      id: crypto.randomUUID(),
      check_id: checkId,
      completed_by: profileId,
      completed_at: new Date().toISOString(),
      notes: notes ?? null,
    };
    if (isSupabaseConfigured) {
      const { data, error } = await db()
        .from('recurring_check_completions')
        .insert(completion)
        .select('*, completed_by_profile:profiles!completed_by(*)')
        .single();
      if (error) throw error;
      await this.logActivity('recurring_check.complete', {
        entityType: 'recurring_check',
        entityId: checkId,
        metadata: { completed_by: profileId },
      });
      return data as RecurringCheckCompletion;
    }
    updateLocal('recurring_check_completions', (items) => [completion, ...items]);
    notifyLocalDataChange('recurring_checks');
    return completion;
  },

  async getResponsibilityAreas(): Promise<ResponsibilityArea[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db()
        .from('responsibility_areas')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) {
        if (isMissingDbTableError(error, 'responsibility')) {
          responsibilitySchemaReady = false;
          return [];
        }
        throw error;
      }
      responsibilitySchemaReady = true;
      return data as ResponsibilityArea[];
    }
    return getLocal('responsibility_areas') ?? [];
  },

  async getResponsibilityAssignments(): Promise<ResponsibilityAssignment[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('responsibility_assignments').select('*');
      if (error) {
        if (isMissingDbTableError(error, 'responsibility')) {
          responsibilitySchemaReady = false;
          return [];
        }
        throw error;
      }
      return data as ResponsibilityAssignment[];
    }
    return getLocal('responsibility_assignments') ?? [];
  },

  async createResponsibilityArea(
    area: Omit<ResponsibilityArea, 'id' | 'created_at'>
  ): Promise<ResponsibilityArea> {
    const newArea: ResponsibilityArea = {
      ...area,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    if (isSupabaseConfigured) {
      if (!responsibilitySchemaReady) {
        throw new Error(
          'Who\'s Responsible tables are not set up yet. Run supabase/migrations/20260816130000_whos_responsible.sql in the Supabase SQL editor.'
        );
      }
      const { data, error } = await db()
        .from('responsibility_areas')
        .insert(newArea)
        .select()
        .single();
      if (error) {
        if (isMissingDbTableError(error, 'responsibility')) {
          responsibilitySchemaReady = false;
          throw new Error(
            'Who\'s Responsible tables are not set up yet. Run supabase/migrations/20260816130000_whos_responsible.sql in the Supabase SQL editor.'
          );
        }
        throw error;
      }
      await this.logActivity('responsibility.create', {
        entityType: 'responsibility_area',
        entityId: (data as ResponsibilityArea).id,
        metadata: { title: newArea.title },
      });
      return data as ResponsibilityArea;
    }
    updateLocal('responsibility_areas', (items) => [...items, newArea]);
    notifyLocalDataChange('responsibility_areas');
    return newArea;
  },

  async updateResponsibilityArea(
    id: string,
    updates: Partial<ResponsibilityArea>
  ): Promise<ResponsibilityArea> {
    if (isSupabaseConfigured) {
      const { data: before, error: beforeError } = await db()
        .from('responsibility_areas')
        .select('*')
        .eq('id', id)
        .single();
      if (beforeError) throw beforeError;
      const { data, error } = await db()
        .from('responsibility_areas')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      await this.logActivity('responsibility.update', {
        entityType: 'responsibility_area',
        entityId: id,
        metadata: { changes: updates, previous: pickPrevious(before as ResponsibilityArea, updates) },
      });
      return data as ResponsibilityArea;
    }
    let updated!: ResponsibilityArea;
    updateLocal('responsibility_areas', (items) =>
      items.map((a) => {
        if (a.id === id) {
          updated = { ...a, ...updates };
          return updated;
        }
        return a;
      })
    );
    notifyLocalDataChange('responsibility_areas');
    return updated;
  },

  async deleteResponsibilityArea(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { data: snapshot, error: fetchError } = await db()
        .from('responsibility_areas')
        .select('*')
        .eq('id', id)
        .single();
      if (fetchError) throw fetchError;
      const { error } = await db().from('responsibility_areas').delete().eq('id', id);
      if (error) throw error;
      await this.logActivity('responsibility.delete', {
        entityType: 'responsibility_area',
        entityId: id,
        metadata: { snapshot, title: (snapshot as ResponsibilityArea).title },
      });
      return;
    }
    updateLocal('responsibility_areas', (items) => items.filter((a) => a.id !== id));
    updateLocal('responsibility_assignments', (items) => items.filter((a) => a.area_id !== id));
    notifyLocalDataChange('responsibility_areas');
  },

  async assignResponsibility(areaId: string, profileId: string): Promise<ResponsibilityAssignment> {
    const profile = await this.getProfile(profileId);
    const existingAssignments = await this.getResponsibilityAssignments();
    const existing = existingAssignments.find(
      (a) => a.area_id === areaId && a.profile_id === profileId
    );
    if (existing) return existing;

    const assignment: ResponsibilityAssignment = {
      id: crypto.randomUUID(),
      area_id: areaId,
      profile_id: profileId,
    };
    if (isSupabaseConfigured) {
      const { data, error } = await db()
        .from('responsibility_assignments')
        .insert(assignment)
        .select()
        .single();
      if (error) throw error;
      await this.logActivity('responsibility.assign', {
        entityType: 'responsibility_area',
        entityId: areaId,
        metadata: {
          profile_id: profileId,
          display_name: profile?.display_name ?? 'Unknown',
        },
      });
      return data as ResponsibilityAssignment;
    }
    updateLocal('responsibility_assignments', (items) => [...items, assignment]);
    notifyLocalDataChange('responsibility_areas');
    return assignment;
  },

  async unassignResponsibility(areaId: string, profileId: string): Promise<void> {
    const profile = await this.getProfile(profileId);
    if (isSupabaseConfigured) {
      const { error } = await db()
        .from('responsibility_assignments')
        .delete()
        .eq('area_id', areaId)
        .eq('profile_id', profileId);
      if (error) throw error;
      await this.logActivity('responsibility.unassign', {
        entityType: 'responsibility_area',
        entityId: areaId,
        metadata: {
          profile_id: profileId,
          display_name: profile?.display_name ?? 'Unknown',
        },
      });
      return;
    }
    updateLocal('responsibility_assignments', (items) =>
      items.filter((a) => !(a.area_id === areaId && a.profile_id === profileId))
    );
    notifyLocalDataChange('responsibility_areas');
  },

  async getVisitNotes(): Promise<VisitNote[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db()
        .from('visit_notes')
        .select('*, author:profiles(*)')
        .order('visit_date', { ascending: false });
      if (error) throw error;
      return data as VisitNote[];
    }
    const notes = getLocal('visit_notes');
    const profiles = getLocal('profiles');
    return notes.map((n) => ({
      ...n,
      author: profiles.find((p) => p.id === n.author_id),
    }));
  },

  async createVisitNote(note: Omit<VisitNote, 'id' | 'created_at' | 'author'>): Promise<VisitNote> {
    const newNote: VisitNote = { ...note, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('visit_notes').insert(newNote).select().single();
      if (error) throw error;
      await this.logActivity('visit_note.create', {
        entityType: 'visit_note',
        entityId: (data as VisitNote).id,
        metadata: { visit_date: newNote.visit_date },
      });
      return data as VisitNote;
    }
    updateLocal('visit_notes', (items) => [newNote, ...items]);
    return newNote;
  },

  async getDocuments(): Promise<Document[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('documents').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as Document[];
    }
    return getLocal('documents');
  },

  async createDocument(doc: Omit<Document, 'id' | 'created_at'>): Promise<Document> {
    const newDoc: Document = { ...doc, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('documents').insert(newDoc).select().single();
      if (error) throw error;
      await this.logActivity('document.create', {
        entityType: 'document',
        entityId: (data as Document).id,
        metadata: { name: newDoc.name, folder: newDoc.folder },
      });
      return data as Document;
    }
    updateLocal('documents', (items) => [newDoc, ...items]);
    return newDoc;
  },

  async deleteDocument(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { data: snapshot, error: fetchError } = await db().from('documents').select('*').eq('id', id).single();
      if (fetchError) throw fetchError;
      const { error } = await db().from('documents').delete().eq('id', id);
      if (error) throw error;
      await this.logActivity('document.delete', {
        entityType: 'document',
        entityId: id,
        metadata: { snapshot, name: (snapshot as Document).name },
      });
      return;
    }
    updateLocal('documents', (items) => items.filter((d) => d.id !== id));
  },

  async uploadDocument(file: File, folder: Document['folder'], uploadedBy: string | null): Promise<Document> {
    if (isSupabaseConfigured) {
      const path = `${folder}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await db().storage.from('documents').upload(path, file);
      if (uploadError) throw uploadError;
      return this.createDocument({ name: file.name, storage_path: path, folder, uploaded_by: uploadedBy });
    }
    const dataUrl = await fileToDataUrl(file);
    const path = `local://${folder}/${file.name}`;
    localStorage.setItem(`doc:${path}`, dataUrl);
    return this.createDocument({ name: file.name, storage_path: path, folder, uploaded_by: uploadedBy });
  },

  async getDocumentUrl(doc: Document): Promise<string> {
    if (isSupabaseConfigured && !doc.storage_path.startsWith('local://')) {
      const { data, error } = await db().storage.from('documents').createSignedUrl(doc.storage_path, 3600);
      if (error) throw error;
      await this.logActivity('document.view', {
        entityType: 'document',
        entityId: doc.id,
        metadata: { name: doc.name },
      });
      return data.signedUrl;
    }
    return localStorage.getItem(`doc:${doc.storage_path}`) ?? '#';
  },

  async getFamilyUpdates(): Promise<FamilyUpdate[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db()
        .from('family_updates')
        .select('*, author:profiles(*)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as FamilyUpdate[];
    }
    const updates = getLocal('family_updates');
    const profiles = getLocal('profiles');
    return updates.map((u) => ({
      ...u,
      author: profiles.find((p) => p.id === u.author_id),
    }));
  },

  async createFamilyUpdate(body: string, authorId: string): Promise<FamilyUpdate> {
    const update: FamilyUpdate = {
      id: crypto.randomUUID(),
      body,
      author_id: authorId,
      created_at: new Date().toISOString(),
    };
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('family_updates').insert(update).select().single();
      if (error) throw error;
      await this.logActivity('family_update.create', {
        entityType: 'family_update',
        entityId: (data as FamilyUpdate).id,
        metadata: { body: update.body },
      });
      return data as FamilyUpdate;
    }
    updateLocal('family_updates', (items) => [update, ...items]);
    return update;
  },

  async deleteFamilyUpdate(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await db().from('family_updates').delete().eq('id', id);
      if (error) throw error;
      return;
    }
    updateLocal('family_updates', (items) => items.filter((u) => u.id !== id));
  },

  async getFinancialAccounts(): Promise<FinancialAccount[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('financial_accounts').select('*').order('institution');
      if (error) throw error;
      return data as FinancialAccount[];
    }
    return getLocal('financial_accounts');
  },

  async updateFinancialAccount(id: string, updates: Partial<FinancialAccount>): Promise<FinancialAccount> {
    if (isSupabaseConfigured) {
      const { data: before, error: beforeError } = await db()
        .from('financial_accounts')
        .select('*')
        .eq('id', id)
        .single();
      if (beforeError) throw beforeError;
      const { data, error } = await db()
        .from('financial_accounts')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      await this.logActivity('financial_account.update', {
        entityType: 'financial_account',
        entityId: id,
        metadata: { changes: updates, previous: pickPrevious(before as FinancialAccount, updates) },
      });
      return data as FinancialAccount;
    }
    let updated!: FinancialAccount;
    updateLocal('financial_accounts', (items) =>
      items.map((a) => {
        if (a.id === id) {
          updated = { ...a, ...updates };
          return updated;
        }
        return a;
      })
    );
    return updated;
  },

  async refreshChimeBalance(): Promise<{
    account: FinancialAccount | null;
    transactionsSynced?: { added: number; modified: number; removed: number };
  }> {
    if (isSupabaseConfigured) {
      const data = await invokePlaidBalance({ action: 'refresh' });
      await this.logActivity('financial.refresh_balance');
      const transactionsSynced = data?.transactions_synced as
        | { added: number; modified: number; removed: number }
        | undefined;
      return {
        account: (data?.account as FinancialAccount | undefined) ?? null,
        transactionsSynced,
      };
    }
    const accounts = getLocal('financial_accounts');
    const chime = accounts.find((a) => a.institution.toLowerCase() === 'chime');
    if (!chime) return { account: null };
    const account = await this.updateFinancialAccount(chime.id, {
      last_balance: chime.last_balance,
      last_synced: new Date().toISOString(),
    });
    return { account };
  },

  async getPlaidLinkToken(): Promise<string> {
    if (!isSupabaseConfigured) {
      throw new Error('Plaid Link requires Supabase configuration');
    }
    const { data: sessionData } = await db().auth.getSession();
    if (!sessionData.session) {
      throw new PlaidApiError(
        'You are not signed in with Supabase. Sign out, sign in with your admin email and password, then try Connect Chime again.'
      );
    }
    const data = await invokePlaidBalance({ action: 'link_token' });
    if (!data?.link_token) {
      throw new Error('Could not create Plaid link token');
    }
    return data.link_token as string;
  },

  async exchangePlaidToken(publicToken: string): Promise<FinancialAccount> {
    if (!isSupabaseConfigured) {
      throw new Error('Plaid exchange requires Supabase configuration');
    }
    const data = await invokePlaidBalance({ action: 'exchange', public_token: publicToken });
    if (!data?.account) {
      throw new Error('Could not connect Chime account');
    }
    await this.logActivity('financial.connect_plaid');
    return data.account as FinancialAccount;
  },

  async setChimeBalance(balance: number): Promise<FinancialAccount> {
    const accounts = await this.getFinancialAccounts();
    const chime = accounts.find((a) => a.institution.toLowerCase() === 'chime');
    const updates = {
      last_balance: balance,
      last_synced: new Date().toISOString(),
    };

    if (chime) {
      return this.updateFinancialAccount(chime.id, {
        ...updates,
        display_on_mother_hub: true,
      });
    }

    const newAccount: FinancialAccount = {
      id: crypto.randomUUID(),
      institution: 'Chime',
      account_name: 'Spending',
      plaid_item_id: null,
      display_on_mother_hub: true,
      ...updates,
    };

    if (isSupabaseConfigured) {
      const { data, error } = await db()
        .from('financial_accounts')
        .insert(newAccount)
        .select()
        .single();
      if (error) throw error;
      await this.logActivity('financial_account.update', {
        entityType: 'financial_account',
        entityId: newAccount.id,
        metadata: { changes: updates, source: 'manual_balance' },
      });
      return data as FinancialAccount;
    }

    updateLocal('financial_accounts', (items) => [...items, newAccount]);
    return newAccount;
  },

  async getTransactions(): Promise<Transaction[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db()
        .from('transactions')
        .select('*, account:financial_accounts(*)')
        .order('date', { ascending: false });
      if (error) throw error;
      return (data as Transaction[]).filter((t) => !isHiddenTransaction(t));
    }
    const transactions = getLocal('transactions');
    const accounts = getLocal('financial_accounts');
    return transactions
      .filter((t) => !isHiddenTransaction(t))
      .map((t) => ({
      ...t,
      account: accounts.find((a) => a.id === t.account_id),
    }));
  },

  async getMotherHubTransactions(): Promise<Transaction[]> {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await db()
          .from('transactions')
          .select('*, account:financial_accounts(*)')
          .order('date', { ascending: false });
        if (error) throw error;
        return (data as Transaction[]).filter(
          (t) =>
            t.account?.display_on_mother_hub &&
            !isHiddenTransaction(t) &&
            !isMotherHubHiddenTransaction(t)
        );
      } catch (err) {
        console.warn('Could not load mother hub transactions:', err);
        return [];
      }
    }
    const transactions = getLocal('transactions');
    const accounts = getLocal('financial_accounts');
    const hubAccountIds = new Set(
      accounts.filter((a) => a.display_on_mother_hub).map((a) => a.id)
    );
    return transactions
      .filter(
        (t) =>
          hubAccountIds.has(t.account_id) &&
          !isHiddenTransaction(t) &&
          !isMotherHubHiddenTransaction(t)
      )
      .map((t) => ({
        ...t,
        account: accounts.find((a) => a.id === t.account_id),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  },

  async importTransactions(rows: Omit<Transaction, 'id' | 'created_at'>[]): Promise<number> {
    const withIds = rows.map((r) => ({
      ...r,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    }));

    if (isSupabaseConfigured) {
      const { error } = await db().from('transactions').insert(withIds);
      if (error) throw error;
      await this.logActivity('transaction.import', { metadata: { count: withIds.length } });
      return withIds.length;
    }

    updateLocal('transactions', (items) => [...withIds, ...items]);
    return withIds.length;
  },

  async updateTransaction(
    id: string,
    updates: Partial<Pick<Transaction, 'category' | 'category_override'>>
  ): Promise<Transaction> {
    if (isSupabaseConfigured) {
      const { data: before, error: beforeError } = await db()
        .from('transactions')
        .select('*')
        .eq('id', id)
        .single();
      if (beforeError) throw beforeError;
      const { data, error } = await db()
        .from('transactions')
        .update(updates)
        .eq('id', id)
        .select('*, account:financial_accounts(*)')
        .single();
      if (error) throw error;
      await this.logActivity('transaction.update', {
        entityType: 'transaction',
        entityId: id,
        metadata: { changes: updates, previous: pickPrevious(before as Transaction, updates) },
      });
      return data as Transaction;
    }
    let updated!: Transaction;
    updateLocal('transactions', (items) =>
      items.map((t) => {
        if (t.id === id) {
          updated = { ...t, ...updates };
          return updated;
        }
        return t;
      })
    );
    return updated;
  },

  async logFinancialAccess(profileId: string | null, action: string): Promise<void> {
    await this.logActivity('financial.access', { metadata: { detail: action } });
    if (isSupabaseConfigured) {
      await db().from('financial_access_log').insert({ profile_id: profileId, action });
      return;
    }
  },

  async logActivity(
    action: string,
    opts?: { entityType?: string; entityId?: string; metadata?: Record<string, unknown> }
  ): Promise<void> {
    const entry: ActivityLog = {
      id: crypto.randomUUID(),
      profile_id: activityContext.profileId,
      persona: activityContext.persona,
      action,
      entity_type: opts?.entityType ?? null,
      entity_id: opts?.entityId ?? null,
      metadata: opts?.metadata ?? {},
      created_at: new Date().toISOString(),
    };

    if (isSupabaseConfigured) {
      try {
        await db().rpc('log_activity', {
          p_profile_id: entry.profile_id,
          p_persona: entry.persona,
          p_action: entry.action,
          p_entity_type: entry.entity_type,
          p_entity_id: entry.entity_id,
          p_metadata: entry.metadata,
        });
      } catch {
        // Don't block user actions if logging fails
      }
      return;
    }

    updateLocal('activity_log', (items) => [entry, ...items].slice(0, 500));
  },

  async getActivityLogs(limit = 200): Promise<ActivityLog[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db()
        .from('activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      const logs = (data ?? []) as ActivityLog[];
      const profileIds = [...new Set(
        logs.map((log) => log.profile_id).filter((id): id is string => Boolean(id))
      )];

      let profiles: Profile[] = [];
      if (profileIds.length > 0) {
        const { data: profileData, error: profileError } = await db()
          .from('profiles')
          .select('*')
          .in('id', profileIds);
        if (profileError) throw profileError;
        profiles = (profileData ?? []) as Profile[];
      }

      return logs.map((log) => ({
        ...log,
        profile: log.profile_id ? profiles.find((p) => p.id === log.profile_id) : undefined,
      }));
    }

    const logs = getLocal('activity_log');
    const profiles = getLocal('profiles');
    return logs.slice(0, limit).map((log) => ({
      ...log,
      profile: log.profile_id ? profiles.find((p) => p.id === log.profile_id) : undefined,
    }));
  },

  async markActivityReverted(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      try {
        await db().rpc('mark_activity_reverted', { p_log_id: id });
      } catch {
        // Fall back silently if migration not applied yet
      }
      return;
    }

    updateLocal('activity_log', (items) =>
      items.map((log) =>
        log.id === id ? { ...log, metadata: { ...log.metadata, reverted: true } } : log
      )
    );
  },
};

export class PlaidApiError extends Error {
  needsRelink: boolean;

  constructor(message: string, needsRelink = false) {
    super(message);
    this.name = 'PlaidApiError';
    this.needsRelink = needsRelink;
  }
}

async function invokePlaidBalance(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await db().functions.invoke('plaid-balance', { body });

  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.error) {
    throw new PlaidApiError(
      String(payload.error),
      Boolean(payload.needs_relink)
    );
  }

  if (error) {
    const context = (error as { context?: { json?: () => Promise<Record<string, unknown>> } }).context;
    if (context?.json) {
      try {
        const errBody = await context.json();
        if (errBody?.error) {
          throw new PlaidApiError(
            String(errBody.error),
            Boolean(errBody.needs_relink)
          );
        }
      } catch (parseErr) {
        if (parseErr instanceof PlaidApiError) throw parseErr;
      }
    }
    throw new PlaidApiError(error.message ?? 'Plaid request failed');
  }

  return payload;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
