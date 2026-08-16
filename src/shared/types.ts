export type Persona = 'mother' | 'admin' | 'family_caregiver' | 'hired_caregiver';

export interface Profile {
  id: string;
  email: string | null;
  display_name: string;
  persona: Persona;
  avatar_url: string | null;
  created_at: string;
}

export interface CalendarEvent {
  id: string;
  google_event_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  description: string | null;
  created_by: string | null;
  synced_at: string | null;
  created_at: string;
  recurrence_source_id?: string;
  recurrence_index?: number;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  visit_specific: boolean;
  open_slot: boolean;
  show_on_mother_hub: boolean;
  status: 'pending' | 'in_progress' | 'completed';
  checklist: ChecklistItem[];
  created_by: string | null;
  claimed_by: string | null;
  created_at: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface TaskAssignment {
  id: string;
  task_id: string;
  profile_id: string;
}

export interface MotherHubTask {
  id: string;
  title: string;
  due_at: string | null;
  open_slot: boolean;
  helper_name: string | null;
}

export interface RecurringCheck {
  id: string;
  title: string;
  description: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface RecurringCheckCompletion {
  id: string;
  check_id: string;
  completed_by: string;
  completed_at: string;
  notes: string | null;
  completed_by_profile?: Profile;
}

export interface RecurringCheckWithStatus extends RecurringCheck {
  last_completion: RecurringCheckCompletion | null;
}

export interface Reminder {
  id: string;
  body: string;
  priority: 'low' | 'normal' | 'high';
  active: boolean;
  show_on_mother_hub: boolean;
  created_by: string | null;
  created_at: string;
}

export interface VisitNote {
  id: string;
  author_id: string;
  visit_date: string;
  mood: string | null;
  meals: string | null;
  meds: string | null;
  activities: string | null;
  concerns: string | null;
  notes: string | null;
  created_at: string;
  author?: Profile;
}

export interface Document {
  id: string;
  name: string;
  storage_path: string;
  folder: 'medical' | 'legal' | 'daily_routine' | 'emergency';
  uploaded_by: string | null;
  created_at: string;
}

export interface FamilyUpdate {
  id: string;
  body: string;
  author_id: string;
  created_at: string;
  author?: Profile;
}

export interface FinancialAccount {
  id: string;
  institution: string;
  account_name: string;
  plaid_item_id: string | null;
  last_balance: number | null;
  last_synced: string | null;
  display_on_mother_hub: boolean;
}

export interface Transaction {
  id: string;
  account_id: string;
  date: string;
  description: string;
  amount: number;
  category: string | null;
  import_source: string;
  account?: FinancialAccount;
}

export interface AppSettings {
  id: string;
  mother_name: string;
  mother_pin_hash: string | null;
  admin_switch_pin_hash: string | null;
  financial_pin_hash: string | null;
  text_scale: number;
  google_calendar_id: string | null;
  google_refresh_token: string | null;
}

export interface SessionState {
  persona: Persona | null;
  profile: Profile | null;
  motherDeviceMode: boolean;
  motherPinVerified?: boolean;
}

export interface ActivityLog {
  id: string;
  profile_id: string | null;
  persona: Persona | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  profile?: Profile;
}

export const PERSONA_LABELS: Record<Persona, string> = {
  mother: 'Mom',
  admin: 'Admin',
  family_caregiver: 'Family Caregiver',
  hired_caregiver: 'Hired Caregiver',
};

export const FOLDER_LABELS: Record<Document['folder'], string> = {
  medical: 'Medical',
  legal: 'Legal',
  daily_routine: 'Daily Routine',
  emergency: 'Emergency',
};
