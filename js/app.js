import { EXERCISES } from "./exercises.js";
import { renderBarChart, renderLineChart } from "./charts.js";
import {
  evaluateProgression,
  formatSuggestionTitle,
  SUGGESTION_TYPES
} from "./progression.js";
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
  HISTORY_KEY,
  addSetToSession,
  calculateMetrics,
  completeLiftInSession,
  completeSession,
  createSetEntry,
  ensureActiveSession,
  flattenSets,
  getActiveSession,
  getSetsForLift,
  markSetsSynced,
  normalizeHistory,
  normalizeLiftFeedback,
  setLiftFeedback
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
  return normalized;
}
function clearAllTimers(){
  Object.keys(timerIntervals).forEach((key)=>{
    clearInterval(timerIntervals[key]);
    delete timerIntervals[key];
  });
}
function img(slug){return `assets/exercises/${slug}.png`}
function workoutOf(slug){return EXERCISES.find(e=>e.slug===slug)?.workout || "A"}
function exercise(slug){return EXERCISES.find(e=>e.slug===slug)}

function setRoute(hash){
  clearAllTimers();
  const app = qs("#app");
  const route = (hash || "#/").replace(/^#\/?/,"");
  const parts = route.split("/").filter(Boolean);
  if(parts.length===0) app.innerHTML = home();
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
  const active = getActiveSession(persistMigratedSessions());
  const activeBanner = active
    ? `<div class="session-banner"><strong>Session in progress:</strong> ${active.workout} • ${active.sets.length} sets logged • ${active.completedLifts.length} exercises done <a href="#/workout/${active.template}">Resume</a></div>`
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
      <div class="goal"><b>Dashboard</b><span>Track history, reps, volume, and progress.</span></div>
    </div>
    <div class="action-grid">
      <a class="btn" href="#/workout/A">Workout A<br><small>Push + legs</small></a>
      <a class="btn" href="#/workout/B">Workout B<br><small>Pull + legs</small></a>
    </div>
    <div class="panel"><h2>Today's Rule</h2><p>Train clean. Stop with 1–3 good reps left. The app suggests conservative progression — you decide whether to follow it.</p></div>
    <div class="panel"><h2>Settings</h2><a class="secondary-btn" href="#/settings">Google Sheets Setup</a></div>
  </section>`;
}

function workout(letter){
  const normalizedLetter = String(letter || "A").toUpperCase();
  let sessions = persistMigratedSessions();
  const ensured = ensureActiveSession(sessions, normalizedLetter);
  if(ensured.created || JSON.stringify(sessions) !== JSON.stringify(ensured.sessions)){
    sessions = ensured.sessions;
    saveSessions(sessions);
  }
  const session = ensured.session;
  const list = EXERCISES.filter(e=>e.workout===normalizedLetter).map(e=>card(e, session)).join("");
  const finishBtn = session.endedAt === null
    ? `<div class="panel finish-panel">
        <h2>Finish Workout</h2>
        <p class="lede">Optional notes for your records. These fields are for personal tracking only — not medical advice.</p>
        <label class="field-label" for="wellness-weight">Body weight (lb)</label>
        <input id="wellness-weight" type="number" inputmode="decimal" placeholder="e.g. 182">
        <label class="field-label" for="wellness-waist">Waist (in)</label>
        <input id="wellness-waist" type="number" inputmode="decimal" placeholder="e.g. 36">
        <label class="field-label" for="wellness-glucose-pre">Pre-workout glucose (mg/dL)</label>
        <input id="wellness-glucose-pre" type="number" inputmode="decimal" placeholder="Optional">
        <label class="field-label" for="wellness-glucose-post">Post-workout glucose (mg/dL)</label>
        <input id="wellness-glucose-post" type="number" inputmode="decimal" placeholder="Optional">
        <button class="btn finish-workout" data-session="${session.id}">Complete Workout</button>
      </div>`
    : "";
  return `<section>
    <div class="topbar"><a href="#/">← Home</a><span>Workout ${normalizedLetter}</span></div>
    <h1>Workout ${normalizedLetter}</h1>
    <p class="lede">${normalizedLetter==="A"?"Push + legs":"Pull + legs"}. Tap any lift for timer, rep counter, cues, logging, and video.</p>
    <div class="session-banner in-progress"><strong>Session active</strong> • ${session.sets.length} sets saved • ${session.completedLifts.length} exercises complete</div>
    <div class="lift-list">${list}</div>
    ${finishBtn}
  </section>`;
}

function card(e, session){
  const setsForLift = getSetsForLift(session, e.slug);
  const done = session.completedLifts.includes(e.slug);
  const status = done
    ? `<span class="lift-status done">Complete</span>`
    : setsForLift.length
      ? `<span class="lift-status in-progress">${setsForLift.length} set${setsForLift.length===1?"":"s"} logged</span>`
      : `<span class="lift-status">${e.subtitle}</span>`;
  return `<a class="lift-card${done?" lift-card-done":""}" href="#/lift/${e.slug}">
    <img src="${img(e.slug)}" alt="${e.name}">
    <div><h3>${e.name}</h3><p>${e.sets}</p>${status}</div>
  </a>`;
}

function renderProgressionCard(exercise, sessions) {
  const suggestion = evaluateProgression(sessions, exercise);
  const confirmButtons =
    suggestion.type === SUGGESTION_TYPES.INCREASE_WEIGHT && suggestion.suggestedWeight
      ? `<div class="progression-actions">
          <button class="btn progression-apply" type="button" data-weight="${suggestion.suggestedWeight}">Use ${suggestion.suggestedWeight} lb</button>
          <button class="secondary-btn progression-dismiss" type="button">Keep ${suggestion.currentWeight} lb</button>
        </div>
        <p class="progression-note">Weight changes only apply when you confirm. Nothing is saved automatically.</p>`
      : "";

  return `<div class="progression-card" data-suggestion-type="${suggestion.type}">
    <h2>${formatSuggestionTitle(suggestion)}</h2>
    <p class="progression-message">${suggestion.message}</p>
    <p class="progression-suggestion"><strong>Suggestion:</strong> ${suggestion.suggestion}</p>
    ${confirmButtons}
  </div>`;
}

function renderEffortControls(session, slug) {
  const feedback = session.liftFeedback?.[slug] || {};
  const effort = feedback.effort ?? "";
  const painChecked = feedback.pain ? " checked" : "";
  const effortOptions = Array.from({ length: 10 }, (_, index) => {
    const value = index + 1;
    const selected = effort === value ? " selected" : "";
    return `<option value="${value}"${selected}>${value}/10</option>`;
  }).join("");

  return `<div class="effort-panel">
    <h2>How did it feel?</h2>
    <p class="panel-note">Optional. Used for conservative progression suggestions — not medical advice.</p>
    <label class="field-label" for="lift-effort">Effort (1 = easy, 10 = max)</label>
    <select id="lift-effort" class="dash-select effort-select">
      <option value="">Not logged</option>
      ${effortOptions}
    </select>
    <label class="pain-check">
      <input id="lift-pain" type="checkbox"${painChecked}>
      <span>Pain or sharp discomfort during this exercise</span>
    </label>
  </div>`;
}

function lift(slug){
  const e = exercise(slug);
  let sessions = persistMigratedSessions();
  let session = getActiveSession(sessions);
  if(!session || session.template !== e.workout){
    const ensured = ensureActiveSession(sessions, e.workout);
    sessions = ensured.sessions;
    saveSessions(sessions);
    session = ensured.session;
  }
  const savedSets = getSetsForLift(session, slug);
  const savedSummary = savedSets.length
    ? `<p class="saved-sets">Saved this session: ${savedSets.map(s=>`${s.reps} reps${s.weight?` @ ${s.weight} lb`:""}`).join(" • ")}</p>`
    : "";
  const lastSet = savedSets[0];
  const workoutExercises = EXERCISES.filter(x=>x.workout===e.workout);
  const idx = workoutExercises.findIndex(x=>x.slug===e.slug);
  const prev = workoutExercises[(idx-1+workoutExercises.length)%workoutExercises.length].slug;
  const next = workoutExercises[(idx+1)%workoutExercises.length].slug;
  const cues = e.cues.map(c=>`<li>${c}</li>`).join("");
  const progressionCard = renderProgressionCard(e, sessions);
  const effortControls = renderEffortControls(session, slug);
  return `<section>
    <div class="topbar"><a href="#/workout/${e.workout}">← Workout ${e.workout}</a><span>${e.name}</span></div>
    <div class="art"><img src="${img(e.slug)}" alt="${e.name}"></div>
    <h1>${e.name}</h1>
    <p class="lede">${e.subtitle}</p>
    <div class="sets">${e.sets}</div>
    ${progressionCard}
    ${savedSummary}
    <div class="card"><h2>How to do it</h2><p>${e.instructions}</p></div>
    <div class="card"><h2>Form cues</h2><ul>${cues}</ul></div>
    <div class="card tools" data-lift="${e.slug}" data-rest="${e.rest}" data-session="${session.id}">
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
      <input class="weight" placeholder="Weight used, e.g. 20" value="${lastSet?.weight || ""}">
      <textarea class="notes" placeholder="Notes">${lastSet?.notes || ""}</textarea>
      <button class="set-complete">Save Set + Start Timer</button>
    </div>
    ${effortControls}
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
        .map(
          (entry) => `<div class="history-item compact">
            <b>${entry.date}</b>
            <span>${entry.weight != null ? `${entry.weight} lb` : "—"}${entry.waist != null ? ` • waist ${entry.waist} in` : ""}${entry.notes ? ` • ${entry.notes}` : ""}</span>
          </div>`
        )
        .join("")
    : emptyState("No body measurements yet", "Log weight or waist below, or add them when you finish a workout.");

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
      <p class="panel-note">Track weight and waist over time. Not a substitute for professional care.</p>
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
  return `<section>
    <div class="topbar"><a href="#/">← Home</a><span>Settings</span></div>
    <h1>Settings</h1>
    <div class="card"><h2>Google Sheets Web App URL</h2><p>Paste your deployed Google Apps Script Web App URL here.</p><textarea id="sheetsUrl">${url}</textarea><button class="btn" id="saveUrl">Save URL</button></div>
  </section>`;
}

function bindPage(){
  const tool = qs(".tools");
  if(tool) bindTool(tool);
  const sync = qs("#sync"); if(sync) sync.onclick = syncSheets;
  const csv = qs("#csv"); if(csv) csv.onclick = exportCSV;
  const saveUrl = qs("#saveUrl"); if(saveUrl) saveUrl.onclick = ()=>{localStorage.setItem(SHEETS_URL_KEY, qs("#sheetsUrl").value.trim()); alert("Saved.");};
  const finish = qs(".finish-workout");
  if(finish) finish.onclick = ()=>{
    const sessionId = finish.dataset.session;
    let sessions = loadSessions();
    const wellness = normalizeWellness({
      bodyWeight: qs("#wellness-weight")?.value,
      waistInches: qs("#wellness-waist")?.value,
      glucosePre: qs("#wellness-glucose-pre")?.value,
      glucosePost: qs("#wellness-glucose-post")?.value
    });
    sessions = completeSession(sessions, sessionId, new Date().toISOString(), wellness);
    saveSessions(sessions);
    setRoute("#/");
  };
  const next = qs(".lift-next");
  if(next) next.addEventListener("click", ()=>{
    const liftSlug = next.dataset.lift;
    const sessionId = tool?.dataset.session;
    if(!liftSlug || !sessionId) return;
    let sessions = loadSessions();
    sessions = saveLiftFeedbackFromForm(sessions, sessionId, liftSlug);
    sessions = completeLiftInSession(sessions, sessionId, liftSlug);
    saveSessions(sessions);
  });
  bindDashboard();
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
    pain: qs("#lift-pain")?.checked
  });
  if (!feedback) return sessions;
  return setLiftFeedback(sessions, sessionId, liftSlug, feedback);
}

function bindProgressionControls(tool) {
  const apply = qs(".progression-apply");
  if (apply) {
    apply.onclick = () => {
      const weightInput = tool?.querySelector(".weight");
      if (weightInput) {
        weightInput.value = apply.dataset.weight || "";
        weightInput.focus();
      }
    };
  }

  const dismiss = qs(".progression-dismiss");
  if (dismiss) {
    dismiss.onclick = () => {
      const card = qs(".progression-card");
      if (card) {
        card.classList.add("progression-dismissed");
        const note = document.createElement("p");
        note.className = "progression-note";
        note.textContent = "Keeping your current weight. You can revisit this suggestion next time.";
        card.appendChild(note);
        dismiss.remove();
        apply?.remove();
      }
    };
  }
}

function bindTool(tool){
  const liftSlug = tool.dataset.lift, e = exercise(liftSlug), rest = +tool.dataset.rest;
  const sessionId = tool.dataset.session;
  const rep = tool.querySelector(".repnum"), time = tool.querySelector(".time");
  let reps = 0, remaining = rest;
  const render=()=>{rep.textContent=reps; time.textContent=fmt(remaining)};
  const stop=()=>{clearInterval(timerIntervals[liftSlug]); delete timerIntervals[liftSlug]};
  const start=()=>{stop(); if(remaining<=0) remaining=rest; timerIntervals[liftSlug]=setInterval(()=>{remaining--; render(); if(remaining<=0){remaining=0; render(); stop(); if(navigator.vibrate) navigator.vibrate([250,120,250]);}},1000)};
  tool.querySelector(".plus").onclick=()=>{reps++; render()};
  tool.querySelector(".minus").onclick=()=>{reps=Math.max(0,reps-1); render()};
  tool.querySelector(".start").onclick=start;
  tool.querySelector(".pause").onclick=stop;
  tool.querySelector(".reset").onclick=()=>{stop(); remaining=rest; render()};
  tool.querySelector(".set-complete").onclick=()=>{
    if(reps<=0){alert("Add at least 1 rep before saving this set."); return}
    if(!sessionId){
      alert("Start Workout A or Workout B before saving sets.");
      return;
    }
    const weight = Number((tool.querySelector(".weight").value||"").replace(/[^0-9.]/g,""))||0;
    const entry = createSetEntry({
      lift: liftSlug,
      liftName: e.name,
      reps,
      weight,
      notes: tool.querySelector(".notes").value || ""
    });
    let sessions = loadSessions();
    sessions = addSetToSession(sessions, sessionId, entry);
    sessions = saveLiftFeedbackFromForm(sessions, sessionId, liftSlug);
    saveSessions(sessions);
    reps = 0; render();
    remaining = rest; start();
  };
  bindProgressionControls(tool);
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
  const bodyHeaders=["date","weight","waist","notes","timestamp"];
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
