import test from "node:test";
import assert from "node:assert/strict";
import {
  addSetToSession,
  calculateMetrics,
  completeLiftInSession,
  completeSession,
  createSession,
  createSessionAfterWarmUp,
  createSetEntry,
  ensureActiveSession,
  flattenSets,
  getActiveSession,
  getSetsForLift,
  hasSharpPainInSet,
  migrateLegacyLogs,
  normalizeHistory,
  SCHEMA_VERSION,
  sessionPrerequisitesMet,
  volumeForSet
} from "./workout-data.js";
import { shouldStartRestTimerAfterSet } from "./progression.js";

test("volumeForSet multiplies reps and weight", () => {
  assert.equal(volumeForSet(12, 20), 240);
  assert.equal(volumeForSet(0, 25), 0);
});

test("migrateLegacyLogs groups sets by workout template and local date", () => {
  const legacy = [
    {
      id: "1",
      timestamp: "2026-07-20T10:00:00.000Z",
      localTime: "7/20/2026, 3:00:00 AM",
      workout: "Workout A",
      lift: "goblet-squat",
      liftName: "Goblet Squat",
      reps: 12,
      weight: 30,
      volume: 360,
      notes: "",
      trigger: "set_complete",
      synced: true
    },
    {
      id: "2",
      timestamp: "2026-07-20T11:00:00.000Z",
      localTime: "7/20/2026, 4:00:00 AM",
      workout: "Workout A",
      lift: "floor-press",
      liftName: "Floor Press",
      reps: 10,
      weight: 25,
      volume: 250,
      notes: "felt good",
      trigger: "set_complete",
      synced: false
    },
    {
      id: "3",
      timestamp: "2026-07-21T10:00:00.000Z",
      localTime: "7/21/2026, 3:00:00 AM",
      workout: "Workout A",
      lift: "goblet-squat",
      liftName: "Goblet Squat",
      reps: 8,
      weight: 35,
      volume: 280,
      notes: "",
      trigger: "set_complete",
      synced: false
    }
  ];

  const sessions = migrateLegacyLogs(legacy);
  assert.equal(sessions.length, 2);

  const july20 = sessions.find((session) => session.startedAt.startsWith("2026-07-20"));
  const july21 = sessions.find((session) => session.startedAt.startsWith("2026-07-21"));

  assert.ok(july20);
  assert.equal(july20.template, "A");
  assert.equal(july20.sets.length, 2);
  assert.equal(july20.endedAt, "2026-07-20T11:00:00.000Z");
  assert.deepEqual(july20.completedLifts.sort(), ["floor-press", "goblet-squat"]);

  assert.ok(july21);
  assert.equal(july21.sets.length, 1);
  assert.equal(july21.sets[0].lift, "goblet-squat");
  assert.equal(july21.sets[0].workout, undefined);
});

test("migrateSessionV2 adds defaults without losing sets", () => {
  const legacySession = {
    id: "old-session",
    template: "A",
    workout: "Workout A",
    startedAt: "2026-06-01T10:00:00.000Z",
    endedAt: "2026-06-01T11:00:00.000Z",
    completedLifts: ["goblet-squat"],
    sets: [
      {
        id: "set-1",
        timestamp: "2026-06-01T10:05:00.000Z",
        localTime: "6/1/2026",
        lift: "goblet-squat",
        liftName: "Goblet Squat",
        reps: 12,
        weight: 20,
        volume: 240,
        notes: "",
        trigger: "set_complete",
        synced: true
      }
    ],
    wellness: { glucosePre: 110, glucosePost: 98 }
  };

  const [migrated] = normalizeHistory([legacySession]);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.sets.length, 1);
  assert.equal(migrated.readiness.glucose, 110);
  assert.equal(migrated.recovery.glucose, 98);
  assert.equal(migrated.readiness.migrated, true);
});

test("createSetEntry stores per-set effort and pain", () => {
  const set = createSetEntry({
    lift: "goblet-squat",
    liftName: "Goblet Squat",
    reps: 12,
    weight: 20,
    effort: 7,
    painDuringSet: "mild"
  });
  assert.equal(set.effort, 7);
  assert.equal(set.painDuringSet, "mild");
});

test("sessionPrerequisitesMet allows migrated sessions", () => {
  const session = createSession("A");
  session.readiness = { migrated: true };
  assert.equal(sessionPrerequisitesMet(session), true);
});

test("createSessionAfterWarmUp stores readiness and warm-up", () => {
  const readiness = {
    energy: 4,
    soreness: 2,
    painToday: "none",
    recordedAt: new Date().toISOString(),
    blocked: false,
    suggestedAdjustments: [],
    acceptedAdjustments: []
  };
  const result = createSessionAfterWarmUp([], "A", readiness, {
    completed: true,
    skipped: false,
    completedAt: new Date().toISOString()
  });
  assert.equal(result.created, true);
  assert.equal(result.session.readiness.energy, 4);
  assert.equal(result.session.warmUp.completed, true);
  assert.equal(sessionPrerequisitesMet(result.session), true);
});

test("localStorage round-trip preserves phase 5 fields", () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };

  const readiness = {
    energy: 3,
    soreness: 2,
    painToday: "none",
    recordedAt: "2026-07-20T10:00:00.000Z",
    blocked: false,
    suggestedAdjustments: [],
    acceptedAdjustments: ["test"]
  };
  const session = createSession("A", "2026-07-20T10:00:00.000Z", {
    readiness,
    warmUp: { completed: true, skipped: false, completedAt: "2026-07-20T10:05:00.000Z" }
  });
  const set = createSetEntry({
    lift: "goblet-squat",
    liftName: "Goblet Squat",
    reps: 12,
    weight: 20,
    effort: 6,
    painDuringSet: "none"
  });
  let sessions = addSetToSession([session], session.id, set);
  storage.set("workoutHistory", JSON.stringify(sessions));

  const loaded = normalizeHistory(JSON.parse(storage.get("workoutHistory")));
  assert.equal(loaded[0].readiness.acceptedAdjustments[0], "test");
  assert.equal(loaded[0].sets[0].effort, 6);
});

test("sharp pain blocks auto rest timer", () => {
  assert.equal(shouldStartRestTimerAfterSet("sharp"), false);
  assert.equal(shouldStartRestTimerAfterSet("mild"), true);
  assert.equal(hasSharpPainInSet("sharp"), true);
});

test("normalizeHistory migrates legacy arrays and keeps session arrays", () => {
  const legacy = [
    {
      id: "legacy-1",
      timestamp: "2026-07-19T12:00:00.000Z",
      workout: "Workout B",
      lift: "one-arm-row",
      liftName: "One Arm Row",
      reps: 15,
      weight: 20,
      volume: 300,
      notes: "",
      trigger: "set_complete",
      synced: false
    }
  ];
  const existingSession = createSession("A", "2026-07-18T12:00:00.000Z");
  existingSession.endedAt = "2026-07-18T13:00:00.000Z";

  const normalized = normalizeHistory([...legacy, existingSession]);
  assert.equal(normalized.length, 2);
  assert.ok(normalized.every((entry) => Array.isArray(entry.sets)));
});

test("calculateMetrics totals reps, volume, and unsynced sets across sessions", () => {
  const session = createSession("A");
  const first = createSetEntry({
    lift: "goblet-squat",
    liftName: "Goblet Squat",
    reps: 12,
    weight: 30,
    notes: ""
  });
  const second = createSetEntry({
    lift: "floor-press",
    liftName: "Floor Press",
    reps: 10,
    weight: 25,
    notes: ""
  });
  second.synced = true;

  let sessions = addSetToSession([session], session.id, first);
  sessions = addSetToSession(sessions, session.id, second);
  sessions = completeSession(sessions, session.id);

  const metrics = calculateMetrics(sessions);
  assert.equal(metrics.setCount, 2);
  assert.equal(metrics.totalReps, 22);
  assert.equal(metrics.volume, 610);
  assert.equal(metrics.unsyncedCount, 1);
  assert.equal(metrics.byLift["Goblet Squat"], 360);
  assert.equal(metrics.byLift["Floor Press"], 250);
});

test("ensureActiveSession resumes matching workout and completes other active sessions", () => {
  let sessions = [createSession("A")];
  const first = ensureActiveSession(sessions, "A");
  assert.equal(first.created, false);
  assert.equal(first.session.template, "A");

  const switched = ensureActiveSession(first.sessions, "B");
  assert.equal(switched.created, true);
  assert.equal(switched.session.template, "B");
  assert.ok(switched.sessions.find((session) => session.template === "A")?.endedAt);
  assert.equal(getActiveSession(switched.sessions)?.template, "B");
});

test("completeLiftInSession and flattenSets preserve saved sets when revisiting lifts", () => {
  const session = createSession("A");
  const setEntry = createSetEntry({
    lift: "goblet-squat",
    liftName: "Goblet Squat",
    reps: 12,
    weight: 30,
    notes: "steady"
  });

  let sessions = addSetToSession([session], session.id, setEntry);
  sessions = completeLiftInSession(sessions, session.id, "goblet-squat");
  sessions = completeLiftInSession(sessions, session.id, "floor-press");

  const active = sessions[0];
  assert.deepEqual(active.completedLifts, ["goblet-squat", "floor-press"]);
  assert.equal(getSetsForLift(active, "goblet-squat").length, 1);

  const anotherSet = createSetEntry({
    lift: "goblet-squat",
    liftName: "Goblet Squat",
    reps: 10,
    weight: 32,
    notes: ""
  });
  sessions = addSetToSession(sessions, session.id, anotherSet);

  const flat = flattenSets(sessions);
  assert.equal(flat.filter((set) => set.lift === "goblet-squat").length, 2);
});
