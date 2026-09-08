-- WPlace La Commune — D1 migration 0003
-- Radar events + regions.
-- Cette migration ne crée aucune alerte et n'active aucune surveillance.

PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS radar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  radar_id TEXT NOT NULL,
  zone_id INTEGER,
  started_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  closed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'quiet', 'closed')),
  pixel_count INTEGER NOT NULL DEFAULT 0 CHECK (pixel_count >= 0),
  region_count INTEGER NOT NULL DEFAULT 0 CHECK (region_count >= 0),
  score INTEGER CHECK (score IS NULL OR score >= 0),
  score_breakdown TEXT CHECK (score_breakdown IS NULL OR json_valid(score_breakdown)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status='closed' AND closed_at IS NOT NULL) OR (status <> 'closed'))
);
CREATE INDEX IF NOT EXISTS idx_radar_events_radar_status
  ON radar_events(radar_id, status);
CREATE INDEX IF NOT EXISTS idx_radar_events_last_activity
  ON radar_events(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_radar_events_status
  ON radar_events(status);

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

COMMIT;
