import { EXERCISES } from "./exercises.js";

const SHEETS_URL_KEY = "googleSheetsWebAppUrl";
const DEFAULT_SHEETS_URL = "PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE";

let timerIntervals = {};

function qs(sel){return document.querySelector(sel)}
function fmt(s){s=Math.max(0,Number(s)||0);return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`}
function logs(){try{return JSON.parse(localStorage.getItem("workoutHistory")||"[]")}catch{return[]}}
function saveLogs(v){localStorage.setItem("workoutHistory",JSON.stringify(v))}
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
  return `<section>
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
    <div class="panel"><h2>Today's Rule</h2><p>Train clean. Stop with 1–3 good reps left. When you hit the top of the rep range with good form, move up in weight.</p></div>
    <div class="panel"><h2>Settings</h2><a class="secondary-btn" href="#/settings">Google Sheets Setup</a></div>
  </section>`;
}

function workout(letter){
  const list = EXERCISES.filter(e=>e.workout===letter).map(e=>card(e)).join("");
  return `<section>
    <div class="topbar"><a href="#/">← Home</a><span>Workout ${letter}</span></div>
    <h1>Workout ${letter}</h1>
    <p class="lede">${letter==="A"?"Push + legs":"Pull + legs"}. Tap any lift for timer, rep counter, cues, logging, and video.</p>
    <div class="lift-list">${list}</div>
  </section>`;
}

function card(e){
  return `<a class="lift-card" href="#/lift/${e.slug}">
    <img src="${img(e.slug)}" alt="${e.name}">
    <div><h3>${e.name}</h3><p>${e.sets}</p><span>${e.subtitle}</span></div>
  </a>`;
}

function lift(slug){
  const e = exercise(slug);
  const workoutExercises = EXERCISES.filter(x=>x.workout===e.workout);
  const idx = workoutExercises.findIndex(x=>x.slug===e.slug);
  const prev = workoutExercises[(idx-1+workoutExercises.length)%workoutExercises.length].slug;
  const next = workoutExercises[(idx+1)%workoutExercises.length].slug;
  const cues = e.cues.map(c=>`<li>${c}</li>`).join("");
  return `<section>
    <div class="topbar"><a href="#/workout/${e.workout}">← Workout ${e.workout}</a><span>${e.name}</span></div>
    <div class="art"><img src="${img(e.slug)}" alt="${e.name}"></div>
    <h1>${e.name}</h1>
    <p class="lede">${e.subtitle}</p>
    <div class="sets">${e.sets}</div>
    <div class="card"><h2>How to do it</h2><p>${e.instructions}</p></div>
    <div class="card"><h2>Form cues</h2><ul>${cues}</ul></div>
    <div class="card tools" data-lift="${e.slug}" data-rest="${e.rest}">
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
      <input class="weight" placeholder="Weight used, e.g. 20">
      <textarea class="notes" placeholder="Notes"></textarea>
      <button class="set-complete">Save Set + Start Timer</button>
    </div>
    <a class="video" href="${e.video}" target="_blank" rel="noopener noreferrer">Open video in new tab</a>
    <div class="action-grid"><a class="secondary-btn" href="#/lift/${prev}">← Previous</a><a class="secondary-btn" href="#/lift/${next}">Next →</a></div>
  </section>`;
}

function dashboard(){
  const l = logs();
  const totalReps = l.reduce((s,x)=>s+(+x.reps||0),0);
  const volume = l.reduce((s,x)=>s+(+x.volume||0),0);
  const byLift = {};
  l.forEach(x=>byLift[x.liftName]=(byLift[x.liftName]||0)+(+x.volume||0));
  const max = Math.max(...Object.values(byLift),1);
  const bars = Object.entries(byLift).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([name,v])=>`<div class="bar-row"><strong>${name}</strong><div class="bar" style="width:${Math.max(5, v/max*100)}%"></div><small>${Math.round(v)} lb-reps</small></div>`).join("");
  const recent = l.slice(0,30).map(x=>`<div class="history-item"><b>${x.liftName} — ${x.reps} reps${x.weight?` @ ${x.weight} lb`:""}</b><span>${x.localTime} • ${x.workout} • ${x.synced?"Synced":"Not synced"}</span></div>`).join("") || "<p>No saved sets yet.</p>";
  return `<section>
    <div class="topbar"><a href="#/">← Home</a><span>Dashboard</span></div>
    <h1>Dashboard</h1>
    <div class="metric-grid">
      <div class="metric"><b>${l.length}</b><span>saved sets</span></div>
      <div class="metric"><b>${totalReps}</b><span>total reps</span></div>
      <div class="metric"><b>${Math.round(volume)}</b><span>estimated volume</span></div>
      <div class="metric"><b>${l.filter(x=>!x.synced).length}</b><span>unsynced sets</span></div>
    </div>
    <div class="panel"><h2>Volume by Lift</h2><div class="chart">${bars || "No volume yet."}</div></div>
    <div class="panel"><h2>Sync + Export</h2><button class="btn" id="sync">Sync to Google Sheets</button><button class="secondary-btn" id="csv">Export CSV</button><p id="status" class="lede"></p></div>
    <div class="panel"><h2>Recent History</h2>${recent}</div>
  </section>`;
}

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
}

function bindTool(tool){
  const liftSlug = tool.dataset.lift, e = exercise(liftSlug), rest = +tool.dataset.rest;
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
    const weight = Number((tool.querySelector(".weight").value||"").replace(/[^0-9.]/g,""))||0;
    const now = new Date();
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: now.toISOString(),
      localTime: now.toLocaleString(),
      workout: `Workout ${e.workout}`,
      lift: liftSlug,
      liftName: e.name,
      reps,
      weight,
      volume: reps * weight,
      notes: tool.querySelector(".notes").value || "",
      trigger: "set_complete",
      synced: false
    };
    const l = logs(); l.unshift(entry); saveLogs(l);
    reps = 0; render();
    remaining = rest; start();
  };
  render();
}

async function syncSheets(){
  const status = qs("#status");
  const url = localStorage.getItem(SHEETS_URL_KEY) || DEFAULT_SHEETS_URL;
  if(!url || url.includes("PASTE_YOUR")){status.textContent="Add your Google Sheets Web App URL in Settings first.";return}
  const l = logs(), unsynced = l.filter(x=>!x.synced);
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
    const ids = new Set(unsynced.map(x=>x.id));
    saveLogs(l.map(x=>ids.has(x.id)?{...x,synced:true}:x));
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
  const l=logs(), headers=["timestamp","localTime","workout","liftName","reps","weight","volume","notes","synced"];
  const rows=[headers.join(",")].concat(l.map(x=>headers.map(h=>`"${String(x[h]??"").replaceAll('"','""')}"`).join(",")));
  const blob=new Blob([rows.join("\n")],{type:"text/csv"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="workout-history.csv"; a.click(); URL.revokeObjectURL(url);
}

window.addEventListener("hashchange",()=>setRoute(location.hash));
setRoute(location.hash);

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.log));
}
