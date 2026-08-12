-- Resolve assigned/claimed user names for the mother hub (anon-safe).
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
    COALESCE(
      claimer.display_name,
      assigned.names
    ) AS helper_name
  FROM tasks t
  LEFT JOIN profiles claimer ON claimer.id = t.claimed_by
  LEFT JOIN LATERAL (
    SELECT string_agg(p.display_name, ' & ' ORDER BY p.display_name) AS names
    FROM task_assignments ta
    JOIN profiles p ON p.id = ta.profile_id
    WHERE ta.task_id = t.id
  ) assigned ON true
  WHERE t.status <> 'completed'
    AND t.show_on_mother_hub = true
    AND (t.open_slot OR claimer.display_name IS NOT NULL OR assigned.names IS NOT NULL)
  ORDER BY t.due_at NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION get_mother_hub_tasks() TO anon, authenticated;
