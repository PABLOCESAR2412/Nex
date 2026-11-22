-- TikTok: el token de acceso dura 24 horas y se renueva con un refresh token (365 días).
ALTER TABLE social_accounts ADD COLUMN refresh_ciphertext TEXT;
ALTER TABLE social_accounts ADD COLUMN refresh_iv TEXT;
ALTER TABLE social_accounts ADD COLUMN refresh_expires_at TEXT;

CREATE TABLE IF NOT EXISTS tiktok_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tiktok_oauth_states_expiry
  ON tiktok_oauth_states (expires_at);

-- Estado de la subida por trozos de una publicación hacia la bandeja de TikTok.
-- publish_id es el job_id de la publicación; lease_until evita que dos ciclos del cron suban el mismo trozo.
CREATE TABLE IF NOT EXISTS tiktok_uploads (
  publication_id TEXT PRIMARY KEY REFERENCES publications(id) ON DELETE CASCADE,
  publish_id TEXT NOT NULL,
  upload_url TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  video_size INTEGER NOT NULL,
  chunk_size INTEGER NOT NULL,
  total_chunks INTEGER NOT NULL,
  next_offset INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
