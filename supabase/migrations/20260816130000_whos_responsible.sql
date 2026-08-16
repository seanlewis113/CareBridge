-- Who's Responsible: ongoing care areas assigned to family/caregivers (separate from tasks)

CREATE TABLE responsibility_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE responsibility_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id UUID NOT NULL REFERENCES responsibility_areas(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  UNIQUE(area_id, profile_id)
);

CREATE INDEX responsibility_assignments_area_id_idx
  ON responsibility_assignments (area_id);

ALTER TABLE responsibility_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE responsibility_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY responsibility_areas_select ON responsibility_areas FOR SELECT TO authenticated
  USING (get_my_persona() IS NOT NULL);

CREATE POLICY responsibility_areas_write ON responsibility_areas FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

CREATE POLICY responsibility_assignments_select ON responsibility_assignments FOR SELECT TO authenticated
  USING (get_my_persona() IS NOT NULL);

CREATE POLICY responsibility_assignments_write ON responsibility_assignments FOR ALL TO authenticated
  USING (get_my_persona() = 'admin');

-- Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'responsibility_areas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.responsibility_areas;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'responsibility_assignments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.responsibility_assignments;
  END IF;
END $$;
