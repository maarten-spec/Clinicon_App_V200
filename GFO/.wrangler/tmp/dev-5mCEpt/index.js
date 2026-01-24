var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/index.js
var MONTH_COUNT = 12;
var MONTHS = Array.from({ length: MONTH_COUNT }, (_, i) => i + 1);
var CATEGORY_MAIN = "main";
var CATEGORY_EXTRA = "extra";
var DEFAULT_SCOPE = "total";
var JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}
__name(jsonResponse, "jsonResponse");
function badRequest(message) {
  return jsonResponse({ ok: false, error: message }, 400);
}
__name(badRequest, "badRequest");
function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
__name(toInt, "toInt");
function normalizeText(value) {
  if (value === null || value === void 0) return "";
  return String(value).trim();
}
__name(normalizeText, "normalizeText");
function normalizeNumber(value) {
  if (value === null || value === void 0 || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}
__name(normalizeNumber, "normalizeNumber");
function buildMonthArray(seed = 0) {
  return MONTHS.map(() => seed);
}
__name(buildMonthArray, "buildMonthArray");
function withCors(response) {
  return response;
}
__name(withCors, "withCors");
async function handleOptions() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}
__name(handleOptions, "handleOptions");
async function handleGetStellenplan(request, env) {
  const url = new URL(request.url);
  const year = toInt(url.searchParams.get("year"), (/* @__PURE__ */ new Date()).getFullYear());
  if (!Number.isFinite(year)) {
    return badRequest("Invalid year.");
  }
  const db = env.DB;
  const qualifications = await db.prepare("SELECT id, code, label FROM qualifications WHERE is_active=1 ORDER BY label ASC").all();
  const employees = await db.prepare(
    "SELECT id, personal_number, name, category, extra_category, qualification_id FROM employees WHERE is_active=1 ORDER BY id ASC"
  ).all();
  const monthValues = await db.prepare("SELECT employee_id, month, value FROM employee_month_values WHERE year=?").bind(year).all();
  const planTargets = await db.prepare("SELECT month, value, scope FROM wirtschaftsplan_targets WHERE year=? AND scope=?").bind(year, DEFAULT_SCOPE).all();
  const valueMap = /* @__PURE__ */ new Map();
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
__name(handleGetStellenplan, "handleGetStellenplan");
async function resolveEmployeeId(db, row, category) {
  const personalNumber = normalizeText(row.personalNumber);
  const name = normalizeText(row.name);
  const extraCategory = normalizeText(row.category);
  const qualificationId = row.qualificationId ? Number(row.qualificationId) : null;
  if (Number.isInteger(row.id)) {
    await db.prepare(
      "UPDATE employees SET personal_number=?, name=?, category=?, extra_category=?, qualification_id=?, updated_at=datetime('now') WHERE id=?"
    ).bind(personalNumber, name || extraCategory || "Unbenannt", category, extraCategory || null, qualificationId, row.id).run();
    return row.id;
  }
  const existing = await db.prepare(
    "SELECT id FROM employees WHERE personal_number=? AND name=? AND category=? AND IFNULL(extra_category,'')=?"
  ).bind(personalNumber, name || extraCategory || "Unbenannt", category, extraCategory || "").first();
  if (existing && existing.id) {
    await db.prepare(
      "UPDATE employees SET qualification_id=?, updated_at=datetime('now') WHERE id=?"
    ).bind(qualificationId, existing.id).run();
    return existing.id;
  }
  const insert = await db.prepare(
    "INSERT INTO employees (personal_number, name, category, extra_category, qualification_id) VALUES (?, ?, ?, ?, ?)"
  ).bind(
    personalNumber,
    name || extraCategory || "Unbenannt",
    category,
    extraCategory || null,
    qualificationId
  ).run();
  return insert.meta.last_row_id;
}
__name(resolveEmployeeId, "resolveEmployeeId");
async function handlePostStellenplan(request, env) {
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return badRequest("Invalid payload.");
  }
  const year = toInt(payload.year, (/* @__PURE__ */ new Date()).getFullYear());
  if (!Number.isFinite(year)) {
    return badRequest("Invalid year.");
  }
  const employees = Array.isArray(payload.employees) ? payload.employees : [];
  const extras = Array.isArray(payload.extras) ? payload.extras : [];
  const planTargets = payload.planTargets || null;
  const db = env.DB;
  for (const row of employees) {
    const employeeId = await resolveEmployeeId(db, row, CATEGORY_MAIN);
    const months = Array.isArray(row.months) ? row.months : buildMonthArray(0);
    for (const month of MONTHS) {
      const value = normalizeNumber(months[month - 1] ?? 0);
      await db.prepare(
        "INSERT INTO employee_month_values (employee_id, year, month, value) VALUES (?, ?, ?, ?) ON CONFLICT(employee_id, year, month) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
      ).bind(employeeId, year, month, value).run();
    }
  }
  for (const row of extras) {
    const employeeId = await resolveEmployeeId(db, row, CATEGORY_EXTRA);
    const months = Array.isArray(row.months) ? row.months : buildMonthArray(0);
    for (const month of MONTHS) {
      const value = normalizeNumber(months[month - 1] ?? 0);
      await db.prepare(
        "INSERT INTO employee_month_values (employee_id, year, month, value) VALUES (?, ?, ?, ?) ON CONFLICT(employee_id, year, month) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
      ).bind(employeeId, year, month, value).run();
    }
  }
  if (planTargets && Array.isArray(planTargets.months)) {
    for (const month of MONTHS) {
      const value = normalizeNumber(planTargets.months[month - 1] ?? 0);
      await db.prepare(
        "INSERT INTO wirtschaftsplan_targets (year, month, value, scope) VALUES (?, ?, ?, ?) ON CONFLICT(year, month, scope) DO UPDATE SET value=excluded.value"
      ).bind(year, month, value, DEFAULT_SCOPE).run();
    }
  }
  return jsonResponse({ ok: true });
}
__name(handlePostStellenplan, "handlePostStellenplan");
async function handleGetSummary(request, env) {
  const url = new URL(request.url);
  const year = toInt(url.searchParams.get("year"), (/* @__PURE__ */ new Date()).getFullYear());
  if (!Number.isFinite(year)) {
    return badRequest("Invalid year.");
  }
  const db = env.DB;
  const mainRows = await db.prepare(
    "SELECT month, SUM(value) AS total FROM employee_month_values v JOIN employees e ON e.id=v.employee_id WHERE v.year=? AND e.category=? GROUP BY month"
  ).bind(year, CATEGORY_MAIN).all();
  const extraRows = await db.prepare(
    "SELECT month, SUM(value) AS total FROM employee_month_values v JOIN employees e ON e.id=v.employee_id WHERE v.year=? AND e.category=? GROUP BY month"
  ).bind(year, CATEGORY_EXTRA).all();
  const planRows = await db.prepare(
    "SELECT month, value AS total FROM wirtschaftsplan_targets WHERE year=? AND scope=?"
  ).bind(year, DEFAULT_SCOPE).all();
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
  const sum = /* @__PURE__ */ __name((arr) => arr.reduce((acc, val) => acc + normalizeNumber(val), 0), "sum");
  const avg = /* @__PURE__ */ __name((arr) => arr.length ? sum(arr) / arr.length : 0, "avg");
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
__name(handleGetSummary, "handleGetSummary");
var worker_default = {
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

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// .wrangler/tmp/bundle-RZ33OJ/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-RZ33OJ/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
