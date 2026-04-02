-- Storage policies for report-logos bucket
-- These must be applied after the bucket is created manually in Supabase dashboard.

-- Allow authenticated users to upload files to report-logos
CREATE POLICY "Allow authenticated uploads to report-logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'report-logos');

-- Allow public read access to report-logos (so logo URLs work in reports)
CREATE POLICY "Allow public read of report-logos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'report-logos');

-- Allow authenticated users to replace/update their own uploads
CREATE POLICY "Allow authenticated updates to report-logos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'report-logos');

-- Allow authenticated users to delete their own uploads
CREATE POLICY "Allow authenticated deletes from report-logos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'report-logos');

-- ──────────────────────────────────────────────────────────────────────────────
-- Also ensure marketplace-photos has the same policies if not already applied
-- (safe to run even if bucket doesn't exist yet — will no-op)
-- ──────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Allow authenticated uploads to marketplace-photos'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Allow authenticated uploads to marketplace-photos"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'marketplace-photos')
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Allow public read of marketplace-photos'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Allow public read of marketplace-photos"
      ON storage.objects FOR SELECT
      TO public
      USING (bucket_id = 'marketplace-photos')
    $policy$;
  END IF;
END $$;
