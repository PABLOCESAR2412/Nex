-- Permisos por clave MCP. Las claves existentes conservan todos los permisos.
ALTER TABLE mcp_tokens ADD COLUMN scopes TEXT NOT NULL DEFAULT 'content:read content:write publish';
-- Claves emitidas por OAuth: el acceso dura poco y se renueva con un refresh token rotativo (guardado como hash).
ALTER TABLE mcp_tokens ADD COLUMN expires_at TEXT;
ALTER TABLE mcp_tokens ADD COLUMN client_id TEXT;
ALTER TABLE mcp_tokens ADD COLUMN refresh_hash TEXT;
ALTER TABLE mcp_tokens ADD COLUMN refresh_expires_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tokens_refresh
  ON mcp_tokens (refresh_hash)
  WHERE refresh_hash IS NOT NULL;

-- Clientes públicos registrados dinámicamente (RFC 7591), por ejemplo un conector de claude.ai o ChatGPT.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Códigos de autorización de un solo uso (guardados como hash) con su desafío PKCE.
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_oauth_codes_expiry
  ON oauth_codes (expires_at);
