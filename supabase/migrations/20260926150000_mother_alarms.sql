-- Scheduled pop-up alarms for Mom's tablet (must tap to dismiss).

CREATE TABLE mother_alarms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT,
  time_of_day TEXT NOT NULL CHECK (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  days_of_week INTEGER[] NOT NULL DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mother_alarms_days_valid CHECK (
    cardinality(days_of_week) > 0
    AND days_of_week <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[]
  )
);

ALTER TABLE mother_alarms ENABLE ROW LEVEL SECURITY;

CREATE POLICY mother_alarms_select ON mother_alarms
  FOR SELECT TO authenticated
  USING (get_my_persona() IS NOT NULL);

CREATE POLICY mother_alarms_write ON mother_alarms
  FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

CREATE POLICY mother_alarms_select_anon ON mother_alarms
  FOR SELECT TO anon
  USING (active = true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'mother_alarms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mother_alarms;
  END IF;
END $$;
