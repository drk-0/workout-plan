import test from "node:test";
import assert from "node:assert/strict";
import { HISTORY_KEY } from "./workout-data.js";
import {
  acceptSuggestion,
  createProgressionSuggestion,
  dismissSuggestion,
  migrateProgressionStorage,
  migrateProgressionStorageData,
  SUGGESTION_STATUS,
  TARGET_SOURCES
} from "./progression-storage.js";
import { SUGGESTION_TYPES } from "./progression.js";

const mockExercise = {
  slug: "goblet-squat",
  progression: { sets: 3, repMin: 12, repMax: 15, usesDumbbells: true }
};

test("migrateProgressionStorageData seeds targets and equipment", () => {
  const migrated = migrateProgressionStorageData({
    version: 0,
    targets: [],
    suggestions: [],
    equipment: null,
    exercises: [mockExercise],
    sessions: []
  });

  assert.equal(migrated.version, 2);
  assert.equal(migrated.targets.length, 1);
  assert.equal(migrated.targets[0].exerciseId, "goblet-squat");
  assert.deepEqual(migrated.equipment.availableDumbbellWeights, [5, 8, 10, 12, 15, 20, 25, 30]);
});

test("acceptSuggestion updates target without changing workout history", () => {
  const session = {
    id: "session-fixed",
    template: "A",
    workout: "Workout A",
    startedAt: "2026-07-20T10:00:00.000Z",
    endedAt: null,
    completedLifts: [],
    sets: []
  };
  const historySnapshot = JSON.stringify([session]);
  const currentTarget = {
    exerciseId: "goblet-squat",
    sets: 3,
    minReps: 12,
    maxReps: 15,
    weight: 20,
    source: TARGET_SOURCES.PLAN
  };
  const proposedTarget = { ...currentTarget, weight: 25 };

  let state = migrateProgressionStorageData({
    version: 2,
    targets: [currentTarget],
    suggestions: [],
    equipment: { availableDumbbellWeights: [5, 10, 15, 20, 25] },
    exercises: [mockExercise],
    sessions: []
  });

  const suggestion = createProgressionSuggestion({
    exerciseId: "goblet-squat",
    type: SUGGESTION_TYPES.INCREASE_WEIGHT,
    currentTarget,
    proposedTarget,
    reason: "Ready for more load",
    evidence: "Two good sessions"
  });
  state = { ...state, suggestions: [suggestion] };

  state = acceptSuggestion(state, suggestion.id);
  const target = state.targets.find((t) => t.exerciseId === "goblet-squat");
  assert.equal(target.weight, 25);
  assert.equal(target.source, TARGET_SOURCES.SUGGESTION);
  assert.equal(state.suggestions[0].status, SUGGESTION_STATUS.ACCEPTED);

  const historyAfter = JSON.stringify([session]);
  assert.equal(historySnapshot, historyAfter);
});

test("dismissSuggestion records dismissed status", () => {
  let state = migrateProgressionStorageData({
    version: 2,
    targets: [],
    suggestions: [],
    equipment: { availableDumbbellWeights: [5, 10, 15, 20, 25] },
    exercises: [mockExercise],
    sessions: []
  });

  const suggestion = createProgressionSuggestion({
    exerciseId: "goblet-squat",
    type: SUGGESTION_TYPES.REPEAT_WEIGHT,
    currentTarget: { exerciseId: "goblet-squat", sets: 3, minReps: 12, maxReps: 15, weight: 20 },
    proposedTarget: { exerciseId: "goblet-squat", sets: 3, minReps: 12, maxReps: 15, weight: 20 },
    reason: "Hold steady",
    evidence: "Evidence"
  });
  state = { ...state, suggestions: [suggestion] };
  state = dismissSuggestion(state, suggestion.id);
  assert.equal(state.suggestions[0].status, SUGGESTION_STATUS.DISMISSED);
  assert.ok(state.suggestions[0].decidedAt);
});

test("localStorage migration preserves unrelated workout history key shape", async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value)
  };

  const sessions = [{ id: "session-1", template: "A", workout: "Workout A", startedAt: "2026-07-20T10:00:00.000Z", endedAt: null, completedLifts: [], sets: [] }];
  store.set(HISTORY_KEY, JSON.stringify(sessions));

  migrateProgressionStorage(sessions);

  const history = JSON.parse(store.get(HISTORY_KEY));
  assert.equal(history[0].id, "session-1");
  assert.ok(store.get("storageVersion"));
  assert.ok(store.get("exerciseTargets"));
});
