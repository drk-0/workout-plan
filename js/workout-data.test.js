import test from "node:test";
import assert from "node:assert/strict";
import {
  addSetToSession,
  calculateMetrics,
  completeLiftInSession,
  completeSession,
  createSession,
  createSetEntry,
  ensureActiveSession,
  flattenSets,
  migrateLegacyLogs,
  normalizeHistory,
  volumeForSet
} from "./workout-data.js";

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

function getActiveSession(sessions) {
  return sessions.find((session) => session.endedAt === null) || null;
}

function getSetsForLift(session, liftSlug) {
  return (session?.sets || []).filter((set) => set.lift === liftSlug);
}
