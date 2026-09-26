-- Stock level recorded when a caregiver completes a recurring check (full / low / out)

ALTER TABLE recurring_check_completions
  ADD COLUMN IF NOT EXISTS stock_level TEXT NOT NULL DEFAULT 'full'
  CHECK (stock_level IN ('full', 'low', 'out'));
