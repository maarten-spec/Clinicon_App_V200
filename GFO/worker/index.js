/**
 * Clinicon Stellenplan Worker (D1)
 * Routes:
 *   GET  /api/stellenplan?year=YYYY
 *   POST /api/stellenplan
 *   GET  /api/stellenplan/summary?year=YYYY
 *   GET  /api/stellenplan/entries?year=YYYY
 *   GET  /api/insights?year=YYYY&month=MM
 */

const MONTH_COUNT = 12;
const MONTHS = Array.from({ length: MONTH_COUNT }, (_, i) => i + 1);
const CATEGORY_MAIN = "main";
const CATEGORY_EXTRA = "extra";
const DEFAULT_SCOPE = "total";

const QUALIFICATION_SEED = [
  { code: "REQ_PFK", label: "Pflegefachkraft" },
  { code: "REQ_PFA", label: "Pflegefachassistenz" },
  { code: "REQ_UK", label: "Ungelernte Kraft" },
  { code: "REQ_MFA", label: "MFA" },
  { code: "FACH_INT", label: "Fachpflegekraft fuer Intensivpflege und Anaesthesie" },
  { code: "FACH_OP", label: "Fachpflegekraft fuer OP-Dienst / perioperative Pflege" },
  { code: "FACH_ONK", label: "Fachpflegekraft fuer Onkologie" },
  { code: "FACH_PSY", label: "Fachpflegekraft fuer Psychiatrie (psychiatrische Pflege)" },
  { code: "FACH_PAE", label: "Fachpflegekraft fuer Paediatrische Intensivpflege / Paediatrie" },
  { code: "FACH_END", label: "Fachpflegekraft fuer Endoskopie" },
  { code: "FUNC_PRAXIS", label: "Praxisanleitung (Praxisanleiter:in)" },
  { code: "FUNC_WUND", label: "Wundexpert:in ICW / Wundmanager:in" },
  { code: "FUNC_PAIN", label: "Pain Nurse / algesiologische Fachassistenz" },
  { code: "FUNC_HYG", label: "Hygienebeauftragte:r in der Pflege / Hygienefachkraft" },
  { code: "FUNC_PALL", label: "Palliativ-Care-Fachkraft" },
  { code: "FUNC_ATEM", label: "Atemtherapeut:in / Atmungstherapie" },
  { code: "FUNC_STOMA", label: "Stoma- und Kontinenzberater:in" },
  { code: "FUNC_DIAB", label: "Diabetesberatung" },
  { code: "FUNC_CASE", label: "Case Management / Entlassmanagement" },
  { code: "FUNC_NOTF", label: "Notfallpflege" },
  { code: "FUNC_GERONTO", label: "Gerontopsychiatrische Zusatzqualifikation" },
  { code: "LEAD_STL", label: "Stationsleitung / Leitung einer Einheit" },
  { code: "LEAD_PDL", label: "Pflegedienstleitung (PDL)" },
  { code: "LEAD_MGMT", label: "Pflegemanagement / Pflegepaedagogik" },
  { code: "LEAD_QM", label: "Qualitaetsmanagement (QM-Beauftragte:r / Auditor:in)" },
  { code: "AKUT_REA", label: "Reanimations-/ALS-/BLS-Instruktor:in" },
  { code: "AKUT_DEESK", label: "Deeskalation / Aggressionsmanagement" },
  { code: "AKUT_CIRS", label: "CIRS-/Patientensicherheitsbeauftragte:r" },
  { code: "AKUT_TRANS", label: "Transfusionsbeauftragte:r / Blutprodukte-Schulung" },
  { code: "AKUT_MPG", label: "Medizinproduktebeauftragte:r / MPG-Einweisungen" },
  { code: "AKUT_ZSVA", label: "Sterilgut/ZSVA-Grundlagen" }
];

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "https://app.clinicon.de",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function badRequest(message) {
  return jsonResponse({ ok: false, error: message }, 400);
}

function unauthorized() {
  return jsonResponse({ ok: false, error: "unauthorized" }, 401);
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseJsonSafe(value, fallback = {}) {
  try {
    if (!value) return fallback;
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function buildMonthArray(seed = 0) {
  return MONTHS.map(() => seed);
}

function getAuthEmail(request) {
  return (
    request.headers.get("cf-access-authenticated-user-email") ||
    request.headers.get("CF-Access-Authenticated-User-Email") ||
    request.headers.get("x-user-email") ||
    request.headers.get("X-User-Email") ||
    ""
  ).trim();
}

async function listTenants(db) {
  const rows = await db
    .prepare("SELECT id, code, name FROM tenants WHERE is_active=1 ORDER BY name ASC")
    .all();
  return rows.results || [];
}

async function resolveTenantContext(db, request, payloadTenantId) {
  const email = getAuthEmail(request);
  const url = new URL(request.url);
  const allTenants = await listTenants(db);

  if (!email) {
    return { error: "unauthorized" };
  }

  const rows = await db
    .prepare(
      "SELECT tu.role, t.id, t.code, t.name " +
        "FROM tenant_users tu JOIN tenants t ON t.id=tu.tenant_id " +
        "WHERE tu.email=? AND tu.is_active=1 AND t.is_active=1"
    )
    .bind(email)
    .all();

  const results = rows.results || [];
  if (!results.length) {
    return { error: "unauthorized" };
  }

  const roles = new Set(results.map((row) => String(row.role || "").toLowerCase()));
  const isAdmin = roles.has("admin");
  const isZpd = roles.has("zpd");
  const tenants = isAdmin || isZpd
    ? allTenants
    : Array.from(
        new Map(results.map((row) => [row.id, { id: row.id, code: row.code, name: row.name }])).values()
      );

  const requestedId =
    toInt(url.searchParams.get("tenant"), null) ||
    toInt(url.searchParams.get("tenant_id"), null) ||
    toInt(payloadTenantId, null);

  const activeTenant = tenants.find((t) => t.id === requestedId) || tenants[0] || null;

  return {
    email,
    role: isAdmin ? "admin" : isZpd ? "zpd" : "tenant",
    tenants,
    tenant: activeTenant
  };
}

async function listDepartments(db, tenantId) {
  if (!tenantId) return [];
  const rows = await db
    .prepare("SELECT id, code, name FROM departments WHERE tenant_id=? AND is_active=1 ORDER BY name ASC")
    .bind(tenantId)
    .all();
  return rows.results || [];
}

async function resolveDepartment(db, request, payloadDeptId, tenantId) {
  const url = new URL(request.url);
  const requestedId =
    toInt(url.searchParams.get("department"), null) ||
    toInt(url.searchParams.get("department_id"), null) ||
    toInt(payloadDeptId, null);
  const departments = await listDepartments(db, tenantId);
  const active = requestedId ? (departments.find((d) => d.id === requestedId) || null) : null;
  return { departments, department: active };
}

function buildScopeKey(tenantId, departmentId) {
  if (!tenantId) return DEFAULT_SCOPE;
  return `${DEFAULT_SCOPE}:${tenantId}:${departmentId || "all"}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function buildDateString(year, month) {
  return `${year}-${pad2(month)}-01`;
}

function withCors(response, request) {
  const req = request || response.__request || null;
  const origin = req ? req.headers.get("Origin") : null;
  const reqHeaders = req ? req.headers.get("Access-Control-Request-Headers") : null;
  const headers = new Headers(response.headers || {});
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  } else {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    reqHeaders && reqHeaders.trim() ? reqHeaders : "content-type, x-user-email, cf-access-authenticated-user-email"
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}


async function handleOptions(request) {
  const origin = request.headers.get("Origin");
  const reqHeaders = request.headers.get("Access-Control-Request-Headers");
  const headers = new Headers(JSON_HEADERS);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  } else {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    reqHeaders && reqHeaders.trim() ? reqHeaders : "content-type, x-user-email, cf-access-authenticated-user-email"
  );
  return new Response(null, { status: 204, headers });
}


async function ensureQualifications(db) {
  const existing = await db.prepare("SELECT code, label FROM qualifications").all();
  const codeSet = new Set((existing.results || []).map((row) => String(row.code || "")));
  const labelSet = new Set((existing.results || []).map((row) => String(row.label || "").toLowerCase().trim()));

  for (const qual of QUALIFICATION_SEED) {
    const code = String(qual.code || "");
    const label = String(qual.label || "");
    if (!code || !label) continue;
    if (codeSet.has(code) || labelSet.has(label.toLowerCase().trim())) continue;
    await db
      .prepare("INSERT INTO qualifications (code, label) VALUES (?, ?)")
      .bind(code, label)
      .run();
  }
}

async function handleGetStellenplan(request, env) {
  const url = new URL(request.url);
  const year = toInt(url.searchParams.get("year"), new Date().getFullYear());
  if (!Number.isFinite(year)) {
    return badRequest("Invalid year.");
  }

  const db = env.DB;
  const tenantContext = await resolveTenantContext(db, request);
  if (tenantContext.error) {
    return unauthorized();
  }
  const tenantId = tenantContext.tenant ? tenantContext.tenant.id : null;
  const deptContext = await resolveDepartment(db, request, null, tenantId);
  const departmentId = deptContext.department ? deptContext.department.id : null;
  if (!tenantId || !departmentId) {
    return badRequest("tenant_id and department_id are required.");
  }

  await ensureQualifications(db);

  const qualifications = await db
    .prepare("SELECT id, code, label FROM qualifications WHERE is_active=1 ORDER BY label ASC")
    .all();

  let employeeSql =
    "SELECT id, personal_number, name, category, extra_category, qualification_id, is_hidden " +
    "FROM employees WHERE is_active=1";
  const employeeParams = [];
  if (tenantId) {
    employeeSql += " AND tenant_id=?";
    employeeParams.push(tenantId);
  }
  if (departmentId) {
    employeeSql += " AND department_id=?";
    employeeParams.push(departmentId);
  }
  employeeSql += " ORDER BY id ASC";
  const employees = await db.prepare(employeeSql).bind(...employeeParams).all();

  const optionalQualifications = await db
    .prepare("SELECT employee_id, qualification_id FROM employee_qualifications")
    .all();

  const optionalMap = new Map();
  for (const row of optionalQualifications.results || []) {
    const list = optionalMap.get(row.employee_id) || [];
    list.push(row.qualification_id);
    optionalMap.set(row.employee_id, list);
  }

  let monthSql = "SELECT employee_id, month, value FROM employee_month_values WHERE year=?";
  const monthParams = [year];
  if (tenantId) {
    monthSql += " AND tenant_id=?";
    monthParams.push(tenantId);
  }
  if (departmentId) {
    monthSql += " AND department_id=?";
    monthParams.push(departmentId);
  }
  const monthValues = await db.prepare(monthSql).bind(...monthParams).all();

  let flagsSql = "SELECT employee_id, month, code FROM employee_month_flags WHERE year=?";
  const flagsParams = [year];
  if (tenantId) {
    flagsSql += " AND tenant_id=?";
    flagsParams.push(tenantId);
  }
  if (departmentId) {
    flagsSql += " AND department_id=?";
    flagsParams.push(departmentId);
  }
  const flagsRows = await db.prepare(flagsSql).bind(...flagsParams).all();

  const scopeKey = buildScopeKey(tenantId, departmentId);
  const planTargets = await db
    .prepare("SELECT month, value, scope FROM wirtschaftsplan_targets WHERE year=? AND scope=?")
    .bind(year, scopeKey)
    .all();
  const sollwertRow = await db
    .prepare("SELECT value, method, inputs_json FROM sollwert_values WHERE year=? AND scope=?")
    .bind(year, scopeKey)
    .first();

  const valueMap = new Map();
  for (const row of monthValues.results || []) {
    if (!valueMap.has(row.employee_id)) {
      valueMap.set(row.employee_id, buildMonthArray(0));
    }
    const months = valueMap.get(row.employee_id);
    const index = Math.max(1, Math.min(MONTH_COUNT, Number(row.month))) - 1;
    months[index] = normalizeNumber(row.value);
  }

  const flagsMap = new Map();
  for (const row of flagsRows.results || []) {
    if (!flagsMap.has(row.employee_id)) {
      flagsMap.set(row.employee_id, buildMonthArray(""));
    }
    const list = flagsMap.get(row.employee_id);
    const index = Math.max(1, Math.min(MONTH_COUNT, Number(row.month))) - 1;
    list[index] = String(row.code || "").toUpperCase();
  }

  const mainRows = [];
  const extraRows = [];

  for (const row of employees.results || []) {
    const months = valueMap.get(row.id) || buildMonthArray(0);
    const payload = {
      id: row.id,
      personalNumber: normalizeText(row.personal_number),
      name: normalizeText(row.name),
      category: normalizeText(row.extra_category),
      qualificationId: row.qualification_id || null,
      optionalQualifications: optionalMap.get(row.id) || [],
      months,
      absences: flagsMap.get(row.id) || buildMonthArray(""),
      isHidden: Boolean(row.is_hidden)
    };
    if (row.category === CATEGORY_EXTRA) {
      extraRows.push(payload);
    } else {
      mainRows.push(payload);
    }
  }

  const planMonthValues = buildMonthArray(0);
  for (const row of planTargets.results || []) {
    const index = Math.max(1, Math.min(MONTH_COUNT, Number(row.month))) - 1;
    planMonthValues[index] = normalizeNumber(row.value);
  }

  return jsonResponse({
    ok: true,
    year,
    tenant: tenantContext.tenant,
    tenants: tenantContext.tenants,
    department: deptContext.department,
    departments: deptContext.departments,
    qualifications: qualifications.results || [],
    employees: mainRows,
    extras: extraRows,
    planTargets: {
      scope: scopeKey,
      months: planMonthValues
    },
    sollwert: {
      value: normalizeNumber(sollwertRow ? sollwertRow.value : 0),
      method: sollwertRow && sollwertRow.method ? sollwertRow.method : "arbeitsplatz",
      inputs: sollwertRow ? parseJsonSafe(sollwertRow.inputs_json, {}) : {}
    }
  });
}

async function resolveEmployeeId(db, row, category, tenantId, departmentId) {
  const personalNumber = normalizeText(row.personalNumber);
  const name = normalizeText(row.name);
  const extraCategory = normalizeText(row.category);
  const qualificationId = row.qualificationId ? Number(row.qualificationId) : null;
  const isHidden = row.isHidden ? 1 : 0;

  if (Number.isInteger(row.id)) {
    await db
      .prepare(
        "UPDATE employees SET personal_number=?, name=?, category=?, extra_category=?, qualification_id=?, tenant_id=?, department_id=?, is_hidden=?, updated_at=datetime('now') WHERE id=?"
      )
      .bind(
        personalNumber,
        name || extraCategory || "Unbenannt",
        category,
        extraCategory || null,
        qualificationId,
        tenantId || null,
        departmentId || null,
        isHidden,
        row.id
      )
      .run();
    return row.id;
  }

  const existing = await db
    .prepare(
      "SELECT id FROM employees WHERE personal_number=? AND name=? AND category=? AND IFNULL(extra_category,'')=? " +
        "AND IFNULL(tenant_id,0)=IFNULL(?,0) AND IFNULL(department_id,0)=IFNULL(?,0)"
    )
    .bind(
      personalNumber,
      name || extraCategory || "Unbenannt",
      category,
      extraCategory || "",
      tenantId || null,
      departmentId || null
    )
    .first();

  if (existing && existing.id) {
    await db
      .prepare(
        "UPDATE employees SET qualification_id=?, tenant_id=?, department_id=?, is_hidden=?, updated_at=datetime('now') WHERE id=?"
      )
      .bind(qualificationId, tenantId || null, departmentId || null, isHidden, existing.id)
      .run();
    return existing.id;
  }

  const insert = await db
    .prepare(
      "INSERT INTO employees (personal_number, name, category, extra_category, qualification_id, tenant_id, department_id, is_hidden) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      personalNumber,
      name || extraCategory || "Unbenannt",
      category,
      extraCategory || null,
      qualificationId,
      tenantId || null,
      departmentId || null,
      isHidden
    )
    .run();

  return insert.meta.last_row_id;
}

async function saveOptionalQualifications(db, employeeId, list) {
  await db.prepare("DELETE FROM employee_qualifications WHERE employee_id=?").bind(employeeId).run();
  const ids = Array.isArray(list) ? list : [];
  for (const qualificationId of ids) {
    const parsed = Number(qualificationId);
    if (!Number.isFinite(parsed)) continue;
    await db
      .prepare("INSERT INTO employee_qualifications (employee_id, qualification_id) VALUES (?, ?)")
      .bind(employeeId, parsed)
      .run();
  }
}

async function handlePostStellenplan(request, env) {
  try {
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return badRequest("Invalid payload.");
  }

  const year = toInt(payload.year, new Date().getFullYear());
  if (!Number.isFinite(year)) {
    return badRequest("Invalid year.");
  }

  const employees = Array.isArray(payload.employees) ? payload.employees : [];
  const extras = Array.isArray(payload.extras) ? payload.extras : [];
  const planTargets = payload.planTargets || null;

  const db = env.DB;
  const tenantContext = await resolveTenantContext(db, request, payload.tenantId);
  if (tenantContext.error) {
    return unauthorized();
  }
  const tenantId = tenantContext.tenant ? tenantContext.tenant.id : null;
  const deptContext = await resolveDepartment(db, request, payload.departmentId, tenantId);
  const departmentId = deptContext.department ? deptContext.department.id : null;
  if (!tenantId || !departmentId) {
    return badRequest("tenant_id and department_id are required.");
  }
  const scopeKey = buildScopeKey(tenantId, departmentId);

  const upsertFlag = async (employeeId, year, month, code, value, tenantId, departmentId) => {
    await db
      .prepare(
        "INSERT INTO employee_month_flags (employee_id, year, month, code, value, tenant_id, department_id) VALUES (?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(employee_id, year, month) DO UPDATE SET code=excluded.code, value=excluded.value, tenant_id=excluded.tenant_id, department_id=excluded.department_id, updated_at=datetime('now')"
      )
      .bind(employeeId, year, month, code, value, tenantId || null, departmentId || null)
      .run();
  };
  const clearFlag = async (employeeId, year, month) => {
    await db
      .prepare("DELETE FROM employee_month_flags WHERE employee_id=? AND year=? AND month=?")
      .bind(employeeId, year, month)
      .run();
  };

  const normalizeFlagCode = (value) => String(value || "").trim().toUpperCase();
  const isFlagCode = (code) => code === "MS" || code === "EZ" || code === "KOL";

  // Upsert employees + month values
  for (const row of employees) {
    const employeeId = await resolveEmployeeId(db, row, CATEGORY_MAIN, tenantId, departmentId);
    await saveOptionalQualifications(db, employeeId, row.optionalQualifications);
    const months = Array.isArray(row.months) ? row.months : buildMonthArray(0);
    const absences = Array.isArray(row.absences) ? row.absences : [];
    for (const month of MONTHS) {
      const absenceCode = normalizeFlagCode(absences[month - 1]);
      const value = normalizeNumber(months[month - 1] ?? 0);
      await db
        .prepare(
          "INSERT INTO employee_month_values (employee_id, year, month, value, tenant_id, department_id) VALUES (?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(employee_id, year, month) DO UPDATE SET value=excluded.value, tenant_id=excluded.tenant_id, department_id=excluded.department_id, updated_at=datetime('now')"
        )
        .bind(employeeId, year, month, value, tenantId, departmentId)
        .run();
      if (isFlagCode(absenceCode)) {
        await upsertFlag(employeeId, year, month, absenceCode, 1, tenantId, departmentId);
      } else {
        await clearFlag(employeeId, year, month);
      }
    }
  }

  for (const row of extras) {
    const employeeId = await resolveEmployeeId(db, row, CATEGORY_EXTRA, tenantId, departmentId);
    await saveOptionalQualifications(db, employeeId, row.optionalQualifications);
    const months = Array.isArray(row.months) ? row.months : buildMonthArray(0);
    const absences = Array.isArray(row.absences) ? row.absences : [];
    for (const month of MONTHS) {
      const absenceCode = normalizeFlagCode(absences[month - 1]);
      const value = normalizeNumber(months[month - 1] ?? 0);
      await db
        .prepare(
          "INSERT INTO employee_month_values (employee_id, year, month, value, tenant_id, department_id) VALUES (?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(employee_id, year, month) DO UPDATE SET value=excluded.value, tenant_id=excluded.tenant_id, department_id=excluded.department_id, updated_at=datetime('now')"
        )
        .bind(employeeId, year, month, value, tenantId, departmentId)
        .run();
      if (isFlagCode(absenceCode)) {
        await upsertFlag(employeeId, year, month, absenceCode, 1, tenantId, departmentId);
      } else {
        await clearFlag(employeeId, year, month);
      }
    }
  }

  if (planTargets && Array.isArray(planTargets.months)) {
    for (const month of MONTHS) {
      const value = normalizeNumber(planTargets.months[month - 1] ?? 0);
      await db
        .prepare(
          "INSERT INTO wirtschaftsplan_targets (year, month, value, scope, tenant_id, department_id) VALUES (?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(year, month, scope) DO UPDATE SET value=excluded.value, tenant_id=excluded.tenant_id, department_id=excluded.department_id"
        )
        .bind(year, month, value, scopeKey, tenantId || null, departmentId || null)
        .run();
    }
  }

  return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: "Save failed", detail: String(err && err.message ? err.message : err) }, 500);
  }
}

async function handleGetSollwert(request, env) {
  const url = new URL(request.url);
  const year = toInt(url.searchParams.get("year"), new Date().getFullYear());
  if (!Number.isFinite(year)) {
    return badRequest("Invalid year.");
  }
  const db = env.DB;
  const tenantContext = await resolveTenantContext(db, request);
  if (tenantContext.error) {
    return unauthorized();
  }
  const tenantId = tenantContext.tenant ? tenantContext.tenant.id : null;
  const deptContext = await resolveDepartment(db, request, null, tenantId);
  const departmentId = deptContext.department ? deptContext.department.id : null;
  const scopeKey = buildScopeKey(tenantId, departmentId);

  const row = await db
    .prepare("SELECT value, method, inputs_json FROM sollwert_values WHERE year=? AND scope=?")
    .bind(year, scopeKey)
    .first();

  return jsonResponse({
    ok: true,
    year,
    sollwert: {
      value: normalizeNumber(row ? row.value : 0),
      method: row && row.method ? row.method : "arbeitsplatz",
      inputs: row ? parseJsonSafe(row.inputs_json, {}) : {}
    }
  });
}

async function handlePostSollwert(request, env) {
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return badRequest("Invalid payload.");
  }
  const year = toInt(payload.year, new Date().getFullYear());
  if (!Number.isFinite(year)) {
    return badRequest("Invalid year.");
  }
  const value = normalizeNumber(payload.value);
  const method = normalizeText(payload.method) || "arbeitsplatz";
  const inputsJson = JSON.stringify(payload.inputs || {});

  const db = env.DB;
  const tenantContext = await resolveTenantContext(db, request, payload.tenantId);
  if (tenantContext.error) {
    return unauthorized();
  }
  const tenantId = tenantContext.tenant ? tenantContext.tenant.id : null;
  const deptContext = await resolveDepartment(db, request, payload.departmentId, tenantId);
  const departmentId = deptContext.department ? deptContext.department.id : null;
  const scopeKey = buildScopeKey(tenantId, departmentId);

  await db
    .prepare(
      "INSERT INTO sollwert_values (year, value, method, inputs_json, scope, tenant_id, department_id) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(year, scope) DO UPDATE SET value=excluded.value, method=excluded.method, inputs_json=excluded.inputs_json, " +
        "tenant_id=excluded.tenant_id, department_id=excluded.department_id, updated_at=datetime('now')"
    )
    .bind(year, value, method, inputsJson, scopeKey, tenantId, departmentId)
    .run();

  return jsonResponse({ ok: true });
}

async function handleGetSummary(request, env) {
  const url = new URL(request.url);
  const year = toInt(url.searchParams.get("year"), new Date().getFullYear());
  if (!Number.isFinite(year)) {
    return badRequest("Invalid year.");
  }

  const db = env.DB;
  const tenantContext = await resolveTenantContext(db, request);
  if (tenantContext.error) {
    return unauthorized();
  }
  const tenantId = tenantContext.tenant ? tenantContext.tenant.id : null;
  const deptContext = await resolveDepartment(db, request, null, tenantId);
  const departmentId = deptContext.department ? deptContext.department.id : null;
  const scopeKey = buildScopeKey(tenantId, departmentId);

  let mainSql =
    "SELECT month, SUM(value) AS total " +
    "FROM employee_month_values v JOIN employees e ON e.id=v.employee_id " +
    "WHERE v.year=? AND e.category=?";
  const mainParams = [year, CATEGORY_MAIN];
  if (tenantId) {
    mainSql += " AND e.tenant_id=?";
    mainParams.push(tenantId);
  }
  if (departmentId) {
    mainSql += " AND e.department_id=?";
    mainParams.push(departmentId);
  }
  mainSql += " GROUP BY month";
  const mainRows = await db.prepare(mainSql).bind(...mainParams).all();

  let extraSql =
    "SELECT month, SUM(value) AS total " +
    "FROM employee_month_values v JOIN employees e ON e.id=v.employee_id " +
    "WHERE v.year=? AND e.category=?";
  const extraParams = [year, CATEGORY_EXTRA];
  if (tenantId) {
    extraSql += " AND e.tenant_id=?";
    extraParams.push(tenantId);
  }
  if (departmentId) {
    extraSql += " AND e.department_id=?";
    extraParams.push(departmentId);
  }
  extraSql += " GROUP BY month";
  const extraRows = await db.prepare(extraSql).bind(...extraParams).all();

  const planRows = await db
    .prepare(
      "SELECT month, value AS total FROM wirtschaftsplan_targets WHERE year=? AND scope=?"
    )
    .bind(year, scopeKey)
    .all();

  const mainMonths = buildMonthArray(0);
  const extraMonths = buildMonthArray(0);
  const planMonths = buildMonthArray(0);

  for (const row of mainRows.results || []) {
    mainMonths[row.month - 1] = normalizeNumber(row.total);
  }
  for (const row of extraRows.results || []) {
    extraMonths[row.month - 1] = normalizeNumber(row.total);
  }
  for (const row of planRows.results || []) {
    planMonths[row.month - 1] = normalizeNumber(row.total);
  }

  const combinedMonths = mainMonths.map((val, idx) => val + extraMonths[idx]);
  const deviationMonths = combinedMonths.map((val, idx) => val - planMonths[idx]);

  const sum = (arr) => arr.reduce((acc, val) => acc + normalizeNumber(val), 0);
  const avg = (arr) => (arr.length ? sum(arr) / arr.length : 0);

  return jsonResponse({
    ok: true,
    year,
    main: { months: mainMonths, total: sum(mainMonths), average: avg(mainMonths) },
    extras: { months: extraMonths, total: sum(extraMonths), average: avg(extraMonths) },
    combined: { months: combinedMonths, total: sum(combinedMonths), average: avg(combinedMonths) },
    plan: { months: planMonths, total: sum(planMonths), average: avg(planMonths) },
    deviation: { months: deviationMonths, total: sum(deviationMonths), average: avg(deviationMonths) }
  });
}

async function handleGetStellenplanEntries(request, env) {
  const url = new URL(request.url);
  const year = toInt(url.searchParams.get("year"), new Date().getFullYear());
  if (!Number.isFinite(year)) {
    return badRequest("Invalid year.");
  }
  const deptId = toInt(url.searchParams.get("department"), null);
  const db = env.DB;
  const tenantContext = await resolveTenantContext(db, request);
  if (tenantContext.error) {
    return unauthorized();
  }
  const tenantId = tenantContext.tenant ? tenantContext.tenant.id : null;
  if (!tenantId) {
    return badRequest("tenant_id is required.");
  }

  await ensureQualifications(db);
  const departments = await listDepartments(db, tenantId);

  const qualRows = await db.prepare("SELECT id, code, label FROM qualifications WHERE is_active=1").all();
  const qualById = new Map();
  for (const row of qualRows.results || []) {
    qualById.set(row.id, {
      code: row.code || "",
      label: row.label || ""
    });
  }

  const optionalRows = await db.prepare("SELECT employee_id, qualification_id FROM employee_qualifications").all();
  const optionalMap = new Map();
  for (const row of optionalRows.results || []) {
    const list = optionalMap.get(row.employee_id) || [];
    list.push(row.qualification_id);
    optionalMap.set(row.employee_id, list);
  }

  let employeeSql =
    "SELECT e.id, e.personal_number, e.name, e.category, e.extra_category, e.qualification_id, e.department_id, e.is_hidden, " +
    "d.name AS dept_name, d.code AS dept_code " +
    "FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.is_active=1";
  const employeeParams = [];
  if (tenantId) {
    employeeSql += " AND e.tenant_id=?";
    employeeParams.push(tenantId);
  }
  if (Number.isFinite(deptId)) {
    employeeSql += " AND e.department_id=?";
    employeeParams.push(deptId);
  }
  employeeSql += " ORDER BY e.id ASC";
  const employees = await db.prepare(employeeSql).bind(...employeeParams).all();

  let monthSql = "SELECT employee_id, month, value FROM employee_month_values WHERE year=?";
  const monthParams = [year];
  if (tenantId) {
    monthSql += " AND tenant_id=?";
    monthParams.push(tenantId);
  }
  if (Number.isFinite(deptId)) {
    monthSql += " AND department_id=?";
    monthParams.push(deptId);
  }
  const monthValues = await db.prepare(monthSql).bind(...monthParams).all();

  const valueMap = new Map();
  for (const row of monthValues.results || []) {
    if (!valueMap.has(row.employee_id)) {
      valueMap.set(row.employee_id, buildMonthArray(0));
    }
    const months = valueMap.get(row.employee_id);
    const index = Math.max(1, Math.min(MONTH_COUNT, Number(row.month))) - 1;
    months[index] = normalizeNumber(row.value);
  }

  const entries = [];
  for (const row of employees.results || []) {
    const months = valueMap.get(row.id) || buildMonthArray(0);
    const qualIds = new Set(optionalMap.get(row.id) || []);
    if (row.qualification_id) {
      qualIds.add(row.qualification_id);
    }
    const qualLabels = Array.from(qualIds)
      .map((id) => qualById.get(id))
      .filter(Boolean)
      .map((qual) => qual.label || qual.code)
      .filter(Boolean);
    const deptLabel = normalizeText(row.dept_name || row.dept_code || row.extra_category || "Station");
    entries.push({
      dept: deptLabel,
      dept_id: row.department_id || null,
      year,
      personal_number: normalizeText(row.personal_number),
      name: normalizeText(row.name),
      category: row.category,
      extra_category: row.extra_category,
      qual: qualLabels.join(", "),
      include: row.is_hidden ? false : true,
      months,
      values: months
    });
  }

  let planSql = "SELECT department_id, month, value FROM wirtschaftsplan_targets WHERE year=?";
  const planParams = [year];
  if (tenantId) {
    planSql += " AND tenant_id=?";
    planParams.push(tenantId);
  }
  if (Number.isFinite(deptId)) {
    planSql += " AND department_id=?";
    planParams.push(deptId);
  }
  const planRows = await db.prepare(planSql).bind(...planParams).all();
  const planMonthsByDept = new Map();
  for (const row of planRows.results || []) {
    const deptKey = row.department_id || null;
    if (!planMonthsByDept.has(deptKey)) {
      planMonthsByDept.set(deptKey, buildMonthArray(0));
    }
    const months = planMonthsByDept.get(deptKey);
    const index = Math.max(1, Math.min(MONTH_COUNT, Number(row.month))) - 1;
    months[index] = normalizeNumber(row.value);
  }

  const planByDept = {};
  const planLabels = new Map((departments || []).map((d) => [d.id, d.name || d.code || String(d.id)]));
  (departments || []).forEach((dept) => {
    const months = planMonthsByDept.get(dept.id) || buildMonthArray(0);
    const total = months.reduce((acc, val) => acc + normalizeNumber(val), 0);
    const avg = total / MONTH_COUNT;
    const label = planLabels.get(dept.id);
    if (label) {
      planByDept[label] = avg;
    }
  });

  const planTotal = Object.values(planByDept).reduce((acc, val) => acc + normalizeNumber(val), 0);

  const yearSet = new Set();
  const yearRows = await db
    .prepare("SELECT DISTINCT year FROM employee_month_values WHERE tenant_id=?")
    .bind(tenantId)
    .all();
  for (const row of yearRows.results || []) {
    if (Number.isFinite(row.year)) {
      yearSet.add(row.year);
    }
  }
  const planYearRows = await db
    .prepare("SELECT DISTINCT year FROM wirtschaftsplan_targets WHERE tenant_id=?")
    .bind(tenantId)
    .all();
  for (const row of planYearRows.results || []) {
    if (Number.isFinite(row.year)) {
      yearSet.add(row.year);
    }
  }
  const years = Array.from(yearSet).sort((a, b) => b - a);
  if (!years.length) {
    years.push(year);
  }

  return jsonResponse({
    ok: true,
    year,
    tenant: tenantContext.tenant,
    departments,
    entries,
    plan_by_dept: planByDept,
    plan_total: planTotal,
    years
  });
}

async function resolveInsightsMonth(db, year, monthParam) {
  if (Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12) {
    return monthParam;
  }
  const latestActual = await db
    .prepare("SELECT MAX(month) AS month FROM staffing_actuals WHERE year=?")
    .bind(year)
    .first();
  if (latestActual && Number.isFinite(latestActual.month)) {
    return latestActual.month;
  }
  const latestPlan = await db
    .prepare("SELECT MAX(month) AS month FROM station_capacity WHERE year=?")
    .bind(year)
    .first();
  if (latestPlan && Number.isFinite(latestPlan.month)) {
    return latestPlan.month;
  }
  return 1;
}

async function handleGetInsights(request, env) {
  const url = new URL(request.url);
  const year = toInt(url.searchParams.get("year"), new Date().getFullYear());
  if (!Number.isFinite(year)) {
    return badRequest("Invalid year.");
  }
  const monthParam = toInt(url.searchParams.get("month"), null);
  const deptId = toInt(url.searchParams.get("department"), null);
  const db = env.DB;
  const tenantContext = await resolveTenantContext(db, request);
  if (tenantContext.error) {
    return unauthorized();
  }
  const tenantId = tenantContext.tenant ? tenantContext.tenant.id : null;
  const scopeKey = buildScopeKey(tenantId, deptId);
  const month = await resolveInsightsMonth(db, year, monthParam);

    const stationRows = await db
      .prepare(
        "SELECT s.id, s.name, s.code, s.type, " +
          "COALESCE(cap.vk_soll, 0) AS vk_soll, " +
          "COALESCE(act.vk_ist, 0) AS vk_ist, " +
          "COALESCE(pp.status, 'OK') AS ppug_status, " +
          "COALESCE(pp.ratio_actual, 0) AS ratio_actual, " +
          "COALESCE(pp.ratio_target, 0) AS ratio_target " +
          "FROM stations s " +
          "LEFT JOIN station_capacity cap ON cap.station_id=s.id AND cap.year=? AND cap.month=? " +
          "LEFT JOIN staffing_actuals act ON act.station_id=s.id AND act.year=? AND act.month=? " +
          "LEFT JOIN ppug_status pp ON pp.station_id=s.id AND pp.year=? AND pp.month=? " +
          "WHERE s.is_active=1 " +
          (tenantId ? "AND s.tenant_id=? " : "") +
          "ORDER BY s.name ASC"
      )
    .bind(
      year,
      month,
      year,
      month,
      year,
      month,
      ...(tenantId ? [tenantId] : [])
    )
    .all();
  const stationRowsList = stationRows.results || [];
  const hasSollData = stationRowsList.some((row) => normalizeNumber(row.vk_soll) > 0);
  const hasIstData = stationRowsList.some((row) => normalizeNumber(row.vk_ist) > 0);
  const hasStationData = hasSollData || hasIstData;

  const qualRows = await db.prepare("SELECT id, code, label FROM qualifications WHERE is_active=1").all();
  const qualMap = new Map();
  for (const row of qualRows.results || []) {
    qualMap.set(row.id, {
      code: row.code || "",
      label: row.label || "",
      key: normalizeText(row.code || row.label || "").toLowerCase().replace(/[^a-z0-9]/g, "")
    });
  }

  const mixRows = await db
    .prepare(
      "SELECT station_id, qualification_id, SUM(vk_value) AS total " +
        "FROM station_qualification_mix WHERE year=? AND month=? " +
        (tenantId ? "AND tenant_id=? " : "") +
        "GROUP BY station_id, qualification_id"
    )
    .bind(...[year, month, ...(tenantId ? [tenantId] : [])])
    .all();

  const mixMap = new Map();
  const mixTotals = new Map();
  for (const row of mixRows.results || []) {
    const existing = mixMap.get(row.station_id);
    const total = normalizeNumber(row.total);
    if (!existing || total > existing.total) {
      mixMap.set(row.station_id, { qualification_id: row.qualification_id, total });
    }
    if (!mixTotals.has(row.station_id)) {
      mixTotals.set(row.station_id, new Map());
    }
    const stationMap = mixTotals.get(row.station_id);
    stationMap.set(row.qualification_id, (stationMap.get(row.qualification_id) || 0) + total);
  }

  const matchAny = (tokens, patterns) => patterns.some((pattern) => tokens.some((token) => token === pattern || token.includes(pattern)));
  const mandatoryDefs = [
    { code: "PFK", label: "Pflegefachkraft", patterns: ["reqpfk", "pflegefachkraft", "pfk"] },
    { code: "PFA", label: "Pflegefachassistenz", patterns: ["reqpfa", "pflegefachassistenz", "pfa"] },
    { code: "UK", label: "Ungelernte Kraft", patterns: ["requk", "ungelerntekraft", "ungelernte", "uk"] },
    { code: "MFA", label: "MFA", patterns: ["reqmfa", "mfa"] }
  ];
  const mandatoryTotals = new Map(mandatoryDefs.map((item) => [item.code, { ...item, soll: 0, ist: 0 }]));

  const deptRows = tenantId
    ? await db.prepare("SELECT id, name, code FROM departments WHERE tenant_id=? AND is_active=1").bind(tenantId).all()
    : { results: [] };
  const normalizeKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const deptNameMap = new Map();
  for (const row of deptRows.results || []) {
    const keyName = normalizeKey(row.name);
    const keyCode = normalizeKey(row.code);
    if (keyName) deptNameMap.set(keyName, row.id);
    if (keyCode) deptNameMap.set(keyCode, row.id);
  }

  let empTotalsRows = null;
  const empTotalsByDept = new Map();
  let empTotalsSum = 0;
  {
    let empSql =
      "SELECT e.department_id AS dept_id, " +
      "COALESCE(d.name, d.code, e.extra_category, 'Station') AS dept_label, " +
      "SUM(v.value) AS total " +
      "FROM employee_month_values v JOIN employees e ON e.id=v.employee_id " +
      "LEFT JOIN departments d ON d.id=e.department_id " +
      "WHERE v.year=? AND v.month=? AND e.category='main'";
    const empParams = [year, month];
    if (tenantId) {
      empSql += " AND e.tenant_id=?";
      empParams.push(tenantId);
    }
    if (Number.isFinite(deptId)) {
      empSql += " AND e.department_id=?";
      empParams.push(deptId);
    }
    empSql += " GROUP BY e.department_id, dept_label ORDER BY dept_label";
    empTotalsRows = await db.prepare(empSql).bind(...empParams).all();
    for (const row of empTotalsRows.results || []) {
      const key = normalizeKey(row.dept_label || "");
      const total = normalizeNumber(row.total);
      if (key) {
        empTotalsByDept.set(key, total);
      }
      empTotalsSum += total;
    }
  }

  const absenceRows = await db
    .prepare(
      "SELECT department_id, code, SUM(value) AS total " +
        "FROM employee_month_flags WHERE year=? AND month=? " +
        (tenantId ? "AND tenant_id=? " : "") +
        "GROUP BY department_id, code"
    )
    .bind(...[year, month, ...(tenantId ? [tenantId] : [])])
    .all();

  const absenceByDept = new Map();
  for (const row of absenceRows.results || []) {
    const deptId = Number.isFinite(row.department_id) ? row.department_id : null;
    const bucket = deptId || null;
    if (!absenceByDept.has(bucket)) {
      absenceByDept.set(bucket, { ms: 0, ez: 0, kol: 0 });
    }
    const agg = absenceByDept.get(bucket);
    const code = String(row.code || "").toUpperCase();
    if (code === "MS") agg.ms += normalizeNumber(row.total);
    if (code === "EZ") agg.ez += normalizeNumber(row.total);
    if (code === "KOL") agg.kol += normalizeNumber(row.total);
  }

    const useEmpTotals = empTotalsSum > 0;
    let stations = useEmpTotals ? [] : (hasStationData ? stationRowsList : []).map((row) => {
      const vkSoll = normalizeNumber(row.vk_soll);
      let vkIst = normalizeNumber(row.vk_ist);
      const stationKey = normalizeKey(row.name || row.code || "");
      const empIst = empTotalsByDept.get(stationKey);
      if (vkIst === 0 && empIst) {
        vkIst = empIst;
      }
      const occupancy = vkSoll ? (vkIst / vkSoll) * 100 : 0;
      const mix = mixMap.get(row.id);
      const mixInfo = mix ? qualMap.get(mix.qualification_id) : null;
      const mixLabel = mixInfo ? (mixInfo.label || mixInfo.code || "Qualifikation") : "Keine Angabe";
      const stationQuals = mixTotals.get(row.id) || new Map();
      let mandatorySum = 0;
      for (const [qualId, total] of stationQuals.entries()) {
        const info = qualMap.get(qualId) || { code: "", label: "", key: "" };
        const tokens = [
          (info.code || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
          (info.label || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
          info.key || ""
        ].filter(Boolean);
        const mandatory = mandatoryDefs.find((def) => matchAny(tokens, def.patterns));
        if (mandatory) {
          mandatorySum += total;
          const agg = mandatoryTotals.get(mandatory.code);
          if (agg) {
            agg.soll += total;
            agg.ist += total;
          }
        }
      }
      const qualCoverage = vkSoll ? (mandatorySum / vkSoll) * 100 : 0;
      const fulfillment = vkSoll ? (vkIst / vkSoll) * 100 : 0;
      const deptId = deptNameMap.get(stationKey) || null;
      const abs = absenceByDept.get(deptId) || { ms: 0, ez: 0, kol: 0 };
      return {
        station: normalizeText(row.name || row.code || "Station"),
        beds_planned: vkSoll,
        beds_occupied: vkIst,
        occupancy_pct: occupancy,
        qual_mix_label: normalizeText(mixLabel),
        variance_hours: vkIst - vkSoll,
        soll_vza: vkSoll,
        ist_vza: vkIst,
        fulfillment_pct: fulfillment,
        qual_coverage_pct: qualCoverage,
        mutterschutz_vza: abs.ms,
        elternzeit_vza: abs.ez,
        kol_vza: abs.kol
      };
    });

    if (useEmpTotals) {
      stations = (deptRows.results || []).map((row) => {
        const stationKey = normalizeKey(row.name || row.code || "");
        const vkIst = empTotalsByDept.get(stationKey) || 0;
        const abs = absenceByDept.get(row.id) || { ms: 0, ez: 0, kol: 0 };
        return {
          station: normalizeText(row.name || row.code || "Station"),
          beds_planned: 0,
          beds_occupied: vkIst,
          occupancy_pct: 0,
          qual_mix_label: "Keine Angabe",
          variance_hours: vkIst,
          soll_vza: 0,
          ist_vza: vkIst,
          fulfillment_pct: 0,
          qual_coverage_pct: 0,
          mutterschutz_vza: abs.ms,
          elternzeit_vza: abs.ez,
          kol_vza: abs.kol
        };
      });
    }

    // Fallback: wenn keine stations-Daten vorhanden sind, aggregiere direkt aus dem Stellenplan
    if (!stations.length) {
      for (const row of (empTotalsRows?.results || [])) {
        const label = normalizeText(row.dept_label || "Station");
        const vkIst = normalizeNumber(row.total);
        stations.push({
          station: label,
          beds_planned: 0,
          beds_occupied: vkIst,
          occupancy_pct: 0,
          qual_mix_label: "Keine Angabe",
          variance_hours: vkIst
        });
      }
    }
    if (Number.isFinite(deptId)) {
      const deptRow = (deptRows.results || []).find((row) => row.id === deptId) || null;
      const deptKey = deptRow ? normalizeKey(deptRow.name || deptRow.code || "") : "";
      if (deptKey) {
        stations = stations.filter((row) => normalizeKey(row.station) === deptKey);
      }
    }

    let actualTotals;
    if (hasIstData) {
      actualTotals = await db
        .prepare(
          "SELECT month, SUM(vk_ist) AS total FROM staffing_actuals WHERE year=? " +
            (tenantId ? "AND tenant_id=? " : "") +
            "GROUP BY month"
        )
        .bind(...[year, ...(tenantId ? [tenantId] : [])])
        .all();
    }
    if (!actualTotals || !(actualTotals.results || []).length) {
      let empTotalSql =
        "SELECT v.month AS month, SUM(v.value) AS total " +
        "FROM employee_month_values v JOIN employees e ON e.id=v.employee_id " +
        "WHERE v.year=? AND e.category='main'";
      const empTotalParams = [year];
      if (tenantId) {
        empTotalSql += " AND e.tenant_id=?";
        empTotalParams.push(tenantId);
      }
      if (deptId) {
        empTotalSql += " AND e.department_id=?";
        empTotalParams.push(deptId);
      }
      empTotalSql += " GROUP BY v.month";
      actualTotals = await db.prepare(empTotalSql).bind(...empTotalParams).all();
    }

  let planTotals = null;
  if (hasSollData) {
    planTotals = await db
      .prepare(
        "SELECT month, SUM(vk_soll) AS total FROM station_capacity WHERE year=? " +
          (tenantId ? "AND tenant_id=? " : "") +
          "GROUP BY month"
      )
      .bind(...[year, ...(tenantId ? [tenantId] : [])])
      .all();
  }
  if (!planTotals || !(planTotals.results || []).length) {
    let planSql =
      "SELECT month, SUM(value) AS total FROM wirtschaftsplan_targets WHERE year=? AND scope='total'";
    const planParams = [year];
    if (tenantId) {
      planSql += " AND tenant_id=?";
      planParams.push(tenantId);
    }
    if (deptId) {
      planSql += " AND department_id=?";
      planParams.push(deptId);
    }
    planSql += " GROUP BY month";
    planTotals = await db.prepare(planSql).bind(...planParams).all();
  }

  const wpTotals = await db
    .prepare("SELECT month, value FROM wirtschaftsplan_targets WHERE year=? AND scope=?")
    .bind(year, scopeKey)
    .all();
  const wpMap = new Map((wpTotals.results || []).map((row) => [row.month, normalizeNumber(row.value)]));

  const sollwertRow = await db
    .prepare("SELECT value FROM sollwert_values WHERE year=? AND scope=?")
    .bind(year, scopeKey)
    .first();
  const sollwertValue = normalizeNumber(sollwertRow ? sollwertRow.value : 0);

  if (useEmpTotals || !hasStationData) {
    let qualSql =
      "SELECT e.qualification_id AS qualification_id, SUM(v.value) AS total " +
      "FROM employee_month_values v JOIN employees e ON e.id=v.employee_id " +
      "WHERE v.year=? AND v.month=? AND e.category='main'";
    const qualParams = [year, month];
    if (tenantId) {
      qualSql += " AND e.tenant_id=?";
      qualParams.push(tenantId);
    }
    if (Number.isFinite(deptId)) {
      qualSql += " AND e.department_id=?";
      qualParams.push(deptId);
    }
    qualSql += " GROUP BY e.qualification_id";
    const qualTotals = await db.prepare(qualSql).bind(...qualParams).all();
    for (const row of qualTotals.results || []) {
      const info = qualMap.get(row.qualification_id) || { code: "", label: "", key: "" };
      const tokens = [
        (info.code || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
        (info.label || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
        info.key || ""
      ].filter(Boolean);
      const mandatory = mandatoryDefs.find((def) => matchAny(tokens, def.patterns));
      if (mandatory) {
        const agg = mandatoryTotals.get(mandatory.code);
        if (agg) {
          const total = normalizeNumber(row.total);
          agg.soll += total;
          agg.ist += total;
        }
      }
    }
  }

  const mandatoryQuals = Array.from(mandatoryTotals.values()).map((item) => {
    const totalSoll = item.soll;
    const coverage = totalSoll ? (item.ist / totalSoll) * 100 : 0;
    return {
      code: item.code,
      label: item.label,
      soll_vza: item.soll,
      ist_vza: item.ist,
      coverage_pct: coverage
    };
  });

  const trendMap = new Map();
  for (const row of planTotals.results || []) {
    trendMap.set(row.month, {
      month: row.month,
      vk_soll: normalizeNumber(row.total),
      vk_ist: 0
    });
  }
  for (const row of actualTotals.results || []) {
    const entry = trendMap.get(row.month) || { month: row.month, vk_soll: 0, vk_ist: 0 };
    entry.vk_ist = normalizeNumber(row.total);
    trendMap.set(row.month, entry);
  }

  for (let m = 1; m <= 12; m += 1) {
    if (!trendMap.has(m)) {
      trendMap.set(m, { month: m, vk_soll: 0, vk_ist: 0 });
    }
  }
  const trend = Array.from(trendMap.values())
    .sort((a, b) => a.month - b.month)
    .map((entry) => ({
      date: buildDateString(year, entry.month),
      occupancy_pct: entry.vk_soll ? (entry.vk_ist / entry.vk_soll) * 100 : 0,
      staffed_hours: entry.vk_ist,
      required_hours: entry.vk_soll,
      wirtschaftsplan_hours: wpMap.get(entry.month) || 0,
      sollwert_hours: sollwertValue
    }));

  const response = {
    ok: true,
    year,
    month,
    tenant: tenantContext.tenant,
    meta: {
      updated_at: new Date().toISOString(),
      range_label: `${year}-${pad2(month)}`,
      source: "d1"
    },
    stations,
    mandatory_quals: mandatoryQuals,
    trend,
    shift_mix: [
      { label: "Frueh", value: 0 },
      { label: "Spaet", value: 0 },
      { label: "Nacht", value: 0 }
    ]
  };

  return jsonResponse(response);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    if (url.pathname === "/api/stellenplan" && request.method === "GET") {
      return withCors(await handleGetStellenplan(request, env));
    }

    if (url.pathname === "/api/stellenplan" && request.method === "POST") {
      return withCors(await handlePostStellenplan(request, env), request);
    }

    if (url.pathname === "/api/stellenplan/sollwert" && request.method === "GET") {
      return withCors(await handleGetSollwert(request, env), request);
    }

    if (url.pathname === "/api/stellenplan/sollwert" && request.method === "POST") {
      return withCors(await handlePostSollwert(request, env), request);
    }

    if (url.pathname === "/api/stellenplan/summary" && request.method === "GET") {
      return withCors(await handleGetSummary(request, env));
    }

    if (url.pathname === "/api/stellenplan/entries" && request.method === "GET") {
      return withCors(await handleGetStellenplanEntries(request, env), request);
    }

    if (url.pathname === "/api/insights" && request.method === "GET") {
      return withCors(await handleGetInsights(request, env), request);
    }

    if (url.pathname === "/api/tenants" && request.method === "GET") {
      const db = env.DB;
      const tenantContext = await resolveTenantContext(db, request);
      if (tenantContext.error) {
        return unauthorized();
      }
      return jsonResponse({
        ok: true,
        role: tenantContext.role,
        tenants: tenantContext.tenants,
        tenant: tenantContext.tenant
      });
    }

    if (url.pathname === "/api/departments" && request.method === "GET") {
      const db = env.DB;
      const tenantContext = await resolveTenantContext(db, request);
      if (tenantContext.error) {
        return unauthorized();
      }
      const tenantId =
        toInt(url.searchParams.get("tenant"), null) ||
        (tenantContext.tenant ? tenantContext.tenant.id : null);
      const departments = await listDepartments(db, tenantId);
      return jsonResponse({
        ok: true,
        tenant_id: tenantId,
        departments
      });
    }

    return jsonResponse({ ok: false, error: "Not found." }, 404);
  }
};
