export const HISTORY_KEY = "workoutHistory";

export function isLegacyLogEntry(entry) {
  return entry && typeof entry.reps === "number" && !Array.isArray(entry.sets);
}

export function isSession(entry) {
  return entry && Array.isArray(entry.sets);
}

export function workoutLabel(template) {
  return `Workout ${String(template).toUpperCase()}`;
}

export function parseWorkoutTemplate(label) {
  const match = String(label || "").match(/Workout\s+([AB])/i);
  return match ? match[1].toUpperCase() : null;
}

export function localDateKey(isoOrDate) {
  const date = new Date(isoOrDate);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function volumeForSet(reps, weight) {
  return (+reps || 0) * (+weight || 0);
}

export function createSetEntry({ lift, liftName, reps, weight, notes, trigger = "set_complete", now = new Date() }) {
  const repsNum = +reps || 0;
  const weightNum = +weight || 0;
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: now.toISOString(),
    localTime: now.toLocaleString(),
    lift,
    liftName,
    reps: repsNum,
    weight: weightNum,
    volume: volumeForSet(repsNum, weightNum),
    notes: notes || "",
    trigger,
    synced: false
  };
}

export function createSession(template, startedAt = new Date().toISOString()) {
  const letter = String(template).toUpperCase();
  return {
    id: `session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    template: letter,
    workout: workoutLabel(letter),
    startedAt,
    endedAt: null,
    completedLifts: [],
    sets: []
  };
}

export function migrateLegacyLogs(flatLogs) {
  if (!Array.isArray(flatLogs) || flatLogs.length === 0) return [];

  const groups = new Map();
  for (const entry of flatLogs) {
    if (!isLegacyLogEntry(entry)) continue;
    const template = parseWorkoutTemplate(entry.workout) || "A";
    const dateKey = localDateKey(entry.timestamp || Date.now());
    const key = `${template}|${dateKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const sessions = [];
  for (const [key, sets] of groups) {
    const [template] = key.split("|");
    sets.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const startedAt = sets[0].timestamp;
    const endedAt = sets[sets.length - 1].timestamp;
    const completedLifts = [...new Set(sets.map((set) => set.lift).filter(Boolean))];

    sessions.push({
      id: `migrated-${template}-${localDateKey(startedAt)}`,
      template,
      workout: workoutLabel(template),
      startedAt,
      endedAt,
      completedLifts,
      sets: sets.map(({ workout: _workout, ...rest }) => rest)
    });
  }

  sessions.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  return sessions;
}

export function normalizeHistory(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const legacy = raw.filter(isLegacyLogEntry);
  const sessions = raw.filter(isSession);

  if (legacy.length === 0) return sessions;
  return [...migrateLegacyLogs(legacy), ...sessions].sort(
    (a, b) => new Date(b.startedAt) - new Date(a.startedAt)
  );
}

export function getActiveSession(sessions) {
  return sessions.find((session) => session.endedAt === null) || null;
}

export function flattenSets(sessions) {
  const flat = [];
  for (const session of sessions) {
    for (const set of session.sets) {
      flat.push({
        ...set,
        sessionId: session.id,
        workout: session.workout,
        sessionStartedAt: session.startedAt,
        sessionEndedAt: session.endedAt
      });
    }
  }
  flat.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return flat;
}

export function ensureActiveSession(sessions, template) {
  const letter = String(template).toUpperCase();
  const active = getActiveSession(sessions);
  let updated = sessions;

  if (active) {
    if (active.template === letter) {
      return { sessions: updated, session: active, created: false };
    }
    updated = completeSession(updated, active.id);
  }

  const session = createSession(letter);
  updated = [session, ...updated];
  return { sessions: updated, session, created: true };
}

export function addSetToSession(sessions, sessionId, setEntry) {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    return { ...session, sets: [setEntry, ...session.sets] };
  });
}

export function completeLiftInSession(sessions, sessionId, liftSlug) {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    if (session.completedLifts.includes(liftSlug)) return session;
    return { ...session, completedLifts: [...session.completedLifts, liftSlug] };
  });
}

export function completeSession(sessions, sessionId, endedAt = new Date().toISOString(), wellness) {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const updated = { ...session, endedAt: session.endedAt || endedAt };
    if (wellness && Object.keys(wellness).length) updated.wellness = wellness;
    return updated;
  });
}

export function getSetsForLift(session, liftSlug) {
  return (session?.sets || []).filter((set) => set.lift === liftSlug);
}

export function normalizeLiftFeedback(raw) {
  if (!raw || typeof raw !== "object") return undefined;

  const effort = raw.effort === "" || raw.effort == null ? null : Number(raw.effort);
  const out = {};

  if (Number.isFinite(effort)) out.effort = effort;
  if ("pain" in raw) out.pain = Boolean(raw.pain);

  return Object.keys(out).length ? out : undefined;
}

export function setLiftFeedback(sessions, sessionId, liftSlug, feedback) {
  const normalized = normalizeLiftFeedback(feedback);
  if (!normalized) return sessions;

  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    return {
      ...session,
      liftFeedback: {
        ...(session.liftFeedback || {}),
        [liftSlug]: {
          ...(session.liftFeedback?.[liftSlug] || {}),
          ...normalized
        }
      }
    };
  });
}

export function calculateMetrics(sessions) {
  const flat = flattenSets(sessions);
  const byLift = {};
  flat.forEach((set) => {
    byLift[set.liftName] = (byLift[set.liftName] || 0) + (+set.volume || 0);
  });

  return {
    setCount: flat.length,
    totalReps: flat.reduce((sum, set) => sum + (+set.reps || 0), 0),
    volume: flat.reduce((sum, set) => sum + (+set.volume || 0), 0),
    byLift,
    unsyncedCount: flat.filter((set) => !set.synced).length,
    sessionCount: sessions.length,
    activeSession: getActiveSession(sessions)
  };
}

export function markSetsSynced(sessions, ids) {
  const idSet = new Set(ids);
  return sessions.map((session) => ({
    ...session,
    sets: session.sets.map((set) => (idSet.has(set.id) ? { ...set, synced: true } : set))
  }));
}
