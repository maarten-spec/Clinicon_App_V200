-- Clinicon multi-tenant schema (D1 / SQLite)

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tenant_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  tenant_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'tenant',
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(email, tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  code TEXT,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, code, name),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Extend existing tables for tenant + department scoping
ALTER TABLE employees ADD COLUMN tenant_id INTEGER;
ALTER TABLE employees ADD COLUMN department_id INTEGER;

ALTER TABLE employee_month_values ADD COLUMN tenant_id INTEGER;
ALTER TABLE employee_month_values ADD COLUMN department_id INTEGER;

ALTER TABLE wirtschaftsplan_targets ADD COLUMN tenant_id INTEGER;
ALTER TABLE wirtschaftsplan_targets ADD COLUMN department_id INTEGER;

ALTER TABLE stations ADD COLUMN tenant_id INTEGER;
ALTER TABLE station_capacity ADD COLUMN tenant_id INTEGER;
ALTER TABLE staffing_actuals ADD COLUMN tenant_id INTEGER;
ALTER TABLE ppug_status ADD COLUMN tenant_id INTEGER;
ALTER TABLE station_qualification_mix ADD COLUMN tenant_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_employees_tenant_dept
ON employees(tenant_id, department_id, category);

CREATE INDEX IF NOT EXISTS idx_month_values_tenant_dept_year
ON employee_month_values(tenant_id, department_id, year);

CREATE INDEX IF NOT EXISTS idx_departments_tenant
ON departments(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_stations_tenant
ON stations(tenant_id, is_active);

-- Seed tenants
INSERT OR IGNORE INTO tenants (code, name) VALUES
  ('GFO-ZPD','GFO-ZPD'),
  ('GFO-SIE','GFO-SIE'),
  ('GFO-BEU','GFO-BEU'),
  ('GFO-BAH','GFO-BAH'),
  ('GFO-TRO','GFO-TRO'),
  ('GFO-DIN','GFO-DIN'),
  ('GFO-MOE','GFO-MOE'),
  ('GFO-DUI','GFO-DUI'),
  ('GFO-BEN','GFO-BEN'),
  ('GFO-BER','GFO-BER'),
  ('GFO-OLP','GFO-OLP'),
  ('GFO-LEN','GFO-LEN'),
  ('GFO-ENG','GFO-ENG'),
  ('GFO-BRU','GFO-BRU'),
  ('GFO-LAN','GFO-LAN'),
  ('GFO-HIL','GFO-HIL'),
  ('GFO-WIS','GFO-WIS'),
  ('GFO-RHE','GFO-RHE'),
  ('ADMIN','Admin');
