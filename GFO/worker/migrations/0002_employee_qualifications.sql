-- Add optional qualifications per employee
CREATE TABLE IF NOT EXISTS employee_qualifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  qualification_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(employee_id, qualification_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (qualification_id) REFERENCES qualifications(id)
);

CREATE INDEX IF NOT EXISTS idx_employee_qualifications_employee
ON employee_qualifications(employee_id);

