-- WPlace La Commune — D1
-- Migration 0004 : Radar
--
-- Schéma extrait du dump réel de la D1 DEV.
-- Cette migration vise à rendre le schéma Radar actuellement utilisé par
-- le Worker DEV reproductible dans le dépôt.

CREATE TABLE IF NOT EXISTS radar_baselines (
  id TEXT PRIMARY KEY,
  radar_id TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'finalized', 'committed', 'aborted')),
  expected_tile_count INTEGER NOT NULL CHECK (expected_tile_count > 0),
  manifest_key TEXT NOT NULL,
  current INTEGER NOT NULL DEFAULT 0 CHECK (current IN (0, 1)),
  created_at TEXT NOT NULL,
  committed_at TEXT,
  UNIQUE (radar_id, version)
);

CREATE TABLE IF NOT EXISTS radar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  radar_id TEXT NOT NULL,
  zone_id INTEGER,
  started_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  closed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'quiet', 'closed')),
  pixel_count INTEGER NOT NULL DEFAULT 0 CHECK (pixel_count >= 0),
  region_count INTEGER NOT NULL DEFAULT 0 CHECK (region_count >= 0),
  score INTEGER CHECK (score IS NULL OR score >= 0),
  score_breakdown TEXT CHECK (score_breakdown IS NULL OR json_valid(score_breakdown)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status = 'closed' AND closed_at IS NOT NULL) OR (status <> 'closed'))
);

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

CREATE TABLE IF NOT EXISTS radars (
  id TEXT PRIMARY KEY,
  zone_id INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('zone', 'rectangle')),
  geometry TEXT,
  status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('active', 'paused', 'archived')),
  scan_interval_seconds INTEGER NOT NULL DEFAULT 120 CHECK (scan_interval_seconds >= 60),
  notification_mode TEXT NOT NULL DEFAULT 'observation' CHECK (notification_mode IN ('observation', 'automatic')),
  alert_threshold INTEGER,
  urgency_threshold INTEGER,
  last_scan_at TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((type = 'zone' AND geometry IS NULL) OR (type = 'rectangle' AND geometry IS NOT NULL AND json_valid(geometry))),
  CHECK (alert_threshold IS NULL OR alert_threshold >= 0),
  CHECK (urgency_threshold IS NULL OR urgency_threshold >= 0),
  CHECK (alert_threshold IS NULL OR urgency_threshold IS NULL OR urgency_threshold >= alert_threshold),
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_radar_baselines_current ON radar_baselines(radar_id) WHERE current = 1;
CREATE INDEX IF NOT EXISTS idx_radar_baselines_status ON radar_baselines(status);
CREATE INDEX IF NOT EXISTS idx_radar_events_radar_status ON radar_events(radar_id, status);
CREATE INDEX IF NOT EXISTS idx_radar_events_last_activity ON radar_events(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_radar_events_status ON radar_events(status);
CREATE INDEX IF NOT EXISTS idx_radar_event_regions_event ON radar_event_regions(event_id);
CREATE INDEX IF NOT EXISTS idx_radar_event_regions_tile ON radar_event_regions(tile_x, tile_y);
CREATE INDEX IF NOT EXISTS idx_radars_zone_status ON radars(zone_id, status);
CREATE INDEX IF NOT EXISTS idx_radars_status ON radars(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_radars_one_zone_radar ON radars(zone_id) WHERE type = 'zone' AND status IN ('active', 'paused');

CREATE TRIGGER IF NOT EXISTS radars_set_updated_at
AFTER UPDATE ON radars
FOR EACH ROW
BEGIN
  UPDATE radars SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS radars_max_two_rectangles_insert
BEFORE INSERT ON radars
FOR EACH ROW
WHEN NEW.type = 'rectangle' AND NEW.status IN ('active', 'paused') AND (
  SELECT COUNT(*) FROM radars WHERE zone_id = NEW.zone_id AND type = 'rectangle' AND status IN ('active', 'paused')
) >= 2
BEGIN
  SELECT RAISE(ABORT, 'maximum de 2 Radars rectangle par zone');
END;

CREATE TRIGGER IF NOT EXISTS radars_max_two_rectangles_update
BEFORE UPDATE OF zone_id, type, status ON radars
FOR EACH ROW
WHEN NEW.type = 'rectangle' AND NEW.status IN ('active', 'paused') AND (
  SELECT COUNT(*) FROM radars WHERE zone_id = NEW.zone_id AND type = 'rectangle' AND status IN ('active', 'paused') AND id != OLD.id
) >= 2
BEGIN
  SELECT RAISE(ABORT, 'maximum de 2 Radars rectangle par zone');
END;
