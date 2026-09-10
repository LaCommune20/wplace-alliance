-- WPlace La Commune — D1
-- Migration 0003 : synchronisation du CHECK template_history.action
--
-- Le schéma DEV actuel accepte l'action 'upload' dans template_history.
-- 0001_initial_schema.sql ne peut pas être réécrite : elle appartient à
-- l'historique des migrations. SQLite/D1 nécessite donc une reconstruction contrôlée.

PRAGMA foreign_keys = OFF;

CREATE TABLE template_history__new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  action TEXT NOT NULL CHECK (
    action IN (
      'create',
      'update',
      'upload',
      'validate',
      'reject',
      'archive',
      'restore'
    )
  ),
  r2_key TEXT NOT NULL,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  author_discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (template_id, version),
  FOREIGN KEY (template_id)
    REFERENCES templates(id)
    ON DELETE CASCADE
);

INSERT INTO template_history__new (
  id, template_id, version, action, r2_key, snapshot, author_discord_id, created_at
)
SELECT id, template_id, version, action, r2_key, snapshot, author_discord_id, created_at
FROM template_history;

DROP TABLE template_history;
ALTER TABLE template_history__new RENAME TO template_history;

-- Le dump DEV actuel ne contient pas l'ancien index historique
-- idx_template_history_template après cette reconstruction. Il n'est donc
-- volontairement pas recréé ici.

PRAGMA foreign_keys = ON;
