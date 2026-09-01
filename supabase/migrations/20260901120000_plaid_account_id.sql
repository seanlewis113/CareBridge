ALTER TABLE financial_accounts
  ADD COLUMN IF NOT EXISTS plaid_account_id TEXT;
