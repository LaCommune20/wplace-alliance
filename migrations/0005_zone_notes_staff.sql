-- WPlace La Commune — D1
-- Migration 0005 : responsables de zone et Notes
--
-- Cette migration extrait uniquement le socle hors Radar de l'ancien PR #11.
-- Le schéma Radar est déjà porté par 0004_radar.sql.
-- Le système d'alertes reste inchangé dans cette migration.

-- ------------------------------------------------------------
-- RESPONSABLES DE ZONE
-- ------------------------------------------------------------
-- Un utilisateur peut cumuler plusieurs rôles sur une même zone.
-- Les modérateurs existants restent dans zone_moderators.

CREATE TABLE IF NOT EXISTS zone_staff (
  zone_id INTEGER NOT NULL,
  discord_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager', 'template_manager')),
  assigned_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (zone_id, discord_user_id, role),
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_zone_staff_user
  ON zone_staff(discord_user_id);

CREATE INDEX IF NOT EXISTS idx_zone_staff_zone_role
  ON zone_staff(zone_id, role);

-- ------------------------------------------------------------
-- NOTES DE ZONE
-- ------------------------------------------------------------
-- Une Note appartient à une zone.
-- La position est conservée en JSON afin de rester indépendante du format
-- cartographique final. L'affichage comme épingle sera géré par le frontend.

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('information', 'watch', 'important')),
  content TEXT NOT NULL,
  position TEXT NOT NULL CHECK (json_valid(position)),
  duration_type TEXT NOT NULL CHECK (
    duration_type IN ('permanent', '1h', '6h', '24h', '3d', '7d', 'custom')
  ),
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  CHECK (
    (duration_type = 'permanent' AND expires_at IS NULL)
    OR
    (duration_type <> 'permanent' AND expires_at IS NOT NULL)
  ),
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notes_zone_status
  ON notes(zone_id, status);

CREATE INDEX IF NOT EXISTS idx_notes_expires
  ON notes(expires_at);

CREATE INDEX IF NOT EXISTS idx_notes_level
  ON notes(zone_id, level);

CREATE TRIGGER IF NOT EXISTS notes_set_updated_at
AFTER UPDATE ON notes
FOR EACH ROW
BEGIN
  UPDATE notes SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
