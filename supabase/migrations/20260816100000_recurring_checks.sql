-- Recurring Checks: visit staples everyone should verify (separate from one-off tasks)

CREATE TABLE recurring_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE recurring_check_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id UUID NOT NULL REFERENCES recurring_checks(id) ON DELETE CASCADE,
  completed_by UUID NOT NULL REFERENCES profiles(id),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX recurring_check_completions_check_id_idx
  ON recurring_check_completions (check_id, completed_at DESC);

ALTER TABLE recurring_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_check_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY recurring_checks_select ON recurring_checks FOR SELECT TO authenticated
  USING (get_my_persona() IS NOT NULL);

CREATE POLICY recurring_checks_write ON recurring_checks FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

CREATE POLICY recurring_check_completions_select ON recurring_check_completions FOR SELECT TO authenticated
  USING (get_my_persona() IS NOT NULL);

CREATE POLICY recurring_check_completions_insert ON recurring_check_completions FOR INSERT TO authenticated
  WITH CHECK (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver'));

-- Realtime
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
