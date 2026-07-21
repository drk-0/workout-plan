import { EXERCISES, getWorkoutExercises } from "./exercises.js";
import { renderBarChart, renderLineChart } from "./charts.js";
import {
  buildEvidence,
  buildProgressionSuggestion,
  formatSuggestionTitle,
  getLiftFeedback,
  getPainLevel,
  getSessionsWithLift,
  shouldStartRestTimerAfterSet,
  SUGGESTION_TYPES
} from "./progression.js";
import {
  acceptSuggestion,
  dismissSuggestion,
  evaluateAndQueueSuggestion,
  formatSourceLabel,
  formatTargetLabel,
  getExerciseTarget,
  loadProgressionState,
  migrateProgressionStorage,
  modifySuggestionTarget,
  parseDumbbellWeightsInput,
  saveProgressionState,
  SUGGESTION_STATUS
} from "./progression-storage.js";
import {
  addBodyMetric,
  calculateConsistencyStreak,
  countWorkoutsThisWeek,
  createBodyMetricEntry,
  formatWeekLabel,
  getBodyMetricsTimeline,
  getGlucoseLog,
  getLiftBests,
  getLiftHistory,
  getWeeklyTrend,
  loadBodyMetrics,
  normalizeWellness
} from "./progress.js";
import {
  formatHealthConnectStatus,
  getHealthConnectAvailability,
  getLastHealthConnectSync,
  isHealthConnectRuntime,
  syncBodyMetricsFromHealthConnect
} from "./health-connect.js";
import {
  normalizeReadiness,
  readinessIsComplete
} from "./readiness.js";
import { WARMUP_STEPS } from "./warmup.js";
import { normalizeRecovery } from "./recovery.js";
import { getSubstitutes } from "./substitutions.js";
import {
  MEDICAL_DISCLAIMER,
  READINESS_BLOCK_MESSAGE,
  SHARP_PAIN_WARNING,
  URGENT_SYMPTOM_WARNING,
  renderStopSymptomsList
} from "./safety.js";
import {
  HISTORY_KEY,
  PENDING_READINESS_PREFIX,
  addSetToSession,
  addSubstitution,
  calculateMetrics,
  completeLiftInSession,
  completeSession,
  createSessionAfterWarmUp,
  createSetEntry,
  flattenSets,
  getActiveSession,
  getSetsForLift,
  markSetsSynced,
  normalizeHistory,
  normalizeLiftFeedback,
  sessionPrerequisitesMet,
  setLiftFeedback,
  skipExerciseInSession,
  updateSession
} from "./workout-data.js";

const SHEETS_URL_KEY = "googleSheetsWebAppUrl";
const DEFAULT_SHEETS_URL = "PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE";

let timerIntervals = {};

function qs(sel){return document.querySelector(sel)}
function fmt(s){s=Math.max(0,Number(s)||0);return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`}
function loadSessions(){
  try{
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return normalizeHistory(raw);
  }catch{
    return [];
  }
}
function saveSessions(sessions){localStorage.setItem(HISTORY_KEY, JSON.stringify(sessions))}
function persistMigratedSessions(){
  const raw = localStorage.getItem(HISTORY_KEY) || "[]";
  let parsed;
  try{parsed = JSON.parse(raw)}catch{parsed = []}
  const normalized = normalizeHistory(parsed);
  if(JSON.stringify(parsed) !== JSON.stringify(normalized)) saveSessions(normalized);
  migrateProgressionStorage(normalized);
  return normalized;
}
function loadProgression(){return loadProgressionState(persistMigratedSessions())}
function saveProgression(state){saveProgressionState(state)}
function clearAllTimers(){
  Object.keys(timerIntervals).forEach((key)=>{
    clearInterval(timerIntervals[key]);
    delete timerIntervals[key];
  });
}
function img(slug){return `assets/exercises/${slug}.png`}
function exerciseImage(e){return img(e?.imageSlug || e?.slug)}
function workoutOf(slug){
  const ex = EXERCISES.find(e=>e.slug===slug);
  if(!ex) return "A";
  if(ex.workout !== "sub") return ex.workout;
  for(const main of EXERCISES.filter((item)=>item.workout !== "sub")){
    if(main.substitutes?.some((sub)=>sub.slug===slug)) return main.workout;
  }
  return "A";
}
function exercise(slug){return EXERCISES.find(e=>e.slug===slug)}

function pendingReadinessKey(template){return `${PENDING_READINESS_PREFIX}${String(template).toUpperCase()}`}
function savePendingReadiness(template, readiness){
  sessionStorage.setItem(pendingReadinessKey(template), JSON.stringify(readiness));
}
function loadPendingReadiness(template){
  try{
    const raw = sessionStorage.getItem(pendingReadinessKey(template));
    return raw ? JSON.parse(raw) : null;
  }catch{return null}
}
function clearPendingReadiness(template){sessionStorage.removeItem(pendingReadinessKey(template))}

function workoutEntryHref(letter){
  const normalized = String(letter || "A").toUpperCase();
  const sessions = persistMigratedSessions();
  const active = getActiveSession(sessions);
  if(active && active.template === normalized && sessionPrerequisitesMet(active)) return `#/workout/${normalized}`;
  if(active && active.template === normalized && active.readiness?.recordedAt && !(active.warmUp?.completed || active.warmUp?.skipped)) return `#/warmup/${normalized}`;
  return `#/readiness/${normalized}`;
}

function gateActiveSession(letter){
  const normalized = String(letter || "A").toUpperCase();
  const sessions = persistMigratedSessions();
  const active = getActiveSession(sessions);
  if(!active || active.template !== normalized){
    location.replace(`#/readiness/${normalized}`);
    return null;
  }
  if(active.readiness?.blocked){
    location.replace(`#/readiness/${normalized}`);
    return null;
  }
  if(!sessionPrerequisitesMet(active)){
    if(!readinessIsComplete(active.readiness) && !active.readiness?.migrated){
      location.replace(`#/readiness/${normalized}`);
      return null;
    }
    if(!(active.warmUp?.completed || active.warmUp?.skipped)){
      location.replace(`#/warmup/${normalized}`);
      return null;
    }
  }
  return active;
}

function renderScaleButtons(name, min, max, selected){
  return Array.from({length: max - min + 1}, (_, i) => {
    const value = min + i;
    const pressed = Number(selected) === value ? " aria-pressed=\"true\"" : " aria-pressed=\"false\"";
    return `<button type="button" class="scale-btn${Number(selected) === value ? " scale-btn-active" : ""}" data-scale="${name}" data-value="${value}"${pressed}>${value}</button>`;
  }).join("");
}

function renderSafetyWarning(title, message, extra = ""){
  return `<div class="safety-warning" role="alert">
    <h2>${title}</h2>
    <p>${message}</p>
    ${extra}
  </div>`;
}

function setRoute(hash){
  clearAllTimers();
  const app = qs("#app");
  const route = (hash || "#/").replace(/^#\/?/,"");
  const parts = route.split("/").filter(Boolean);
  if(parts.length===0) app.innerHTML = home();
  else if(parts[0]==="readiness") app.innerHTML = readiness(parts[1] || "A");
  else if(parts[0]==="warmup") app.innerHTML = warmUp(parts[1] || "A");
  else if(parts[0]==="recovery") app.innerHTML = recovery();
  else if(parts[0]==="workout") app.innerHTML = workout(parts[1] || "A");
  else if(parts[0]==="lift"){
    if(parts[1] && exercise(parts[1])) app.innerHTML = lift(parts[1]);
    else{
      location.replace("#/");
      return;
    }
  }
  else if(parts[0]==="dashboard") app.innerHTML = dashboard();
  else if(parts[0]==="settings") app.innerHTML = settings();
  else app.innerHTML = home();
  bindPage();
  window.scrollTo(0,0);
}

function home(){
  const sessions = persistMigratedSessions();
  const active = getActiveSession(sessions);
  let resumeHref = "#/";
  if(active){
    if(!sessionPrerequisitesMet(active) && !active.readiness?.migrated){
      resumeHref = readinessIsComplete(active.readiness) ? `#/warmup/${active.template}` : `#/readiness/${active.template}`;
    } else {
      resumeHref = `#/workout/${active.template}`;
    }
  }
  const activeBanner = active
    ? `<div class="session-banner"><strong>Session in progress:</strong> ${active.workout} • ${active.sets.length} sets logged • ${active.completedLifts.length} exercises done <a href="${resumeHref}">Resume</a></div>`
    : "";
  return `<section>
    ${activeBanner}
    <div class="hero">
      <div class="hero-title">Workout Plan</div>
      <p class="hero-sub">Build muscle, improve body composition, and progress at a pace you can sustain.</p>
    </div>
    <div class="goal-grid">
      <div class="goal"><b>Muscle</b><span>Controlled reps and progressive overload.</span></div>
      <div class="goal"><b>Body Comp</b><span>Protein, walking, and slow fat loss.</span></div>
      <div class="goal"><b>Consistency</b><span>Start with 3 solid workouts per week.</span></div>
      <div class="goal"><b>Safety</b><span>Readiness check before each workout.</span></div>
    </div>
    <div class="action-grid">
      <a class="btn" href="${workoutEntryHref("A")}">Workout A<br><small>Push + legs</small></a>
      <a class="btn" href="${workoutEntryHref("B")}">Workout B<br><small>Pull + legs</small></a>
    </div>
    <div class="panel"><h2>Today's Rule</h2><p>Train clean. Stop with 1–3 good reps left. Review progression suggestions on the Dashboard — you decide whether to follow them.</p><p class="panel-note">${MEDICAL_DISCLAIMER}</p></div>
    <div class="panel"><a class="secondary-btn" href="#/dashboard">Open Dashboard</a></div>
    <div class="panel"><h2>Settings</h2><a class="secondary-btn" href="#/settings">Settings</a></div>
  </section>`;
}

function readiness(letter){
  const normalized = String(letter || "A").toUpperCase();
  const pending = loadPendingReadiness(normalized);
  const energy = pending?.energy ?? "";
  const soreness = pending?.soreness ?? "";
  const painToday = pending?.painToday ?? "none";
  return `<section>
    <div class="topbar"><a href="#/">← Home</a><span>Readiness</span></div>
    <h1>Pre-Workout Check</h1>
    <p class="lede">Workout ${normalized}. Answer honestly. This is not medical advice.</p>
    <form id="readiness-form" class="readiness-form" data-template="${normalized}">
      <div class="card readiness-card">
        <h2>How do you feel?</h2>
        <p class="field-label">Energy level (1 = very low, 5 = good)</p>
        <div class="scale-row" role="group" aria-label="Energy level">${renderScaleButtons("energy", 1, 5, energy)}</div>
        <p class="field-label">Soreness level (1 = none, 5 = very sore)</p>
        <div class="scale-row" role="group" aria-label="Soreness level">${renderScaleButtons("soreness", 1, 5, soreness)}</div>
        <label class="field-label" for="pain-today">Pain today</label>
        <select id="pain-today" class="dash-select">
          ${["none","mild","moderate","severe"].map((level)=>`<option value="${level}"${painToday===level?" selected":""}>${level.charAt(0).toUpperCase()+level.slice(1)}</option>`).join("")}
        </select>
      </div>
      <div class="card readiness-card">
        <h2>Symptoms today</h2>
        <label class="toggle-row"><input type="checkbox" id="dizziness"${pending?.dizziness?" checked":""}><span>Dizziness</span></label>
        <label class="toggle-row"><input type="checkbox" id="unusual-weakness"${pending?.unusualWeakness?" checked":""}><span>Unusual weakness</span></label>
        <label class="toggle-row"><input type="checkbox" id="unusual-sob"${pending?.unusualShortnessOfBreath?" checked":""}><span>Unusual shortness of breath</span></label>
        <label class="toggle-row"><input type="checkbox" id="chest-discomfort"${pending?.chestDiscomfort?" checked":""}><span>Chest discomfort</span></label>
        <label class="toggle-row"><input type="checkbox" id="confusion"${pending?.confusion?" checked":""}><span>Confusion</span></label>
        <label class="toggle-row"><input type="checkbox" id="faintness"${pending?.faintness?" checked":""}><span>Faintness</span></label>
      </div>
      <div class="card readiness-card">
        <label class="field-label" for="readiness-glucose">Optional glucose (mg/dL)</label>
        <input id="readiness-glucose" type="number" inputmode="decimal" placeholder="Optional" value="${pending?.glucose ?? ""}">
        <label class="field-label" for="readiness-note">Optional note</label>
        <textarea id="readiness-note" placeholder="Optional">${pending?.note || ""}</textarea>
      </div>
      <div class="panel safety-panel">
        <h2>Stop exercising and seek help if you have:</h2>
        <ul class="safety-list">${renderStopSymptomsList()}</ul>
        <p class="panel-note">${URGENT_SYMPTOM_WARNING}</p>
      </div>
      <button class="btn" type="submit">Continue</button>
    </form>
    <div id="readiness-result"></div>
  </section>`;
}

function warmUp(letter){
  const normalized = String(letter || "A").toUpperCase();
  const readiness = loadPendingReadiness(normalized);
  if(!readiness || readiness.blocked){
    location.replace(`#/readiness/${normalized}`);
    return "";
  }
  const steps = WARMUP_STEPS.map((step, index)=>`<div class="warmup-step">
    <div class="warmup-step-num">${index + 1}</div>
    <div><h3>${step.title}</h3><p class="warmup-duration">${step.duration}</p><p>${step.detail}</p></div>
  </div>`).join("");
  return `<section>
    <div class="topbar"><a href="#/readiness/${normalized}">← Back</a><span>Warm-up</span></div>
    <h1>Warm-Up</h1>
    <p class="lede">Workout ${normalized}. Move gently before lifting. About 3–5 minutes total.</p>
    <div class="warmup-list">${steps}</div>
    <button class="btn warmup-complete" data-template="${normalized}">Warm-up complete</button>
    <button class="secondary-btn warmup-skip" data-template="${normalized}">Skip warm-up</button>
    <p class="panel-note">Skipping warm-up may increase injury risk. Only skip if you are already warmed up.</p>
  </section>`;
}

function recovery(){
  const sessions = persistMigratedSessions();
  const session = getActiveSession(sessions);
  if(!session){
    location.replace("#/");
    return "";
  }
  return `<section>
    <div class="topbar"><a href="#/workout/${session.template}">← Workout</a><span>Recovery</span></div>
    <h1>Post-Workout Check</h1>
    <p class="lede">How did the session go? Optional — for your records only.</p>
    <form id="recovery-form" class="recovery-form" data-session="${session.id}">
      <div class="card">
        <label class="field-label" for="recovery-effort">Overall workout effort (1–10)</label>
        <select id="recovery-effort" class="dash-select">
          <option value="">Not logged</option>
          ${Array.from({length:10},(_,i)=>`<option value="${i+1}">${i+1}/10</option>`).join("")}
        </select>
        <label class="toggle-row"><input type="checkbox" id="recovery-fatigue"><span>Unusual fatigue</span></label>
        <label class="field-label" for="recovery-pain">Pain after workout</label>
        <select id="recovery-pain" class="dash-select">
          ${["none","mild","moderate","severe"].map((level)=>`<option value="${level}">${level.charAt(0).toUpperCase()+level.slice(1)}</option>`).join("")}
        </select>
        <label class="field-label" for="recovery-glucose">Optional post-workout glucose (mg/dL)</label>
        <input id="recovery-glucose" type="number" inputmode="decimal" placeholder="Optional">
        <label class="field-label" for="recovery-status">Session status</label>
        <select id="recovery-status" class="dash-select">
          <option value="completed">Completed</option>
          <option value="shortened">Shortened</option>
          <option value="stopped">Stopped early</option>
        </select>
        <label class="field-label" for="wellness-weight">Body weight (lb)</label>
        <input id="wellness-weight" type="number" inputmode="decimal" placeholder="Optional">
        <label class="field-label" for="wellness-waist">Waist (in)</label>
        <input id="wellness-waist" type="number" inputmode="decimal" placeholder="Optional">
        <label class="field-label" for="recovery-notes">Notes</label>
        <textarea id="recovery-notes" placeholder="Optional"></textarea>
      </div>
      <p class="panel-note">${MEDICAL_DISCLAIMER}</p>
      <button class="btn" type="submit">Save and finish</button>
    </form>
  </section>`;
}

function workout(letter){
  const normalizedLetter = String(letter || "A").toUpperCase();
  const session = gateActiveSession(normalizedLetter);
  if(!session) return "";
  const adjustmentBanner = session.readiness?.acceptedAdjustments?.length
    ? `<div class="adjustment-banner"><strong>Today's adjustments (your choice):</strong><ul>${session.readiness.acceptedAdjustments.map((item)=>`<li>${item}</li>`).join("")}</ul></div>`
    : "";
  const list = getWorkoutExercises(normalizedLetter).map(e=>card(e, session)).join("");
  const finishBtn = session.endedAt === null
    ? `<div class="panel finish-panel">
        <button class="btn finish-workout" data-session="${session.id}">Complete Workout</button>
        <p class="panel-note">You'll log recovery details on the next screen.</p>
      </div>`
    : "";
  return `<section>
    <div class="topbar"><a href="#/">← Home</a><span>Workout ${normalizedLetter}</span></div>
    <h1>Workout ${normalizedLetter}</h1>
    <p class="lede">${normalizedLetter==="A"?"Push + legs":"Pull + legs"}. Tap any lift for timer, rep counter, cues, logging, and video.</p>
    <div class="session-banner in-progress"><strong>Session active</strong> • ${session.sets.length} sets saved • ${session.completedLifts.length} exercises complete</div>
    ${adjustmentBanner}
    <div class="lift-list">${list}</div>
    ${finishBtn}
  </section>`;
}

function card(e, session){
  const setsForLift = getSetsForLift(session, e.slug);
  const done = session.completedLifts.includes(e.slug);
  const skipped = (session.skippedExercises || []).includes(e.slug);
  const status = skipped
    ? `<span class="lift-status">Skipped</span>`
    : done
      ? `<span class="lift-status done">Complete</span>`
      : setsForLift.length
        ? `<span class="lift-status in-progress">${setsForLift.length} set${setsForLift.length===1?"":"s"} logged</span>`
        : `<span class="lift-status">${e.subtitle}</span>`;
  return `<a class="lift-card${done?" lift-card-done":""}" href="#/lift/${e.slug}">
    <img src="${exerciseImage(e)}" alt="${e.name}">
    <div><h3>${e.name}</h3><p>${e.sets}</p>${status}</div>
  </a>`;
}

function renderTargetBanner(exercise, sessions, target) {
  const sourceLabel = formatSourceLabel(target?.source);
  const targetLabel = formatTargetLabel(target, exercise);
  const lastCompleted = getSessionsWithLift(sessions, exercise.slug)[0];
  const lastPain = lastCompleted ? getPainLevel(getLiftFeedback(lastCompleted, exercise.slug)) : null;
  const safetyNote =
    lastPain === "sharp"
      ? `<p class="safety-note">Last time you reported sharp pain — consider reducing load or substituting.</p>`
      : "";

  return `<div class="target-banner">
    <div class="target-banner-row">
      <strong>Target:</strong> ${targetLabel}
      <span class="source-badge">${sourceLabel}</span>
    </div>
    ${safetyNote}
    <p class="target-banner-note">Suggestions are reviewed on the Dashboard after you finish this exercise.</p>
  </div>`;
}

function renderSetTrackingControls(){
  const effortOptions = Array.from({ length: 10 }, (_, index) => {
    const value = index + 1;
    return `<option value="${value}">${value}/10</option>`;
  }).join("");
  const painOptions = ["none", "mild", "moderate", "sharp"]
    .map((level) => `<option value="${level}">${level.charAt(0).toUpperCase() + level.slice(1)}</option>`)
    .join("");

  return `<div class="set-tracking">
    <label class="field-label" for="set-effort">Effort this set (1–10)</label>
    <select id="set-effort" class="dash-select effort-select" required>
      <option value="">Select effort</option>
      ${effortOptions}
    </select>
    <label class="field-label" for="set-pain">Pain during this set</label>
    <select id="set-pain" class="dash-select effort-select" required>
      ${painOptions}
    </select>
    <div id="sharp-pain-warning" class="safety-warning hidden" role="alert">
      <h2>Stop this exercise</h2>
      <p>${SHARP_PAIN_WARNING}</p>
      <div class="action-grid">
        <button type="button" class="secondary-btn skip-exercise">Skip Exercise</button>
        <button type="button" class="btn choose-substitute">Choose Substitute</button>
      </div>
    </div>
  </div>`;
}

function renderSubstituteModal(exercise){
  const subs = getSubstitutes(exercise);
  if(!subs.length) return "";
  const options = subs.map((sub)=>`<button type="button" class="secondary-btn substitute-option" data-slug="${sub.slug}" data-original="${exercise.slug}">${sub.label}<br><small>${sub.reason}</small></button>`).join("");
  return `<div id="substitute-modal" class="substitute-modal hidden" role="dialog" aria-label="Choose substitute">
    <div class="card">
      <h2>Choose a substitute</h2>
      <p>Easier options for ${exercise.name}:</p>
      <div class="action-grid">${options}</div>
      <button type="button" class="secondary-btn close-substitute">Cancel</button>
    </div>
  </div>`;
}

function lift(slug){
  const e = exercise(slug);
  if(!e){
    location.replace("#/");
    return "";
  }
  const workoutLetter = e.workout === "sub" ? workoutOf(slug) : e.workout;
  const session = gateActiveSession(workoutLetter);
  if(!session) return "";

  const savedSets = getSetsForLift(session, slug);
  const savedSummary = savedSets.length
    ? `<p class="saved-sets">Saved this session: ${savedSets.map(s=>`${s.reps} reps${s.weight?` @ ${s.weight} lb`:""}${s.effort?` • effort ${s.effort}`:""}${s.painDuringSet && s.painDuringSet!=="none"?` • pain: ${s.painDuringSet}`:""}`).join(" • ")}</p>`
    : "";
  const lastSet = savedSets[0];
  const workoutExercises = getWorkoutExercises(workoutLetter);
  const idx = workoutExercises.findIndex(x=>x.slug===slug);
  const navExercises = idx >= 0 ? workoutExercises : [...workoutExercises, e];
  const navIdx = navExercises.findIndex(x=>x.slug===slug);
  const prev = navExercises[(navIdx-1+navExercises.length)%navExercises.length].slug;
  const next = navExercises[(navIdx+1)%navExercises.length].slug;
  const cues = e.cues.map(c=>`<li>${c}</li>`).join("");
  const progressionState = loadProgression();
  const target = getExerciseTarget(progressionState, slug, e);
  const targetBanner = renderTargetBanner(e, persistMigratedSessions(), target);
  const setTracking = renderSetTrackingControls();
  const substituteModal = renderSubstituteModal(e);
  const defaultWeight = target?.weight ?? lastSet?.weight ?? "";
  const backHref = e.workout === "sub" ? `#/workout/${workoutLetter}` : `#/workout/${e.workout}`;
  return `<section>
    <div class="topbar"><a href="${backHref}">← Workout ${workoutLetter}</a><span>${e.name}</span></div>
    <div class="art"><img src="${exerciseImage(e)}" alt="${e.name}"></div>
    <h1>${e.name}</h1>
    <p class="lede">${e.subtitle}</p>
    <div class="sets">${e.sets}</div>
    ${targetBanner}
    ${savedSummary}
    <div class="card"><h2>How to do it</h2><p>${e.instructions}</p></div>
    <div class="card"><h2>Form cues</h2><ul>${cues}</ul></div>
    <div class="card tools" data-lift="${e.slug}" data-rest="${e.rest}" data-session="${session.id}" data-original="${slug}">
      <h2>Rep Counter + Rest Timer</h2>
      <div class="counter">
        <button class="minus">−</button>
        <div class="repbox"><span class="repnum">0</span><strong>reps</strong></div>
        <button class="plus">+</button>
      </div>
      <div class="timer">
        <strong>Recommended rest: ${fmt(e.rest)}</strong>
        <div class="time">${fmt(e.rest)}</div>
        <div class="timer-controls">
          <button class="start">Start</button><button class="pause">Pause</button><button class="reset">Reset</button>
        </div>
      </div>
      <input class="weight" placeholder="Weight used, e.g. 20" value="${defaultWeight}">
      <textarea class="notes" placeholder="Optional note for this set">${lastSet?.notes || ""}</textarea>
      ${setTracking}
      <button class="set-complete">Save Set</button>
    </div>
    ${substituteModal}
    <a class="video" href="${e.video}" target="_blank" rel="noopener noreferrer">Open video in new tab</a>
    <div class="action-grid"><a class="secondary-btn" href="#/lift/${prev}">← Previous</a><a class="secondary-btn lift-next" href="#/lift/${next}" data-lift="${e.slug}">Next →</a></div>
  </section>`;
}

function emptyState(title, text) {
  return `<div class="empty-state" role="status"><strong>${title}</strong><p>${text}</p></div>`;
}

function formatBest(value, suffix = "") {
  if (value == null) return "—";
  return `${value}${suffix}`;
}


function renderProgressionDashboard(sessions, progressionState) {
  const pending = progressionState.suggestions.filter((s) => s.status === SUGGESTION_STATUS.PENDING);
  const decided = progressionState.suggestions.filter((s) =>
    [SUGGESTION_STATUS.ACCEPTED, SUGGESTION_STATUS.MODIFIED].includes(s.status)
  ).slice(0, 5);
  const dismissed = progressionState.suggestions.filter((s) => s.status === SUGGESTION_STATUS.DISMISSED).slice(0, 5);

  const pendingCards = pending.length
    ? pending.map((s) => {
        const ex = exercise(s.exerciseId);
        const name = ex?.name || s.exerciseId;
        return `<div class="progression-review-card" data-suggestion-id="${s.id}">
          <h3>${formatSuggestionTitle(s)} — ${name}</h3>
          <p><strong>Recommendation:</strong> ${s.reason}</p>
          <p class="progression-evidence">${s.evidence}</p>
          <p class="progression-target-change">${formatTargetLabel(s.currentTarget, ex)} → ${formatTargetLabel(s.proposedTarget, ex)}</p>
          <div class="progression-actions">
            <button class="btn progression-accept" type="button" data-id="${s.id}">Accept</button>
            <button class="secondary-btn progression-modify" type="button" data-id="${s.id}" data-exercise="${s.exerciseId}">Modify</button>
            <button class="secondary-btn progression-dismiss" type="button" data-id="${s.id}">Dismiss</button>
          </div>
          <form class="progression-modify-form hidden" data-id="${s.id}">
            <label class="field-label">Sets</label>
            <input type="number" name="sets" value="${s.proposedTarget?.sets ?? ""}">
            <label class="field-label">Min reps</label>
            <input type="number" name="minReps" value="${s.proposedTarget?.minReps ?? ""}">
            <label class="field-label">Max reps</label>
            <input type="number" name="maxReps" value="${s.proposedTarget?.maxReps ?? ""}">
            <label class="field-label">Weight (lb)</label>
            <input type="number" name="weight" value="${s.proposedTarget?.weight ?? ""}">
            <button class="btn progression-save-modify" type="submit" data-id="${s.id}">Save target</button>
          </form>
        </div>`;
      }).join("")
    : emptyState("No pending suggestions", "Finish an exercise during a workout to generate conservative progression suggestions.");

  const decidedRows = decided.length
    ? decided.map((s) => {
        const ex = exercise(s.exerciseId);
        return `<div class="history-item compact"><b>${ex?.name || s.exerciseId}</b><span>${s.status} • ${formatTargetLabel(s.proposedTarget, ex)}</span></div>`;
      }).join("")
    : `<p class="panel-note">No accepted changes yet.</p>`;

  const dismissedRows = dismissed.length
    ? dismissed.map((s) => {
        const ex = exercise(s.exerciseId);
        return `<div class="history-item compact"><b>${ex?.name || s.exerciseId}</b><span>Dismissed • ${s.reason}</span></div>`;
      }).join("")
    : `<p class="panel-note">No dismissed suggestions.</p>`;

  const holdTypes = new Set([
    SUGGESTION_TYPES.REPEAT_WEIGHT,
    SUGGESTION_TYPES.REDUCE_WEIGHT,
    SUGGESTION_TYPES.REDUCE_ONE_SET,
    SUGGESTION_TYPES.SUBSTITUTION,
    SUGGESTION_TYPES.EASIER_SESSION
  ]);
  const lastHoldByExercise = new Map();
  for (const s of progressionState.suggestions) {
    if (holdTypes.has(s.type) && !lastHoldByExercise.has(s.exerciseId)) {
      lastHoldByExercise.set(s.exerciseId, s.reason);
    }
  }

  const targetRows = progressionState.targets.map((target) => {
    const ex = exercise(target.exerciseId);
    const name = ex?.name || `${target.exerciseId} (not in plan)`;
    const holdReason = lastHoldByExercise.get(target.exerciseId);
    return `<div class="history-item compact target-row" data-exercise="${target.exerciseId}">
      <b>${name}</b>
      <span>${formatTargetLabel(target, ex)} • ${formatSourceLabel(target.source)}${holdReason ? ` • Hold: ${holdReason}` : ""}</span>
    </div>`;
  }).join("");

  return `<div class="panel progression-panel">
    <h2>Progression</h2>
    <p class="panel-note">Conservative suggestions based on your logged workouts. Nothing changes until you accept it.</p>
    <h3 class="progression-subhead">Pending</h3>
    <div class="progression-review-list">${pendingCards}</div>
    <h3 class="progression-subhead">Accepted / Modified</h3>
    <div class="history-list">${decidedRows}</div>
    <details class="progression-dismissed">
      <summary>Dismissed suggestions</summary>
      <div class="history-list">${dismissedRows}</div>
    </details>
    <h3 class="progression-subhead">Current targets</h3>
    <div class="history-list">${targetRows || emptyState("No targets", "Targets will appear after your first migration.")}</div>
  </div>`;
}

function formatBodyMetricLine(entry) {
  const parts = [];
  if (entry.weight != null) parts.push(`${entry.weight} lb`);
  if (entry.bodyFat != null) parts.push(`${entry.bodyFat}% body fat`);
  if (entry.waist != null) parts.push(`waist ${entry.waist} in`);
  const detail = parts.length ? parts.join(" • ") : "—";
  const source =
    entry.source === "health_connect"
      ? "GE scale"
      : entry.source === "workout"
        ? "workout"
        : entry.notes || "manual";
  return { detail, source };
}

function dashboard(){
  const sessions = persistMigratedSessions();
  const metrics = calculateMetrics(sessions);
  const weeklyCount = countWorkoutsThisWeek(sessions);
  const streak = calculateConsistencyStreak(sessions);
  const trend = getWeeklyTrend(sessions, 12);
  const bodyTimeline = getBodyMetricsTimeline(sessions);
  const glucoseLog = getGlucoseLog(sessions);
  const flat = flattenSets(sessions);

  const liftsWithHistory = [...new Set(flat.map((set) => set.lift))];
  const defaultLift = liftsWithHistory[0] || EXERCISES[0].slug;
  const selectedLift = dashboardLiftSelection || defaultLift;
  const liftMeta = exercise(selectedLift);
  const liftHistory = getLiftHistory(sessions, selectedLift);
  const liftBests = getLiftBests(sessions, selectedLift);

  const liftOptions = EXERCISES.map(
    (item) => `<option value="${item.slug}"${item.slug === selectedLift ? " selected" : ""}>${item.name}</option>`
  ).join("");

  const historyRows = liftHistory.length
    ? liftHistory
        .slice(0, 20)
        .map(
          (set) => `<div class="history-item compact">
            <b>${set.reps} reps${set.weight ? ` @ ${set.weight} lb` : ""}</b>
            <span>${set.localTime} • ${set.workout}${set.volume ? ` • ${Math.round(set.volume)} lb-reps` : ""}</span>
          </div>`
        )
        .join("")
    : emptyState("No sets logged yet", `Complete ${liftMeta?.name || "this exercise"} during a workout to build history here.`);

  const bodyRows = bodyTimeline.length
    ? bodyTimeline
        .slice(0, 12)
        .map((entry) => {
          const { detail, source } = formatBodyMetricLine(entry);
          return `<div class="history-item compact">
            <b>${entry.date}</b>
            <span>${detail}${source ? ` • ${source}` : ""}</span>
          </div>`;
        })
        .join("")
    : emptyState("No body measurements yet", "Sync from your GE scale or log weight and waist below.");

  const lastHcSync = getLastHealthConnectSync();
  const hcSyncLabel = lastHcSync
    ? `Last scale sync: ${new Date(lastHcSync).toLocaleString()}`
    : "No scale sync yet.";
  const hcRuntime = isHealthConnectRuntime();

  const glucoseRows = glucoseLog.length
    ? glucoseLog
        .slice(0, 12)
        .map(
          (entry) => `<div class="history-item compact">
            <b>${entry.workout}</b>
            <span>${entry.localTime}${entry.glucosePre != null ? ` • Pre: ${entry.glucosePre}` : ""}${entry.glucosePost != null ? ` • Post: ${entry.glucosePost}` : ""}</span>
          </div>`
        )
        .join("")
    : emptyState("No glucose entries yet", "Optional pre- and post-workout values can be added when you complete a workout.");

  const recent = flat.length
    ? flat
        .slice(0, 15)
        .map(
          (x) =>
            `<div class="history-item compact"><b>${x.liftName} — ${x.reps} reps${x.weight ? ` @ ${x.weight} lb` : ""}</b><span>${x.localTime} • ${x.workout} • ${x.synced ? "Synced" : "Not synced"}</span></div>`
        )
        .join("")
    : emptyState("No saved sets yet", "Start Workout A or B and log your first set to see progress here.");

  const active = metrics.activeSession;
  const activeLine = active ? `<p class="lede">Active session: ${active.workout} (${active.sets.length} sets logged).</p>` : "";
  const progressionState = loadProgression();
  const progressionPanel = renderProgressionDashboard(sessions, progressionState);

  return `<section class="dashboard">
    <div class="topbar"><a href="#/">← Home</a><span>Dashboard</span></div>
    <h1>Dashboard</h1>
    <p class="lede">Long-term progress at a glance. Numbers are estimates for your own tracking.</p>
    ${activeLine}

    <div class="metric-grid highlight-metrics">
      <div class="metric"><b>${weeklyCount}</b><span>workouts this week</span></div>
      <div class="metric"><b>${streak}</b><span>week streak</span></div>
      <div class="metric"><b>${metrics.sessionCount}</b><span>total sessions</span></div>
      <div class="metric"><b>${metrics.setCount}</b><span>saved sets</span></div>
    </div>

    ${progressionPanel}

    <div class="panel">
      <h2>12-Week Workout Trend</h2>
      <p class="panel-note">Workouts completed per week.</p>
      <div id="trend-chart" class="chart-host"></div>
    </div>

    <div class="panel">
      <h2>Exercise History</h2>
      <label class="field-label" for="lift-select">Choose exercise</label>
      <select id="lift-select" class="dash-select">${liftOptions}</select>
      <div class="pr-grid">
        <div class="pr-card"><b>${formatBest(liftBests.bestWeight, " lb")}</b><span>best weight</span></div>
        <div class="pr-card"><b>${formatBest(liftBests.bestReps)}</b><span>best reps (single set)</span></div>
        <div class="pr-card"><b>${formatBest(liftBests.bestVolume != null ? Math.round(liftBests.bestVolume) : null)}</b><span>best volume (lb-reps)</span></div>
      </div>
      <div class="history-list">${historyRows}</div>
    </div>

    <div class="panel">
      <h2>Body Measurements</h2>
      <p class="panel-note">Track weight trends from your GE scale or manual entries. Weekly averages matter more than daily noise. Not a substitute for professional care.</p>
      <div class="health-connect-panel">
        <p id="hc-status" class="lede">${hcRuntime ? "Checking Health Connect…" : "Browser mode — install the Android app to sync from your GE scale."}</p>
        <p class="panel-note">${hcSyncLabel}</p>
        <button class="btn" id="hc-sync" type="button"${hcRuntime ? "" : " disabled"}>Sync from GE Scale</button>
      </div>
      <form id="body-metric-form" class="metric-form">
        <label class="field-label" for="metric-date">Date</label>
        <input id="metric-date" type="date" required>
        <label class="field-label" for="metric-weight">Weight (lb)</label>
        <input id="metric-weight" type="number" inputmode="decimal" placeholder="Optional">
        <label class="field-label" for="metric-waist">Waist (in)</label>
        <input id="metric-waist" type="number" inputmode="decimal" placeholder="Optional">
        <label class="field-label" for="metric-notes">Notes</label>
        <textarea id="metric-notes" placeholder="Optional"></textarea>
        <button class="btn" type="submit">Save Measurement</button>
      </form>
      <div id="body-chart" class="chart-host"></div>
      <div class="history-list">${bodyRows}</div>
    </div>

    <div class="panel">
      <h2>Glucose Log</h2>
      <p class="panel-note">Optional personal log from workout completion. Values are not interpreted here — discuss patterns with your care team.</p>
      <div class="history-list">${glucoseRows}</div>
    </div>

    <div class="panel">
      <h2>Totals</h2>
      <div class="metric-grid">
        <div class="metric"><b>${metrics.totalReps}</b><span>total reps</span></div>
        <div class="metric"><b>${Math.round(metrics.volume)}</b><span>estimated volume</span></div>
        <div class="metric"><b>${metrics.unsyncedCount}</b><span>unsynced sets</span></div>
        <div class="metric"><b>${formatWeekLabel(new Date())}</b><span>current week</span></div>
      </div>
    </div>

    <div class="panel"><h2>Sync + Export</h2><button class="btn" id="sync">Sync to Google Sheets</button><button class="secondary-btn" id="csv">Export CSV</button><p id="status" class="lede"></p></div>
    <div class="panel"><h2>Recent Sets</h2><div class="history-list">${recent}</div></div>
  </section>`;
}

let dashboardLiftSelection = null;

function settings(){
  const url = localStorage.getItem(SHEETS_URL_KEY) || DEFAULT_SHEETS_URL;
  const progressionState = loadProgression();
  const weights = progressionState.equipment.availableDumbbellWeights.join(", ");
  const hcRuntime = isHealthConnectRuntime();
  const lastHcSync = getLastHealthConnectSync();
  return `<section>
    <div class="topbar"><a href="#/">← Home</a><span>Settings</span></div>
    <h1>Settings</h1>
    <div class="card">
      <h2>GE Scale / Health Connect</h2>
      <p>${hcRuntime ? "Sync weight from your GE scale through Health Connect." : "Health Connect sync requires the Android app build. The browser PWA can still log measurements manually."}</p>
      <p class="panel-note">${lastHcSync ? `Last sync: ${new Date(lastHcSync).toLocaleString()}` : "No scale sync yet."}</p>
      <button class="btn" id="hc-sync-settings" type="button"${hcRuntime ? "" : " disabled"}>Sync from GE Scale</button>
      <p id="hc-settings-status" class="lede"></p>
    </div>
    <div class="card"><h2>Google Sheets Web App URL</h2><p>Paste your deployed Google Apps Script Web App URL here.</p><textarea id="sheetsUrl">${url}</textarea><button class="btn" id="saveUrl">Save URL</button></div>
    <div class="card"><h2>Available Dumbbells</h2><p>Used only for conservative weight-increase suggestions. Enter weights in pounds, separated by commas.</p><textarea id="dumbbellWeights" placeholder="5, 8, 10, 12, 15, 20, 25, 30">${weights}</textarea><button class="btn" id="saveEquipment">Save Dumbbells</button></div>
  </section>`;
}

function bindReadinessForm(){
  const form = qs("#readiness-form");
  if(!form) return;

  form.querySelectorAll(".scale-btn").forEach((button)=>{
    button.onclick = ()=>{
      const name = button.dataset.scale;
      form.querySelectorAll(`.scale-btn[data-scale="${name}"]`).forEach((btn)=>{
        btn.classList.toggle("scale-btn-active", btn === button);
        btn.setAttribute("aria-pressed", btn === button ? "true" : "false");
      });
      form.dataset[name] = button.dataset.value;
    };
  });

  form.onsubmit = (event)=>{
    event.preventDefault();
    const template = form.dataset.template;
    const readiness = normalizeReadiness({
      energy: form.dataset.energy,
      soreness: form.dataset.soreness,
      painToday: qs("#pain-today")?.value,
      dizziness: qs("#dizziness")?.checked,
      unusualWeakness: qs("#unusual-weakness")?.checked,
      unusualShortnessOfBreath: qs("#unusual-sob")?.checked,
      chestDiscomfort: qs("#chest-discomfort")?.checked,
      confusion: qs("#confusion")?.checked,
      faintness: qs("#faintness")?.checked,
      glucose: qs("#readiness-glucose")?.value,
      note: qs("#readiness-note")?.value
    });

    if(readiness.energy == null || readiness.soreness == null){
      alert("Please select energy and soreness levels.");
      return;
    }

    const resultHost = qs("#readiness-result");
    if(readiness.blocked){
      savePendingReadiness(template, readiness);
      resultHost.innerHTML = `${renderSafetyWarning("Do not start this workout", READINESS_BLOCK_MESSAGE, `<p><strong>Reported:</strong> ${readiness.blockReasons.join(", ")}</p><a class="btn" href="#/">Return home</a>`)}`;
      return;
    }

    savePendingReadiness(template, readiness);
    if(readiness.suggestedAdjustments.length){
      resultHost.innerHTML = `<div class="panel adjustment-panel">
        <h2>Suggested adjustments</h2>
        <p>These are suggestions only. Nothing changes unless you choose to follow them.</p>
        <ul>${readiness.suggestedAdjustments.map((item)=>`<li>${item}</li>`).join("")}</ul>
        <button class="btn readiness-continue" data-template="${template}">Continue to warm-up</button>
      </div>`;
      qs(".readiness-continue").onclick = ()=>{
        const updated = { ...readiness, acceptedAdjustments: [...readiness.suggestedAdjustments] };
        savePendingReadiness(template, updated);
        setRoute(`#/warmup/${template}`);
      };
      return;
    }
    setRoute(`#/warmup/${template}`);
  };
}

function bindWarmUp(){
  const complete = qs(".warmup-complete");
  if(complete){
    complete.onclick = ()=>{
      const template = complete.dataset.template;
      const readiness = loadPendingReadiness(template);
      if(!readiness || readiness.blocked) return;
      let sessions = loadSessions();
      const result = createSessionAfterWarmUp(sessions, template, readiness, {
        completed: true,
        skipped: false,
        completedAt: new Date().toISOString()
      });
      saveSessions(result.sessions);
      clearPendingReadiness(template);
      setRoute(`#/workout/${template}`);
    };
  }
  const skip = qs(".warmup-skip");
  if(skip){
    skip.onclick = ()=>{
      if(!confirm("Skipping warm-up may increase injury risk. Skip anyway?")) return;
      const template = skip.dataset.template;
      const readiness = loadPendingReadiness(template);
      if(!readiness || readiness.blocked) return;
      let sessions = loadSessions();
      const result = createSessionAfterWarmUp(sessions, template, readiness, {
        completed: false,
        skipped: true,
        completedAt: new Date().toISOString()
      });
      saveSessions(result.sessions);
      clearPendingReadiness(template);
      setRoute(`#/workout/${template}`);
    };
  }
}

function bindRecoveryForm(){
  const form = qs("#recovery-form");
  if(!form) return;
  form.onsubmit = (event)=>{
    event.preventDefault();
    const sessionId = form.dataset.session;
    let sessions = loadSessions();
    const recovery = normalizeRecovery({
      overallEffort: qs("#recovery-effort")?.value,
      unusualFatigue: qs("#recovery-fatigue")?.checked,
      painAfter: qs("#recovery-pain")?.value,
      glucose: qs("#recovery-glucose")?.value,
      completionStatus: qs("#recovery-status")?.value,
      notes: qs("#recovery-notes")?.value
    });
    const wellness = normalizeWellness({
      bodyWeight: qs("#wellness-weight")?.value,
      waistInches: qs("#wellness-waist")?.value
    });
    sessions = completeSession(sessions, sessionId, new Date().toISOString(), { recovery, wellness });
    saveSessions(sessions);
    setRoute("#/");
  };
}

function bindPage(){
  const tool = qs(".tools");
  if(tool) bindTool(tool);
  bindReadinessForm();
  bindWarmUp();
  bindRecoveryForm();
  const sync = qs("#sync"); if(sync) sync.onclick = syncSheets;
  const csv = qs("#csv"); if(csv) csv.onclick = exportCSV;
  const saveUrl = qs("#saveUrl"); if(saveUrl) saveUrl.onclick = ()=>{localStorage.setItem(SHEETS_URL_KEY, qs("#sheetsUrl").value.trim()); alert("Saved.");};
  const saveEquipment = qs("#saveEquipment");
  if (saveEquipment) {
    saveEquipment.onclick = () => {
      let state = loadProgression();
      state = {
        ...state,
        equipment: {
          availableDumbbellWeights: parseDumbbellWeightsInput(qs("#dumbbellWeights")?.value)
        }
      };
      saveProgression(state);
      alert("Dumbbell weights saved.");
    };
  }
  const finish = qs(".finish-workout");
  if(finish) finish.onclick = ()=>{
    setRoute("#/recovery");
  };
  const next = qs(".lift-next");
  if(next) next.addEventListener("click", ()=>{
    const liftSlug = next.dataset.lift;
    const sessionId = tool?.dataset.session;
    if(!liftSlug || !sessionId) return;
    let sessions = loadSessions();
    sessions = completeLiftInSession(sessions, sessionId, liftSlug);
    saveSessions(sessions);

    const ex = exercise(liftSlug);
    if (ex) {
      let progState = loadProgression();
      const target = getExerciseTarget(progState, liftSlug, ex);
      const built = buildProgressionSuggestion(sessions, ex, {
        target,
        suggestions: progState.suggestions,
        availableWeights: progState.equipment.availableDumbbellWeights
      });
      const payload = {
        type: built.type,
        currentTarget: built.currentTarget,
        proposedTarget: built.proposedTarget,
        reason: built.reason,
        evidence: buildEvidence(sessions, liftSlug, built.currentTarget, ex)
      };
      const queued = evaluateAndQueueSuggestion(sessions, ex, progState, payload);
      if (queued.queued) saveProgression(queued.state);
    }
  });
  bindDashboard();
  bindProgressionDashboard();
  bindHealthConnect();
}

async function bindHealthConnect() {
  const statusEl = qs("#hc-status");
  const settingsStatus = qs("#hc-settings-status");

  if (statusEl || settingsStatus) {
    const availability = await getHealthConnectAvailability();
    const { label } = formatHealthConnectStatus(availability);
    if (statusEl) {
      statusEl.textContent = availability === "WebOnly"
        ? "Browser mode — install the Android app to sync from your GE scale."
        : `Health Connect: ${label}`;
    }
  }

  const runSync = async (statusTarget) => {
    if (statusTarget) statusTarget.textContent = "Syncing from GE scale…";
    try {
      const result = await syncBodyMetricsFromHealthConnect();
      if (statusTarget) statusTarget.textContent = result.message;
      if (result.ok) setRoute(location.hash);
    } catch (error) {
      if (statusTarget) {
        statusTarget.textContent = `Scale sync failed: ${error.message || "Check Health Connect permissions."}`;
      }
    }
  };

  const syncBtn = qs("#hc-sync");
  if (syncBtn) syncBtn.onclick = () => runSync(statusEl);

  const settingsBtn = qs("#hc-sync-settings");
  if (settingsBtn) settingsBtn.onclick = () => runSync(settingsStatus);
}

function bindDashboard(){
  const liftSelect = qs("#lift-select");
  if (liftSelect) {
    liftSelect.onchange = () => {
      dashboardLiftSelection = liftSelect.value;
      setRoute("#/dashboard");
    };
  }

  const metricDate = qs("#metric-date");
  if (metricDate && !metricDate.value) {
    metricDate.value = new Date().toISOString().slice(0, 10);
  }

  const bodyForm = qs("#body-metric-form");
  if (bodyForm) {
    bodyForm.onsubmit = (event) => {
      event.preventDefault();
      const weight = qs("#metric-weight")?.value;
      const waist = qs("#metric-waist")?.value;
      if (!weight && !waist) {
        alert("Enter at least weight or waist.");
        return;
      }
      addBodyMetric(
        createBodyMetricEntry({
          date: qs("#metric-date")?.value,
          weight,
          waist,
          notes: qs("#metric-notes")?.value || ""
        })
      );
      setRoute("#/dashboard");
    };
  }

  const sessions = persistMigratedSessions();
  const trend = getWeeklyTrend(sessions, 12);
  const trendHost = qs("#trend-chart");
  if (trendHost) {
    renderBarChart(
      trendHost,
      trend.map((point) => ({ label: point.label, value: point.workouts })),
      {
        ariaLabel: "Workouts per week for the last 12 weeks",
        valueLabel: "workouts",
        emptyLabel: "No workouts in the last 12 weeks yet. Finish a workout to start your trend."
      }
    );
  }

  const bodyTimeline = getBodyMetricsTimeline(sessions)
    .filter((entry) => entry.weight != null)
    .slice(0, 12)
    .reverse();
  const bodyHost = qs("#body-chart");
  if (bodyHost) {
    renderLineChart(
      bodyHost,
      bodyTimeline.map((entry) => ({
        label: entry.date.slice(5),
        value: entry.weight
      })),
      {
        ariaLabel: "Body weight trend",
        valueSuffix: " lb",
        emptyLabel: "No weight entries yet. Add a measurement above to see a trend."
      }
    );
  }
}

function saveLiftFeedbackFromForm(sessions, sessionId, liftSlug) {
  const feedback = normalizeLiftFeedback({
    effort: qs("#lift-effort")?.value,
    painLevel: qs("#lift-pain-level")?.value,
    stoppedEarly: qs("#lift-stopped-early")?.checked
  });
  if (!feedback) return sessions;
  return setLiftFeedback(sessions, sessionId, liftSlug, feedback);
}

function bindProgressionDashboard() {
  document.querySelectorAll(".progression-accept").forEach((button) => {
    button.onclick = () => {
      let state = loadProgression();
      state = acceptSuggestion(state, button.dataset.id);
      saveProgression(state);
      setRoute("#/dashboard");
    };
  });

  document.querySelectorAll(".progression-dismiss").forEach((button) => {
    button.onclick = () => {
      let state = loadProgression();
      state = dismissSuggestion(state, button.dataset.id);
      saveProgression(state);
      setRoute("#/dashboard");
    };
  });

  document.querySelectorAll(".progression-modify").forEach((button) => {
    button.onclick = () => {
      const form = document.querySelector(`.progression-modify-form[data-id="${button.dataset.id}"]`);
      if (form) form.classList.toggle("hidden");
    };
  });

  document.querySelectorAll(".progression-modify-form").forEach((form) => {
    form.onsubmit = (event) => {
      event.preventDefault();
      const id = form.dataset.id;
      const patch = {
        sets: Number(form.elements.sets.value) || undefined,
        minReps: form.elements.minReps.value === "" ? null : Number(form.elements.minReps.value),
        maxReps: form.elements.maxReps.value === "" ? null : Number(form.elements.maxReps.value),
        weight: form.elements.weight.value === "" ? null : Number(form.elements.weight.value)
      };
      let state = loadProgression();
      state = modifySuggestionTarget(state, id, patch);
      saveProgression(state);
      setRoute("#/dashboard");
    };
  });
}

function bindTool(tool){
  const liftSlug = tool.dataset.lift, e = exercise(liftSlug), rest = +tool.dataset.rest;
  const sessionId = tool.dataset.session;
  const rep = tool.querySelector(".repnum"), time = tool.querySelector(".time");
  const painSelect = qs("#set-pain");
  const sharpWarning = qs("#sharp-pain-warning");
  const substituteModal = qs("#substitute-modal");
  let reps = 0, remaining = rest;
  const render=()=>{rep.textContent=reps; time.textContent=fmt(remaining)};
  const stop=()=>{clearInterval(timerIntervals[liftSlug]); delete timerIntervals[liftSlug]};
  const start=()=>{stop(); if(remaining<=0) remaining=rest; timerIntervals[liftSlug]=setInterval(()=>{remaining--; render(); if(remaining<=0){remaining=0; render(); stop(); if(navigator.vibrate) navigator.vibrate([250,120,250]);}},1000)};
  tool.querySelector(".plus").onclick=()=>{reps++; render()};
  tool.querySelector(".minus").onclick=()=>{reps=Math.max(0,reps-1); render()};
  tool.querySelector(".start").onclick=start;
  tool.querySelector(".pause").onclick=stop;
  tool.querySelector(".reset").onclick=()=>{stop(); remaining=rest; render()};
  if(painSelect){
    painSelect.onchange = ()=>{
      const isSharp = painSelect.value === "sharp";
      sharpWarning?.classList.toggle("hidden", !isSharp);
    };
  }
  const skipBtn = qs(".skip-exercise");
  if(skipBtn){
    skipBtn.onclick = ()=>{
      let sessions = loadSessions();
      sessions = skipExerciseInSession(sessions, sessionId, liftSlug);
      saveSessions(sessions);
      const workoutLetter = e.workout === "sub" ? workoutOf(liftSlug) : e.workout;
      setRoute(`#/workout/${workoutLetter}`);
    };
  }
  const chooseSub = qs(".choose-substitute");
  if(chooseSub){
    chooseSub.onclick = ()=> substituteModal?.classList.remove("hidden");
  }
  qs(".close-substitute")?.addEventListener("click", ()=> substituteModal?.classList.add("hidden"));
  document.querySelectorAll(".substitute-option").forEach((button)=>{
    button.onclick = ()=>{
      const substituteSlug = button.dataset.slug;
      const originalSlug = button.dataset.original;
      let sessions = loadSessions();
      sessions = addSubstitution(sessions, sessionId, originalSlug, substituteSlug);
      saveSessions(sessions);
      setRoute(`#/lift/${substituteSlug}`);
    };
  });
  tool.querySelector(".set-complete").onclick=()=>{
    if(reps<=0){alert("Add at least 1 rep before saving this set."); return}
    if(!sessionId){
      alert("Complete the readiness check and warm-up before saving sets.");
      return;
    }
    const effort = qs("#set-effort")?.value;
    const painDuringSet = qs("#set-pain")?.value;
    if(!effort){alert("Select effort for this set (1–10)."); return}
    if(!painDuringSet){alert("Select pain level for this set."); return}
    if(painDuringSet === "sharp"){
      sharpWarning?.classList.remove("hidden");
      return;
    }
    const weight = Number((tool.querySelector(".weight").value||"").replace(/[^0-9.]/g,""))||0;
    const entry = createSetEntry({
      lift: liftSlug,
      liftName: e.name,
      reps,
      weight,
      notes: tool.querySelector(".notes").value || "",
      effort: Number(effort),
      painDuringSet
    });
    let sessions = loadSessions();
    sessions = addSetToSession(sessions, sessionId, entry);
    sessions = setLiftFeedback(sessions, sessionId, liftSlug, {
      effort: Number(effort),
      painLevel: painDuringSet
    });
    saveSessions(sessions);
    reps = 0; render();
    if(shouldStartRestTimerAfterSet(painDuringSet)){
      remaining = rest; start();
    }
  };
  render();
}

async function syncSheets(){
  const status = qs("#status");
  const url = localStorage.getItem(SHEETS_URL_KEY) || DEFAULT_SHEETS_URL;
  if(!url || url.includes("PASTE_YOUR")){status.textContent="Add your Google Sheets Web App URL in Settings first.";return}
  const sessions = loadSessions();
  const unsynced = flattenSets(sessions).filter(x=>!x.synced);
  if(!unsynced.length){status.textContent="Everything is synced."; return}
  status.textContent=`Syncing ${unsynced.length} sets...`;
  try{
    const response = await fetch(url,{
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify({logs:unsynced})
    });
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if(!result.ok) throw new Error(result.error || "Sync rejected by server.");
    const ids = unsynced.map(x=>x.id);
    saveSessions(markSetsSynced(sessions, ids));
    const saved = result.saved ?? unsynced.length;
    status.textContent=saved===unsynced.length
      ? `Synced ${saved} sets.`
      : `Synced ${saved} new sets (${unsynced.length - saved} were already in the sheet).`;
    setTimeout(()=>setRoute(location.hash),500);
  }catch(e){
    status.textContent=`Sync failed: ${e.message || "Check URL and internet connection."}`;
  }
}

function exportCSV(){
  const sessions = loadSessions();
  const flat = flattenSets(sessions);
  const setHeaders=["timestamp","localTime","sessionId","workout","liftName","reps","weight","volume","notes","synced"];
  const setRows=[setHeaders.join(",")].concat(flat.map(x=>setHeaders.map(h=>`"${String(x[h]??"").replaceAll('"','""')}"`).join(",")));

  const bodyMetrics = loadBodyMetrics();
  const bodyHeaders=["date","weight","bodyFat","waist","source","notes","timestamp"];
  const bodyRows=[bodyHeaders.join(",")].concat(bodyMetrics.map(x=>bodyHeaders.map(h=>`"${String(x[h]??"").replaceAll('"','""')}"`).join(",")));

  const glucose = getGlucoseLog(sessions);
  const glucoseHeaders=["date","localTime","workout","glucosePre","glucosePost"];
  const glucoseRows=[glucoseHeaders.join(",")].concat(glucose.map(x=>glucoseHeaders.map(h=>`"${String(x[h]??"").replaceAll('"','""')}"`).join(",")));

  const content = [
    "Workout Sets",
    setRows.join("\n"),
    "",
    "Body Measurements",
    bodyRows.join("\n"),
    "",
    "Glucose Log",
    glucoseRows.join("\n")
  ].join("\n");

  const blob=new Blob([content],{type:"text/csv"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="workout-progress.csv"; a.click(); URL.revokeObjectURL(url);
}

window.addEventListener("hashchange",()=>setRoute(location.hash));
persistMigratedSessions();
setRoute(location.hash);

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.log));
}
