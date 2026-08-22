"use strict";

import {
  clearSetDraft,
  draftStorageKey,
  enqueueSetOperation,
  getSetQueue,
  loadSetDraft,
  removeSetOperation,
  restTimerState,
  saveSetDraft,
  synchronizationState,
} from "./active-workout-state.js";
import {
  buildWorkoutGrid,
  groupSessionExercises,
  parseRepsPerSet,
  resolveSetDisplayState,
  workoutProgress,
} from "./workout-utils.js";

const API_KEY_STORAGE_KEY = "workout_logger_api_key";
const API_BASE = "/api/v1";

function getStoredApiKey() {
  return localStorage.getItem(API_KEY_STORAGE_KEY) || "";
}

function setStoredApiKey(value) {
  localStorage.setItem(API_KEY_STORAGE_KEY, value);
}

function clearStoredApiKey() {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("X-API-Key", getStoredApiKey());
  if (options.body) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const errorBody = await response.json();
      detail = errorBody.detail || detail;
    } catch {
      // ignore body parse failures
    }
    throw new Error(detail);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

function setText(element, text) {
  element.textContent = text;
}

function clearChildren(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

// ---- View switching ----

const views = document.querySelectorAll(".view");
const navButtons = document.querySelectorAll(".nav-btn");

function showView(viewId) {
  views.forEach((view) => {
    view.hidden = view.id !== viewId;
  });
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const viewId = button.dataset.view;
    showView(viewId);
    if (viewId === "plans-view") loadPlans();
    if (viewId === "new-log-view") loadPlansIntoSelect();
    if (viewId === "history-view") loadHistory();
  });
});

// ---- Online/offline indicator ----

const connectionStatus = document.getElementById("connection-status");
const submitLogBtn = document.getElementById("submit-log-btn");

function updateConnectionStatus() {
  const online = navigator.onLine;
  setText(connectionStatus, online ? "online" : "offline");
  connectionStatus.classList.toggle("bg-emerald-700", online);
  connectionStatus.classList.toggle("bg-red-700", !online);
  if (submitLogBtn) {
    submitLogBtn.disabled = !online;
  }
}

window.addEventListener("online", () => {
  updateConnectionStatus();
  flushSetQueue();
});
window.addEventListener("offline", updateConnectionStatus);

// ---- API key settings ----

const apiKeyForm = document.getElementById("api-key-form");
const apiKeyInput = document.getElementById("api-key-input");
const apiKeyStatus = document.getElementById("api-key-status");
const forgetApiKeyBtn = document.getElementById("forget-api-key");

apiKeyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  setStoredApiKey(apiKeyInput.value.trim());
  apiKeyInput.value = "";
  setText(apiKeyStatus, "API key saved.");
});

forgetApiKeyBtn.addEventListener("click", () => {
  clearStoredApiKey();
  apiKeyInput.value = "";
  setText(apiKeyStatus, "API key removed.");
});

// ---- Plans list ----

const plansList = document.getElementById("plans-list");

async function startWorkout(planId) {
  try {
    const session = await apiFetch("/workout-sessions", {
      method: "POST",
      body: JSON.stringify({ source_plan_id: planId }),
    });
    renderActiveSession(session);
  } catch (err) {
    window.alert(`Failed to start workout: ${err.message}`);
  }
}

async function loadPlans() {
  clearChildren(plansList);
  let data;
  try {
    data = await apiFetch("/plans?limit=100");
  } catch (err) {
    const li = document.createElement("li");
    setText(li, `Failed to load plans: ${err.message}`);
    plansList.appendChild(li);
    return;
  }
  data.items.forEach((plan) => {
    const li = document.createElement("li");
    li.className = "border rounded p-3 flex justify-between items-center";

    const info = document.createElement("div");
    const name = document.createElement("p");
    name.className = "font-medium";
    setText(name, plan.name);
    info.appendChild(name);
    if (plan.description) {
      const desc = document.createElement("p");
      desc.className = "text-sm text-slate-600";
      setText(desc, plan.description);
      info.appendChild(desc);
    }
    li.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "flex gap-2";
    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "btn-primary";
    setText(startBtn, "Start workout");
    startBtn.addEventListener("click", () => startWorkout(plan.id));
    actions.appendChild(startBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-danger-sm";
    setText(deleteBtn, "Delete");
    deleteBtn.addEventListener("click", async () => {
      await apiFetch(`/plans/${plan.id}`, { method: "DELETE" });
      loadPlans();
    });
    actions.appendChild(deleteBtn);
    li.appendChild(actions);

    plansList.appendChild(li);
  });
}

// ---- Active workout ----

const activePlanName = document.getElementById("active-plan-name");
const activeProgressText = document.getElementById("active-progress-text");
const activeProgress = document.getElementById("active-progress");
const activeGrid = document.getElementById("active-grid");
const activeRestTimer = document.getElementById("active-rest-timer");
const activeRestExpired = document.getElementById("active-rest-expired");
const addRestTime = document.getElementById("add-rest-time");
const subtractRestTime = document.getElementById("subtract-rest-time");
const skipRest = document.getElementById("skip-rest");
const activeSyncStatus = document.getElementById("active-sync-status");
const retryActiveSync = document.getElementById("retry-active-sync");
const activeFeeling = document.getElementById("active-feeling");
const finishActiveWorkout = document.getElementById("finish-active-workout");
let currentSession = null;
let restTimerHandle = null;
let restWasSkipped = false;
let syncInProgress = false;
let lastSyncError = null;

function updateRestTimer() {
  const state = restTimerState(currentSession?.rest_ends_at || null);
  const label = restWasSkipped && !currentSession?.rest_ends_at ? "Rest skipped" : state.label;
  setText(activeRestTimer, state.status === "expired" ? "Rest: 0s" : label);
  activeRestExpired.hidden = state.status !== "expired";
  activeRestTimer.classList.toggle("text-emerald-700", state.status === "expired");
  const canAdjust = Boolean(currentSession?.rest_ends_at);
  addRestTime.disabled = !canAdjust;
  subtractRestTime.disabled = !canAdjust;
  skipRest.disabled = !canAdjust;
}

function renderSyncStatus() {
  const state = synchronizationState(
    getSetQueue(localStorage),
    navigator.onLine,
    lastSyncError
  );
  setText(activeSyncStatus, state.label);
  activeSyncStatus.dataset.state = state.status;
  retryActiveSync.hidden = state.status !== "failed";
}

async function flushSetQueue() {
  if (syncInProgress || !navigator.onLine || !currentSession) return;
  const operations = getSetQueue(localStorage).filter(
    (operation) => operation.session_id === currentSession.id
  );
  if (operations.length === 0) {
    lastSyncError = null;
    renderSyncStatus();
    return;
  }
  syncInProgress = true;
  lastSyncError = null;
  renderSyncStatus();
  try {
    for (const operation of operations) {
      currentSession = await apiFetch(`/workout-sessions/${operation.session_id}/sets`, {
        method: "POST",
        body: JSON.stringify(operation.payload),
      });
      removeSetOperation(localStorage, operation.client_operation_id);
      if (operation.draft_key) clearSetDraft(localStorage, operation.draft_key);
      if (operation.payload.state !== "skipped") restWasSkipped = false;
    }
    renderActiveSession(currentSession);
  } catch (err) {
    lastSyncError = err.message;
  } finally {
    syncInProgress = false;
    renderSyncStatus();
  }
}

/** @param {HTMLInputElement} input */
function numberValue(input) {
  return input.value ? Number.parseFloat(input.value) : null;
}

/**
 * @param {string} labelText
 * @param {number | string | null} value
 * @param {{inputMode: string, min: string, max?: string, step?: string, disabled: boolean}} options
 */
function makeInput(labelText, value, options) {
  const label = document.createElement("label");
  label.className = "text-xs font-medium";
  setText(label, labelText);
  const input = document.createElement("input");
  input.type = "number";
  input.inputMode = options.inputMode;
  input.min = options.min;
  input.max = options.max || "";
  input.step = options.step || "1";
  input.value = value ?? "";
  input.disabled = options.disabled;
  input.className = "block border rounded px-2 min-h-12 min-w-12 w-20 disabled:bg-slate-100";
  label.appendChild(input);
  return { label, input };
}

async function persistSet(row, values, state = "completed") {
  const operationId = crypto.randomUUID();
  const draftKey = draftStorageKey(currentSession.id, row.exercise.id, row.setNumber);
  enqueueSetOperation(localStorage, {
    client_operation_id: operationId,
    session_id: currentSession.id,
    draft_key: draftKey,
    payload: {
      session_exercise_id: row.exercise.id,
      set_number: row.setNumber,
      weight_kg: values.weight,
      reps: values.reps,
      rir: values.rir,
      state,
      client_operation_id: operationId,
    },
  });
  lastSyncError = null;
  renderSyncStatus();
  await flushSetQueue();
}

function renderSetRow(row, totalSets) {
  const form = document.createElement("form");
  form.dataset.setRow = "";
  form.dataset.exerciseName = row.exercise.exercise_name;
  form.dataset.setNumber = String(row.setNumber);
  form.dataset.state = row.state;
  form.className = "grid grid-cols-[3rem_5rem_repeat(3,minmax(4rem,1fr))_minmax(7rem,auto)] gap-2 items-end border-t py-2 min-w-[38rem]";
  if (row.state === "completed") form.classList.add("bg-emerald-50");
  if (row.state === "skipped") form.classList.add("bg-amber-50");
  if (row.state === "current") form.classList.add("ring-2", "ring-slate-700");
  if (row.state === "future") form.classList.add("opacity-70");
  const setCell = document.createElement("strong");
  setText(setCell, String(row.setNumber));
  const previous = document.createElement("span");
  previous.className = "text-xs text-slate-600 self-center";
  const previousWeight = row.exercise.suggested_weight_kg;
  setText(
    previous,
    `${previousWeight ?? "—"} kg × ${row.exercise.suggested_reps}`
  );
  const display = resolveSetDisplayState({
    savedEntry: row.entry,
    suggestedWeightKg: row.exercise.suggested_weight_kg,
    suggestedReps: row.exercise.suggested_reps,
    suggestionSource: row.exercise.suggestion_source,
  });
  const draftKey = draftStorageKey(currentSession.id, row.exercise.id, row.setNumber);
  if (row.entry) clearSetDraft(localStorage, draftKey);
  const draft = row.entry ? null : loadSetDraft(localStorage, draftKey);
  const disabled = row.entry !== null;
  const weight = makeInput("Weight (kg)", draft?.weight ?? display.weightKg, {
    inputMode: "decimal",
    min: "0",
    step: "0.25",
    disabled,
  });
  const reps = makeInput("Repetitions", draft?.reps ?? display.reps, {
    inputMode: "numeric",
    min: "1",
    max: "1000",
    disabled,
  });
  const rir = makeInput("RIR", draft?.rir ?? display.rir, {
    inputMode: "numeric",
    min: "0",
    max: "10",
    disabled,
  });
  const actions = document.createElement("div");
  actions.className = "flex flex-wrap gap-1";

  const values = () => ({
    weight: numberValue(weight.input),
    reps: Number.parseInt(reps.input.value, 10),
    rir: rir.input.value ? Number.parseInt(rir.input.value, 10) : null,
  });
  if (!row.entry) {
    const saveDraft = () => {
      saveSetDraft(localStorage, draftKey, {
        weight: weight.input.value,
        reps: reps.input.value,
        rir: rir.input.value,
      });
    };
    [weight.input, reps.input, rir.input].forEach((input) => {
      input.addEventListener("input", saveDraft);
    });
  }
  if (row.entry) {
    const state = document.createElement("span");
    state.className = row.state === "skipped" ? "text-amber-700 self-center" : "text-emerald-700 self-center";
    setText(state, row.state === "skipped" ? "Skipped" : "Saved");
    actions.appendChild(state);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn-secondary min-h-12 min-w-12";
    setText(edit, "Edit");
    edit.addEventListener("click", async () => {
      if (weight.input.disabled) {
        [weight.input, reps.input, rir.input].forEach((input) => {
          input.disabled = false;
        });
        setText(edit, "Save correction");
        return;
      }
      const data = values();
      currentSession = await apiFetch(
        `/workout-sessions/${currentSession.id}/sets/${row.entry.id}`,
        {
          method: "PUT",
          body: JSON.stringify({ weight_kg: data.weight, reps: data.reps, rir: data.rir }),
        }
      );
      renderActiveSession(currentSession);
    });
    actions.appendChild(edit);
    const undoRemaining = 5_000 - (Date.now() - new Date(row.entry.completed_at).getTime());
    if (undoRemaining > 0) {
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "btn-secondary min-h-12 min-w-12";
      setText(undo, "Undo");
      undo.addEventListener("click", async () => {
        currentSession = await apiFetch(
          `/workout-sessions/${currentSession.id}/sets/${row.entry.id}`,
          { method: "DELETE" }
        );
        renderActiveSession(currentSession);
      });
      actions.appendChild(undo);
      window.setTimeout(() => undo.remove(), undoRemaining);
    }
  } else {
    const suggestion = document.createElement("span");
    suggestion.className = "text-xs text-amber-700 self-center";
    setText(suggestion, display.label);
    actions.appendChild(suggestion);
    const complete = document.createElement("button");
    complete.type = "submit";
    complete.className = "btn-primary min-h-12 min-w-12";
    setText(
      complete,
      totalSets === 1 ? "Save set" : `Complete ${row.exercise.exercise_name} set ${row.setNumber}`
    );
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "btn-secondary min-h-12 min-w-12";
    setText(skip, `Skip ${row.exercise.exercise_name} set ${row.setNumber}`);
    skip.addEventListener("click", () => persistSet(row, values(), "skipped"));
    actions.append(complete, skip);
    if (row.state !== "current") {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "btn-secondary min-h-12 min-w-12";
      setText(open, `Open ${row.exercise.exercise_name} set ${row.setNumber}`);
      open.addEventListener("click", async () => {
        currentSession = await apiFetch(`/workout-sessions/${currentSession.id}/focus`, {
          method: "PATCH",
          body: JSON.stringify({
            session_exercise_id: row.exercise.id,
            set_number: row.setNumber,
          }),
        });
        renderActiveSession(currentSession);
      });
      actions.appendChild(open);
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await persistSet(row, values());
    });
  }
  form.append(setCell, previous, weight.label, reps.label, rir.label, actions);
  return form;
}

function renderExercise(exercise, totalSets) {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.className = "text-lg font-semibold p-2";
  setText(heading, exercise.exercise_name);
  section.appendChild(heading);
  const scroller = document.createElement("div");
  scroller.className = "overflow-x-auto px-2";
  const header = document.createElement("div");
  header.className = "grid grid-cols-[3rem_5rem_repeat(3,minmax(4rem,1fr))_minmax(7rem,auto)] gap-2 min-w-[38rem] text-xs font-semibold text-slate-600";
  for (const label of ["Set", "Previous", "kg", "Reps", "RIR", "Complete"]) {
    const cell = document.createElement("span");
    cell.setAttribute("role", "columnheader");
    setText(cell, label);
    header.appendChild(cell);
  }
  scroller.appendChild(header);
  const rows = buildWorkoutGrid(currentSession).filter((row) => row.exercise.id === exercise.id);
  rows.forEach((row) => scroller.appendChild(renderSetRow(row, totalSets)));
  section.appendChild(scroller);
  return section;
}

function renderActiveSession(session) {
  currentSession = session;
  const progress = workoutProgress(session);

  setText(activePlanName, session.source_plan_name);
  setText(activeProgressText, `${progress.done} of ${progress.total} sets`);
  activeProgress.value = progress.percent;
  clearChildren(activeGrid);
  groupSessionExercises(session.exercises).forEach((group) => {
    if (group.label) {
      const details = document.createElement("details");
      details.open = true;
      details.className = "border rounded bg-white";
      details.setAttribute("role", "group");
      details.setAttribute("aria-label", group.label);
      const summary = document.createElement("summary");
      summary.className = "cursor-pointer font-semibold p-3 min-h-12";
      setText(summary, group.label);
      details.appendChild(summary);
      group.exercises.forEach((exercise) => details.appendChild(renderExercise(exercise, progress.total)));
      activeGrid.appendChild(details);
    } else {
      const card = document.createElement("article");
      card.className = "border rounded bg-white";
      card.appendChild(renderExercise(group.exercises[0], progress.total));
      activeGrid.appendChild(card);
    }
  });
  updateRestTimer();
  renderSyncStatus();
  if (restTimerHandle) window.clearInterval(restTimerHandle);
  restTimerHandle = window.setInterval(updateRestTimer, 1000);
  showView("active-workout-view");
  window.requestAnimationFrame(() => {
    activeGrid.querySelector('[data-state="current"] input:not(:disabled)')?.focus();
  });
}

/** @param {{adjustment_seconds?: number, skip?: boolean}} data */
async function updateRest(data) {
  if (!currentSession) return;
  try {
    currentSession = await apiFetch(`/workout-sessions/${currentSession.id}/rest`, {
      method: "PATCH",
      body: JSON.stringify({ ...data, expected_version: currentSession.version }),
    });
    restWasSkipped = data.skip === true;
    renderActiveSession(currentSession);
  } catch (err) {
    window.alert(`Failed to update rest timer: ${err.message}`);
  }
}

addRestTime.addEventListener("click", () => updateRest({ adjustment_seconds: 30 }));
subtractRestTime.addEventListener("click", () => updateRest({ adjustment_seconds: -30 }));
skipRest.addEventListener("click", () => updateRest({ skip: true }));
retryActiveSync.addEventListener("click", flushSetQueue);

finishActiveWorkout.addEventListener("click", async () => {
  if (!currentSession) return;
  const progress = workoutProgress(currentSession);
  if (progress.done < progress.total && !window.confirm("Finish this incomplete workout?")) return;
  try {
    await apiFetch(`/workout-sessions/${currentSession.id}/complete`, {
      method: "POST",
      body: JSON.stringify({ overall_feeling: Number.parseInt(activeFeeling.value, 10) }),
    });
    currentSession = null;
    if (restTimerHandle) window.clearInterval(restTimerHandle);
    showView("history-view");
    loadHistory();
  } catch (err) {
    window.alert(`Failed to finish workout: ${err.message}`);
  }
});

async function resumeActiveSession() {
  if (!getStoredApiKey()) return;
  try {
    renderActiveSession(await apiFetch("/workout-sessions/active"));
    await flushSetQueue();
  } catch {
    // no resumable session is a normal initial state
  }
}

// ---- New workout form ----

const logPlanSelect = document.getElementById("log-plan-select");
const logExercisesList = document.getElementById("log-exercises-list");
const addExerciseBtn = document.getElementById("add-exercise-btn");
const newLogForm = document.getElementById("new-log-form");
const exerciseRowTemplate = document.getElementById("exercise-row-template");

async function loadPlansIntoSelect() {
  logPlanSelect.querySelectorAll("option:not(:first-child)").forEach((opt) => opt.remove());
  let data;
  try {
    data = await apiFetch("/plans?limit=100");
  } catch {
    return;
  }
  data.items.forEach((plan) => {
    const option = document.createElement("option");
    option.value = plan.id;
    setText(option, plan.name);
    logPlanSelect.appendChild(option);
  });
}

function addExerciseRow(prefill = null) {
  const fragment = exerciseRowTemplate.content.cloneNode(true);
  const row = fragment.querySelector(".exercise-row");
  if (prefill) {
    row.querySelector(".exercise-name").value = prefill.exercise_name || "";
    row.querySelector(".exercise-sets").value = prefill.target_sets || "";
    row.querySelector(".exercise-weight").value = prefill.target_weight_kg || "";
    row.querySelector(".exercise-rest").value = prefill.rest_time_seconds || "";
  }
  row.querySelector(".remove-exercise-btn").addEventListener("click", () => {
    row.remove();
  });
  logExercisesList.appendChild(row);
}

addExerciseBtn.addEventListener("click", () => addExerciseRow());

logPlanSelect.addEventListener("change", async () => {
  clearChildren(logExercisesList);
  if (!logPlanSelect.value) return;
  try {
    const plan = await apiFetch(`/plans/${logPlanSelect.value}`);
    plan.exercises.forEach((exercise) => addExerciseRow(exercise));
  } catch {
    // leave exercise list empty on failure
  }
});

newLogForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const performedAtLocal = document.getElementById("log-performed-at").value;
  if (!performedAtLocal) return;
  const performedAtIso = new Date(performedAtLocal).toISOString();

  const exercises = Array.from(logExercisesList.querySelectorAll(".exercise-row")).map((row) => {
    const repsPerSet = parseRepsPerSet(row.querySelector(".exercise-reps").value);
    return {
      exercise_name: row.querySelector(".exercise-name").value,
      sets_count: Number.parseInt(row.querySelector(".exercise-sets").value, 10),
      reps_per_set: repsPerSet,
      weight_kg: row.querySelector(".exercise-weight").value
        ? Number.parseFloat(row.querySelector(".exercise-weight").value)
        : null,
      rest_time_seconds: row.querySelector(".exercise-rest").value
        ? Number.parseInt(row.querySelector(".exercise-rest").value, 10)
        : 60,
    };
  });

  const payload = {
    source_plan_id: logPlanSelect.value || null,
    performed_at: performedAtIso,
    total_time_minutes: Number.parseInt(document.getElementById("log-total-time").value, 10),
    calories_burned: document.getElementById("log-calories").value
      ? Number.parseInt(document.getElementById("log-calories").value, 10)
      : null,
    overall_feeling: Number.parseInt(document.getElementById("log-feeling").value, 10),
    notes: document.getElementById("log-notes").value || null,
    exercises,
  };

  try {
    await apiFetch("/logs", { method: "POST", body: JSON.stringify(payload) });
    newLogForm.reset();
    clearChildren(logExercisesList);
    showView("history-view");
    loadHistory();
  } catch (err) {
    window.alert(`Failed to save workout: ${err.message}`);
  }
});

// ---- History list & detail ----

const historyList = document.getElementById("history-list");
const detailContent = document.getElementById("detail-content");
const backToHistoryBtn = document.getElementById("back-to-history");
const deleteLogBtn = document.getElementById("delete-log-btn");
let currentDetailLogId = null;

async function loadHistory() {
  clearChildren(historyList);
  let data;
  try {
    data = await apiFetch("/logs?limit=100");
  } catch (err) {
    const li = document.createElement("li");
    setText(li, `Failed to load history: ${err.message}`);
    historyList.appendChild(li);
    return;
  }
  data.items.forEach((log) => {
    const li = document.createElement("li");
    li.className = "border rounded p-3 cursor-pointer hover:bg-slate-100";
    const title = document.createElement("p");
    title.className = "font-medium";
    setText(
      title,
      log.source_plan_name || new Date(log.performed_at).toLocaleString()
    );
    const subtitle = document.createElement("p");
    subtitle.className = "text-sm text-slate-600";
    setText(subtitle, `Feeling: ${log.overall_feeling}/5 · ${log.total_time_minutes} min`);
    li.appendChild(title);
    li.appendChild(subtitle);
    li.addEventListener("click", () => showLogDetail(log.id));
    historyList.appendChild(li);
  });
}

async function showLogDetail(logId) {
  currentDetailLogId = logId;
  showView("detail-view");
  clearChildren(detailContent);
  let log;
  try {
    log = await apiFetch(`/logs/${logId}`);
  } catch (err) {
    const p = document.createElement("p");
    setText(p, `Failed to load workout: ${err.message}`);
    detailContent.appendChild(p);
    return;
  }

  const summary = document.createElement("p");
  setText(
    summary,
    `${new Date(log.performed_at).toLocaleString()} · ${log.total_time_minutes} min · Feeling ${log.overall_feeling}/5`
  );
  detailContent.appendChild(summary);

  if (log.source_plan_name) {
    const plan = document.createElement("p");
    setText(plan, `Plan: ${log.source_plan_name}`);
    detailContent.appendChild(plan);
  }

  if (log.notes) {
    const notes = document.createElement("p");
    setText(notes, log.notes);
    detailContent.appendChild(notes);
  }

  const exerciseList = document.createElement("ul");
  exerciseList.className = "flex flex-col gap-2 mt-3";
  log.exercises.forEach((exercise) => {
    const li = document.createElement("li");
    li.className = "border rounded p-2";
    setText(
      li,
      `${exercise.exercise_name}: ${exercise.reps_per_set.join(", ")} reps` +
        (exercise.weight_kg ? ` @ ${exercise.weight_kg}kg` : "")
    );
    exerciseList.appendChild(li);
  });
  detailContent.appendChild(exerciseList);
}

backToHistoryBtn.addEventListener("click", () => {
  showView("history-view");
  loadHistory();
});

deleteLogBtn.addEventListener("click", async () => {
  if (!currentDetailLogId) return;
  await apiFetch(`/logs/${currentDetailLogId}`, { method: "DELETE" });
  showView("history-view");
  loadHistory();
});

// ---- Service worker registration ----

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // service worker registration failures should not block the app
    });
  });
}

// ---- Init ----

updateConnectionStatus();
showView("settings-view");
apiKeyInput.value = "";
resumeActiveSession();
