"use strict";

import {
  parseRepsPerSet,
  remainingTimeSeconds,
  resolveSetDisplayState,
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

window.addEventListener("online", updateConnectionStatus);
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
const activeExerciseName = document.getElementById("active-exercise-name");
const activeSetNumber = document.getElementById("active-set-number");
const activeSetState = document.getElementById("active-set-state");
const activeSetForm = document.getElementById("active-set-form");
const activeWeight = document.getElementById("active-weight");
const activeReps = document.getElementById("active-reps");
const activeRir = document.getElementById("active-rir");
const saveActiveSet = document.getElementById("save-active-set");
const activeRestTimer = document.getElementById("active-rest-timer");
const activeFeeling = document.getElementById("active-feeling");
const finishActiveWorkout = document.getElementById("finish-active-workout");
let currentSession = null;
let restTimerHandle = null;

function updateRestTimer() {
  if (!currentSession?.rest_ends_at) {
    setText(activeRestTimer, "Rest not started");
    return;
  }
  setText(activeRestTimer, `Rest: ${remainingTimeSeconds(currentSession.rest_ends_at)}s`);
}

function renderActiveSession(session) {
  currentSession = session;
  const exercise =
    session.exercises.find((item) => item.id === session.focused_exercise_id) ||
    session.exercises[0];
  const savedEntry =
    exercise.set_entries.find((entry) => entry.set_number === session.focused_set_number) || null;
  const display = resolveSetDisplayState({
    savedEntry,
    suggestedWeightKg: exercise.suggested_weight_kg,
    suggestedReps: exercise.suggested_reps,
    suggestionSource: exercise.suggestion_source,
  });

  setText(activePlanName, session.source_plan_name);
  setText(activeExerciseName, exercise.exercise_name);
  setText(activeSetNumber, `Set ${session.focused_set_number} of ${exercise.target_sets}`);
  setText(activeSetState, display.label);
  activeSetState.classList.toggle("text-emerald-700", display.isSaved);
  activeSetState.classList.toggle("text-amber-700", !display.isSaved);
  activeWeight.value = display.weightKg ?? "";
  activeReps.value = display.reps ?? "";
  activeRir.value = display.rir ?? "";
  saveActiveSet.disabled = display.isSaved;
  updateRestTimer();
  if (restTimerHandle) window.clearInterval(restTimerHandle);
  restTimerHandle = window.setInterval(updateRestTimer, 1000);
  showView("active-workout-view");
}

activeSetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentSession) return;
  const exercise =
    currentSession.exercises.find(
      (item) => item.id === currentSession.focused_exercise_id
    ) || currentSession.exercises[0];
  try {
    const session = await apiFetch(`/workout-sessions/${currentSession.id}/sets`, {
      method: "POST",
      body: JSON.stringify({
        session_exercise_id: exercise.id,
        set_number: currentSession.focused_set_number,
        weight_kg: activeWeight.value ? Number.parseFloat(activeWeight.value) : null,
        reps: Number.parseInt(activeReps.value, 10),
        rir: activeRir.value ? Number.parseInt(activeRir.value, 10) : null,
        client_operation_id: crypto.randomUUID(),
      }),
    });
    renderActiveSession(session);
  } catch (err) {
    window.alert(`Failed to save set: ${err.message}`);
  }
});

finishActiveWorkout.addEventListener("click", async () => {
  if (!currentSession) return;
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
