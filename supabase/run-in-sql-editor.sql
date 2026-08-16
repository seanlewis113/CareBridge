-- Jeanne's Care Bridge — run in Supabase Dashboard → SQL Editor
-- Project: https://supabase.com/dashboard/project/zliprdkszovsihdvzrye/sql/new
--
-- ⚠️  If your database already has tables (most setups):
--     Do NOT run this entire file. Use enable-realtime-only.sql instead,
--     or jump to line 220 ("UPDATES ONLY") for incremental migrations.
--
-- OPTION A: Brand-new empty database → run this ENTIRE file once.
-- OPTION B: Schema already exists → run enable-realtime-only.sql (or UPDATES ONLY block).

-- =============================================================================
-- BASE SCHEMA (skip if tables already exist)
-- =============================================================================

CREATE TYPE persona_type AS ENUM ('mother', 'admin', 'family_caregiver', 'hired_caregiver');
CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed');
CREATE TYPE document_folder AS ENUM ('medical', 'legal', 'daily_routine', 'emergency');

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
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
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
  last_balance NUMERIC(12, 2),
  last_synced TIMESTAMPTZ,
  display_on_mother_hub BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES financial_accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
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

CREATE OR REPLACE FUNCTION get_my_persona() RETURNS persona_type AS $$
  SELECT persona FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

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
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (get_my_persona() IS NOT NULL);
CREATE POLICY profiles_update_own ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

CREATE POLICY calendar_select ON calendar_events FOR SELECT TO authenticated
  USING (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver', 'mother'));
CREATE POLICY calendar_insert ON calendar_events FOR INSERT TO authenticated
  WITH CHECK (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver', 'mother'));
CREATE POLICY calendar_update ON calendar_events FOR UPDATE TO authenticated
  USING (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver', 'mother'));
CREATE POLICY calendar_delete ON calendar_events FOR DELETE TO authenticated
  USING (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver'));

CREATE POLICY tasks_select ON tasks FOR SELECT TO authenticated
  USING (get_my_persona() IS NOT NULL);
CREATE POLICY tasks_insert ON tasks FOR INSERT TO authenticated
  WITH CHECK (get_my_persona() = 'admin');
CREATE POLICY tasks_update ON tasks FOR UPDATE TO authenticated
  USING (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver'));
CREATE POLICY tasks_delete ON tasks FOR DELETE TO authenticated
  USING (get_my_persona() = 'admin');

CREATE POLICY task_assignments_all ON task_assignments FOR ALL TO authenticated
  USING (get_my_persona() IS NOT NULL);

CREATE POLICY reminders_select ON reminders FOR SELECT TO authenticated
  USING (get_my_persona() IS NOT NULL);
CREATE POLICY reminders_write ON reminders FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

CREATE POLICY visit_notes_select ON visit_notes FOR SELECT TO authenticated
  USING (get_my_persona() IS NOT NULL);
CREATE POLICY visit_notes_insert ON visit_notes FOR INSERT TO authenticated
  WITH CHECK (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver'));

CREATE POLICY documents_select ON documents FOR SELECT TO authenticated
  USING (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver'));
CREATE POLICY documents_write ON documents FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

CREATE POLICY family_updates_select ON family_updates FOR SELECT TO authenticated
  USING (get_my_persona() IS NOT NULL);
CREATE POLICY family_updates_write ON family_updates FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

CREATE POLICY financial_accounts_admin ON financial_accounts FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');
CREATE POLICY transactions_admin ON transactions FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');
CREATE POLICY financial_log_admin ON financial_access_log FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

CREATE POLICY settings_admin ON app_settings FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

CREATE INDEX idx_calendar_events_start ON calendar_events(start_at);
CREATE INDEX idx_tasks_due ON tasks(due_at);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_visit_notes_date ON visit_notes(visit_date DESC);

-- =============================================================================
-- UPDATES ONLY (run this block if base schema already exists)
-- =============================================================================

-- Auth: auto-create profile on signup/invite
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_persona persona_type;
BEGIN
  requested_persona := coalesce((new.raw_user_meta_data ->> 'persona')::persona_type, 'family_caregiver'::persona_type);

  IF requested_persona = 'mother' THEN
    requested_persona := 'family_caregiver'::persona_type;
  END IF;

  INSERT INTO public.profiles (id, email, display_name, persona, avatar_url)
  VALUES (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    requested_persona,
    null
  )
  ON CONFLICT (id) DO UPDATE
    SET email = excluded.email,
        display_name = excluded.display_name,
        persona = excluded.persona;

  RETURN new;
EXCEPTION
  WHEN others THEN
    RAISE WARNING 'handle_new_auth_user failed for user %: %', new.id, sqlerrm;
    RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_auth_user();

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS show_on_mother_hub BOOLEAN NOT NULL DEFAULT TRUE;

-- Activity log
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  persona persona_type,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_log_created_at_idx ON activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_profile_id_idx ON activity_log (profile_id);
CREATE INDEX IF NOT EXISTS activity_log_action_idx ON activity_log (action);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_log_select_admin ON activity_log;
CREATE POLICY activity_log_select_admin ON activity_log
  FOR SELECT TO authenticated
  USING (get_my_persona() = 'admin');

CREATE OR REPLACE FUNCTION log_activity(
  p_profile_id UUID,
  p_persona persona_type,
  p_action TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO activity_log (profile_id, persona, action, entity_type, entity_id, metadata)
  VALUES (p_profile_id, p_persona, p_action, p_entity_type, p_entity_id, COALESCE(p_metadata, '{}'))
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION log_activity TO authenticated, anon;

-- Mother hub anon access
CREATE OR REPLACE FUNCTION get_mother_hub_settings()
RETURNS TABLE(mother_name TEXT, text_scale REAL)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT mother_name, text_scale FROM app_settings WHERE id = 'default';
$$;

GRANT EXECUTE ON FUNCTION get_mother_hub_settings TO anon, authenticated;

DROP POLICY IF EXISTS calendar_select_anon ON calendar_events;
CREATE POLICY calendar_select_anon ON calendar_events
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS calendar_insert_anon ON calendar_events;
CREATE POLICY calendar_insert_anon ON calendar_events
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS reminders_select_anon ON reminders;
CREATE POLICY reminders_select_anon ON reminders
  FOR SELECT TO anon
  USING (active = true AND show_on_mother_hub = true);

DROP POLICY IF EXISTS tasks_select_anon ON tasks;
CREATE POLICY tasks_select_anon ON tasks
  FOR SELECT TO anon
  USING (status <> 'completed' AND show_on_mother_hub = true);

DROP POLICY IF EXISTS task_assignments_select_anon ON task_assignments;
CREATE POLICY task_assignments_select_anon ON task_assignments
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS profiles_select_anon ON profiles;
CREATE POLICY profiles_select_anon ON profiles
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS financial_accounts_select_anon ON financial_accounts;
CREATE POLICY financial_accounts_select_anon ON financial_accounts
  FOR SELECT TO anon
  USING (display_on_mother_hub = true);

-- PIN verification (default PIN 1023 when no hash set)
CREATE OR REPLACE FUNCTION verify_mother_pin(input_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $$
DECLARE
  stored_hash TEXT;
BEGIN
  SELECT mother_pin_hash INTO stored_hash FROM app_settings WHERE id = 'default';

  IF stored_hash IS NULL THEN
    RETURN input_pin = '1023';
  END IF;

  RETURN encode(digest(input_pin, 'sha256'), 'hex') = stored_hash;
END;
$$;

CREATE OR REPLACE FUNCTION verify_admin_switch_pin(input_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $$
DECLARE
  stored_hash TEXT;
BEGIN
  SELECT admin_switch_pin_hash INTO stored_hash FROM app_settings WHERE id = 'default';

  IF stored_hash IS NULL THEN
    RETURN input_pin = '1023';
  END IF;

  RETURN encode(digest(input_pin, 'sha256'), 'hex') = stored_hash;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_mother_pin(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_admin_switch_pin(TEXT) TO anon, authenticated;

-- Activity revert
CREATE OR REPLACE FUNCTION mark_activity_reverted(p_log_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_my_persona() <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  UPDATE activity_log
  SET metadata = metadata || '{"reverted": true}'::jsonb
  WHERE id = p_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_activity_reverted(UUID) TO authenticated;

-- Mother hub tasks with helper names
CREATE OR REPLACE FUNCTION get_mother_hub_tasks()
RETURNS TABLE (
  id UUID,
  title TEXT,
  due_at TIMESTAMPTZ,
  open_slot BOOLEAN,
  helper_name TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.title,
    t.due_at,
    t.open_slot,
    assigned.names AS helper_name
  FROM tasks t
  LEFT JOIN LATERAL (
    SELECT string_agg(p.display_name, ' & ' ORDER BY p.display_name) AS names
    FROM task_assignments ta
    JOIN profiles p ON p.id = ta.profile_id
    WHERE ta.task_id = t.id
  ) assigned ON true
  WHERE t.status <> 'completed'
    AND t.show_on_mother_hub = true
    AND (t.open_slot OR assigned.names IS NOT NULL)
  ORDER BY t.due_at NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION get_mother_hub_tasks() TO anon, authenticated;

-- Realtime: mother hub and task views
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tasks',
    'task_assignments',
    'profiles',
    'calendar_events',
    'reminders',
    'financial_accounts'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    END IF;
  END LOOP;
END $$;

-- Optional: documents storage bucket
-- INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false)
-- ON CONFLICT (id) DO NOTHING;

-- Recurring Checks (see migration 20260816100000_recurring_checks.sql)
CREATE TABLE IF NOT EXISTS recurring_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recurring_check_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id UUID NOT NULL REFERENCES recurring_checks(id) ON DELETE CASCADE,
  completed_by UUID NOT NULL REFERENCES profiles(id),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS recurring_check_completions_check_id_idx
  ON recurring_check_completions (check_id, completed_at DESC);

ALTER TABLE recurring_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_check_completions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'recurring_checks_select'
  ) THEN
    CREATE POLICY recurring_checks_select ON recurring_checks FOR SELECT TO authenticated
      USING (get_my_persona() IS NOT NULL);
    CREATE POLICY recurring_checks_write ON recurring_checks FOR ALL TO authenticated
      USING (get_my_persona() = 'admin');
    CREATE POLICY recurring_check_completions_select ON recurring_check_completions FOR SELECT TO authenticated
      USING (get_my_persona() IS NOT NULL);
    CREATE POLICY recurring_check_completions_insert ON recurring_check_completions FOR INSERT TO authenticated
      WITH CHECK (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'recurring_checks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.recurring_checks;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'recurring_check_completions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.recurring_check_completions;
  END IF;
END $$;
