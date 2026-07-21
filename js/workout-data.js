export const HISTORY_KEY = "workoutHistory";
export const SCHEMA_VERSION = 2;
export const PENDING_READINESS_PREFIX = "pendingReadiness:";

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

export function createSetEntry({
  lift,
  liftName,
  reps,
  weight,
  notes,
  effort = null,
  painDuringSet = null,
  substitutedFrom = null,
  trigger = "set_complete",
  now = new Date()
}) {
  const repsNum = +reps || 0;
  const weightNum = +weight || 0;
  const entry = {
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

  if (effort != null && effort !== "") entry.effort = Number(effort);
  const painLevel = normalizePainLevel(painDuringSet);
  if (painLevel) entry.painDuringSet = painLevel;
  if (substitutedFrom) entry.substitutedFrom = substitutedFrom;

  return entry;
}

export function createSession(template, startedAt = new Date().toISOString(), extras = {}) {
  const letter = String(template).toUpperCase();
  return {
    id: `session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    schemaVersion: SCHEMA_VERSION,
    template: letter,
    workout: workoutLabel(letter),
    startedAt,
    endedAt: null,
    completedLifts: [],
    skippedExercises: [],
    substitutions: [],
    progressionDecisions: [],
    sets: [],
    ...extras
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

export function migrateSessionV2(session) {
  if (!session || !isSession(session)) return session;

  const migrated = { ...session };

  if (!migrated.schemaVersion || migrated.schemaVersion < SCHEMA_VERSION) {
    migrated.schemaVersion = SCHEMA_VERSION;
  }

  if (!Array.isArray(migrated.skippedExercises)) migrated.skippedExercises = [];
  if (!Array.isArray(migrated.substitutions)) migrated.substitutions = [];
  if (!Array.isArray(migrated.progressionDecisions)) migrated.progressionDecisions = [];

  if (!migrated.warmUp) {
    migrated.warmUp = { completed: false, skipped: false, completedAt: null };
  }

  if (!migrated.readiness) {
    const wellness = migrated.wellness || {};
    migrated.readiness = {
      migrated: true,
      energy: null,
      soreness: null,
      painToday: null,
      dizziness: false,
      unusualWeakness: false,
      unusualShortnessOfBreath: false,
      chestDiscomfort: false,
      confusion: false,
      faintness: false,
      glucose: wellness.glucosePre ?? null,
      note: "",
      recordedAt: migrated.startedAt || null,
      blocked: false,
      blockReasons: [],
      suggestedAdjustments: [],
      acceptedAdjustments: []
    };
    if (migrated.endedAt) {
      migrated.warmUp = { completed: true, skipped: false, completedAt: migrated.startedAt };
    }
  } else {
    const readiness = { ...migrated.readiness };
    if (!Array.isArray(readiness.blockReasons)) readiness.blockReasons = [];
    if (!Array.isArray(readiness.suggestedAdjustments)) readiness.suggestedAdjustments = [];
    if (!Array.isArray(readiness.acceptedAdjustments)) readiness.acceptedAdjustments = [];
    migrated.readiness = readiness;
  }

  if (!migrated.recovery && migrated.endedAt) {
    const wellness = migrated.wellness || {};
    migrated.recovery = {
      migrated: true,
      overallEffort: null,
      unusualFatigue: false,
      painAfter: "none",
      glucose: wellness.glucosePost ?? null,
      notes: "",
      completionStatus: "completed",
      recordedAt: migrated.endedAt
    };
  }

  migrated.sets = (migrated.sets || []).map((set) => {
    const updated = { ...set };
    if (!updated.painDuringSet && set.pain != null) {
      updated.painDuringSet = set.pain ? "moderate" : "none";
    }
    return updated;
  });

  return migrated;
}

export function normalizeHistory(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const legacy = raw.filter(isLegacyLogEntry);
  const sessions = raw.filter(isSession).map(migrateSessionV2);

  if (legacy.length === 0) return sessions;
  return [...migrateLegacyLogs(legacy).map(migrateSessionV2), ...sessions].sort(
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

export function sessionPrerequisitesMet(session) {
  if (!session) return false;
  if (session.readiness?.migrated) return true;
  if (session.readiness?.blocked) return false;
  if (!session.readiness?.recordedAt) return false;
  const warmUp = session.warmUp || {};
  return Boolean(warmUp.completed || warmUp.skipped);
}

export function createSessionAfterWarmUp(sessions, template, readiness, warmUp) {
  if (readiness?.blocked) {
    return { sessions, session: null, created: false, blocked: true };
  }
  const letter = String(template).toUpperCase();
  const active = getActiveSession(sessions);
  let updated = sessions;

  if (active) {
    if (active.template === letter && sessionPrerequisitesMet(active)) {
      return { sessions: updated, session: active, created: false };
    }
    updated = completeSession(updated, active.id);
  }

  const session = createSession(letter, new Date().toISOString(), {
    readiness: {
      ...readiness,
      acceptedAdjustments: readiness?.acceptedAdjustments || []
    },
    warmUp: warmUp || { completed: true, skipped: false, completedAt: new Date().toISOString() }
  });
  updated = [session, ...updated];
  return { sessions: updated, session, created: true };
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

export function completeSession(sessions, sessionId, endedAt = new Date().toISOString(), extras = {}) {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const updated = { ...session, endedAt: session.endedAt || endedAt };
    if (extras.wellness && Object.keys(extras.wellness).length) updated.wellness = extras.wellness;
    if (extras.recovery) updated.recovery = extras.recovery;
    return updated;
  });
}

export function updateSession(sessions, sessionId, patch) {
  return sessions.map((session) => (session.id === sessionId ? { ...session, ...patch } : session));
}

export function setSessionReadiness(sessions, sessionId, readiness) {
  return updateSession(sessions, sessionId, { readiness });
}

export function setWarmUpStatus(sessions, sessionId, warmUp) {
  return updateSession(sessions, sessionId, { warmUp });
}

export function addSubstitution(sessions, sessionId, originalSlug, substituteSlug) {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    return {
      ...session,
      substitutions: [
        ...(session.substitutions || []),
        { originalSlug, substituteSlug, at: new Date().toISOString() }
      ]
    };
  });
}

export function skipExerciseInSession(sessions, sessionId, liftSlug) {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const skipped = session.skippedExercises || [];
    if (skipped.includes(liftSlug)) return session;
    return { ...session, skippedExercises: [...skipped, liftSlug] };
  });
}

export function setProgressionDecision(sessions, sessionId, decision) {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    return {
      ...session,
      progressionDecisions: [...(session.progressionDecisions || []), decision]
    };
  });
}

export function hasBlockingSetPain(session, liftSlug) {
  return getSetsForLift(session, liftSlug).some((set) => {
    const level = normalizePainLevel(set.painDuringSet);
    return level === "moderate" || level === "sharp";
  });
}

export function hasSharpPainInSet(painDuringSet) {
  return normalizePainLevel(painDuringSet) === "sharp";
}

export function getMaxSetEffort(session, liftSlug) {
  const efforts = getSetsForLift(session, liftSlug)
    .map((set) => set.effort)
    .filter((effort) => effort != null);
  return efforts.length ? Math.max(...efforts) : null;
}

export function getSetsForLift(session, liftSlug) {
  return (session?.sets || []).filter((set) => set.lift === liftSlug);
}

export const PAIN_LEVELS = ["none", "mild", "moderate", "sharp"];

export function normalizePainLevel(raw) {
  if (raw == null || raw === "") return null;
  const level = String(raw).toLowerCase();
  if (PAIN_LEVELS.includes(level)) return level;
  return null;
}

export function normalizeLiftFeedback(raw) {
  if (!raw || typeof raw !== "object") return undefined;

  const effort = raw.effort === "" || raw.effort == null ? null : Number(raw.effort);
  const out = {};

  if (Number.isFinite(effort)) out.effort = effort;

  if ("painLevel" in raw) {
    const painLevel = normalizePainLevel(raw.painLevel);
    if (painLevel) out.painLevel = painLevel;
  } else if ("pain" in raw) {
    out.painLevel = raw.pain ? "moderate" : "none";
  }

  if ("stoppedEarly" in raw) out.stoppedEarly = Boolean(raw.stoppedEarly);

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
