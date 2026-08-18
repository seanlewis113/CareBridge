-- Prevent duplicate Plaid transaction rows and remove existing duplicates.

CREATE UNIQUE INDEX IF NOT EXISTS transactions_plaid_import_unique
  ON transactions (account_id, import_source)
  WHERE import_source LIKE 'plaid:%';

-- Drop manual/import rows when an identical Plaid row already exists.
DELETE FROM transactions t
WHERE t.import_source NOT LIKE 'plaid:%'
  AND EXISTS (
    SELECT 1
    FROM transactions p
    WHERE p.account_id = t.account_id
      AND p.date = t.date
      AND p.description = t.description
      AND p.amount = t.amount
      AND p.import_source LIKE 'plaid:%'
  );

-- Drop duplicate rows with the same business key (e.g. Plaid reconnect).
DELETE FROM transactions t1
USING transactions t2
WHERE t1.account_id = t2.account_id
  AND t1.date = t2.date
  AND t1.description = t2.description
  AND t1.amount = t2.amount
  AND t1.id > t2.id;
