-- Track refill dates instead of per-dose logging (pill dispenser workflow)

ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS next_refill_date DATE,
  ADD COLUMN IF NOT EXISTS last_refill_date DATE;

CREATE POLICY prescriptions_caregiver_refill_update ON prescriptions
  FOR UPDATE TO authenticated
  USING (get_my_persona() IN ('family_caregiver', 'hired_caregiver'))
  WITH CHECK (get_my_persona() IN ('family_caregiver', 'hired_caregiver'));
