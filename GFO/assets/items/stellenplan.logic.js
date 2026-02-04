// Clinicon Stellenplan Logic (UI + Data)
// Reines Vanilla JS, Daten via fetch().

const MONTH_LABELS = ["Jan", "Feb", "Mrz", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONTH_COUNT = MONTH_LABELS.length;
const DEFAULT_EXTRAS = ["Schueler:in", "Azubi", "MFA/ATA"];
const MIN_YEAR = 2026;
const EXTENSION_TARGET_YEAR = 2030;
const API_BASE = "";

const numberFormat = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const state = {
  year: Math.max(new Date().getFullYear(), MIN_YEAR),
  qualifications: [],
  employees: [],
  extras: [],
  planTargets: { months: Array(MONTH_COUNT).fill(0) },
  sollwert: { value: 0, method: "arbeitsplatz", inputs: {} },
  dienstart: "DA03",
  station: "Station 1",
  tenantId: null,
  departmentId: null
};

const uiState = {
  hiddenMonths: new Set(),
  lastFocusedMonth: null
};

const selectors = {
  yearInput: "#yearInput",
  saveButton: "#btnSavePlan",
  addEmployeeButton: "#btnAddEmployee",
  addExtraButton: "#btnAddExtra",
  saveStatus: "#saveStatus",
  dienstartSelect: "#dienstartSelect",
  stationSelect: "#stationSelect",
  employeeBody: "#planBody",
  extraBody: "#extraBody",
  sumRow: "#sumRow",
  sumExtraRow: "#sumExtraRow",
  sumMainInExtraRow: "#sumMainInExtraRow",
  sumCombinedRow: "#sumCombinedRow",
  planRow: "#planRow",
  deviationRow: "#planDeviationRow",
  sollwertRow: "#sollwertRow",
  istSollRow: "#istSollRow",
  sollwertModal: "#sollwertModal",
  sollwertButton: "#openSollwertModal",
  sollHoursInput: "#sollHoursInput",
  sollAnnualInput: "#sollAnnualInput",
  sollDirectInput: "#sollDirectInput",
  sollResultValue: "#sollResultValue",
  sollSaveButton: "#saveSollwert"
};

function $(selector) {
  return document.querySelector(selector);
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

const ABSENCE_CODES = ["MS", "EZ", "KOL"];
function normalizeAbsenceCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return ABSENCE_CODES.includes(code) ? code : "";
}

function formatNumber(value) {
  return numberFormat.format(normalizeNumber(value));
}

function buildEmptyMonths() {
  return Array(MONTH_COUNT).fill(0);
}

function buildUid(prefix = "row") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function getYear() {
  const input = $(selectors.yearInput);
  if (!input) return state.year;
  const parsed = Number.parseInt(input.value, 10);
  if (!Number.isFinite(parsed)) return state.year;
  return Math.max(parsed, MIN_YEAR);
}

function setStatus(message, isError = false) {
  const el = $(selectors.saveStatus);
  if (!el) return;
  el.textContent = message;
  el.style.display = message ? "inline-flex" : "none";
  el.classList.toggle("error", isError);
}

function getApiBase() {
  return (document.body && document.body.dataset && document.body.dataset.apiBase) ? document.body.dataset.apiBase : API_BASE;
}


function getContextIds() {
  const body = document.body || {};
  const tenantId =
    body.dataset?.tenantId ||
    sessionStorage.getItem("tenant_id") ||
    "";
  const departmentId =
    body.dataset?.departmentId ||
    sessionStorage.getItem("department_id") ||
    "";
  const tenant = Number.parseInt(tenantId, 10);
  const department = Number.parseInt(departmentId, 10);
  return {
    tenantId: Number.isFinite(tenant) ? tenant : null,
    departmentId: Number.isFinite(department) ? department : null
  };
}

async function fetchJson(url, options = {}) {
  const headers = { "content-type": "application/json" };
  const response = await fetch(`${getApiBase()}${url}`, {
    headers,
    credentials: "same-origin",
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

async function loadPlan(year) {
  const context = getContextIds();
  state.tenantId = context.tenantId;
  state.departmentId = context.departmentId;
  const params = new URLSearchParams({ year: String(year) });
  if (context.tenantId) params.set("tenant", String(context.tenantId));
  if (context.departmentId) params.set("department", String(context.departmentId));
  const data = await fetchJson(`/api/stellenplan?${params.toString()}`);
  state.year = data.year || year;
  if (data.tenant && data.tenant.id) {
    state.tenantId = data.tenant.id;
    sessionStorage.setItem("tenant_id", String(data.tenant.id));
  }
  if (data.department && data.department.id) {
    state.departmentId = data.department.id;
    sessionStorage.setItem("department_id", String(data.department.id));
  }
  state.qualifications = Array.isArray(data.qualifications) ? data.qualifications : [];
  state.employees = (Array.isArray(data.employees) ? data.employees : []).map(normalizeEmployeeRow);
  state.extras = (Array.isArray(data.extras) ? data.extras : []).map(normalizeExtraRow);
  state.planTargets = data.planTargets || { months: buildEmptyMonths() };
  if (Object.prototype.hasOwnProperty.call(data, "sollwert")) {
    state.sollwert = data.sollwert || { value: 0, method: "arbeitsplatz", inputs: {} };
  }

  if (!state.employees.length) {
    state.employees = [createBlankEmployee()];
  }
  if (!state.extras.length) {
    state.extras = DEFAULT_EXTRAS.map((label) => createBlankExtra(label));
  }
}

async function loadSollwert(year) {
  const context = getContextIds();
  const params = new URLSearchParams({ year: String(year) });
  if (context.tenantId) params.set("tenant", String(context.tenantId));
  if (context.departmentId) params.set("department", String(context.departmentId));
  try {
    const data = await fetchJson(`/api/stellenplan/sollwert?${params.toString()}`);
    if (data && data.ok) {
      state.sollwert = data.sollwert || { value: 0, method: "arbeitsplatz", inputs: {} };
    }
  } catch (err) {
    // ignore
  }
}

async function savePlan() {
  const payload = {
    year: state.year,
    employees: serializeRows(state.employees, "main"),
    extras: serializeRows(state.extras, "extra"),
    planTargets: state.planTargets,
    tenantId: state.tenantId,
    departmentId: state.departmentId
  };
  await fetchJson("/api/stellenplan", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

function normalizeEmployeeRow(row) {
  const optional = Array.isArray(row.optionalQualifications) ? row.optionalQualifications : [];
  const primary = row.qualificationId ? [row.qualificationId] : [];
  return {
    id: Number.isInteger(row.id) ? row.id : null,
    uid: buildUid("emp"),
    personalNumber: row.personalNumber || "",
    name: row.name || "",
    qualificationId: row.qualificationId || "",
    optionalQualifications: Array.from(new Set([...optional, ...primary])).filter(Boolean),
    months: Array.isArray(row.months) ? row.months.map(normalizeNumber) : buildEmptyMonths(),
    absences: Array.isArray(row.absences) ? row.absences.map(normalizeAbsenceCode) : buildEmptyMonths().map(() => ""),
    isHidden: Boolean(row.isHidden)
  };
}

function normalizeExtraRow(row) {
  const optional = Array.isArray(row.optionalQualifications) ? row.optionalQualifications : [];
  const primary = row.qualificationId ? [row.qualificationId] : [];
  return {
    id: Number.isInteger(row.id) ? row.id : null,
    uid: buildUid("extra"),
    personalNumber: row.personalNumber || "",
    category: row.category || "",
    qualificationId: row.qualificationId || "",
    optionalQualifications: Array.from(new Set([...optional, ...primary])).filter(Boolean),
    months: Array.isArray(row.months) ? row.months.map(normalizeNumber) : buildEmptyMonths(),
    absences: Array.isArray(row.absences) ? row.absences.map(normalizeAbsenceCode) : buildEmptyMonths().map(() => ""),
    isHidden: Boolean(row.isHidden)
  };
}

function serializeRows(rows, type) {
  return rows.map((row) => ({
    id: Number.isInteger(row.id) ? row.id : undefined,
    personalNumber: row.personalNumber,
    name: type === "main" ? row.name : undefined,
    category: type === "extra" ? row.category : undefined,
    qualificationId: row.optionalQualifications && row.optionalQualifications.length ? row.optionalQualifications[0] : null,
    optionalQualifications: Array.isArray(row.optionalQualifications) ? row.optionalQualifications : [],
    months: row.months.map((value) => normalizeNumber(value)),
    absences: Array.isArray(row.absences) ? row.absences.map(normalizeAbsenceCode) : buildEmptyMonths().map(() => ""),
    isHidden: Boolean(row.isHidden)
  }));
}

function createBlankEmployee() {
  return {
    id: null,
    uid: buildUid("emp"),
    personalNumber: "",
    name: "",
    qualificationId: "",
    optionalQualifications: [],
    months: buildEmptyMonths(),
    absences: buildEmptyMonths().map(() => ""),
    isHidden: false
  };
}

function createBlankExtra(label = "") {
  return {
    id: null,
    uid: buildUid("extra"),
    personalNumber: "",
    category: label,
    qualificationId: "",
    optionalQualifications: [],
    months: buildEmptyMonths(),
    absences: buildEmptyMonths().map(() => ""),
    isHidden: false
  };
}

function rowAverage(months) {
  const sum = months.reduce((acc, val) => acc + normalizeNumber(val), 0);
  return sum / MONTH_COUNT;
}

function buildHeaderRow(extraLabel) {
  return `
    <tr>
      <th class="col-personal">Personalnummer</th>
      <th class="col-name">${extraLabel}</th>
      ${MONTH_LABELS.map((label, index) => `<th data-month-index="${index}">${label}</th>`).join("")}
      <th>&Oslash; Monat</th>
      <th class="qual-col">Qualifikation</th>
      <th class="action-col">Aktionen</th>
    </tr>
  `;
}

function isRequiredQualification(qual) {
  const code = String(qual.code || "");
  const label = String(qual.label || "").toLowerCase();
  if (code.startsWith("REQ_")) return true;
  return label === "pflegefachkraft" || label === "pflegefachassistenz" || label === "ungelernte kraft";
}

function isNoFrameQualification(qual) {
  const label = String(qual.label || "").toLowerCase().trim();
  const key = label.replace(/[^a-z0-9]+/g, "");
  return (
    key === "mfa" ||
    key === "pflegefachassistenz" ||
    key === "pflegefachkraft" ||
    key === "ungelerntkraft" ||
    key === "ungelerntekraft"
  );
}

function renderQualificationOptions(selectedId) {
  const qualifications = Array.isArray(state.qualifications) ? state.qualifications : [];
  const optionsByGroup = {
    Pflichtqualifikationen: [],
    Fachpflege: [],
    Funktionen: [],
    Leitung: [],
    Akut: [],
    Weitere: []
  };

  const normalizeKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const groupByLabel = {
    pflegefachkraft: "Pflichtqualifikationen",
    pflegefachassistenz: "Pflichtqualifikationen",
    ungelerntkraft: "Pflichtqualifikationen",
    fachpflegekraftfuerintensivpflegeundanaesthesie: "Fachpflege",
    fachpflegekraftfueropdienstperioperativepflege: "Fachpflege",
    fachpflegekraftfueronkologie: "Fachpflege",
    fachpflegekraftfuerpsychiatriepsychiatrischepflege: "Fachpflege",
    fachpflegekraftfuerpaediatrischeintensivpflegepaediatrie: "Fachpflege",
    fachpflegekraftfuerendoskopie: "Fachpflege",
    praxisanleitungpraxisanleiterin: "Funktionen",
    wundexpertinicwwundmanagerin: "Funktionen",
    painnursealgesiologischefachassistenz: "Funktionen",
    hygienebeauftragterinderpflegehygienefachkraft: "Funktionen",
    palliativcarefachkraft: "Funktionen",
    atemtherapeutinatmungstherapie: "Funktionen",
    stomaundkontinenzberaterin: "Funktionen",
    diabetesberatung: "Funktionen",
    casemanagemententlassmanagement: "Funktionen",
    notfallpflege: "Funktionen",
    gerontopsychiatrischezusatzqualifikation: "Funktionen",
    stationsleitungleitungeinereinheit: "Leitung",
    pflegedienstleitungpdl: "Leitung",
    pflegemanagementpflegepaedagogik: "Leitung",
    qualitaetsmanagementqmbeauftragterauditorin: "Leitung",
    reanimationsalsblsinstruktorin: "Akut",
    deeskalationaggressionsmanagement: "Akut",
    cirspatientensicherheitsbeauftragter: "Akut",
    transfusionsbeauftragterblutprodukteschulung: "Akut",
    medizinproduktebeauftragtermpgeinweisungen: "Akut",
    sterilgutzsvagrundlagen: "Akut"
  };

  qualifications.forEach((qual) => {
    const code = String(qual.code || "");
    const label = String(qual.label || "");
    let group = "Weitere";

    if (code.startsWith("REQ_")) group = "Pflichtqualifikationen";
    else if (code.startsWith("FACH_")) group = "Fachpflege";
    else if (code.startsWith("FUNC_")) group = "Funktionen";
    else if (code.startsWith("LEAD_")) group = "Leitung";
    else if (code.startsWith("AKUT_")) group = "Akut";
    else {
      const key = normalizeKey(label);
      group = groupByLabel[key] || "Weitere";
    }

    if (!isRequiredQualification(qual)) {
      return;
    }
    const selected = String(qual.id) === String(selectedId) ? " selected" : "";
    optionsByGroup[group].push(`<option value="${qual.id}"${selected}>${label}</option>`);
  });

  const output = ['<option value="">Qualifikation waehlen</option>'];
  Object.entries(optionsByGroup).forEach(([group, list]) => {
    if (!list.length) return;
    output.push(`<optgroup label="${group}">`);
    output.push(list.join(""));
    output.push('</optgroup>');
  });
  return output.join("");
}

function renderOptionalQualificationOptions(selectedIds, rowUid) {
  const qualifications = Array.isArray(state.qualifications) ? state.qualifications : [];
  const selectedSet = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String));
  const optionsByGroup = {
    Pflichtqualifikationen: [],
    Fachpflege: [],
    Funktionen: [],
    Leitung: [],
    Akut: [],
    Weitere: []
  };

  qualifications.forEach((qual) => {
    const code = String(qual.code || "");
    const label = String(qual.label || "");
    let group = "Weitere";
    if (code.startsWith("REQ_")) group = "Pflichtqualifikationen";
    else if (code.startsWith("FACH_")) group = "Fachpflege";
    else if (code.startsWith("FUNC_")) group = "Funktionen";
    else if (code.startsWith("LEAD_")) group = "Leitung";
    else if (code.startsWith("AKUT_")) group = "Akut";
    else if (isRequiredQualification(qual)) group = "Pflichtqualifikationen";
    const checked = selectedSet.has(String(qual.id)) ? " checked" : "";
    const required = isRequiredQualification(qual);
    const noFrame = required && isNoFrameQualification(qual);
    const requiredClass = required ? " required" : "";
    const noFrameClass = noFrame ? " no-frame" : "";
    const inputType = required ? "radio" : "checkbox";
    const nameAttr = required ? ` name="req-${rowUid}" data-qual-required="1"` : "";
    optionsByGroup[group].push(
      `<label class="multi-option${requiredClass}${noFrameClass}"><input type="${inputType}" data-qual-id="${qual.id}"${nameAttr}${checked}>${label}</label>`
    );
  });

  const output = [];
  const groupOrder = ["Pflichtqualifikationen", "Fachpflege", "Funktionen", "Leitung", "Akut", "Weitere"];
  groupOrder.forEach((group) => {
    const list = optionsByGroup[group] || [];
    if (!list.length) return;
    const titleClass = group === "Pflichtqualifikationen" ? " required-title" : "";
    output.push(`<div class="multi-group"><div class="multi-group-title${titleClass}">${group}</div>`);
    output.push(`<div class="multi-group-list">${list.join("")}</div></div>`);
  });
  return output.join("");
}

function renderOptionalTags(selectedIds) {
  const qualifications = Array.isArray(state.qualifications) ? state.qualifications : [];
  const byId = new Map(qualifications.map((q) => [String(q.id), q]));
  const selected = Array.isArray(selectedIds) ? selectedIds.map(String) : [];
  if (!selected.length) return "<span class=\"tag-empty\">Keine Qualifikationen</span>";
  const required = [];
  const optional = [];
  selected.forEach((id) => {
    const qual = byId.get(id);
    if (!qual) return;
    const label = String(qual.label || "");
    if (isRequiredQualification(qual)) required.push(label);
    else optional.push(label);
  });
  const pills = [
    ...required.map((label) => `<span class="tag-pill required">${label}</span>`),
    ...optional.map((label) => `<span class="tag-pill">${label}</span>`)
  ].join("");
  return `<div class="tag-scroll">${pills}</div>`;
}

function renderRows(tbody, rows, type) {
  tbody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.dataset.uid = row.uid;
    if (row.isHidden) tr.classList.add("row-hidden");
    const labelValue = type === "main" ? row.name : row.category;
    tr.innerHTML = `
        <td class="col-personal">
          <input class="cell-input cell-input-key" data-field="personalNumber" value="${escapeHtml(row.personalNumber)}" placeholder="z.B. 1001" />
        </td>
        <td class="col-name">
          <input class="cell-input cell-input-name" data-field="${type === "main" ? "name" : "category"}" value="${escapeHtml(labelValue)}" placeholder="${type === "main" ? "Mitarbeiter:in" : "Kategorie"}" />
          <span class="row-hidden-badge">Ausgeblendet</span>
        </td>
      ${MONTH_LABELS.map(
        (_, index) => `
        <td data-month-cell="${index}">
          <input class="cell-input cell-input-number" data-field="month" data-month="${index}" type="text" inputmode="decimal" value="${formatInputValue(row.months[index], row.absences ? row.absences[index] : "")}" />
        </td>`
      ).join("")}
      <td class="avg-cell" data-avg-for="${row.uid}">${formatNumber(rowAverage(row.months))}</td>
        <td class="qual-cell">
          <div class="qual-wrap">
            <div class="multi-wrap" data-multi-root="${row.uid}">
            <button class="multi-trigger" type="button" data-action="toggle-multi">
              <span class="multi-value">${renderOptionalTags(row.optionalQualifications)}</span>
              <span class="multi-caret" aria-hidden="true">▾</span>
            </button>
            <div class="multi-panel" data-multi-panel>
              <div class="multi-search">
                <input type="text" class="multi-search-input" placeholder="Suche..." data-action="multi-search" />
              </div>
                <div class="multi-options" data-field="optionalQualifications">
                  ${renderOptionalQualificationOptions(row.optionalQualifications, row.uid)}
                </div>
              </div>
            </div>
          </div>
        </td>
      <td class="action-cell">
        <div class="action-grid">
            <button class="action-btn" type="button" data-action="toggle-row" title="Zeile ausblenden / einblenden">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="action-btn" type="button" data-action="delete-row" title="Zeile entfernen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>
          </button>
          <button class="action-btn" type="button" data-action="copy-forward" title="Wert bis Jahresende fortschreiben">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h12"/><path d="m13 6 6 6-6 6"/></svg>
          </button>
          <button class="action-btn" type="button" data-action="extend-forward" title="Fortschreibung bis ${EXTENSION_TARGET_YEAR}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h10"/><path d="m12 7 5 5-5 5"/><path d="m16 7 5 5-5 5"/></svg>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderTableHeaders() {
  const employeeHead = document.getElementById("planHead");
  const extraHead = document.getElementById("extraHead");
  if (employeeHead) employeeHead.innerHTML = buildHeaderRow("Mitarbeiter:in");
  if (extraHead) extraHead.innerHTML = buildHeaderRow("Kategorie");
}

function updateAverages(rows, tableBody) {
  rows.forEach((row) => {
    const avgCell = tableBody.querySelector(`[data-avg-for="${row.uid}"]`);
    if (!avgCell) return;
    avgCell.textContent = formatNumber(rowAverage(row.months));
  });
}

function calculateTotals(rows) {
  const months = buildEmptyMonths();
  rows.forEach((row) => {
    row.months.forEach((value, index) => {
      months[index] += normalizeNumber(value);
    });
  });
  const total = months.reduce((acc, val) => acc + normalizeNumber(val), 0);
  const average = total / MONTH_COUNT;
  return { months, total, average };
}

function renderTotals(rowElement, totals) {
  if (!rowElement) return;
  const monthCells = rowElement.querySelectorAll("[data-month-total]");
  monthCells.forEach((cell) => {
    const index = Number.parseInt(cell.dataset.monthTotal, 10);
    cell.textContent = formatNumber(totals.months[index] || 0);
  });
  const avgCell = rowElement.querySelector("[data-total-average]");
  if (avgCell) {
    avgCell.textContent = formatNumber(totals.average);
  }
}

function renderPlanRow(rowElement, months) {
  if (!rowElement) return;
  const cells = rowElement.querySelectorAll("[data-plan-month]");
  cells.forEach((cell) => {
    const index = Number.parseInt(cell.dataset.planMonth, 10);
    cell.textContent = formatNumber(months[index] || 0);
  });
  const avgCell = rowElement.querySelector("[data-plan-average]");
  if (avgCell) {
    const total = months.reduce((acc, val) => acc + normalizeNumber(val), 0);
    avgCell.textContent = formatNumber(total / MONTH_COUNT);
  }
}

function renderSollwertRow(rowElement, months) {
  if (!rowElement) return;
  const cells = rowElement.querySelectorAll("[data-soll-month]");
  cells.forEach((cell) => {
    const index = Number.parseInt(cell.dataset.sollMonth, 10);
    cell.textContent = formatNumber(months[index] || 0);
  });
  const avgCell = rowElement.querySelector("[data-soll-average]");
  if (avgCell) {
    const total = months.reduce((acc, val) => acc + normalizeNumber(val), 0);
    avgCell.textContent = formatNumber(total / MONTH_COUNT);
  }
}

function renderIstSollRow(rowElement, months) {
  if (!rowElement) return;
  const cells = rowElement.querySelectorAll("[data-ist-soll-month]");
  cells.forEach((cell) => {
    const index = Number.parseInt(cell.dataset.istSollMonth, 10);
    const value = months[index] || 0;
    cell.textContent = formatNumber(value);
    applyValueTone(cell, value);
  });
  const avgCell = rowElement.querySelector("[data-ist-soll-average]");
  if (avgCell) {
    const total = months.reduce((acc, val) => acc + normalizeNumber(val), 0);
    const avgValue = total / MONTH_COUNT;
    avgCell.textContent = formatNumber(avgValue);
    applyValueTone(avgCell, avgValue);
  }
}

function renderDeviationRow(rowElement, deviationMonths) {
  if (!rowElement) return;
  const cells = rowElement.querySelectorAll("[data-deviation-month]");
  cells.forEach((cell) => {
    const index = Number.parseInt(cell.dataset.deviationMonth, 10);
    const value = deviationMonths[index] || 0;
    cell.textContent = formatNumber(value);
    applyValueTone(cell, value);
  });
  const avgCell = rowElement.querySelector("[data-deviation-average]");
  if (avgCell) {
    const total = deviationMonths.reduce((acc, val) => acc + normalizeNumber(val), 0);
    const avgValue = total / MONTH_COUNT;
    avgCell.textContent = formatNumber(avgValue);
    applyValueTone(avgCell, avgValue);
  }
}

function applyValueTone(cell, value) {
  if (!cell) return;
  cell.classList.remove("value-positive", "value-negative");
  if (value > 0) {
    cell.classList.add("value-positive");
  } else if (value < 0) {
    cell.classList.add("value-negative");
  }
}

function applyToneBySelector(rowElement, cellSelector, avgSelector) {
  if (!rowElement) return;
  rowElement.querySelectorAll(cellSelector).forEach((cell) => {
    const value = normalizeNumber(cell.textContent);
    applyValueTone(cell, value);
  });
  if (avgSelector) {
    const avgCell = rowElement.querySelector(avgSelector);
    if (avgCell) {
      const value = normalizeNumber(avgCell.textContent);
      applyValueTone(avgCell, value);
    }
  }
}

function refreshTotals() {
  const mainTotals = calculateTotals(state.employees);
  const extraTotals = calculateTotals(state.extras);
  const combinedMonths = mainTotals.months.map((val, idx) => val + extraTotals.months[idx]);
  const combinedTotals = {
    months: combinedMonths,
    total: combinedMonths.reduce((acc, val) => acc + normalizeNumber(val), 0),
    average: combinedMonths.reduce((acc, val) => acc + normalizeNumber(val), 0) / MONTH_COUNT
  };
  const planMonths = Array.isArray(state.planTargets.months) ? state.planTargets.months : buildEmptyMonths();
  const deviationMonths = combinedTotals.months.map((val, idx) => val - normalizeNumber(planMonths[idx] || 0));

  renderTotals($(selectors.sumRow), mainTotals);
  renderTotals($(selectors.sumExtraRow), extraTotals);
  renderTotals($(selectors.sumMainInExtraRow), mainTotals);
  renderTotals($(selectors.sumCombinedRow), combinedTotals);
  renderPlanRow($(selectors.planRow), planMonths);
  const sollValue = normalizeNumber(state.sollwert && state.sollwert.value);
  const sollMonths = buildEmptyMonths().map(() => sollValue);
  const istSollMonths = combinedTotals.months.map((val, idx) => val - normalizeNumber(sollMonths[idx] || 0));
  renderSollwertRow($(selectors.sollwertRow), sollMonths);
  renderIstSollRow($(selectors.istSollRow), istSollMonths);
  renderDeviationRow($(selectors.deviationRow), deviationMonths);
}

function formatInputValue(value, absenceCode = "") {
  const code = normalizeAbsenceCode(absenceCode);
  if (code) return code;
  const numeric = normalizeNumber(value);
  if (!Number.isFinite(numeric)) return "0,00";
  return numberFormat.format(numeric);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function bindTableEvents(tbody, rows, type) {
  tbody.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.field !== "month") return;
    const index = Number.parseInt(target.dataset.month, 10);
    setFocusedMonth(index);
  });

  tbody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.field !== "month") return;
    const index = Number.parseInt(target.dataset.month, 10);
    setFocusedMonth(index);
  });

  const table = tbody.closest("table");
  if (table) {
    table.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const th = target.closest("[data-month-index]");
      if (!th) return;
      const index = Number.parseInt(th.getAttribute("data-month-index"), 10);
      setFocusedMonth(index);
    });
  }

  tbody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const actionButton = target.closest("button[data-action]");
    if (!actionButton) return;
    const tr = actionButton.closest("tr");
    if (!tr) return;
    const row = rows.find((item) => item.uid === tr.dataset.uid);
    if (!row) return;
    const action = actionButton.dataset.action;
    const focusedMonth = getFocusedMonthIndex();

    if (action === "toggle-row") {
      row.isHidden = !row.isHidden;
      renderAll();
      return;
    }

    if (action === "copy-forward") {
      if (focusedMonth === null) {
        setStatus("Bitte Monat waehlen", true);
        return;
      }
      copyRowForward(row, focusedMonth);
      renderAll();
      setStatus("Wert fortgeschrieben");
      setTimeout(() => setStatus(""), 2000);
      return;
    }

    if (action === "extend-forward") {
      if (focusedMonth === null) {
        setStatus("Bitte Monat waehlen", true);
        return;
      }
      extendRowForward(row, focusedMonth);
      renderAll();
      setStatus(`Fortschreibung bis ${EXTENSION_TARGET_YEAR} markiert`);
      setTimeout(() => setStatus(""), 2000);
      return;
    }

    if (action === "delete-row") {
      const index = rows.findIndex((item) => item.uid === row.uid);
      if (index >= 0) {
        rows.splice(index, 1);
      }
      if (!rows.length) {
        rows.push(type === "main" ? createBlankEmployee() : createBlankExtra());
      }
      renderAll();
    }
  });

  tbody.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const tr = target.closest("tr");
    if (!tr) return;
    const row = rows.find((item) => item.uid === tr.dataset.uid);
    if (!row) return;

    const field = target.dataset.field;
    if (field === "personalNumber") {
      row.personalNumber = target.value;
    } else if (field === "name" || field === "category") {
      row[field] = target.value;
    } else if (field === "month") {
      const index = Number.parseInt(target.dataset.month, 10);
      if (Number.isFinite(index)) {
        const code = normalizeAbsenceCode(target.value);
        if (code) {
          row.absences[index] = code;
          row.months[index] = 0;
          target.value = code;
        } else {
          row.absences[index] = "";
          row.months[index] = normalizeNumber(target.value);
        }
      }
    }
    updateAverages(rows, tbody);
    refreshTotals();
  });

  tbody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const multiButton = target.closest("button[data-action=\"toggle-multi\"]");
    if (!multiButton) return;
    const wrapper = multiButton.closest("[data-multi-root]");
    if (!wrapper) return;
    wrapper.classList.toggle("open");
  });

  tbody.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.action !== "multi-search") return;
    const wrapper = target.closest("[data-multi-root]");
    if (!wrapper) return;
    const query = target.value.toLowerCase();
    wrapper.querySelectorAll(".multi-option").forEach((label) => {
      const text = label.textContent.toLowerCase();
      label.style.display = text.includes(query) ? "flex" : "none";
    });
  });

  tbody.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const tr = target.closest("tr");
    if (!tr) return;
    const row = rows.find((item) => item.uid === tr.dataset.uid);
    if (!row) return;
    if (target instanceof HTMLInputElement && target.matches("[data-qual-id]")) {
      const input = target;
      const id = String(input.dataset.qualId || "");
      const current = new Set((row.optionalQualifications || []).map(String));
      const isRequired = input.dataset.qualRequired === "1";
      if (isRequired && input.checked) {
        const requiredIds = new Set(
          (state.qualifications || [])
            .filter((qual) => isRequiredQualification(qual))
            .map((qual) => String(qual.id))
        );
        requiredIds.forEach((reqId) => current.delete(reqId));
        current.add(id);
      } else if (!isRequired) {
        if (input.checked) current.add(id);
        else current.delete(id);
      }
      row.optionalQualifications = Array.from(current);
      row.qualificationId = row.optionalQualifications.length ? row.optionalQualifications[0] : "";
      renderAll();
    }
  });
}

function renderAll() {
  renderTableHeaders();
  const employeeBody = $(selectors.employeeBody);
  const extraBody = $(selectors.extraBody);
  if (!employeeBody || !extraBody) return;

  renderRows(employeeBody, state.employees, "main");
  renderRows(extraBody, state.extras, "extra");
  updateAverages(state.employees, employeeBody);
  updateAverages(state.extras, extraBody);
  refreshTotals();
  applyMonthVisibility();
}

// UI helpers: column visibility + row actions.
function applyMonthVisibility() {
  const hiddenMonths = uiState.hiddenMonths;
  const tables = document.querySelectorAll(".table-wrap table");
  tables.forEach((table) => {
    table
      .querySelectorAll("[data-month-index],[data-month-cell],[data-month-total],[data-plan-month],[data-deviation-month]")
      .forEach((cell) => cell.classList.remove("is-hidden"));
    hiddenMonths.forEach((index) => {
      table
        .querySelectorAll(
          `[data-month-index="${index}"],[data-month-cell="${index}"],[data-month-total="${index}"],[data-plan-month="${index}"],[data-deviation-month="${index}"]`
        )
        .forEach((cell) => cell.classList.add("is-hidden"));
    });
  });
}

function toggleMonthVisibility(index) {
  if (!Number.isFinite(index)) return;
  if (uiState.hiddenMonths.has(index)) {
    uiState.hiddenMonths.delete(index);
  } else {
    uiState.hiddenMonths.add(index);
  }
  applyMonthVisibility();
}

function setFocusedMonth(index) {
  if (Number.isFinite(index)) {
    uiState.lastFocusedMonth = index;
  }
}

function copyRowForward(row, startIndex) {
  const code = normalizeAbsenceCode(row.absences && row.absences[startIndex]);
  if (code) {
    row.absences = row.absences.map((current, idx) => (idx >= startIndex ? code : normalizeAbsenceCode(current)));
    row.months = row.months.map((current, idx) => (idx >= startIndex ? 0 : normalizeNumber(current)));
    return;
  }
  const value = normalizeNumber(row.months[startIndex]);
  row.absences = row.absences.map((current, idx) => (idx >= startIndex ? "" : normalizeAbsenceCode(current)));
  row.months = row.months.map((current, idx) => (idx >= startIndex ? value : normalizeNumber(current)));
}

function extendRowForward(row, startIndex) {
  copyRowForward(row, startIndex);
  row.extensionTargetYear = EXTENSION_TARGET_YEAR;
}

function getFocusedMonthIndex() {
  return Number.isFinite(uiState.lastFocusedMonth) ? uiState.lastFocusedMonth : null;
}

async function bindControls() {
  const yearInput = $(selectors.yearInput);
  if (yearInput) {
    yearInput.value = state.year;
    yearInput.addEventListener("change", async () => {
      state.year = getYear();
      await reload();
    });
  }

  const addEmployeeButton = $(selectors.addEmployeeButton);
  if (addEmployeeButton) {
    addEmployeeButton.addEventListener("click", () => {
      state.employees.push(createBlankEmployee());
      renderAll();
    });
  }

  const addExtraButton = $(selectors.addExtraButton);
  if (addExtraButton) {
    addExtraButton.addEventListener("click", () => {
      state.extras.push(createBlankExtra());
      renderAll();
    });
  }

  const dienstartSelect = $(selectors.dienstartSelect);
  if (dienstartSelect) {
    dienstartSelect.value = state.dienstart || "DA03";
    dienstartSelect.addEventListener("change", () => {
      state.dienstart = dienstartSelect.value || "DA03";
    });
  }

    const stationSelect = $(selectors.stationSelect);
    if (stationSelect) {
      let cachedDepartments = [];
      const fetchDepartments = async () => {
        const ctx = getContextIds();
        if (!ctx.tenantId) return [];
        const deptData = await fetchJson(`/api/departments?tenant=${ctx.tenantId}`);
        return Array.isArray(deptData?.departments) ? deptData.departments : [];
      };

      const waitForTenant = async () => {
        for (let i = 0; i < 20; i += 1) {
          const ctx = getContextIds();
          if (ctx.tenantId) return ctx;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return getContextIds();
      };

      try {
        await waitForTenant();
        cachedDepartments = await fetchDepartments();
      if (cachedDepartments.length) {
        stationSelect.innerHTML = cachedDepartments
          .map((d) => `<option value="${d.id}">${d.name || d.code}</option>`)
          .join("");
        const ctx = getContextIds();
        const selected = ctx.departmentId || cachedDepartments[0].id;
        stationSelect.value = String(selected);
        state.departmentId = selected;
        if (!ctx.departmentId) {
          sessionStorage.setItem("department_id", String(selected));
          document.body.dataset.departmentId = String(selected);
          try {
            await reload();
          } catch (err) {
            // ignore reload errors here
          }
        }
      }
      } catch (err) {
        // ignore
      }

      stationSelect.addEventListener("change", async () => {
        const rawValue = stationSelect.value;
        const selectedId = Number.parseInt(rawValue, 10);
        if (Number.isFinite(selectedId)) {
          sessionStorage.setItem("department_id", String(selectedId));
          window.location.reload();
          return;
        }
        // fallback: map by name if select still contains labels
        if (!cachedDepartments.length) {
          try {
            cachedDepartments = await fetchDepartments();
          } catch (err) {
            cachedDepartments = [];
          }
        }
        const match = cachedDepartments.find((d) => String(d.name || d.code) === rawValue);
        if (match && Number.isFinite(Number(match.id))) {
          sessionStorage.setItem("department_id", String(match.id));
          window.location.reload();
        }
      });
    }

  const saveButton = $(selectors.saveButton);
  if (saveButton) {
    saveButton.addEventListener("click", async () => {
      try {
        setStatus("Speichern ...");
        await savePlan();
        setStatus("Gespeichert");
        setTimeout(() => setStatus(""), 2500);
      } catch (error) {
        setStatus("Fehler beim Speichern", true);
      }
    });
  }

  const sollwertModal = $(selectors.sollwertModal);
  const sollwertButton = $(selectors.sollwertButton);
  const sollHoursInput = $(selectors.sollHoursInput);
  const sollAnnualInput = $(selectors.sollAnnualInput);
  const sollDirectInput = $(selectors.sollDirectInput);
  const sollResultValue = $(selectors.sollResultValue);
  const sollSaveButton = $(selectors.sollSaveButton);
  if (sollwertModal && sollwertButton) {
    const closeModal = () => {
      sollwertModal.classList.add("is-hidden");
      document.body.style.overflow = "";
    };
    const openModal = () => {
      if (sollHoursInput) {
        sollHoursInput.value = state.sollwert?.inputs?.hours ?? "";
      }
      if (sollAnnualInput) {
        sollAnnualInput.value = state.sollwert?.inputs?.annual ?? "";
      }
      if (sollDirectInput) {
        sollDirectInput.value = state.sollwert?.inputs?.direct ?? "";
      }
      if (sollResultValue) {
        sollResultValue.textContent = formatNumber(state.sollwert?.value ?? 0);
      }
      sollwertModal.classList.remove("is-hidden");
      document.body.style.overflow = "hidden";
    };
    const handleCloseTrigger = (event) => {
      const closeTarget = event.target instanceof Element
        ? event.target.closest("[data-modal-close]")
        : null;
      if (closeTarget && !sollwertModal.classList.contains("is-hidden")) {
        event.preventDefault();
        closeModal();
      }
    };

    sollwertButton.addEventListener("click", openModal);
    sollwertModal.querySelectorAll("[data-modal-close]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        closeModal();
      });
    });
    sollwertModal.addEventListener("click", (event) => {
      const closeTarget = event.target instanceof Element
        ? event.target.closest("[data-modal-close]")
        : null;
      if (closeTarget || event.target === sollwertModal) {
        closeModal();
      }
    });
    document.addEventListener("click", handleCloseTrigger, true);
    document.addEventListener("pointerup", handleCloseTrigger, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !sollwertModal.classList.contains("is-hidden")) {
        closeModal();
      }
    });
    window.__closeSollwertModal = closeModal;
    window.__openSollwertModal = openModal;

    const computeSollwert = () => {
      const hours = normalizeNumber(sollHoursInput ? sollHoursInput.value : 0);
      const annual = normalizeNumber(sollAnnualInput ? sollAnnualInput.value : 0);
      const direct = normalizeNumber(sollDirectInput ? sollDirectInput.value : 0);
      const computed = annual > 0 ? hours / annual : 0;
      const value = direct > 0 ? direct : computed;
      if (sollResultValue) sollResultValue.textContent = formatNumber(value);
      return { value, inputs: { hours, annual, direct } };
    };

    [sollHoursInput, sollAnnualInput, sollDirectInput].forEach((input) => {
      if (!input) return;
      input.addEventListener("input", computeSollwert);
    });

    if (sollSaveButton) {
      sollSaveButton.addEventListener("click", async () => {
        const result = computeSollwert();
        state.sollwert = { value: result.value, method: "arbeitsplatz", inputs: result.inputs };
        renderAll();
        try {
          const payload = {
            year: state.year,
            value: result.value,
            method: "arbeitsplatz",
            inputs: result.inputs,
            tenantId: state.tenantId,
            departmentId: state.departmentId
          };
          await fetchJson("/api/stellenplan/sollwert", {
            method: "POST",
            body: JSON.stringify(payload)
          });
          closeModal();
        } catch (err) {
          setStatus("Fehler beim Speichern", true);
        }
      });
    }
  }
}

async function reload() {
  try {
    await loadPlan(state.year);
    await loadSollwert(state.year);
    renderAll();
  } catch (error) {
    setStatus("Fehler beim Laden", true);
  }
}

async function init() {
  const waitForContext = async () => {
    for (let i = 0; i < 20; i += 1) {
      const hasTenant = Boolean(sessionStorage.getItem("tenant_id"));
      const hasEmail = Boolean((sessionStorage.getItem("user_email") || "").trim());
      if (hasTenant && hasEmail) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
  await waitForContext();
  await reload();
  const employeeBody = $(selectors.employeeBody);
  const extraBody = $(selectors.extraBody);
  if (employeeBody) bindTableEvents(employeeBody, state.employees, "main");
  if (extraBody) bindTableEvents(extraBody, state.extras, "extra");
  await bindControls();
}

if (document.getElementById("stellenplan-root")) {
  init();
}
