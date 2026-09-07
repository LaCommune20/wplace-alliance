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

CREATE UNIQUE INDEX IF NOT EXISTS idx_radar_baselines_current
  ON radar_baselines(radar_id)
  WHERE current = 1;

CREATE INDEX IF NOT EXISTS idx_radar_baselines_status
  ON radar_baselines(status);
