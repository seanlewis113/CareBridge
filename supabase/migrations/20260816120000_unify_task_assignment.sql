-- Move legacy claimed_by values into task_assignments and simplify mother hub helper lookup.

INSERT INTO task_assignments (id, task_id, profile_id)
SELECT gen_random_uuid(), t.id, t.claimed_by
FROM tasks t
WHERE t.claimed_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM task_assignments ta
    WHERE ta.task_id = t.id AND ta.profile_id = t.claimed_by
  );

UPDATE tasks SET claimed_by = NULL WHERE claimed_by IS NOT NULL;

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
