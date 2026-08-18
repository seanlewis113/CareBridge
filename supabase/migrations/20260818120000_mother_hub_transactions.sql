-- Mother tablet reads Chime transactions for hub-visible accounts (anon key, no sign-in).
CREATE POLICY transactions_select_anon ON transactions
  FOR SELECT TO anon
  USING (
    account_id IN (
      SELECT id FROM financial_accounts WHERE display_on_mother_hub = true
    )
  );
