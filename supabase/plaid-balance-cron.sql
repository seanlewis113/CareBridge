-- Scheduled Chime balance refresh (every 6 hours)
--
-- Prerequisites:
-- 1. Enable pg_cron and pg_net in Supabase Dashboard → Database → Extensions
-- 2. Set CRON_SECRET in Edge Function secrets (must match the value below)
-- 3. Replace YOUR_CRON_SECRET with the same value
-- 4. Run this in the SQL Editor
--
-- Alternative: Supabase Dashboard → Edge Functions → plaid-balance → Schedules
--   Cron: 0 */6 * * *
--   Headers: x-cron-secret = (your CRON_SECRET)
--   Body: {"action":"refresh"}

SELECT cron.unschedule('refresh-chime-balance')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'refresh-chime-balance'
);

SELECT cron.schedule(
  'refresh-chime-balance',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://zliprdkszovsihdvzrye.supabase.co/functions/v1/plaid-balance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'YOUR_CRON_SECRET'
    ),
    body := '{"action":"refresh"}'::jsonb
  ) AS request_id;
  $$
);
