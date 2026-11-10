-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Content items (piezas)
CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'video',
  state TEXT NOT NULL DEFAULT 'borrador',
  channels TEXT,
  asset_key TEXT,
  script TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Social accounts (connected destinations)
CREATE TABLE IF NOT EXISTS social_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sin_configurar',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Scheduled posts
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'programada',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Deployments
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  domain TEXT,
  branch TEXT,
  status TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);