-- WPlace La Commune — D1 migration 0002
-- Notes, responsables de zone/templates et socle Radar.
--
-- Cette migration ne déploie encore aucun moteur Radar et n'active aucune
-- surveillance automatique. Elle prépare uniquement le modèle de données.

PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

-- ------------------------------------------------------------
-- RESPONSABLES DE ZONE
-- ------------------------------------------------------------
-- Une même personne peut avoir plusieurs rôles sur une même zone.
-- Les modérateurs restent dans zone_moderators pour compatibilité avec
-- le système de permissions existant.

CREATE TABLE IF NOT EXISTS zone_staff (
  zone_id INTEGER NOT NULL,
  discord_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager','template_manager')),
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
-- Les notes sont toujours rattachées à une zone et peuvent être affichées
-- comme épingle uniquement lorsque cette zone est sélectionnée.

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('information','watch','important')),
  content TEXT NOT NULL,
  position TEXT NOT NULL CHECK (json_valid(position)),
  duration_type TEXT NOT NULL CHECK (
    duration_type IN ('permanent','1h','6h','24h','3d','7d','custom')
  ),
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','expired','archived')),
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

-- ------------------------------------------------------------
-- RADARS
-- ------------------------------------------------------------
-- V1 : une surveillance porte soit sur une zone entière, soit sur un
-- rectangle. La limite "1 zone entière / 2 rectangles" est appliquée par
-- le service métier ; l'index ci-dessous garantit au moins qu'une zone ne
-- possède jamais deux radars "zone entière" actifs simultanément.

CREATE TABLE IF NOT EXISTS radars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('zone','rectangle')),
  geometry TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','archived')),
  scan_interval_seconds INTEGER NOT NULL DEFAULT 120
    CHECK (scan_interval_seconds >= 60),
  notification_mode TEXT NOT NULL DEFAULT 'observation'
    CHECK (notification_mode IN ('observation','automatic')),
  alert_threshold INTEGER,
  urgency_threshold INTEGER,
  last_scan_at TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (type = 'zone' AND geometry IS NULL)
    OR
    (type = 'rectangle' AND geometry IS NOT NULL AND json_valid(geometry))
  ),
  CHECK (
    alert_threshold IS NULL OR alert_threshold >= 0
  ),
  CHECK (
    urgency_threshold IS NULL OR urgency_threshold >= 0
  ),
  CHECK (
    alert_threshold IS NULL
    OR urgency_threshold IS NULL
    OR urgency_threshold >= alert_threshold
  ),
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_radars_zone_status
  ON radars(zone_id, status);

CREATE INDEX IF NOT EXISTS idx_radars_status
  ON radars(status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_radars_one_zone_radar
  ON radars(zone_id)
  WHERE type = 'zone' AND status IN ('active','paused');

CREATE TRIGGER IF NOT EXISTS radars_set_updated_at
AFTER UPDATE ON radars
FOR EACH ROW
BEGIN
  UPDATE radars SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- ------------------------------------------------------------
-- ÉVÉNEMENTS RADAR
-- ------------------------------------------------------------
-- Un événement regroupe des modifications cohérentes dans l'espace et le
-- temps. Les scans sans changement ne sont pas stockés ici.

CREATE TABLE IF NOT EXISTS radar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  radar_id INTEGER NOT NULL,
  zone_id INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  closed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','quiet','closed')),
  pixel_count INTEGER NOT NULL DEFAULT 0 CHECK (pixel_count >= 0),
  region_count INTEGER NOT NULL DEFAULT 0 CHECK (region_count >= 0),
  score INTEGER CHECK (score IS NULL OR score >= 0),
  score_breakdown TEXT CHECK (
    score_breakdown IS NULL OR json_valid(score_breakdown)
  ),
  template_id INTEGER,
  template_version INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status = 'closed' AND closed_at IS NOT NULL)
    OR
    (status <> 'closed')
  ),
  FOREIGN KEY (radar_id) REFERENCES radars(id) ON DELETE CASCADE,
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_radar_events_radar_status
  ON radar_events(radar_id, status);

CREATE INDEX IF NOT EXISTS idx_radar_events_zone_started
  ON radar_events(zone_id, started_at);

CREATE INDEX IF NOT EXISTS idx_radar_events_last_activity
  ON radar_events(last_activity_at);

CREATE INDEX IF NOT EXISTS idx_radar_events_status
  ON radar_events(status);

-- ------------------------------------------------------------
-- RÉGIONS D'UN ÉVÉNEMENT RADAR
-- ------------------------------------------------------------
-- On conserve une empreinte compacte de la région modifiée plutôt qu'une
-- ligne D1 par pixel.

CREATE TABLE IF NOT EXISTS radar_event_regions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  min_x INTEGER NOT NULL,
  min_y INTEGER NOT NULL,
  max_x INTEGER NOT NULL,
  max_y INTEGER NOT NULL,
  pixel_count INTEGER NOT NULL DEFAULT 0 CHECK (pixel_count >= 0),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES radar_events(id) ON DELETE CASCADE,
  CHECK (min_x >= 0 AND min_y >= 0),
  CHECK (max_x >= min_x AND max_y >= min_y)
);

CREATE INDEX IF NOT EXISTS idx_radar_event_regions_event
  ON radar_event_regions(event_id);

CREATE INDEX IF NOT EXISTS idx_radar_event_regions_tile
  ON radar_event_regions(tile_x, tile_y);

-- ------------------------------------------------------------
-- INTÉGRATION DES ALERTES EXISTANTES
-- ------------------------------------------------------------
-- Une alerte Radar réutilise la table alerts existante. Cela permet de
-- conserver un seul système d'alertes et d'éviter les doublons Discord.

ALTER TABLE alerts ADD COLUMN radar_event_id INTEGER
  REFERENCES radar_events(id) ON DELETE SET NULL;

ALTER TABLE alerts ADD COLUMN discord_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_alerts_radar_event
  ON alerts(radar_event_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_discord_message
  ON alerts(discord_message_id)
  WHERE discord_message_id IS NOT NULL;

COMMIT;
