import test from "node:test";
import assert from "node:assert/strict";
import {
  addSetToSession,
  completeSession,
  createSession,
  createSetEntry
} from "./workout-data.js";
import {
  calculateConsistencyStreak,
  countWorkoutsThisWeek,
  getLiftBests,
  getWeeklyTrend,
  getWeekStart,
  normalizeWellness,
  weekKey
} from "./progress.js";

test("countWorkoutsThisWeek counts completed sessions in the current week", () => {
  const now = new Date("2026-07-20T18:00:00.000Z");
  const weekStart = getWeekStart(now);
  weekStart.setHours(12, 0, 0, 0);

  const inWeek = createSession("A", weekStart.toISOString());
  inWeek.endedAt = weekStart.toISOString();

  const lastWeekStart = new Date(now);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const outOfWeek = createSession("B", lastWeekStart.toISOString());
  outOfWeek.endedAt = lastWeekStart.toISOString();

  assert.equal(countWorkoutsThisWeek([inWeek, outOfWeek], now), 1);
});

test("calculateConsistencyStreak counts consecutive weeks with workouts", () => {
  const now = new Date("2026-07-20T18:00:00.000Z");
  const sessions = [];

  for (let weeksAgo = 0; weeksAgo < 3; weeksAgo += 1) {
    const date = getWeekStart(now);
    date.setDate(date.getDate() - weeksAgo * 7);
    date.setHours(12, 0, 0, 0);
    const session = createSession("A", date.toISOString());
    session.endedAt = date.toISOString();
    sessions.push(session);
  }

  assert.equal(calculateConsistencyStreak(sessions, now), 3);
});

test("getLiftBests returns best weight, reps, and volume for a lift", () => {
  const session = createSession("A");
  const lighter = createSetEntry({
    lift: "goblet-squat",
    liftName: "Goblet Squat",
    reps: 12,
    weight: 30
  });
  const heavier = createSetEntry({
    lift: "goblet-squat",
    liftName: "Goblet Squat",
    reps: 8,
    weight: 40
  });
  const highReps = createSetEntry({
    lift: "goblet-squat",
    liftName: "Goblet Squat",
    reps: 15,
    weight: 25
  });

  let sessions = addSetToSession([session], session.id, lighter);
  sessions = addSetToSession(sessions, session.id, heavier);
  sessions = addSetToSession(sessions, session.id, highReps);
  sessions = completeSession(sessions, session.id);

  const bests = getLiftBests(sessions, "goblet-squat");
  assert.equal(bests.bestWeight, 40);
  assert.equal(bests.bestReps, 15);
  assert.equal(bests.bestVolume, 375);
  assert.equal(bests.setCount, 3);
});

test("getWeeklyTrend returns 12 weekly workout counts", () => {
  const session = createSession("A", "2026-07-20T10:00:00.000Z");
  session.endedAt = "2026-07-20T11:00:00.000Z";
  const trend = getWeeklyTrend([session], 12, new Date("2026-07-20T18:00:00.000Z"));

  assert.equal(trend.length, 12);
  assert.equal(trend[trend.length - 1].workouts, 1);
});

test("normalizeWellness keeps only valid numeric fields", () => {
  assert.deepEqual(
    normalizeWellness({ glucosePre: "110", glucosePost: "", bodyWeight: "182.5", waistInches: "36" }),
    { glucosePre: 110, bodyWeight: 182.5, waistInches: 36 }
  );
  assert.equal(normalizeWellness({ glucosePre: "", bodyWeight: "" }), undefined);
});
