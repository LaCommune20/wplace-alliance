-- WPlace La Commune — D1
-- Migration 0001 : schéma initial
--
-- Cette migration correspond au schéma fonctionnel actuellement validé
-- sur la base DEV. La table interne _cf_KV de Cloudflare n'est volontairement
-- pas reproduite ici.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category_id INTEGER NOT NULL,
  continent TEXT NOT NULL,
  country TEXT NOT NULL,
  owner_name TEXT,
  owner_public INTEGER NOT NULL DEFAULT 1 CHECK (owner_public IN (0,1)),
  polygon TEXT NOT NULL CHECK (json_valid(polygon)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  center TEXT CHECK (center IS NULL OR json_valid(center)),
  focus_zoom REAL,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('offensive','defensive')),
  target_zone_id INTEGER,
  target_name TEXT,
  target_location TEXT CHECK (target_location IS NULL OR json_valid(target_location)),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','completed','cancelled')),
  created_by TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (target_zone_id) REFERENCES zones(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  r2_key TEXT NOT NULL UNIQUE,
  wplace_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','archived','rejected')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE,
  UNIQUE (zone_id, slug)
);

CREATE TABLE IF NOT EXISTS zone_moderators (
  zone_id INTEGER NOT NULL,
  discord_user_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (zone_id, discord_user_id),
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS zone_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  action TEXT NOT NULL CHECK (action IN ('create','update','geometry_update','archive','restore')),
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  author_discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (zone_id, version),
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS template_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  action TEXT NOT NULL CHECK (action IN ('create','update','validate','reject','archive','restore')),
  r2_key TEXT NOT NULL,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  author_discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (template_id, version),
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id INTEGER,
  zone_id INTEGER,
  source TEXT NOT NULL CHECK (source IN ('radarbot','discord','system','manual')),
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  title TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','acknowledged','resolved','dismissed')),
  metadata TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE SET NULL,
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_discord_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  result TEXT NOT NULL CHECK (result IN ('success','denied','error')),
  reason TEXT,
  metadata TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_actor ON admin_logs(actor_discord_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_alerts_operation ON alerts(operation_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_zone ON alerts(zone_id);

CREATE INDEX IF NOT EXISTS idx_operations_status ON operations(status);
CREATE INDEX IF NOT EXISTS idx_operations_target ON operations(target_zone_id);

CREATE INDEX IF NOT EXISTS idx_template_history_template ON template_history(template_id);
CREATE INDEX IF NOT EXISTS idx_templates_status ON templates(status);
CREATE INDEX IF NOT EXISTS idx_templates_zone ON templates(zone_id);

CREATE INDEX IF NOT EXISTS idx_zone_history_zone ON zone_history(zone_id);
CREATE INDEX IF NOT EXISTS idx_zone_moderators_user ON zone_moderators(discord_user_id);

CREATE INDEX IF NOT EXISTS idx_zones_category ON zones(category_id);
CREATE INDEX IF NOT EXISTS idx_zones_continent ON zones(continent);
CREATE INDEX IF NOT EXISTS idx_zones_country ON zones(country);
CREATE INDEX IF NOT EXISTS idx_zones_status ON zones(status);

CREATE TRIGGER IF NOT EXISTS operations_set_updated_at
AFTER UPDATE ON operations
FOR EACH ROW
BEGIN
  UPDATE operations SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS templates_set_updated_at
AFTER UPDATE ON templates
FOR EACH ROW
BEGIN
  UPDATE templates SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS zones_set_updated_at
AFTER UPDATE ON zones
FOR EACH ROW
BEGIN
  UPDATE zones SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
