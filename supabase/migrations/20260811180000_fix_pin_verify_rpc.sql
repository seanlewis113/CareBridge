-- Re-apply PIN verify RPCs with extensions in search_path (digest() lives there on Supabase).

CREATE OR REPLACE FUNCTION verify_mother_pin(input_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $$
DECLARE
  stored_hash TEXT;
BEGIN
  SELECT mother_pin_hash INTO stored_hash FROM app_settings WHERE id = 'default';

  IF stored_hash IS NULL THEN
    RETURN input_pin = '1023';
  END IF;

  RETURN encode(digest(input_pin, 'sha256'), 'hex') = stored_hash;
END;
$$;

CREATE OR REPLACE FUNCTION verify_admin_switch_pin(input_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $$
DECLARE
  stored_hash TEXT;
BEGIN
  SELECT admin_switch_pin_hash INTO stored_hash FROM app_settings WHERE id = 'default';

  IF stored_hash IS NULL THEN
    RETURN input_pin = '1023';
  END IF;

  RETURN encode(digest(input_pin, 'sha256'), 'hex') = stored_hash;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_mother_pin(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_admin_switch_pin(TEXT) TO anon, authenticated;
