import { EXERCISES } from "./exercises.js";
import { getSetsForLift } from "./workout-data.js";

function getLastLoggedWeight(sessions, liftSlug) {
  const completed = (sessions || [])
    .filter((session) => session.endedAt && getSetsForLift(session, liftSlug).length > 0)
    .sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt));

  if (!completed[0]) return null;

  const sets = getSetsForLift(completed[0], liftSlug).filter((set) => (+set.weight || 0) > 0);
  if (!sets.length) return null;

  const total = sets.reduce((sum, set) => sum + (+set.weight || 0), 0);
  return Math.round((total / sets.length) * 10) / 10;
}

export const STORAGE_VERSION_KEY = "storageVersion";
export const TARGETS_KEY = "exerciseTargets";
export const SUGGESTIONS_KEY = "progressionSuggestions";
export const EQUIPMENT_KEY = "userEquipment";

export const CURRENT_STORAGE_VERSION = 2;

export const DEFAULT_DUMBBELL_WEIGHTS = [5, 8, 10, 12, 15, 20, 25, 30];

export const TARGET_SOURCES = {
  PLAN: "plan",
  USER: "user",
  SUGGESTION: "suggestion"
};

export const SUGGESTION_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  MODIFIED: "modified",
  DISMISSED: "dismissed"
};

function readJson(key, fallback) {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

export function normalizeDumbbellWeights(weights) {
  if (!Array.isArray(weights)) return [...DEFAULT_DUMBBELL_WEIGHTS];
  const parsed = [...new Set(weights.map((w) => Number(w)).filter((w) => Number.isFinite(w) && w > 0))];
  parsed.sort((a, b) => a - b);
  return parsed.length ? parsed : [...DEFAULT_DUMBBELL_WEIGHTS];
}

export function seedTargetFromExercise(exercise, sessions = []) {
  const prog = exercise?.progression || {};
  let weight = null;
  if (prog.usesDumbbells) {
    weight = getLastLoggedWeight(sessions, exercise.slug);
  }

  return {
    exerciseId: exercise.slug,
    sets: prog.sets || 3,
    minReps: prog.repMin ?? null,
    maxReps: prog.repMax ?? null,
    weight,
    tempo: null,
    updatedAt: new Date().toISOString(),
    source: TARGET_SOURCES.PLAN
  };
}

export function normalizeExerciseTarget(raw, exercise, sessions = []) {
  if (!raw || typeof raw !== "object") {
    return exercise ? seedTargetFromExercise(exercise, sessions) : null;
  }

  const seed = exercise ? seedTargetFromExercise(exercise, sessions) : null;
  return {
    exerciseId: raw.exerciseId || seed?.exerciseId,
    sets: Number(raw.sets) || seed?.sets || 3,
    minReps: raw.minReps != null ? Number(raw.minReps) : seed?.minReps ?? null,
    maxReps: raw.maxReps != null ? Number(raw.maxReps) : seed?.maxReps ?? null,
    weight: raw.weight != null && raw.weight !== "" ? Number(raw.weight) : seed?.weight ?? null,
    tempo: raw.tempo || null,
    updatedAt: raw.updatedAt || new Date().toISOString(),
    source: raw.source || TARGET_SOURCES.PLAN
  };
}

export function buildDismissKey(exerciseId, type, proposedTarget) {
  return `${exerciseId}|${type}|${JSON.stringify(proposedTarget || {})}`;
}

export function createProgressionSuggestion({
  exerciseId,
  type,
  currentTarget,
  proposedTarget,
  reason,
  evidence,
  status = SUGGESTION_STATUS.PENDING
}) {
  const now = new Date().toISOString();
  return {
    id: `sug-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    exerciseId,
    createdAt: now,
    type,
    currentTarget,
    proposedTarget,
    reason,
    evidence,
    status,
    decidedAt: status === SUGGESTION_STATUS.PENDING ? null : now,
    dismissKey: buildDismissKey(exerciseId, type, proposedTarget)
  };
}

export function migrateProgressionStorageData({
  version = 0,
  targets = [],
  suggestions = [],
  equipment = null,
  exercises = EXERCISES,
  sessions = []
} = {}) {
  let nextVersion = version;
  let nextTargets = Array.isArray(targets) ? [...targets] : [];
  let nextSuggestions = Array.isArray(suggestions) ? [...suggestions] : [];
  let nextEquipment = equipment;

  if (nextVersion < 2) {
    if (!nextEquipment?.availableDumbbellWeights?.length) {
      nextEquipment = { availableDumbbellWeights: [...DEFAULT_DUMBBELL_WEIGHTS] };
    }

    const byId = new Map(nextTargets.map((t) => [t.exerciseId, t]));
    for (const ex of exercises) {
      if (!byId.has(ex.slug)) {
        byId.set(ex.slug, seedTargetFromExercise(ex, sessions));
      }
    }
    nextTargets = [...byId.values()];
    nextVersion = 2;
  }

  return {
    version: nextVersion,
    targets: nextTargets.map((t) => {
      const ex = exercises.find((e) => e.slug === t.exerciseId);
      return normalizeExerciseTarget(t, ex, sessions);
    }),
    suggestions: nextSuggestions,
    equipment: {
      availableDumbbellWeights: normalizeDumbbellWeights(
        nextEquipment?.availableDumbbellWeights
      )
    }
  };
}

export function loadProgressionState(sessions = []) {
  const version = Number(readJson(STORAGE_VERSION_KEY, 0)) || 0;
  const targets = readJson(TARGETS_KEY, []);
  const suggestions = readJson(SUGGESTIONS_KEY, []);
  const equipment = readJson(EQUIPMENT_KEY, null);

  return migrateProgressionStorageData({
    version,
    targets,
    suggestions,
    equipment,
    exercises: EXERCISES,
    sessions
  });
}

export function saveProgressionState(state) {
  writeJson(STORAGE_VERSION_KEY, state.version);
  writeJson(TARGETS_KEY, state.targets);
  writeJson(SUGGESTIONS_KEY, state.suggestions);
  writeJson(EQUIPMENT_KEY, state.equipment);
}

export function migrateProgressionStorage(sessions = []) {
  const state = loadProgressionState(sessions);
  saveProgressionState(state);
  return state;
}

export function getExerciseTarget(state, exerciseId, exercise = null) {
  const found = state.targets.find((t) => t.exerciseId === exerciseId);
  if (found) return found;
  const ex = exercise || EXERCISES.find((e) => e.slug === exerciseId);
  return ex ? seedTargetFromExercise(ex, []) : null;
}

export function updateExerciseTarget(state, exerciseId, patch, source = TARGET_SOURCES.USER) {
  const ex = EXERCISES.find((e) => e.slug === exerciseId);
  const current = getExerciseTarget(state, exerciseId, ex);
  const updated = {
    ...current,
    ...patch,
    exerciseId,
    updatedAt: new Date().toISOString(),
    source
  };
  const targets = state.targets.filter((t) => t.exerciseId !== exerciseId);
  targets.push(updated);
  return { ...state, targets };
}

export function getDismissedKeys(suggestions) {
  return (suggestions || [])
    .filter((s) => s.status === SUGGESTION_STATUS.DISMISSED && s.dismissKey)
    .map((s) => s.dismissKey);
}

export function hasPendingSuggestion(suggestions, exerciseId, type) {
  return (suggestions || []).some(
    (s) =>
      s.exerciseId === exerciseId &&
      s.type === type &&
      s.status === SUGGESTION_STATUS.PENDING
  );
}

export function isDismissSuppressed(suggestions, dismissKey) {
  if (!dismissKey) return false;
  return (suggestions || []).some(
    (s) => s.status === SUGGESTION_STATUS.DISMISSED && s.dismissKey === dismissKey
  );
}

export function acceptSuggestion(state, suggestionId) {
  const suggestions = [...state.suggestions];
  const index = suggestions.findIndex((s) => s.id === suggestionId);
  if (index < 0) return state;

  const suggestion = suggestions[index];
  const now = new Date().toISOString();
  suggestions[index] = {
    ...suggestion,
    status: SUGGESTION_STATUS.ACCEPTED,
    decidedAt: now
  };

  const next = updateExerciseTarget(
    { ...state, suggestions },
    suggestion.exerciseId,
    suggestion.proposedTarget,
    TARGET_SOURCES.SUGGESTION
  );
  return next;
}

export function dismissSuggestion(state, suggestionId) {
  const suggestions = state.suggestions.map((s) =>
    s.id === suggestionId
      ? {
          ...s,
          status: SUGGESTION_STATUS.DISMISSED,
          decidedAt: new Date().toISOString()
        }
      : s
  );
  return { ...state, suggestions };
}

export function modifySuggestionTarget(state, suggestionId, patch) {
  const suggestions = [...state.suggestions];
  const index = suggestions.findIndex((s) => s.id === suggestionId);
  if (index < 0) return state;

  const suggestion = suggestions[index];
  const now = new Date().toISOString();
  suggestions[index] = {
    ...suggestion,
    status: SUGGESTION_STATUS.MODIFIED,
    decidedAt: now
  };

  const next = updateExerciseTarget(
    { ...state, suggestions },
    suggestion.exerciseId,
    patch,
    TARGET_SOURCES.USER
  );
  return next;
}

export function formatTargetLabel(target, exercise = null) {
  if (!target) return "No target set";
  const perSide = exercise?.progression?.type === "reps_per_side" ? " per leg" : "";
  const timeBased = exercise?.progression?.type === "time";

  if (timeBased) {
    const weightPart = target.weight ? ` @ ${target.weight} lb` : "";
    return `${target.sets} sets${weightPart} (time-based)`;
  }

  const repRange =
    target.minReps != null && target.maxReps != null
      ? `${target.minReps}–${target.maxReps}`
      : target.maxReps ?? "—";
  const weightPart = target.weight ? ` @ ${target.weight} lb` : "";
  return `${target.sets} × ${repRange}${perSide}${weightPart}`;
}

export function formatSourceLabel(source) {
  switch (source) {
    case TARGET_SOURCES.USER:
      return "You edited";
    case TARGET_SOURCES.SUGGESTION:
      return "From accepted suggestion";
    default:
      return "From plan";
  }
}

export function parseDumbbellWeightsInput(text) {
  const parts = String(text || "")
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return normalizeDumbbellWeights(parts.map(Number));
}

export function evaluateAndQueueSuggestion(sessions, exercise, state, builtSuggestion) {
  if (!builtSuggestion || !exercise) {
    return { state, queued: false };
  }

  const dismissKey = buildDismissKey(
    exercise.slug,
    builtSuggestion.type,
    builtSuggestion.proposedTarget
  );

  if (isDismissSuppressed(state.suggestions, dismissKey)) {
    return { state, queued: false };
  }

  if (hasPendingSuggestion(state.suggestions, exercise.slug, builtSuggestion.type)) {
    return { state, queued: false };
  }

  const suggestion = createProgressionSuggestion({
    exerciseId: exercise.slug,
    type: builtSuggestion.type,
    currentTarget: builtSuggestion.currentTarget,
    proposedTarget: builtSuggestion.proposedTarget,
    reason: builtSuggestion.reason,
    evidence: builtSuggestion.evidence
  });

  return {
    state: {
      ...state,
      suggestions: [suggestion, ...state.suggestions]
    },
    queued: true
  };
}
