-- Scheduled Google Calendar sync (every 2 hours)
--
-- Prerequisites:
-- 1. Enable pg_cron and pg_net in Supabase Dashboard → Database → Extensions
-- 2. Set CRON_SECRET in Edge Function secrets (must match the value below)
-- 3. Replace YOUR_CRON_SECRET with the same value
-- 4. Run this in the SQL Editor
--
-- Alternative: Supabase Dashboard → Integrations → Cron → Create job
--   Type: Supabase Edge Function
--   Function: google-calendar-sync
--   Cron: 0 */2 * * *
--   Body: {"action":"pull"}
--   Header: x-cron-secret = (your CRON_SECRET)

SELECT cron.unschedule('sync-google-calendar')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-google-calendar'
);

SELECT cron.schedule(
  'sync-google-calendar',
  '0 */2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://zliprdkszovsihdvzrye.supabase.co/functions/v1/google-calendar-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'YOUR_CRON_SECRET'
    ),
    body := '{"action":"pull"}'::jsonb
  ) AS request_id;
  $$
);
