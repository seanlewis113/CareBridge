import { getSupabase as getSupabaseClient, isSupabaseConfigured } from './supabase';
import { loadLocalStore, saveLocalStore } from './localStore';
import { expandRecurringEvents, getSourceEventId } from './calendarRecurrence';
import type {
  AppSettings,
  CalendarEvent,
  Document,
  FamilyUpdate,
  FinancialAccount,
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

export const api = {
  async getSettings(): Promise<AppSettings> {
    if (isSupabaseConfigured) {
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
      return (data?.events ?? []) as CalendarEvent[];
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
      return { ...(data as Task), checklist: newTask.checklist, show_on_mother_hub: (data as Task).show_on_mother_hub !== false };
    }
    updateLocal('tasks', (items) => [...items, newTask]);
    return newTask;
  },

  async updateTask(id: string, updates: Partial<Task>): Promise<Task> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('tasks').update(updates).eq('id', id).select().single();
      if (error) throw error;
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
      return data as Reminder;
    }
    updateLocal('reminders', (items) => [newReminder, ...items]);
    return newReminder;
  },

  async updateReminder(id: string, updates: Partial<Reminder>): Promise<Reminder> {
    if (isSupabaseConfigured) {
      const { data, error } = await db().from('reminders').update(updates).eq('id', id).select().single();
      if (error) throw error;
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
      return data as Document;
    }
    updateLocal('documents', (items) => [newDoc, ...items]);
    return newDoc;
  },

  async deleteDocument(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await db().from('documents').delete().eq('id', id);
      if (error) throw error;
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
      return withIds.length;
    }

    updateLocal('transactions', (items) => [...withIds, ...items]);
    return withIds.length;
  },

  async logFinancialAccess(profileId: string | null, action: string): Promise<void> {
    if (isSupabaseConfigured) {
      await db().from('financial_access_log').insert({ profile_id: profileId, action });
      return;
    }
    // no-op in local mode
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
