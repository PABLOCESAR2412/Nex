-- Una publicación es una pieza programada para una cuenta concreta. El cron de Workers
-- las lanza cuando vencen y consulta el estado de las que están en curso.
CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'programada',
  job_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_publications_open
  ON publications (content_id, account_id)
  WHERE status IN ('programada', 'en_curso');

CREATE INDEX IF NOT EXISTS idx_publications_due
  ON publications (status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_publications_owner
  ON publications (user_id, created_at DESC);
