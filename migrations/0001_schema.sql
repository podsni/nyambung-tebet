CREATE TABLE IF NOT EXISTS cafes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  rating REAL,
  down_mbps REAL,
  up_mbps REAL,
  ping_ms REAL,
  outlets TEXT NOT NULL DEFAULT 'unknown',
  prayer TEXT NOT NULL DEFAULT 'unknown',
  hours TEXT NOT NULL DEFAULT '',
  price REAL,
  stability TEXT NOT NULL DEFAULT 'unknown',
  comfort REAL,
  smoking TEXT NOT NULL DEFAULT '',
  ssid TEXT NOT NULL DEFAULT '',
  wifi_password TEXT NOT NULL DEFAULT '',
  wifi_public INTEGER NOT NULL DEFAULT 0 CHECK (wifi_public IN (0, 1)),
  map_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS cafes_area_idx ON cafes(area);
CREATE INDEX IF NOT EXISTS cafes_updated_at_idx ON cafes(updated_at);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  ip_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started INTEGER NOT NULL
);
