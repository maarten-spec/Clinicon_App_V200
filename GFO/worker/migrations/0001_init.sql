-- Clinicon Stellenplan schema (D1 / SQLite)
-- Use wrangler d1 migrations apply <DB_NAME>

CREATE TABLE IF NOT EXISTS qualifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personal_number TEXT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  extra_category TEXT,
  qualification_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (qualification_id) REFERENCES qualifications(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_key
ON employees(personal_number, name, category, IFNULL(extra_category, ''));

CREATE TABLE IF NOT EXISTS employee_month_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  value REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(employee_id, year, month),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_month_values_year_month
ON employee_month_values(year, month);

CREATE TABLE IF NOT EXISTS wirtschaftsplan_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  value REAL NOT NULL DEFAULT 0,
  scope TEXT NOT NULL DEFAULT 'total',
  label TEXT,
  UNIQUE(year, month, scope)
);
