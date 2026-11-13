ALTER TABLE social_accounts ADD COLUMN external_account_id TEXT;
ALTER TABLE social_accounts ADD COLUMN token_ciphertext TEXT;
ALTER TABLE social_accounts ADD COLUMN token_iv TEXT;
ALTER TABLE social_accounts ADD COLUMN token_expires_at TEXT;
ALTER TABLE social_accounts ADD COLUMN connected_at TEXT;
ALTER TABLE social_accounts ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_social_accounts_external
  ON social_accounts (user_id, platform, external_account_id)
  WHERE external_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS instagram_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_instagram_oauth_states_expiry
  ON instagram_oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS instagram_media_grants (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_instagram_media_grants_expiry
  ON instagram_media_grants (expires_at);

CREATE TABLE IF NOT EXISTS instagram_publish_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'creating',
  container_id TEXT,
  media_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_instagram_publish_jobs_active
  ON instagram_publish_jobs (content_id, account_id)
  WHERE status IN ('creating', 'processing', 'publishing');

CREATE INDEX IF NOT EXISTS idx_instagram_publish_jobs_owner
  ON instagram_publish_jobs (user_id, created_at DESC);
