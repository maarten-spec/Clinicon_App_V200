// Clinicon Stellenplan Logic (UI + Data)
// Reines Vanilla JS, Daten via fetch().

const MONTH_LABELS = ["Jan", "Feb", "Mrz", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONTH_COUNT = MONTH_LABELS.length;
const DEFAULT_EXTRAS = ["Schueler:in", "Azubi", "MFA/ATA"];
const EXTENSION_TARGET_YEAR = 2030;
const API_BASE = "";

const numberFormat = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const state = {
  year: new Date().getFullYear(),
  qualifications: [],
  employees: [],
  extras: [],
  planTargets: { months: Array(MONTH_COUNT).fill(0) }
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
  employeeBody: "#planBody",
  extraBody: "#extraBody",
  sumRow: "#sumRow",
  sumExtraRow: "#sumExtraRow",
  sumCombinedRow: "#sumCombinedRow",
  planRow: "#planRow",
  deviationRow: "#planDeviationRow"
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
  return Number.isFinite(parsed) ? parsed : state.year;
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

async function fetchJson(url, options = {}) {
  const response = await fetch(`${getApiBase()}${url}`, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

async function loadPlan(year) {
  const data = await fetchJson(`/api/stellenplan?year=${encodeURIComponent(year)}`);
  state.year = data.year || year;
  state.qualifications = Array.isArray(data.qualifications) ? data.qualifications : [];
  state.employees = (Array.isArray(data.employees) ? data.employees : []).map(normalizeEmployeeRow);
  state.extras = (Array.isArray(data.extras) ? data.extras : []).map(normalizeExtraRow);
  state.planTargets = data.planTargets || { months: buildEmptyMonths() };

  if (!state.employees.length) {
    state.employees = [createBlankEmployee()];
  }
  if (!state.extras.length) {
    state.extras = DEFAULT_EXTRAS.map((label) => createBlankExtra(label));
  }
}

async function savePlan() {
  const payload = {
    year: state.year,
    employees: serializeRows(state.employees, "main"),
    extras: serializeRows(state.extras, "extra"),
    planTargets: state.planTargets
  };
  await fetchJson("/api/stellenplan", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

function normalizeEmployeeRow(row) {
  return {
    id: Number.isInteger(row.id) ? row.id : null,
    uid: buildUid("emp"),
    personalNumber: row.personalNumber || "",
    name: row.name || "",
    qualificationId: row.qualificationId || "",
    months: Array.isArray(row.months) ? row.months.map(normalizeNumber) : buildEmptyMonths()
  };
}

function normalizeExtraRow(row) {
  return {
    id: Number.isInteger(row.id) ? row.id : null,
    uid: buildUid("extra"),
    personalNumber: row.personalNumber || "",
    category: row.category || "",
    qualificationId: row.qualificationId || "",
    months: Array.isArray(row.months) ? row.months.map(normalizeNumber) : buildEmptyMonths()
  };
}

function serializeRows(rows, type) {
  return rows.map((row) => ({
    id: Number.isInteger(row.id) ? row.id : undefined,
    personalNumber: row.personalNumber,
    name: type === "main" ? row.name : undefined,
    category: type === "extra" ? row.category : undefined,
    qualificationId: row.qualificationId || null,
    months: row.months.map((value) => normalizeNumber(value))
  }));
}

function createBlankEmployee() {
  return {
    id: null,
    uid: buildUid("emp"),
    personalNumber: "",
    name: "",
    qualificationId: "",
    months: buildEmptyMonths()
  };
}

function createBlankExtra(label = "") {
  return {
    id: null,
    uid: buildUid("extra"),
    personalNumber: "",
    category: label,
    qualificationId: "",
    months: buildEmptyMonths()
  };
}

function rowAverage(months) {
  const sum = months.reduce((acc, val) => acc + normalizeNumber(val), 0);
  return sum / MONTH_COUNT;
}

function buildHeaderRow(extraLabel) {
  return `
    <tr>
      <th style="min-width:160px;">Personalnummer</th>
      <th style="min-width:220px;">${extraLabel}</th>
      ${MONTH_LABELS.map((label, index) => `<th data-month-index="${index}">${label}</th>`).join("")}
      <th>&Oslash; Monat</th>
      <th style="min-width:170px;">Qualifikation</th>
      <th class="action-col">Aktionen</th>
    </tr>
  `;
}

function renderQualificationOptions(selectedId) {
  const options = [`<option value="">Qualifikation waehlen</option>`];
  state.qualifications.forEach((qual) => {
    const selected = String(qual.id) === String(selectedId) ? " selected" : "";
    options.push(`<option value="${qual.id}"${selected}>${qual.label}</option>`);
  });
  return options.join("");
}

function renderRows(tbody, rows, type) {
  tbody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.dataset.uid = row.uid;
    const labelValue = type === "main" ? row.name : row.category;
    tr.innerHTML = `
      <td>
        <input class="cell-input cell-input-key" data-field="personalNumber" value="${escapeHtml(row.personalNumber)}" placeholder="z.B. 1001" />
      </td>
      <td>
        <input class="cell-input" data-field="${type === "main" ? "name" : "category"}" value="${escapeHtml(labelValue)}" placeholder="${type === "main" ? "Mitarbeiter:in" : "Kategorie"}" />
      </td>
      ${MONTH_LABELS.map(
        (_, index) => `
        <td data-month-cell="${index}">
          <input class="cell-input cell-input-number" data-field="month" data-month="${index}" type="number" step="0.01" value="${formatInputValue(row.months[index])}" />
        </td>`
      ).join("")}
      <td class="avg-cell" data-avg-for="${row.uid}">${formatNumber(rowAverage(row.months))}</td>
      <td>
        <select class="cell-select" data-field="qualificationId">
          ${renderQualificationOptions(row.qualificationId)}
        </select>
      </td>
      <td class="action-cell">
        <div class="action-grid">
          <button class="action-btn" type="button" data-action="toggle-month" title="Spalte ausblenden / einblenden">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="action-btn" type="button" data-action="delete-row" title="Zeile entfernen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>
          </button>
          <button class="action-btn" type="button" data-action="copy-forward" title="Wert bis Jahresende fortschreiben">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h12"/><path d="m13 6 6 6-6 6"/></svg>
          </button>
          <button class="action-btn" type="button" data-action="extend-forward" title="Fortschreibung bis ${EXTENSION_TARGET_YEAR}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18"/><path d="m7 6-4 6 4 6"/><path d="m17 6 4 6-4 6"/></svg>
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

function renderDeviationRow(rowElement, deviationMonths) {
  if (!rowElement) return;
  const cells = rowElement.querySelectorAll("[data-deviation-month]");
  cells.forEach((cell) => {
    const index = Number.parseInt(cell.dataset.deviationMonth, 10);
    cell.textContent = formatNumber(deviationMonths[index] || 0);
  });
  const avgCell = rowElement.querySelector("[data-deviation-average]");
  if (avgCell) {
    const total = deviationMonths.reduce((acc, val) => acc + normalizeNumber(val), 0);
    avgCell.textContent = formatNumber(total / MONTH_COUNT);
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
  renderTotals($(selectors.sumCombinedRow), combinedTotals);
  renderPlanRow($(selectors.planRow), planMonths);
  renderDeviationRow($(selectors.deviationRow), deviationMonths);
}

function formatInputValue(value) {
  const numeric = normalizeNumber(value);
  if (Number.isNaN(numeric)) return "0";
  return String(numeric);
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
    if (Number.isFinite(index)) {
      uiState.lastFocusedMonth = index;
    }
  });

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

    if (action === "toggle-month") {
      if (focusedMonth === null) {
        setStatus("Bitte Monat waehlen", true);
        return;
      }
      setStatus("");
      toggleMonthVisibility(focusedMonth);
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
        row.months[index] = normalizeNumber(target.value);
      }
    }
    updateAverages(rows, tbody);
    refreshTotals();
  });

  tbody.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const tr = target.closest("tr");
    if (!tr) return;
    const row = rows.find((item) => item.uid === tr.dataset.uid);
    if (!row) return;
    row.qualificationId = target.value;
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

function copyRowForward(row, startIndex) {
  const value = normalizeNumber(row.months[startIndex]);
  row.months = row.months.map((current, idx) => (idx >= startIndex ? value : normalizeNumber(current)));
}

function extendRowForward(row, startIndex) {
  copyRowForward(row, startIndex);
  row.extensionTargetYear = EXTENSION_TARGET_YEAR;
}

function getFocusedMonthIndex() {
  return Number.isFinite(uiState.lastFocusedMonth) ? uiState.lastFocusedMonth : null;
}

function bindControls() {
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
}

async function reload() {
  try {
    await loadPlan(state.year);
    renderAll();
  } catch (error) {
    setStatus("Fehler beim Laden", true);
  }
}

async function init() {
  await reload();
  const employeeBody = $(selectors.employeeBody);
  const extraBody = $(selectors.extraBody);
  if (employeeBody) bindTableEvents(employeeBody, state.employees, "main");
  if (extraBody) bindTableEvents(extraBody, state.extras, "extra");
  bindControls();
}

if (document.getElementById("stellenplan-root")) {
  init();
}
