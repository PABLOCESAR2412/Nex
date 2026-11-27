ALTER TABLE social_accounts ADD COLUMN provider TEXT NOT NULL DEFAULT 'nex';
ALTER TABLE social_accounts ADD COLUMN buffer_organization_id TEXT;

CREATE TABLE buffer_publish_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  provider_post_id TEXT,
  scheduling_type TEXT,
  external_link TEXT,
  media_hash TEXT UNIQUE,
  media_expires_at TEXT,
  asset_key TEXT NOT NULL,
  asset_content_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  caption TEXT NOT NULL,
  error TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_buffer_publish_jobs_target ON buffer_publish_jobs (content_id, account_id)
  WHERE status <> 'failed';

CREATE INDEX idx_buffer_publish_jobs_grant ON buffer_publish_jobs (user_id, content_id, media_expires_at)
  WHERE media_hash IS NOT NULL;
