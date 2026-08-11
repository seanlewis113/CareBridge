-- Mom's Care database schema

CREATE TYPE persona_type AS ENUM ('mother', 'admin', 'family_caregiver', 'hired_caregiver');
CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed');
CREATE TYPE document_folder AS ENUM ('medical', 'legal', 'daily_routine', 'emergency');
CREATE TYPE reminder_priority AS ENUM ('low', 'normal', 'high');

CREATE TABLE app_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  mother_name TEXT NOT NULL DEFAULT 'Mom',
  mother_pin_hash TEXT,
  admin_switch_pin_hash TEXT,
  financial_pin_hash TEXT,
  text_scale REAL NOT NULL DEFAULT 1.0,
  google_calendar_id TEXT,
  google_refresh_token TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (id) VALUES ('default');

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT NOT NULL,
  persona persona_type NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_event_id TEXT UNIQUE,
  title TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  description TEXT,
  created_by UUID REFERENCES profiles(id),
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  due_at TIMESTAMPTZ,
  visit_specific BOOLEAN NOT NULL DEFAULT FALSE,
  open_slot BOOLEAN NOT NULL DEFAULT FALSE,
  show_on_mother_hub BOOLEAN NOT NULL DEFAULT TRUE,
  status task_status NOT NULL DEFAULT 'pending',
  checklist JSONB NOT NULL DEFAULT '[]',
  created_by UUID REFERENCES profiles(id),
  claimed_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE task_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  UNIQUE(task_id, profile_id)
);

CREATE TABLE reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body TEXT NOT NULL,
  priority reminder_priority NOT NULL DEFAULT 'normal',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  show_on_mother_hub BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE visit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES profiles(id),
  visit_date TIMESTAMPTZ NOT NULL,
  mood TEXT,
  meals TEXT,
  meds TEXT,
  activities TEXT,
  concerns TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  folder document_folder NOT NULL,
  uploaded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE family_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body TEXT NOT NULL,
  author_id UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE financial_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution TEXT NOT NULL,
  account_name TEXT NOT NULL,
  plaid_item_id TEXT,
  plaid_access_token TEXT,
  last_balance NUMERIC(12,2),
  last_synced TIMESTAMPTZ,
  display_on_mother_hub BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES financial_accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  category TEXT,
  import_source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE financial_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helper: get current user's persona
CREATE OR REPLACE FUNCTION get_my_persona() RETURNS persona_type AS $$
  SELECT persona FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- RLS
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_access_log ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (get_my_persona() = 'admin' OR id = auth.uid());
CREATE POLICY profiles_all_admin ON profiles FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

-- App settings (admin only for writes; all authenticated read mother_name/text_scale)
CREATE POLICY settings_read ON app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY settings_admin ON app_settings FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

-- Calendar: all caregivers + admin can read/write; mother reads via service (anon not used)
CREATE POLICY calendar_read ON calendar_events FOR SELECT TO authenticated
  USING (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver'));
CREATE POLICY calendar_write ON calendar_events FOR ALL TO authenticated
  USING (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver'));

-- Tasks
CREATE POLICY tasks_read ON tasks FOR SELECT TO authenticated
  USING (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver'));
CREATE POLICY tasks_admin ON tasks FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');
CREATE POLICY tasks_caregiver_update ON tasks FOR UPDATE TO authenticated
  USING (get_my_persona() IN ('family_caregiver', 'hired_caregiver'));

CREATE POLICY task_assignments_read ON task_assignments FOR SELECT TO authenticated
  USING (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver'));
CREATE POLICY task_assignments_admin ON task_assignments FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

-- Reminders
CREATE POLICY reminders_read ON reminders FOR SELECT TO authenticated
  USING (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver'));
CREATE POLICY reminders_admin ON reminders FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

-- Visit notes
CREATE POLICY visit_notes_read ON visit_notes FOR SELECT TO authenticated
  USING (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver'));
CREATE POLICY visit_notes_write ON visit_notes FOR INSERT TO authenticated
  WITH CHECK (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver') AND author_id = auth.uid());

-- Documents
CREATE POLICY documents_read ON documents FOR SELECT TO authenticated
  USING (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver'));
CREATE POLICY documents_admin ON documents FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

-- Family updates
CREATE POLICY family_updates_read ON family_updates FOR SELECT TO authenticated
  USING (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver'));
CREATE POLICY family_updates_write ON family_updates FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

-- Financials: admin only
CREATE POLICY financial_accounts_admin ON financial_accounts FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');
CREATE POLICY transactions_admin ON transactions FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');
CREATE POLICY financial_log_admin ON financial_access_log FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

-- Storage bucket for documents (run in Supabase dashboard or separate migration)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false);
