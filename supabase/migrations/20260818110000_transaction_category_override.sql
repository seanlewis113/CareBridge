ALTER TABLE transactions
  ADD COLUMN category_override BOOLEAN NOT NULL DEFAULT false;
