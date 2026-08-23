-- Rx Tracker: admin-managed prescriptions visible to caregivers

CREATE TABLE prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  dosage TEXT NOT NULL,
  frequency TEXT,
  instructions TEXT,
  prescriber TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE prescription_doses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  administered_by UUID NOT NULL REFERENCES profiles(id),
  administered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX prescription_doses_prescription_id_idx
  ON prescription_doses (prescription_id, administered_at DESC);

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescription_doses ENABLE ROW LEVEL SECURITY;

CREATE POLICY prescriptions_select ON prescriptions FOR SELECT TO authenticated
  USING (get_my_persona() IS NOT NULL);

CREATE POLICY prescriptions_write ON prescriptions FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

CREATE POLICY prescription_doses_select ON prescription_doses FOR SELECT TO authenticated
  USING (get_my_persona() IS NOT NULL);

CREATE POLICY prescription_doses_insert ON prescription_doses FOR INSERT TO authenticated
  WITH CHECK (get_my_persona() IN ('admin', 'family_caregiver', 'hired_caregiver'));

-- Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'prescriptions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.prescriptions;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'prescription_doses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.prescription_doses;
  END IF;
END $$;
