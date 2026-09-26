-- Shared Chime card images for the mother hub (all devices / users)

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS mother_card_images JSONB NOT NULL DEFAULT '{}'::jsonb;

DROP FUNCTION IF EXISTS get_mother_hub_settings();

CREATE OR REPLACE FUNCTION get_mother_hub_settings()
RETURNS TABLE(mother_name TEXT, text_scale REAL, mother_card_images JSONB)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT mother_name, text_scale, mother_card_images
  FROM app_settings
  WHERE id = 'default';
$$;

GRANT EXECUTE ON FUNCTION get_mother_hub_settings TO anon, authenticated;

CREATE OR REPLACE FUNCTION update_mother_card_image_meta(
  p_side TEXT,
  p_cropped_path TEXT,
  p_original_path TEXT,
  p_zoom REAL,
  p_offset_x REAL,
  p_offset_y REAL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  patch JSONB;
BEGIN
  IF p_side NOT IN ('front', 'back') THEN
    RAISE EXCEPTION 'invalid card side';
  END IF;

  patch := jsonb_build_object(
    'cropped_path', p_cropped_path,
    'original_path', p_original_path,
    'zoom', p_zoom,
    'offset_x', p_offset_x,
    'offset_y', p_offset_y
  );

  UPDATE app_settings
  SET
    mother_card_images = COALESCE(mother_card_images, '{}'::jsonb) || jsonb_build_object(p_side, patch),
    updated_at = NOW()
  WHERE id = 'default';
END;
$$;

GRANT EXECUTE ON FUNCTION update_mother_card_image_meta TO anon, authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES ('mother-hub', 'mother-hub', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'mother_hub_card_select') THEN
    CREATE POLICY mother_hub_card_select ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'mother-hub');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'mother_hub_card_insert') THEN
    CREATE POLICY mother_hub_card_insert ON storage.objects
      FOR INSERT TO anon, authenticated
      WITH CHECK (
        bucket_id = 'mother-hub'
        AND (storage.foldername(name))[1] = 'card'
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'mother_hub_card_update') THEN
    CREATE POLICY mother_hub_card_update ON storage.objects
      FOR UPDATE TO anon, authenticated
      USING (bucket_id = 'mother-hub' AND (storage.foldername(name))[1] = 'card')
      WITH CHECK (
        bucket_id = 'mother-hub'
        AND (storage.foldername(name))[1] = 'card'
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'mother_hub_card_delete') THEN
    CREATE POLICY mother_hub_card_delete ON storage.objects
      FOR DELETE TO anon, authenticated
      USING (bucket_id = 'mother-hub' AND (storage.foldername(name))[1] = 'card');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'app_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
  END IF;
END $$;
