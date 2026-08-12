import { getSupabase as getSupabaseClient, isSupabaseConfigured } from './supabase';
import { loadLocalStore, saveLocalStore } from './localStore';
import { expandRecurringEvents, getSourceEventId } from './calendarRecurrence';
import type {
  ActivityLog,
  AppSettings,
  CalendarEvent,
  Document,
  FamilyUpdate,
  FinancialAccount,
  Persona,
  Profile,
  Reminder,
  Task,
  TaskAssignment,
  Transaction,
  VisitNote,
} from './types';

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

export function setActivityContext(ctx: ActivityContext): void {
  activityContext = ctx;
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
      const { data, error } = await db()
        .from('app_settings')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', 'default')
        .select()
        .single();
      if (error) throw error;
      await this.logActivity('settings.update', { metadata: { fields: Object.keys(updates) } });
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
      const { data, error } = await db()
        .from('calendar_events')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      await this.logActivity('calendar.update', {
        entityType: 'calendar_event',
        entityId: id,
        metadata: updates,
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
      const { error } = await db().from('calendar_events').delete().eq('id', sourceId);
      if (error) throw error;
      await this.logActivity('calendar.delete', { entityType: 'calendar_event', entityId: sourceId });
      return;
    }
    updateLocal('calendar_events', (items) => items.filter((e) => e.id !== sourceId));
  },

  async syncCalendarFromGoogle(): Promise<CalendarEvent[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().functions.invoke('google-calendar-sync', {
        body: { action: 'pull' },
      });
      if (error) throw error;
      const events = (data?.events ?? []) as CalendarEvent[];
      await this.logActivity('calendar.sync', { metadata: { event_count: events.length } });
      return events;
    }
    return this.getCalendarEvents();
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
    return newTask;
  },

  async updateTask(id: string, updates: Partial<Task>): Promise<Task> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('tasks').update(updates).eq('id', id).select().single();
      if (error) throw error;
      await this.logActivity('task.update', {
        entityType: 'task',
        entityId: id,
        metadata: updates,
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
    return updated;
  },

  async deleteTask(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await db().from('tasks').delete().eq('id', id);
      if (error) throw error;
      await this.logActivity('task.delete', { entityType: 'task', entityId: id });
      return;
    }
    updateLocal('tasks', (items) => items.filter((t) => t.id !== id));
    updateLocal('task_assignments', (items) => items.filter((a) => a.task_id !== id));
  },

  async getTaskAssignments(): Promise<TaskAssignment[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('task_assignments').select('*');
      if (error) throw error;
      return data as TaskAssignment[];
    }
    return getLocal('task_assignments');
  },

  async assignTask(taskId: string, profileId: string): Promise<TaskAssignment> {
    const assignment: TaskAssignment = { id: crypto.randomUUID(), task_id: taskId, profile_id: profileId };
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('task_assignments').insert(assignment).select().single();
      if (error) throw error;
      await this.logActivity('task.assign', {
        entityType: 'task',
        entityId: taskId,
        metadata: { profile_id: profileId },
      });
      return data as TaskAssignment;
    }
    updateLocal('task_assignments', (items) => [...items, assignment]);
    return assignment;
  },

  async unassignTask(taskId: string, profileId: string): Promise<void> {
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
        metadata: { profile_id: profileId },
      });
      return;
    }
    updateLocal('task_assignments', (items) =>
      items.filter((a) => !(a.task_id === taskId && a.profile_id === profileId))
    );
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
      const { data, error } = await db().from('reminders').update(updates).eq('id', id).select().single();
      if (error) throw error;
      await this.logActivity('reminder.update', {
        entityType: 'reminder',
        entityId: id,
        metadata: updates,
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
      const { error } = await db().from('reminders').delete().eq('id', id);
      if (error) throw error;
      await this.logActivity('reminder.delete', { entityType: 'reminder', entityId: id });
      return;
    }
    updateLocal('reminders', (items) => items.filter((r) => r.id !== id));
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
      const { error } = await db().from('documents').delete().eq('id', id);
      if (error) throw error;
      await this.logActivity('document.delete', { entityType: 'document', entityId: id });
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
      });
      return data as FamilyUpdate;
    }
    updateLocal('family_updates', (items) => [update, ...items]);
    return update;
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
        metadata: updates,
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

  async refreshChimeBalance(): Promise<FinancialAccount | null> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().functions.invoke('plaid-balance', { body: { action: 'refresh' } });
      if (error) throw error;
      await this.logActivity('financial.refresh_balance');
      return data?.account ?? null;
    }
    const accounts = getLocal('financial_accounts');
    const chime = accounts.find((a) => a.institution.toLowerCase() === 'chime');
    if (!chime) return null;
    return this.updateFinancialAccount(chime.id, {
      last_balance: chime.last_balance,
      last_synced: new Date().toISOString(),
    });
  },

  async getTransactions(): Promise<Transaction[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await db()
        .from('transactions')
        .select('*, account:financial_accounts(*)')
        .order('date', { ascending: false });
      if (error) throw error;
      return data as Transaction[];
    }
    const transactions = getLocal('transactions');
    const accounts = getLocal('financial_accounts');
    return transactions.map((t) => ({
      ...t,
      account: accounts.find((a) => a.id === t.account_id),
    }));
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
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
