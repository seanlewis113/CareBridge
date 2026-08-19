const STORAGE_KEY = 'moms-care-local-data';

export interface LocalDataStore {
  profiles: import('./types').Profile[];
  settings: import('./types').AppSettings;
  calendar_events: import('./types').CalendarEvent[];
  tasks: import('./types').Task[];
  task_assignments: import('./types').TaskAssignment[];
  reminders: import('./types').Reminder[];
  recurring_checks: import('./types').RecurringCheck[];
  recurring_check_completions: import('./types').RecurringCheckCompletion[];
  responsibility_areas: import('./types').ResponsibilityArea[];
  responsibility_assignments: import('./types').ResponsibilityAssignment[];
  visit_notes: import('./types').VisitNote[];
  documents: import('./types').Document[];
  family_updates: import('./types').FamilyUpdate[];
  financial_accounts: import('./types').FinancialAccount[];
  transactions: import('./types').Transaction[];
  activity_log: import('./types').ActivityLog[];
}

function defaultStore(): LocalDataStore {
  const now = new Date().toISOString();
  const adminId = crypto.randomUUID();
  const familyId = crypto.randomUUID();
  const hiredId = crypto.randomUUID();
  const groceryTaskId = crypto.randomUUID();
  const dinnerTaskId = crypto.randomUUID();
  const toiletPaperCheckId = crypto.randomUUID();
  const staplesCheckId = crypto.randomUUID();
  const financesAreaId = crypto.randomUUID();
  const medicalAreaId = crypto.randomUUID();

  return {
    profiles: [
      {
        id: adminId,
        email: 'admin@family.local',
        display_name: 'Admin',
        persona: 'admin',
        avatar_url: null,
        created_at: now,
      },
      {
        id: familyId,
        email: 'family@family.local',
        display_name: 'Sarah',
        persona: 'family_caregiver',
        avatar_url: null,
        created_at: now,
      },
      {
        id: hiredId,
        email: 'caregiver@family.local',
        display_name: 'Alex',
        persona: 'hired_caregiver',
        avatar_url: null,
        created_at: now,
      },
    ],
    settings: {
      id: 'default',
      mother_name: 'Mom',
      mother_pin_hash: null,
      admin_switch_pin_hash: null,
      financial_pin_hash: null,
      text_scale: 1,
      google_calendar_id: null,
      google_refresh_token: null,
    },
    calendar_events: [
      {
        id: crypto.randomUUID(),
        google_event_id: null,
        title: 'Doctor appointment',
        start_at: new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T10:00:00',
        end_at: new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T11:00:00',
        description: null,
        created_by: adminId,
        created_by_persona: 'admin',
        synced_at: null,
        created_at: now,
      },
      {
        id: crypto.randomUUID(),
        google_event_id: null,
        title: 'Sarah visit',
        start_at: new Date().toISOString().slice(0, 10) + 'T14:00:00',
        end_at: new Date().toISOString().slice(0, 10) + 'T16:00:00',
        description: null,
        created_by: adminId,
        created_by_persona: 'admin',
        synced_at: null,
        created_at: now,
      },
    ],
    tasks: [
      {
        id: groceryTaskId,
        title: 'Grocery shopping',
        description: 'Check fridge and pick up milk and fruit',
        due_at: new Date(Date.now() + 2 * 86400000).toISOString(),
        visit_specific: true,
        open_slot: false,
        show_on_mother_hub: true,
        status: 'pending',
        checklist: [
          { id: crypto.randomUUID(), text: 'Check milk', done: false },
          { id: crypto.randomUUID(), text: 'Buy fruit', done: false },
        ],
        created_by: adminId,
        claimed_by: null,
        created_at: now,
      },
      {
        id: dinnerTaskId,
        title: 'Bring dinner',
        description: 'Thursday evening meal',
        due_at: new Date(Date.now() + 3 * 86400000).toISOString(),
        visit_specific: false,
        open_slot: true,
        show_on_mother_hub: true,
        status: 'pending',
        checklist: [],
        created_by: adminId,
        claimed_by: null,
        created_at: now,
      },
    ],
    task_assignments: [
      {
        id: crypto.randomUUID(),
        task_id: groceryTaskId,
        profile_id: familyId,
      },
      {
        id: crypto.randomUUID(),
        task_id: dinnerTaskId,
        profile_id: hiredId,
      },
    ],
    reminders: [
      {
        id: crypto.randomUUID(),
        body: 'Take morning meds with breakfast',
        priority: 'high',
        active: true,
        show_on_mother_hub: true,
        created_by: adminId,
        created_at: now,
      },
      {
        id: crypto.randomUUID(),
        body: 'Drink water throughout the day',
        priority: 'normal',
        active: true,
        show_on_mother_hub: true,
        created_by: adminId,
        created_at: now,
      },
    ],
    recurring_checks: [
      {
        id: toiletPaperCheckId,
        title: 'Toilet paper stocked',
        description: 'Check bathroom and hall closet supplies',
        active: true,
        created_by: adminId,
        created_at: now,
      },
      {
        id: staplesCheckId,
        title: 'Kitchen staples',
        description: 'Milk, bread, eggs, and fruit on hand',
        active: true,
        created_by: adminId,
        created_at: now,
      },
    ],
    recurring_check_completions: [],
    responsibility_areas: [
      {
        id: financesAreaId,
        title: 'Finances',
        description: 'Bills, banking, and budget tracking',
        created_by: adminId,
        created_at: now,
      },
      {
        id: medicalAreaId,
        title: 'Medical appointments',
        description: 'Scheduling, transportation, and follow-ups',
        created_by: adminId,
        created_at: now,
      },
    ],
    responsibility_assignments: [
      {
        id: crypto.randomUUID(),
        area_id: financesAreaId,
        profile_id: adminId,
      },
      {
        id: crypto.randomUUID(),
        area_id: medicalAreaId,
        profile_id: familyId,
      },
    ],
    visit_notes: [],
    documents: [],
    family_updates: [],
    financial_accounts: [
      {
        id: crypto.randomUUID(),
        institution: 'Chime',
        account_name: 'Spending',
        plaid_item_id: null,
        last_balance: 342.17,
        last_synced: now,
        display_on_mother_hub: true,
      },
      {
        id: crypto.randomUUID(),
        institution: 'Wells Fargo',
        account_name: 'Checking',
        plaid_item_id: null,
        last_balance: 4521.88,
        last_synced: now,
        display_on_mother_hub: false,
      },
    ],
    transactions: [],
    activity_log: [],
  };
}

export function loadLocalStore(): LocalDataStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalDataStore;
      // Backfill legacy tasks created before show_on_mother_hub existed.
      parsed.tasks = parsed.tasks.map((task) => ({
        ...task,
        show_on_mother_hub: task.show_on_mother_hub !== false,
      }));
      if (!parsed.activity_log) parsed.activity_log = [];
      let needsSave = false;
      if (!parsed.recurring_checks) {
        parsed.recurring_checks = [];
        needsSave = true;
      }
      if (!parsed.recurring_check_completions) {
        parsed.recurring_check_completions = [];
        needsSave = true;
      }
      if (!parsed.responsibility_areas) {
        parsed.responsibility_areas = [];
        needsSave = true;
      }
      if (!parsed.responsibility_assignments) {
        parsed.responsibility_assignments = [];
        needsSave = true;
      }
      for (const task of parsed.tasks) {
        if (task.claimed_by) {
          const alreadyAssigned = parsed.task_assignments.some(
            (a) => a.task_id === task.id && a.profile_id === task.claimed_by
          );
          if (!alreadyAssigned) {
            parsed.task_assignments.push({
              id: crypto.randomUUID(),
              task_id: task.id,
              profile_id: task.claimed_by,
            });
          }
          task.claimed_by = null;
          needsSave = true;
        }
      }
      if (needsSave) saveLocalStore(parsed);
      return parsed;
    }
  } catch {
    // fall through
  }
  const store = defaultStore();
  saveLocalStore(store);
  return store;
}

export function saveLocalStore(store: LocalDataStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function resetLocalStore(): LocalDataStore {
  const store = defaultStore();
  saveLocalStore(store);
  return store;
}
