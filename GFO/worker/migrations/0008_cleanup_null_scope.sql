-- Cleanup legacy rows without tenant/department + fix unique index to be tenant scoped

-- Remove month values/flags tied to legacy employees (no tenant/department)
DELETE FROM employee_month_values
WHERE tenant_id IS NULL OR department_id IS NULL
   OR employee_id IN (
     SELECT id FROM employees WHERE tenant_id IS NULL OR department_id IS NULL
   );

DELETE FROM employee_month_flags
WHERE tenant_id IS NULL OR department_id IS NULL
   OR employee_id IN (
     SELECT id FROM employees WHERE tenant_id IS NULL OR department_id IS NULL
   );

DELETE FROM employee_qualifications
WHERE employee_id IN (
  SELECT id FROM employees WHERE tenant_id IS NULL OR department_id IS NULL
);

-- Remove legacy employees
DELETE FROM employees WHERE tenant_id IS NULL OR department_id IS NULL;

-- Replace unique index so employees are unique per tenant/department
DROP INDEX IF EXISTS idx_employees_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_key_tenant_dept
ON employees(tenant_id, department_id, personal_number, name, category, IFNULL(extra_category, ''));
