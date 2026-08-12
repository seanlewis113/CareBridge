-- Allow admins to mark activity log entries as reverted after undo.

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
