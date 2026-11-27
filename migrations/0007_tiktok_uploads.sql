ALTER TABLE social_accounts ADD COLUMN tiktok_refresh_lock TEXT;

CREATE TABLE tiktok_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_tiktok_oauth_states_expiry ON tiktok_oauth_states (expires_at);

CREATE TABLE tiktok_upload_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  publish_id TEXT,
  media_id TEXT,
  media_hash TEXT UNIQUE,
  media_expires_at TEXT,
  asset_key TEXT NOT NULL,
  asset_content_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_tiktok_upload_jobs_target ON tiktok_upload_jobs (content_id, account_id)
  WHERE status <> 'failed';
