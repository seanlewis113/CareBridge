-- General activity log for all user actions (admin-readable)

CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  persona persona_type,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX activity_log_created_at_idx ON activity_log (created_at DESC);
CREATE INDEX activity_log_profile_id_idx ON activity_log (profile_id);
CREATE INDEX activity_log_action_idx ON activity_log (action);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY activity_log_select_admin ON activity_log
  FOR SELECT TO authenticated
  USING (get_my_persona() = 'admin');

-- Inserts go through SECURITY DEFINER RPC so PIN-based sessions (no auth.uid) can log too
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
