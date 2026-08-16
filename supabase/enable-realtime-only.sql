-- Enable realtime updates for the mother dashboard and task views.
-- Safe to run multiple times — skips tables already in the publication.
--
-- Run this in Supabase Dashboard → SQL Editor (NOT the full run-in-sql-editor.sql).

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tasks',
    'task_assignments',
    'profiles',
    'calendar_events',
    'reminders',
    'financial_accounts'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    END IF;
  END LOOP;
END $$;
