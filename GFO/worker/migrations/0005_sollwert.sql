-- Sollwertberechnung (Arbeitsplatzmethode) pro Jahr/Scope

CREATE TABLE IF NOT EXISTS sollwert_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'arbeitsplatz',
  inputs_json TEXT,
  scope TEXT NOT NULL DEFAULT 'total',
  tenant_id INTEGER,
  department_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(year, scope)
);
