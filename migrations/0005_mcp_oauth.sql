CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL,
  grant_types_json TEXT NOT NULL,
  response_types_json TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS mcp_oauth_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  state TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  completed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_requests_expiry
  ON mcp_oauth_requests (expires_at);

CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_codes_expiry
  ON mcp_oauth_codes (expires_at);

CREATE TABLE IF NOT EXISTS mcp_oauth_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  resource TEXT NOT NULL,
  scopes TEXT NOT NULL,
  access_token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_grants_owner
  ON mcp_oauth_grants (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_grants_expiry
  ON mcp_oauth_grants (access_expires_at, refresh_expires_at);

UPDATE mcp_tokens
SET revoked_at = COALESCE(revoked_at, datetime('now'))
WHERE revoked_at IS NULL;
