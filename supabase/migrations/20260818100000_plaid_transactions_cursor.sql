ALTER TABLE financial_accounts
  ADD COLUMN IF NOT EXISTS plaid_transactions_cursor TEXT;
