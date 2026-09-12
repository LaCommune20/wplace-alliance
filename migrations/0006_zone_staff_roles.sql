-- WPlace La Commune — D1
-- Migration 0006 : extension des attributions métier de zone
--
-- Cette migration ajoute le rôle `ally` à zone_staff.
--
-- Le rôle `manager` correspond au Gérant de zone.
-- Le rôle `template_manager` correspond au Responsable des templates.
-- Le rôle `ally` correspond à l'Allié.
--
-- Les Modérateurs restent dans zone_moderators.
-- Les rôles Discord Communard / Sympathisant restent des rôles généraux
-- et ne nécessitent pas d'attribution par zone.
--
-- SQLite ne permet pas de modifier directement le CHECK existant : la table
-- est donc reconstruite en conservant les données présentes.

-- ------------------------------------------------------------
-- ZONE STAFF
-- ------------------------------------------------------------

DROP TABLE IF EXISTS zone_staff_new;

CREATE TABLE zone_staff_new (
  zone_id INTEGER NOT NULL,
  discord_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager', 'template_manager', 'ally')),
  assigned_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (zone_id, discord_user_id, role),
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
);

INSERT INTO zone_staff_new (
  zone_id,
  discord_user_id,
  role,
  assigned_by,
  created_at
)
SELECT
  zone_id,
  discord_user_id,
  role,
  assigned_by,
  created_at
FROM zone_staff;

DROP TABLE zone_staff;
ALTER TABLE zone_staff_new RENAME TO zone_staff;

CREATE INDEX IF NOT EXISTS idx_zone_staff_user
  ON zone_staff(discord_user_id);

CREATE INDEX IF NOT EXISTS idx_zone_staff_zone_role
  ON zone_staff(zone_id, role);
