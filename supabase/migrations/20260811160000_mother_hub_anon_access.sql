-- Mother tablet uses the Supabase anon key without signing in.
-- Allow read access to hub-safe data and limited writes (calendar events).

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

CREATE POLICY calendar_select_anon ON calendar_events
  FOR SELECT TO anon USING (true);

CREATE POLICY calendar_insert_anon ON calendar_events
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY reminders_select_anon ON reminders
  FOR SELECT TO anon
  USING (active = true AND show_on_mother_hub = true);

CREATE POLICY tasks_select_anon ON tasks
  FOR SELECT TO anon
  USING (status <> 'completed' AND show_on_mother_hub = true);

CREATE POLICY task_assignments_select_anon ON task_assignments
  FOR SELECT TO anon USING (true);

CREATE POLICY profiles_select_anon ON profiles
  FOR SELECT TO anon USING (true);

CREATE POLICY financial_accounts_select_anon ON financial_accounts
  FOR SELECT TO anon
  USING (display_on_mother_hub = true);
