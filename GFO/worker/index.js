/**
 * Clinicon Stellenplan Worker (D1)
 * Routes:
 *   GET  /api/stellenplan?year=YYYY
 *   POST /api/stellenplan
 *   GET  /api/stellenplan/summary?year=YYYY
 */

const MONTH_COUNT = 12;
const MONTHS = Array.from({ length: MONTH_COUNT }, (_, i) => i + 1);
const CATEGORY_MAIN = "main";
const CATEGORY_EXTRA = "extra";
const DEFAULT_SCOPE = "total";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function badRequest(message) {
  return jsonResponse({ ok: false, error: message }, 400);
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

function buildMonthArray(seed = 0) {
  return MONTHS.map(() => seed);
}

function withCors(response) {
  return response;
}

async function handleOptions() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}

async function handleGetStellenplan(request, env) {
  const url = new URL(request.url);
  const year = toInt(url.searchParams.get("year"), new Date().getFullYear());
  if (!Number.isFinite(year)) {
    return badRequest("Invalid year.");
  }

  const db = env.DB;

  const qualifications = await db
    .prepare("SELECT id, code, label FROM qualifications WHERE is_active=1 ORDER BY label ASC")
    .all();

  const employees = await db
    .prepare(
      "SELECT id, personal_number, name, category, extra_category, qualification_id " +
        "FROM employees WHERE is_active=1 ORDER BY id ASC"
    )
    .all();

  const monthValues = await db
    .prepare("SELECT employee_id, month, value FROM employee_month_values WHERE year=?")
    .bind(year)
    .all();

  const planTargets = await db
    .prepare("SELECT month, value, scope FROM wirtschaftsplan_targets WHERE year=? AND scope=?")
    .bind(year, DEFAULT_SCOPE)
    .all();

  const valueMap = new Map();
  for (const row of monthValues.results || []) {
    if (!valueMap.has(row.employee_id)) {
      valueMap.set(row.employee_id, buildMonthArray(0));
    }
    const months = valueMap.get(row.employee_id);
    const index = Math.max(1, Math.min(MONTH_COUNT, Number(row.month))) - 1;
    months[index] = normalizeNumber(row.value);
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
      months
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
    qualifications: qualifications.results || [],
    employees: mainRows,
    extras: extraRows,
    planTargets: {
      scope: DEFAULT_SCOPE,
      months: planMonthValues
    }
  });
}

async function resolveEmployeeId(db, row, category) {
  const personalNumber = normalizeText(row.personalNumber);
  const name = normalizeText(row.name);
  const extraCategory = normalizeText(row.category);
  const qualificationId = row.qualificationId ? Number(row.qualificationId) : null;

  if (Number.isInteger(row.id)) {
    await db
      .prepare(
        "UPDATE employees SET personal_number=?, name=?, category=?, extra_category=?, qualification_id=?, updated_at=datetime('now') WHERE id=?"
      )
      .bind(personalNumber, name || extraCategory || "Unbenannt", category, extraCategory || null, qualificationId, row.id)
      .run();
    return row.id;
  }

  const existing = await db
    .prepare(
      "SELECT id FROM employees WHERE personal_number=? AND name=? AND category=? AND IFNULL(extra_category,'')=?"
    )
    .bind(personalNumber, name || extraCategory || "Unbenannt", category, extraCategory || "")
    .first();

  if (existing && existing.id) {
    await db
      .prepare(
        "UPDATE employees SET qualification_id=?, updated_at=datetime('now') WHERE id=?"
      )
      .bind(qualificationId, existing.id)
      .run();
    return existing.id;
  }

  const insert = await db
    .prepare(
      "INSERT INTO employees (personal_number, name, category, extra_category, qualification_id) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(
      personalNumber,
      name || extraCategory || "Unbenannt",
      category,
      extraCategory || null,
      qualificationId
    )
    .run();

  return insert.meta.last_row_id;
}

async function handlePostStellenplan(request, env) {
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

  // Upsert employees + month values
  for (const row of employees) {
    const employeeId = await resolveEmployeeId(db, row, CATEGORY_MAIN);
    const months = Array.isArray(row.months) ? row.months : buildMonthArray(0);
    for (const month of MONTHS) {
      const value = normalizeNumber(months[month - 1] ?? 0);
      await db
        .prepare(
          "INSERT INTO employee_month_values (employee_id, year, month, value) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT(employee_id, year, month) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
        )
        .bind(employeeId, year, month, value)
        .run();
    }
  }

  for (const row of extras) {
    const employeeId = await resolveEmployeeId(db, row, CATEGORY_EXTRA);
    const months = Array.isArray(row.months) ? row.months : buildMonthArray(0);
    for (const month of MONTHS) {
      const value = normalizeNumber(months[month - 1] ?? 0);
      await db
        .prepare(
          "INSERT INTO employee_month_values (employee_id, year, month, value) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT(employee_id, year, month) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
        )
        .bind(employeeId, year, month, value)
        .run();
    }
  }

  if (planTargets && Array.isArray(planTargets.months)) {
    for (const month of MONTHS) {
      const value = normalizeNumber(planTargets.months[month - 1] ?? 0);
      await db
        .prepare(
          "INSERT INTO wirtschaftsplan_targets (year, month, value, scope) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT(year, month, scope) DO UPDATE SET value=excluded.value"
        )
        .bind(year, month, value, DEFAULT_SCOPE)
        .run();
    }
  }

  return jsonResponse({ ok: true });
}

async function handleGetSummary(request, env) {
  const url = new URL(request.url);
  const year = toInt(url.searchParams.get("year"), new Date().getFullYear());
  if (!Number.isFinite(year)) {
    return badRequest("Invalid year.");
  }

  const db = env.DB;

  const mainRows = await db
    .prepare(
      "SELECT month, SUM(value) AS total " +
        "FROM employee_month_values v JOIN employees e ON e.id=v.employee_id " +
        "WHERE v.year=? AND e.category=? GROUP BY month"
    )
    .bind(year, CATEGORY_MAIN)
    .all();

  const extraRows = await db
    .prepare(
      "SELECT month, SUM(value) AS total " +
        "FROM employee_month_values v JOIN employees e ON e.id=v.employee_id " +
        "WHERE v.year=? AND e.category=? GROUP BY month"
    )
    .bind(year, CATEGORY_EXTRA)
    .all();

  const planRows = await db
    .prepare(
      "SELECT month, value AS total FROM wirtschaftsplan_targets WHERE year=? AND scope=?"
    )
    .bind(year, DEFAULT_SCOPE)
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return handleOptions();
    }

    if (url.pathname === "/api/stellenplan" && request.method === "GET") {
      return withCors(await handleGetStellenplan(request, env));
    }

    if (url.pathname === "/api/stellenplan" && request.method === "POST") {
      return withCors(await handlePostStellenplan(request, env));
    }

    if (url.pathname === "/api/stellenplan/summary" && request.method === "GET") {
      return withCors(await handleGetSummary(request, env));
    }

    return jsonResponse({ ok: false, error: "Not found." }, 404);
  }
};
