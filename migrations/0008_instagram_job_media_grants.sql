ALTER TABLE instagram_media_grants ADD COLUMN job_id TEXT REFERENCES instagram_publish_jobs(id) ON DELETE CASCADE;
ALTER TABLE instagram_media_grants ADD COLUMN asset_key TEXT;
ALTER TABLE instagram_media_grants ADD COLUMN asset_content_type TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_instagram_media_grants_job
  ON instagram_media_grants (job_id)
  WHERE job_id IS NOT NULL;
