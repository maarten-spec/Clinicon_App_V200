-- Absence flags per employee/month (MS/EZ/KOL)
CREATE TABLE IF NOT EXISTS employee_month_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  code TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  tenant_id INTEGER,
  department_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(employee_id, year, month),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_employee_flags_tenant_dept_year
ON employee_month_flags(tenant_id, department_id, year);
