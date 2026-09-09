-- WPlace La Commune — D1 migration 0004
-- Configuration des Radars métier.
--
-- Cette migration ne lance aucun scan et n'active aucune surveillance.
-- `radar_events.radar_id` est actuellement TEXT dans la D1 DEV et dans le
-- moteur événementiel validé. La table `radars` utilise donc le même type
-- d'identifiant afin de préserver l'historique existant (`dev-test`) sans
-- reconstruction destructive de `radar_events`.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS radars (
  id TEXT PRIMARY KEY,
  zone_id INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('zone', 'rectangle')),
  geometry TEXT,
  status TEXT NOT NULL DEFAULT 'paused'
    CHECK (status IN ('active', 'paused', 'archived')),
  scan_interval_seconds INTEGER NOT NULL DEFAULT 120
    CHECK (scan_interval_seconds >= 60),
  notification_mode TEXT NOT NULL DEFAULT 'observation'
    CHECK (notification_mode IN ('observation', 'automatic')),
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
  CHECK (alert_threshold IS NULL OR alert_threshold >= 0),
  CHECK (urgency_threshold IS NULL OR urgency_threshold >= 0),
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
  WHERE type = 'zone' AND status IN ('active', 'paused');

CREATE TRIGGER IF NOT EXISTS radars_max_two_rectangles_insert
BEFORE INSERT ON radars
FOR EACH ROW
WHEN NEW.type = 'rectangle'
  AND NEW.status IN ('active', 'paused')
  AND (
    SELECT COUNT(*) FROM radars
    WHERE zone_id = NEW.zone_id
      AND type = 'rectangle'
      AND status IN ('active', 'paused')
  ) >= 2
BEGIN
  SELECT RAISE(ABORT, 'maximum de 2 Radars rectangle par zone');
END;

CREATE TRIGGER IF NOT EXISTS radars_max_two_rectangles_update
BEFORE UPDATE OF zone_id, type, status ON radars
FOR EACH ROW
WHEN NEW.type = 'rectangle'
  AND NEW.status IN ('active', 'paused')
  AND (
    SELECT COUNT(*) FROM radars
    WHERE zone_id = NEW.zone_id
      AND type = 'rectangle'
      AND status IN ('active', 'paused')
      AND id != OLD.id
  ) >= 2
BEGIN
  SELECT RAISE(ABORT, 'maximum de 2 Radars rectangle par zone');
END;

CREATE TRIGGER IF NOT EXISTS radars_set_updated_at
AFTER UPDATE ON radars
FOR EACH ROW
BEGIN
  UPDATE radars SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
