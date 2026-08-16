-- Enable extensions required for scheduled Chime balance refresh.
-- Run supabase/plaid-balance-cron.sql after setting YOUR_CRON_SECRET.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
