-- Sync departments -> stations for Insights (run once, idempotent)

INSERT INTO stations (org_unit_id, code, name, type, tenant_id)
SELECT
  NULL AS org_unit_id,
  d.code,
  d.name,
  'station' AS type,
  d.tenant_id
FROM departments d
WHERE d.is_active=1
  AND NOT EXISTS (
    SELECT 1
    FROM stations s
    WHERE s.tenant_id = d.tenant_id
      AND s.name = d.name
  );

