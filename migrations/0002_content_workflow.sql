ALTER TABLE content_items ADD COLUMN scheduled_at TEXT;
ALTER TABLE content_items ADD COLUMN asset_name TEXT;
ALTER TABLE content_items ADD COLUMN asset_content_type TEXT;
ALTER TABLE content_items ADD COLUMN asset_size INTEGER;

CREATE INDEX IF NOT EXISTS idx_content_items_user_schedule
  ON content_items (user_id, scheduled_at);

CREATE TABLE IF NOT EXISTS content_uploads (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_key TEXT NOT NULL UNIQUE,
  upload_id TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_content_uploads_owner
  ON content_uploads (content_id, user_id);
