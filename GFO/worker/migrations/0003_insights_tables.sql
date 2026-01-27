-- Clinicon Insights schema (D1 / SQLite)
-- Use: wrangler d1 migrations apply <DB_NAME>

CREATE TABLE IF NOT EXISTS org_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  parent_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parent_id) REFERENCES org_units(id)
);

CREATE TABLE IF NOT EXISTS stations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_unit_id INTEGER,
  code TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'station',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (org_unit_id) REFERENCES org_units(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stations_code_org
ON stations(code, IFNULL(org_unit_id, 0));

CREATE TABLE IF NOT EXISTS station_capacity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  vk_soll REAL NOT NULL DEFAULT 0,
  plan_betten INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(station_id, year, month),
  FOREIGN KEY (station_id) REFERENCES stations(id)
);

CREATE TABLE IF NOT EXISTS staffing_actuals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  vk_ist REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'stellenplan',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(station_id, year, month),
  FOREIGN KEY (station_id) REFERENCES stations(id)
);

CREATE TABLE IF NOT EXISTS station_qualification_mix (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL,
  qualification_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  vk_value REAL NOT NULL DEFAULT 0,
  UNIQUE(station_id, qualification_id, year, month),
  FOREIGN KEY (station_id) REFERENCES stations(id),
  FOREIGN KEY (qualification_id) REFERENCES qualifications(id)
);

CREATE TABLE IF NOT EXISTS ppug_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  status TEXT NOT NULL DEFAULT 'OK',
  ratio_actual REAL NOT NULL DEFAULT 0,
  ratio_target REAL NOT NULL DEFAULT 0,
  UNIQUE(station_id, year, month),
  FOREIGN KEY (station_id) REFERENCES stations(id)
);

CREATE TABLE IF NOT EXISTS insights_kpi_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL DEFAULT 'station',
  scope_id INTEGER,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  kpi_key TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(scope, scope_id, year, month, kpi_key)
);
