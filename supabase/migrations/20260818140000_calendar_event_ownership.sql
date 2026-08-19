-- Track who created each calendar event so the mother tablet can edit/delete only her own.

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS created_by_persona TEXT;

DROP POLICY IF EXISTS calendar_insert_anon ON calendar_events;
CREATE POLICY calendar_insert_anon ON calendar_events
  FOR INSERT TO anon
  WITH CHECK (created_by_persona = 'mother');

CREATE POLICY calendar_update_anon ON calendar_events
  FOR UPDATE TO anon
  USING (created_by_persona = 'mother')
  WITH CHECK (created_by_persona = 'mother');

CREATE POLICY calendar_delete_anon ON calendar_events
  FOR DELETE TO anon
  USING (created_by_persona = 'mother');
