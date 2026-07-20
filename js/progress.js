import { flattenSets, localDateKey } from "./workout-data.js";

export const BODY_METRICS_KEY = "bodyMetrics";

export function isCompletedWorkout(session) {
  return Boolean(session?.endedAt) || (session?.sets?.length > 0);
}

export function getWeekStart(dateInput) {
  const date = new Date(dateInput);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function weekKey(dateInput) {
  return localDateKey(getWeekStart(dateInput));
}

export function formatShortDate(dateInput) {
  const date = new Date(dateInput);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatWeekLabel(dateInput) {
  const start = getWeekStart(dateInput);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${formatShortDate(start)}–${formatShortDate(end)}`;
}

export function getCompletedSessions(sessions) {
  return (sessions || []).filter(isCompletedWorkout);
}

export function countWorkoutsThisWeek(sessions, now = new Date()) {
  const currentWeek = weekKey(now);
  return getCompletedSessions(sessions).filter((session) => {
    const stamp = session.endedAt || session.startedAt;
    return weekKey(stamp) === currentWeek;
  }).length;
}

export function calculateConsistencyStreak(sessions, now = new Date()) {
  const completed = getCompletedSessions(sessions);
  if (!completed.length) return 0;

  const weeksWithWorkouts = new Set(
    completed.map((session) => weekKey(session.endedAt || session.startedAt))
  );

  let streak = 0;
  const cursor = getWeekStart(now);

  const currentWeek = weekKey(cursor);
  if (!weeksWithWorkouts.has(currentWeek)) {
    cursor.setDate(cursor.getDate() - 7);
  }

  while (weeksWithWorkouts.has(weekKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 7);
  }

  return streak;
}

export function getWeeklyTrend(sessions, weeks = 12, now = new Date()) {
  const completed = getCompletedSessions(sessions);
  const points = [];

  for (let index = weeks - 1; index >= 0; index -= 1) {
    const start = getWeekStart(now);
    start.setDate(start.getDate() - index * 7);
    const key = weekKey(start);
    const count = completed.filter((session) => weekKey(session.endedAt || session.startedAt) === key).length;
    const volume = completed
      .filter((session) => weekKey(session.endedAt || session.startedAt) === key)
      .reduce((sum, session) => sum + (session.sets || []).reduce((setSum, set) => setSum + (+set.volume || 0), 0), 0);

    points.push({
      weekStart: key,
      label: formatShortDate(start),
      workouts: count,
      volume: Math.round(volume)
    });
  }

  return points;
}

export function getLiftHistory(sessions, liftSlug) {
  return flattenSets(sessions).filter((set) => set.lift === liftSlug);
}

export function getLiftBests(sessions, liftSlug) {
  const history = getLiftHistory(sessions, liftSlug);
  if (!history.length) {
    return { bestWeight: null, bestReps: null, bestVolume: null, setCount: 0 };
  }

  let bestWeight = null;
  let bestReps = null;
  let bestVolume = null;

  for (const set of history) {
    const weight = +set.weight || 0;
    const reps = +set.reps || 0;
    const volume = +set.volume || weight * reps;

    if (weight > 0 && (bestWeight === null || weight > bestWeight)) bestWeight = weight;
    if (reps > 0 && (bestReps === null || reps > bestReps)) bestReps = reps;
    if (volume > 0 && (bestVolume === null || volume > bestVolume)) bestVolume = volume;
  }

  return { bestWeight, bestReps, bestVolume, setCount: history.length };
}

export function loadBodyMetrics() {
  try {
    const raw = JSON.parse(localStorage.getItem(BODY_METRICS_KEY) || "[]");
    return Array.isArray(raw) ? raw.sort((a, b) => new Date(b.date) - new Date(a.date)) : [];
  } catch {
    return [];
  }
}

export function saveBodyMetrics(entries) {
  localStorage.setItem(BODY_METRICS_KEY, JSON.stringify(entries));
}

export function createBodyMetricEntry({ date, weight, waist, notes, now = new Date() }) {
  const weightNum = weight === "" || weight == null ? null : Number(weight);
  const waistNum = waist === "" || waist == null ? null : Number(waist);
  return {
    id: `metric-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date: date || localDateKey(now),
    timestamp: now.toISOString(),
    weight: Number.isFinite(weightNum) ? weightNum : null,
    waist: Number.isFinite(waistNum) ? waistNum : null,
    notes: notes || ""
  };
}

export function addBodyMetric(entry) {
  const entries = loadBodyMetrics();
  entries.unshift(entry);
  saveBodyMetrics(entries);
  return entries;
}

export function getBodyMetricsTimeline(sessions) {
  const standalone = loadBodyMetrics();
  const fromSessions = getCompletedSessions(sessions)
    .filter((session) => session.wellness?.bodyWeight != null || session.wellness?.waistInches != null)
    .map((session) => ({
      id: `session-${session.id}`,
      date: localDateKey(session.endedAt || session.startedAt),
      timestamp: session.endedAt || session.startedAt,
      weight: session.wellness?.bodyWeight ?? null,
      waist: session.wellness?.waistInches ?? null,
      notes: "Logged with workout",
      source: "workout"
    }));

  const merged = [...standalone, ...fromSessions];
  const byDate = new Map();
  for (const item of merged) {
    const existing = byDate.get(item.date);
    if (!existing || new Date(item.timestamp) > new Date(existing.timestamp)) {
      byDate.set(item.date, item);
    }
  }

  return [...byDate.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
}

export function getGlucoseLog(sessions) {
  return getCompletedSessions(sessions)
    .filter((session) => session.wellness?.glucosePre != null || session.wellness?.glucosePost != null)
    .map((session) => ({
      id: session.id,
      date: localDateKey(session.endedAt || session.startedAt),
      localTime: new Date(session.endedAt || session.startedAt).toLocaleString(),
      workout: session.workout,
      glucosePre: session.wellness?.glucosePre ?? null,
      glucosePost: session.wellness?.glucosePost ?? null
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

export function normalizeWellness(raw) {
  if (!raw || typeof raw !== "object") return undefined;

  const out = {};
  const glucosePre = raw.glucosePre === "" || raw.glucosePre == null ? null : Number(raw.glucosePre);
  const glucosePost = raw.glucosePost === "" || raw.glucosePost == null ? null : Number(raw.glucosePost);
  const bodyWeight = raw.bodyWeight === "" || raw.bodyWeight == null ? null : Number(raw.bodyWeight);
  const waistInches = raw.waistInches === "" || raw.waistInches == null ? null : Number(raw.waistInches);

  if (Number.isFinite(glucosePre)) out.glucosePre = glucosePre;
  if (Number.isFinite(glucosePost)) out.glucosePost = glucosePost;
  if (Number.isFinite(bodyWeight)) out.bodyWeight = bodyWeight;
  if (Number.isFinite(waistInches)) out.waistInches = waistInches;

  return Object.keys(out).length ? out : undefined;
}
