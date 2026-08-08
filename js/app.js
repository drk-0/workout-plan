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
} from "./health-integration.js";
import {
  normalizeReadiness,
  readinessIsComplete
} from "./readiness.js";
import { WARMUP_STEPS } from "./warmup.js";
import { normalizeRecovery } from "./recovery.js";
import { getSubstitutes } from "./substitutions.js";
import {
  prepareTimerAlert,
  stopTimerAlert,
  triggerTimerAlert
} from "./timer-alert.js";
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
import { escapeHTML, setSafeHTML } from "./safe-html.js";
import { csvCell } from "./spreadsheet-security.js";
import {
  APP_STORAGE_KEYS,
  createDataBackup,
  migrateLegacyStorage,
  requestPersistentStorage,
  restoreDataBackup
} from "./storage.js";

const SHEETS_URL_KEY = APP_STORAGE_KEYS.sheetsUrl;
const SHEETS_TOKEN_KEY = APP_STORAGE_KEYS.sheetsToken;
const DEFAULT_SHEETS_URL = "PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE";
const IOS_INSTALL_DISMISS_KEY = APP_STORAGE_KEYS.iosInstallDismissed;

let timerIntervals = {};
let wakeLock = null;
let activeTimers = 0;
let wakeLockOperation = Promise.resolve();

function qs(sel){return document.querySelector(sel)}
function fmt(s){s=Math.max(0,Number(s)||0);return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`}
function isValidSheetsUrl(value){
  try{
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "script.google.com" && url.pathname.startsWith("/macros/s/");
  }catch{
    return false;
  }
}
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
    if(timerIntervals[key]) clearInterval(timerIntervals[key]);
    delete timerIntervals[key];
  });
  activeTimers = 0;
  stopTimerAlert();
  releaseWakeLock();
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
function isTimedExercise(exercise){return exercise?.progression?.type === "time"}
function formatSetResult(set){
  return set.durationSeconds ? `${set.durationSeconds} sec` : `${set.reps} reps`;
}
function getSetsForPlannedLift(session, liftSlug){
  return (session?.sets || []).filter(set =>
    set.lift === liftSlug || set.substitutedFrom === liftSlug
  );
}
function getActiveSubstitute(session, originalSlug){
  return [...(session?.substitutions || [])]
    .reverse()
    .find(substitution => substitution.originalSlug === originalSlug)?.substituteSlug || null;
}
function isIOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone(){
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function showIOSInstallBanner(){
  if(!isIOS() || isStandalone()) return;
  if(localStorage.getItem(IOS_INSTALL_DISMISS_KEY) === "1") return;
  const banner = qs("#ios-install");
  const dismiss = qs("#ios-install-dismiss");
  if(!banner || !dismiss) return;
  banner.hidden = false;
  dismiss.onclick = ()=>{
    banner.hidden = true;
    localStorage.setItem(IOS_INSTALL_DISMISS_KEY, "1");
  };
}
async function requestWakeLock(){
  if(!("wakeLock" in navigator) || wakeLock) return;
  try{ wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", ()=>{ wakeLock = null; }); }catch{}
}
async function releaseWakeLock(){
  if(!wakeLock) return;
  try{ await wakeLock.release(); }catch{}
  wakeLock = null;
}
function syncWakeLock(){
  const shouldHoldLock = activeTimers > 0;
  wakeLockOperation = wakeLockOperation
    .catch(()=>{})
    .then(()=> shouldHoldLock ? requestWakeLock() : releaseWakeLock());
  return wakeLockOperation;
}

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
  let pageHtml;
  if(parts.length===0) pageHtml = home();
  else if(parts[0]==="readiness") pageHtml = readiness(parts[1] || "A");
  else if(parts[0]==="warmup") pageHtml = warmUp(parts[1] || "A");
  else if(parts[0]==="recovery") pageHtml = recovery();
  else if(parts[0]==="workout") pageHtml = workout(parts[1] || "A");
  else if(parts[0]==="lift"){
    if(parts[1] && exercise(parts[1])) {
      const originalSlug = parts[2] === "for" && exercise(parts[3]) ? parts[3] : null;
      pageHtml = lift(parts[1], originalSlug);
    }
    else{
      location.replace("#/");
      return;
    }
  }
  else if(parts[0]==="dashboard") pageHtml = dashboard();
  else if(parts[0]==="settings") pageHtml = settings();
  else pageHtml = home();
  setSafeHTML(app, pageHtml);
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
  const setsForLift = getSetsForPlannedLift(session, e.slug);
  const substituteSlug = getActiveSubstitute(session, e.slug);
  const done = session.completedLifts.includes(e.slug);
  const skipped = (session.skippedExercises || []).includes(e.slug);
  const status = skipped
    ? `<span class="lift-status">Skipped</span>`
    : done
      ? `<span class="lift-status done">Complete</span>`
      : setsForLift.length
        ? `<span class="lift-status in-progress">${setsForLift.length} set${setsForLift.length===1?"":"s"} logged</span>`
        : `<span class="lift-status">${e.subtitle}</span>`;
  const href = substituteSlug ? `#/lift/${substituteSlug}/for/${e.slug}` : `#/lift/${e.slug}`;
  return `<a class="lift-card${done?" lift-card-done":""}" href="${href}">
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
  return `<div id="substitute-modal" class="substitute-modal hidden" role="dialog" aria-modal="true" aria-labelledby="substitute-title">
    <div class="card">
      <h2 id="substitute-title">Choose a substitute</h2>
      <p>Easier options for ${exercise.name}:</p>
      <div class="action-grid">${options}</div>
      <button type="button" class="btn close-substitute">Back to ${exercise.name} (no change)</button>
    </div>
  </div>`;
}

function renderSetCounter(exercise, completedSets = 0){
  if(!isTimedExercise(exercise)){
    return `<div class="counter">
      <button class="minus" aria-label="Decrease reps">−</button>
      <div class="repbox"><span class="repnum">0</span><strong>reps</strong></div>
      <button class="plus" aria-label="Increase reps">+</button>
    </div>`;
  }

  const minimum = exercise.progression.durationMin || 30;
  const maximum = exercise.progression.durationMax || minimum;
  const totalRounds = exercise.progression.sets || 1;
  const currentRound = Math.min(completedSets + 1, totalRounds);
  const choices = [...new Set([minimum, maximum])];
  const presets = choices.map((seconds, index)=>
    `<button type="button" class="duration-preset${index===0?" duration-preset-active":""}" data-seconds="${seconds}" aria-pressed="${index===0}">${seconds} sec</button>`
  ).join("");
  return `<div class="exercise-timer" data-duration="${minimum}" data-total-rounds="${totalRounds}" data-completed-rounds="${completedSets}">
    <strong>Timed set</strong>
    <p class="round-status">Round ${currentRound} of ${totalRounds}</p>
    <div class="duration-presets" aria-label="Set duration">${presets}</div>
    <div class="work-time" role="timer">${fmt(minimum)}</div>
    <p class="exercise-timer-status" role="status" aria-live="assertive"></p>
    <div class="timer-controls">
      <button type="button" class="work-start">Start</button>
      <button type="button" class="work-pause">Pause</button>
      <button type="button" class="work-reset">Reset</button>
    </div>
  </div>`;
}

function lift(slug, originalSlug = null){
  const e = exercise(slug);
  if(!e){
    location.replace("#/");
    return "";
  }
  const originalExercise = originalSlug ? exercise(originalSlug) : null;
  const plannedExercise = originalExercise || e;
  const workoutLetter = plannedExercise.workout === "sub" ? workoutOf(plannedExercise.slug) : plannedExercise.workout;
  const session = gateActiveSession(workoutLetter);
  if(!session) return "";

  const savedSets = getSetsForLift(session, slug);
  const savedSummary = savedSets.length
    ? `<p class="saved-sets">Saved this session: ${savedSets.map(s=>`${formatSetResult(s)}${s.weight?` @ ${s.weight} lb`:""}${s.effort?` • effort ${s.effort}`:""}${s.painDuringSet && s.painDuringSet!=="none"?` • pain: ${s.painDuringSet}`:""}`).join(" • ")}</p>`
    : "";
  const lastSet = savedSets[0];
  const workoutExercises = getWorkoutExercises(workoutLetter);
  const idx = workoutExercises.findIndex(x=>x.slug===plannedExercise.slug);
  const navExercises = idx >= 0 ? workoutExercises : [...workoutExercises, plannedExercise];
  const navIdx = navExercises.findIndex(x=>x.slug===plannedExercise.slug);
  const prev = navExercises[(navIdx-1+navExercises.length)%navExercises.length].slug;
  const next = navExercises[(navIdx+1)%navExercises.length].slug;
  const cues = e.cues.map(c=>`<li>${c}</li>`).join("");
  const progressionState = loadProgression();
  const target = getExerciseTarget(progressionState, plannedExercise.slug, plannedExercise);
  const performedTarget = getExerciseTarget(progressionState, e.slug, e);
  const targetBanner = originalExercise
    ? `<div class="target-banner"><strong>Substituting for ${originalExercise.name}</strong><p class="target-banner-note">This set completes the planned exercise without changing its progression target.</p></div>`
    : renderTargetBanner(e, persistMigratedSessions(), target);
  const setTracking = renderSetTrackingControls();
  const substituteModal = renderSubstituteModal(e);
  const timedExercise = isTimedExercise(e);
  const defaultWeight = lastSet?.weight ?? performedTarget?.weight ?? target?.weight ?? "";
  const backHref = `#/workout/${workoutLetter}`;
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
    <div class="card tools" data-lift="${e.slug}" data-rest="${e.rest}" data-session="${session.id}" data-original="${plannedExercise.slug}" data-is-substitute="${Boolean(originalExercise)}" data-timed="${timedExercise}">
      <h2>${timedExercise?"Timed Set + Rest Timer":"Rep Counter + Rest Timer"}</h2>
      ${renderSetCounter(e, savedSets.length)}
      <div class="timer">
        <strong>Recommended rest: ${fmt(e.rest)}</strong>
        <div class="time rest-time" role="timer">${fmt(e.rest)}</div>
        <p class="timer-alert-status rest-timer-status" role="status" aria-live="assertive"></p>
        <div class="timer-controls">
          <button class="start">Start</button><button class="pause">Pause</button><button class="reset">Reset</button>
        </div>
      </div>
      <input class="weight" type="text" inputmode="decimal" autocomplete="off" placeholder="Weight used, e.g. 20" value="${defaultWeight}">
      <textarea class="notes" placeholder="Optional note for this set">${escapeHTML(lastSet?.notes || "")}</textarea>
      ${setTracking}
      <button class="set-complete">Save ${timedExercise?"Timed ":""}Set</button>
    </div>
    ${substituteModal}
    <a class="video" href="${e.video}" target="_blank" rel="noopener noreferrer">Open video in new tab</a>
    <div class="action-grid"><a class="secondary-btn" href="#/lift/${prev}">← Previous</a><a class="secondary-btn lift-next" href="#/lift/${next}" data-lift="${plannedExercise.slug}" data-performed-lift="${e.slug}" data-substitute="${Boolean(originalExercise)}">Next →</a></div>
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
            <b>${formatSetResult(set)}${set.weight ? ` @ ${set.weight} lb` : ""}</b>
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
            `<div class="history-item compact"><b>${x.liftName} — ${formatSetResult(x)}${x.weight ? ` @ ${x.weight} lb` : ""}</b><span>${x.localTime} • ${x.workout} • ${x.synced ? "Synced" : "Not synced"}</span></div>`
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
  const syncToken = localStorage.getItem(SHEETS_TOKEN_KEY) || "";
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
    <div class="card"><h2>Google Sheets Sync</h2><p>Paste your deployed Apps Script URL and the sync token configured in Script Properties.</p><label class="field-label" for="sheetsUrl">Web App URL</label><textarea id="sheetsUrl">${escapeHTML(url)}</textarea><label class="field-label" for="sheetsToken">Sync token</label><input id="sheetsToken" type="password" autocomplete="off" value="${escapeHTML(syncToken)}"><button class="btn" id="saveUrl">Save Sync Settings</button></div>
    <div class="card"><h2>Data Backup</h2><p>Workout and body-measurement data stays on this device. Export a backup regularly. Sync credentials are intentionally excluded.</p><button class="secondary-btn" id="backup-export" type="button">Export Backup</button><label class="secondary-btn" for="backup-import">Restore Backup</label><input id="backup-import" type="file" accept="application/json,.json" hidden></div>
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
      setSafeHTML(resultHost, renderSafetyWarning("Do not start this workout", READINESS_BLOCK_MESSAGE, `<p><strong>Reported:</strong> ${readiness.blockReasons.join(", ")}</p><a class="btn" href="#/">Return home</a>`));
      return;
    }

    savePendingReadiness(template, readiness);
    if(readiness.suggestedAdjustments.length){
      setSafeHTML(resultHost, `<div class="panel adjustment-panel">
        <h2>Suggested adjustments</h2>
        <p>These are suggestions only. Nothing changes unless you choose to follow them.</p>
        <ul>${readiness.suggestedAdjustments.map((item)=>`<li>${item}</li>`).join("")}</ul>
        <button class="btn readiness-continue" data-template="${template}">Continue to warm-up</button>
      </div>`);
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
  const saveUrl = qs("#saveUrl"); if(saveUrl) saveUrl.onclick = ()=>{
    const url = qs("#sheetsUrl").value.trim();
    if(!isValidSheetsUrl(url)){
      alert("Enter a valid HTTPS Apps Script Web App URL from script.google.com.");
      return;
    }
    const syncToken = qs("#sheetsToken").value.trim();
    if(syncToken.length < 24){
      alert("Use a sync token with at least 24 characters.");
      return;
    }
    localStorage.setItem(SHEETS_URL_KEY, url);
    localStorage.setItem(SHEETS_TOKEN_KEY, syncToken);
    alert("Sync settings saved.");
  };
  const backupExport = qs("#backup-export"); if(backupExport) backupExport.onclick = exportBackup;
  const backupImport = qs("#backup-import"); if(backupImport) backupImport.onchange = importBackup;
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
    const isSubstitute = next.dataset.substitute === "true";
    const sessionId = tool?.dataset.session;
    if(!liftSlug || !sessionId) return;
    let sessions = loadSessions();
    sessions = completeLiftInSession(sessions, sessionId, liftSlug);
    saveSessions(sessions);

    const ex = exercise(liftSlug);
    if (ex && !isSubstitute) {
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
  const originalSlug = tool.dataset.original || liftSlug;
  const isSubstitute = tool.dataset.isSubstitute === "true";
  const sessionId = tool.dataset.session;
  const timedExercise = isTimedExercise(e);
  const rep = tool.querySelector(".repnum");
  const time = tool.querySelector(".rest-time");
  const timerStatus = tool.querySelector(".rest-timer-status");
  const restStartButton = tool.querySelector(".start");
  const restPauseButton = tool.querySelector(".pause");
  const restResetButton = tool.querySelector(".reset");
  const setRestControlsEnabled=(enabled)=>{
    if(!timedExercise) return;
    [restStartButton, restPauseButton, restResetButton].forEach(button => {
      button.disabled = !enabled;
    });
  };
  const painSelect = qs("#set-pain");
  const sharpWarning = qs("#sharp-pain-warning");
  const substituteModal = qs("#substitute-modal");
  const workTimer = tool.querySelector(".exercise-timer");
  const workTime = tool.querySelector(".work-time");
  const workStatus = tool.querySelector(".exercise-timer-status");
  const workStartButton = tool.querySelector(".work-start");
  const roundStatus = tool.querySelector(".round-status");
  const totalRounds = +(workTimer?.dataset.totalRounds || 0);
  let completedRounds = +(workTimer?.dataset.completedRounds || 0);
  const updateRoundStatus=(message="")=>{
    if(!roundStatus) return;
    if(completedRounds >= totalRounds){
      roundStatus.textContent = `All ${totalRounds} rounds complete`;
      return;
    }
    roundStatus.textContent = message || `Round ${completedRounds + 1} of ${totalRounds}`;
  };
  let reps = 0, remaining = rest, endAt = null;
  const render=()=>{
    if(rep) rep.textContent=reps;
    time.textContent=fmt(remaining);
  };
  const stop=()=>{
    if(timerIntervals[liftSlug]){
      clearInterval(timerIntervals[liftSlug]);
      delete timerIntervals[liftSlug];
      activeTimers = Math.max(0, activeTimers - 1);
      syncWakeLock();
    }
    endAt = null;
  };
  const tick=()=>{
    if(endAt === null) return;
    remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    render();
    if(remaining <= 0){
      remaining = 0;
      render();
      stop();
      time.classList.add("timer-complete");
      timerStatus.textContent = "Rest complete";
      if(timedExercise && completedRounds < totalRounds){
        workStartButton.disabled = false;
        setRestControlsEnabled(false);
        updateRoundStatus(`Round ${completedRounds + 1} of ${totalRounds} — ready`);
      }
      triggerTimerAlert();
    }
  };
  const start=()=>{
    prepareTimerAlert();
    stopTimerAlert();
    stop();
    if(remaining<=0) remaining=rest;
    time.classList.remove("timer-complete");
    timerStatus.textContent = "";
    if(timedExercise) workStartButton.disabled = true;
    endAt = Date.now() + remaining * 1000;
    timerIntervals[liftSlug]=setInterval(tick, 250);
    activeTimers++;
    syncWakeLock();
    tick();
  };
  if(rep){
    tool.querySelector(".plus").onclick=()=>{reps++; render()};
    tool.querySelector(".minus").onclick=()=>{reps=Math.max(0,reps-1); render()};
  }
  restStartButton.onclick=start;
  restPauseButton.onclick=stop;
  restResetButton.onclick=()=>{
    stop();
    stopTimerAlert();
    remaining=rest;
    time.classList.remove("timer-complete");
    timerStatus.textContent = "";
    render();
  };

  let workTarget = +(workTimer?.dataset.duration || 0);
  let workRemaining = workTarget;
  let workEndAt = null;
  let durationCompleted = 0;
  const workIntervalKey = `${liftSlug}:work`;
  const renderWork=()=>{
    if(workTime) workTime.textContent=fmt(workRemaining);
  };
  const stopWork=()=>{
    if(timerIntervals[workIntervalKey]){
      clearInterval(timerIntervals[workIntervalKey]);
      delete timerIntervals[workIntervalKey];
      activeTimers = Math.max(0, activeTimers - 1);
      syncWakeLock();
    }
    workEndAt = null;
  };
  const tickWork=()=>{
    if(workEndAt === null) return;
    workRemaining = Math.max(0, Math.ceil((workEndAt - Date.now()) / 1000));
    durationCompleted = Math.max(durationCompleted, workTarget - workRemaining);
    renderWork();
    if(workRemaining <= 0){
      durationCompleted = workTarget;
      stopWork();
      workTime.classList.add("timer-complete");
      workStatus.textContent = `Round ${completedRounds + 1} complete — record effort and save`;
      triggerTimerAlert();
    }
  };
  const startWork=()=>{
    if(completedRounds >= totalRounds) return;
    stop();
    setRestControlsEnabled(false);
    prepareTimerAlert();
    stopTimerAlert();
    stopWork();
    if(workRemaining<=0){
      workRemaining=workTarget;
      durationCompleted=0;
    }
    workTime.classList.remove("timer-complete");
    workStatus.textContent = "";
    workEndAt = Date.now() + workRemaining * 1000;
    timerIntervals[workIntervalKey]=setInterval(tickWork, 250);
    activeTimers++;
    syncWakeLock();
    tickWork();
  };
  const resetWork=()=>{
    stopWork();
    stopTimerAlert();
    workRemaining=workTarget;
    durationCompleted=0;
    workTime?.classList.remove("timer-complete");
    if(workStatus) workStatus.textContent = "";
    renderWork();
  };
  workStartButton?.addEventListener("click", startWork);
  tool.querySelector(".work-pause")?.addEventListener("click", ()=>{
    tickWork();
    stopWork();
  });
  tool.querySelector(".work-reset")?.addEventListener("click", resetWork);
  tool.querySelectorAll(".duration-preset").forEach(button=>{
    button.onclick=()=>{
      stopWork();
      stopTimerAlert();
      workTarget=+button.dataset.seconds;
      workRemaining=workTarget;
      durationCompleted=0;
      workTimer.dataset.duration=String(workTarget);
      workTime.classList.remove("timer-complete");
      workStatus.textContent = "";
      tool.querySelectorAll(".duration-preset").forEach(option=>{
        const selected = option === button;
        option.classList.toggle("duration-preset-active", selected);
        option.setAttribute("aria-pressed", String(selected));
      });
      renderWork();
    };
  });
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
      sessions = skipExerciseInSession(sessions, sessionId, originalSlug);
      saveSessions(sessions);
      const workoutLetter = e.workout === "sub" ? workoutOf(liftSlug) : e.workout;
      setRoute(`#/workout/${workoutLetter}`);
    };
  }
  const chooseSub = qs(".choose-substitute");
  const closeSubstitute = ()=>{
    substituteModal?.classList.add("hidden");
    chooseSub?.focus();
  };
  if(chooseSub){
    chooseSub.onclick = ()=>{
      substituteModal?.classList.remove("hidden");
      substituteModal?.querySelector(".close-substitute")?.focus();
    };
  }
  qs(".close-substitute")?.addEventListener("click", closeSubstitute);
  if(substituteModal){
    substituteModal.onclick = event=>{
      if(event.target === substituteModal) closeSubstitute();
    };
    substituteModal.onkeydown = event=>{
      if(event.key === "Escape") closeSubstitute();
    };
  }
  document.querySelectorAll(".substitute-option").forEach((button)=>{
    button.onclick = ()=>{
      const substituteSlug = button.dataset.slug;
      const originalSlug = button.dataset.original;
      let sessions = loadSessions();
      sessions = addSubstitution(sessions, sessionId, originalSlug, substituteSlug);
      saveSessions(sessions);
      setRoute(`#/lift/${substituteSlug}/for/${originalSlug}`);
    };
  });
  const saveSetButton = tool.querySelector(".set-complete");
  saveSetButton.onclick=()=>{
    if(timedExercise && workEndAt !== null){
      tickWork();
      stopWork();
    }
    if(timedExercise && durationCompleted<=0){alert("Start the timed set before saving it."); return}
    if(!timedExercise && reps<=0){alert("Add at least 1 rep before saving this set."); return}
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
      durationSeconds: timedExercise ? durationCompleted : null,
      weight,
      notes: tool.querySelector(".notes").value || "",
      effort: Number(effort),
      painDuringSet,
      substitutedFrom: isSubstitute ? originalSlug : null
    });
    let sessions = loadSessions();
    sessions = addSetToSession(sessions, sessionId, entry);
    sessions = setLiftFeedback(sessions, sessionId, liftSlug, {
      effort: Number(effort),
      painLevel: painDuringSet
    });
    saveSessions(sessions);
    reps = 0;
    if(timedExercise){
      completedRounds++;
      workTimer.dataset.completedRounds=String(completedRounds);
      resetWork();
      updateRoundStatus();
      if(completedRounds >= totalRounds){
        workStartButton.disabled = true;
        saveSetButton.disabled = true;
        saveSetButton.textContent = "All Timed Rounds Saved";
      }
    }
    render();
    if(shouldStartRestTimerAfterSet(painDuringSet) && (!timedExercise || completedRounds < totalRounds)){
      if(timedExercise) updateRoundStatus(`Round ${completedRounds} saved — rest before round ${completedRounds + 1}`);
      setRestControlsEnabled(true);
      remaining = rest; start();
    }
  };
  if(timedExercise && completedRounds >= totalRounds){
    workStartButton.disabled = true;
    saveSetButton.disabled = true;
    saveSetButton.textContent = "All Timed Rounds Saved";
    updateRoundStatus();
  }
  if(timedExercise && completedRounds < totalRounds){
    setRestControlsEnabled(false);
  }
  render();
}

async function syncSheets(){
  const status = qs("#status");
  const url = localStorage.getItem(SHEETS_URL_KEY) || DEFAULT_SHEETS_URL;
  const syncToken = localStorage.getItem(SHEETS_TOKEN_KEY) || "";
  if(!url || url.includes("PASTE_YOUR")){status.textContent="Add your Google Sheets Web App URL in Settings first.";return}
  if(!isValidSheetsUrl(url)){status.textContent="The saved Google Sheets URL is invalid. Update it in Settings.";return}
  if(syncToken.length < 24){status.textContent="Add a sync token of at least 24 characters in Settings.";return}
  const sessions = loadSessions();
  const unsynced = flattenSets(sessions).filter(x=>!x.synced);
  if(!unsynced.length){status.textContent="Everything is synced."; return}
  status.textContent=`Syncing ${unsynced.length} sets...`;
  try{
    const response = await fetch(url,{
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify({token:syncToken,logs:unsynced})
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

function exportBackup(){
  const blob = new Blob([createDataBackup()], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `workout-plan-backup-${new Date().toISOString().slice(0,10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importBackup(event){
  const input = event.currentTarget;
  const file = input.files?.[0];
  if(!file) return;
  try{
    if(!confirm("Restore this backup? Existing workout data in matching sections will be replaced.")) return;
    const restored = restoreDataBackup(await file.text());
    alert(`Backup restored (${restored} data sections).`);
    setRoute("#/settings");
  }catch(error){
    alert(`Restore failed: ${error.message}`);
  }finally{
    input.value = "";
  }
}

function exportCSV(){
  const sessions = loadSessions();
  const flat = flattenSets(sessions);
  const setHeaders=["timestamp","localTime","sessionId","workout","liftName","reps","durationSeconds","weight","volume","notes","synced"];
  const setRows=[setHeaders.join(",")].concat(flat.map(x=>setHeaders.map(h=>csvCell(x[h])).join(",")));

  const bodyMetrics = loadBodyMetrics();
  const bodyHeaders=["date","weight","bodyFat","waist","source","notes","timestamp"];
  const bodyRows=[bodyHeaders.join(",")].concat(bodyMetrics.map(x=>bodyHeaders.map(h=>csvCell(x[h])).join(",")));

  const glucose = getGlucoseLog(sessions);
  const glucoseHeaders=["date","localTime","workout","glucosePre","glucosePost"];
  const glucoseRows=[glucoseHeaders.join(",")].concat(glucose.map(x=>glucoseHeaders.map(h=>csvCell(x[h])).join(",")));

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
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState === "visible") syncWakeLock();
});
window.addEventListener("pagehide", releaseWakeLock);
migrateLegacyStorage();
persistMigratedSessions();
requestPersistentStorage();
setRoute(location.hash);
showIOSInstallBanner();

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.log));
}
