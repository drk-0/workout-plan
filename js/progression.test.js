import test from "node:test";
import assert from "node:assert/strict";
import {
  addSetToSession,
  completeSession,
  createSession,
  createSetEntry,
  setLiftFeedback
} from "./workout-data.js";
import {
  allPrescribedSetsAtRepTop,
  evaluateProgression,
  getNextDumbbell,
  getSessionsWithLift,
  SUGGESTION_TYPES
} from "./progression.js";

const gobletSquat = {
  slug: "goblet-squat",
  name: "Goblet Squat",
  progression: {
    type: "reps",
    sets: 3,
    repMin: 12,
    repMax: 15,
    usesDumbbells: true
  }
};

function buildCompletedLiftSession({
  template = "A",
  liftSlug = "goblet-squat",
  reps = 15,
  weight = 20,
  effort = 7,
  pain = false,
  endedAt
}) {
  const session = createSession(template, endedAt);
  let sessions = [session];
  for (let index = 0; index < 3; index += 1) {
    const setEntry = createSetEntry({
      lift: liftSlug,
      liftName: "Goblet Squat",
      reps,
      weight,
      now: new Date(endedAt)
    });
    sessions = addSetToSession(sessions, session.id, setEntry);
  }
  sessions = setLiftFeedback(sessions, session.id, liftSlug, { effort, pain });
  sessions = completeSession(sessions, session.id, endedAt);
  return sessions[0];
}

test("getNextDumbbell returns the next fixed increment", () => {
  assert.equal(getNextDumbbell(20), 25);
  assert.equal(getNextDumbbell(80), null);
});

test("allPrescribedSetsAtRepTop requires all prescribed sets at rep max", () => {
  const session = buildCompletedLiftSession({
    reps: 14,
    endedAt: "2026-07-20T12:00:00.000Z"
  });
  assert.equal(allPrescribedSetsAtRepTop(session, "goblet-squat", gobletSquat.progression), false);

  const topSession = buildCompletedLiftSession({
    reps: 15,
    endedAt: "2026-07-20T12:00:00.000Z"
  });
  assert.equal(allPrescribedSetsAtRepTop(topSession, "goblet-squat", gobletSquat.progression), true);
});

test("evaluateProgression suggests next dumbbell after two qualifying workouts", () => {
  const first = buildCompletedLiftSession({
    reps: 15,
    weight: 20,
    effort: 7,
    endedAt: "2026-07-13T12:00:00.000Z"
  });
  const second = buildCompletedLiftSession({
    reps: 15,
    weight: 20,
    effort: 8,
    endedAt: "2026-07-20T12:00:00.000Z"
  });

  const suggestion = evaluateProgression([second, first], gobletSquat);
  assert.equal(suggestion.type, SUGGESTION_TYPES.INCREASE_WEIGHT);
  assert.equal(suggestion.requiresConfirmation, true);
  assert.equal(suggestion.suggestedWeight, 25);
  assert.equal(suggestion.currentWeight, 20);
});

test("evaluateProgression does not suggest weight increase with pain or high effort", () => {
  const painful = buildCompletedLiftSession({
    reps: 15,
    weight: 20,
    effort: 7,
    pain: true,
    endedAt: "2026-07-13T12:00:00.000Z"
  });
  const latest = buildCompletedLiftSession({
    reps: 15,
    weight: 20,
    effort: 7,
    endedAt: "2026-07-20T12:00:00.000Z"
  });

  const withPain = evaluateProgression([latest, painful], gobletSquat);
  assert.notEqual(withPain.type, SUGGESTION_TYPES.INCREASE_WEIGHT);

  const hard = buildCompletedLiftSession({
    reps: 15,
    weight: 20,
    effort: 9,
    endedAt: "2026-07-13T12:00:00.000Z"
  });
  const withHighEffort = evaluateProgression([latest, hard], gobletSquat);
  assert.notEqual(withHighEffort.type, SUGGESTION_TYPES.INCREASE_WEIGHT);
});

test("evaluateProgression suggests adding reps when close to the top of the range", () => {
  const session = buildCompletedLiftSession({
    reps: 13,
    weight: 20,
    effort: 7,
    endedAt: "2026-07-20T12:00:00.000Z"
  });

  const suggestion = evaluateProgression([session], gobletSquat);
  assert.equal(suggestion.type, SUGGESTION_TYPES.ADD_REPS);
});

test("getSessionsWithLift returns completed sessions newest first", () => {
  const older = buildCompletedLiftSession({ endedAt: "2026-07-13T12:00:00.000Z" });
  const newer = buildCompletedLiftSession({ endedAt: "2026-07-20T12:00:00.000Z" });
  const sessions = getSessionsWithLift([older, newer], "goblet-squat");
  assert.equal(sessions[0].id, newer.id);
});
