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
  buildProgressionSuggestion,
  evaluateProgression,
  getNextDumbbell,
  getSessionsWithLift,
  isWeightIncreaseEligible,
  SUGGESTION_TYPES
} from "./progression.js";
import {
  acceptSuggestion,
  buildDismissKey,
  createProgressionSuggestion,
  dismissSuggestion,
  migrateProgressionStorageData,
  SUGGESTION_STATUS
} from "./progression-storage.js";

const USER_WEIGHTS = [5, 8, 10, 12, 15, 20, 25, 30];

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

const defaultTarget = {
  exerciseId: "goblet-squat",
  sets: 3,
  minReps: 12,
  maxReps: 15,
  weight: 20,
  source: "plan"
};

function buildCompletedLiftSession({
  template = "A",
  liftSlug = "goblet-squat",
  reps = 15,
  weight = 20,
  effort = 7,
  painLevel = "none",
  stoppedEarly = false,
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
  sessions = setLiftFeedback(sessions, session.id, liftSlug, { effort, painLevel, stoppedEarly });
  sessions = completeSession(sessions, session.id, endedAt);
  return sessions[0];
}

test("getNextDumbbell returns the next weight from user inventory", () => {
  assert.equal(getNextDumbbell(20, USER_WEIGHTS), 25);
  assert.equal(getNextDumbbell(30, USER_WEIGHTS), null);
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

  const suggestion = evaluateProgression([second, first], gobletSquat, {
    target: defaultTarget,
    availableWeights: USER_WEIGHTS,
    suggestions: [],
    now: new Date("2026-07-20T12:00:00.000Z")
  });
  assert.equal(suggestion.type, SUGGESTION_TYPES.INCREASE_WEIGHT);
  assert.equal(suggestion.requiresConfirmation, true);
  assert.equal(suggestion.suggestedWeight, 25);
  assert.equal(suggestion.currentWeight, 20);
});

test("isWeightIncreaseEligible is false with missing effort data", () => {
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
  const missingEffort = buildCompletedLiftSession({
    reps: 15,
    weight: 20,
    endedAt: "2026-07-18T12:00:00.000Z"
  });
  missingEffort.liftFeedback = {};

  const result = isWeightIncreaseEligible([second, missingEffort], gobletSquat, defaultTarget, {
    availableWeights: USER_WEIGHTS
  });
  assert.equal(result.eligible, false);
});

test("evaluateProgression does not suggest weight increase with pain or high effort", () => {
  const painful = buildCompletedLiftSession({
    reps: 15,
    weight: 20,
    effort: 7,
    painLevel: "moderate",
    endedAt: "2026-07-13T12:00:00.000Z"
  });
  const latest = buildCompletedLiftSession({
    reps: 15,
    weight: 20,
    effort: 7,
    endedAt: "2026-07-20T12:00:00.000Z"
  });

  const withPain = evaluateProgression([latest, painful], gobletSquat, {
    target: defaultTarget,
    availableWeights: USER_WEIGHTS,
    now: new Date("2026-07-20T12:00:00.000Z")
  });
  assert.notEqual(withPain.type, SUGGESTION_TYPES.INCREASE_WEIGHT);

  const hardLatest = buildCompletedLiftSession({
    reps: 15,
    weight: 20,
    effort: 9,
    endedAt: "2026-07-20T12:00:00.000Z"
  });
  const hardPrevious = buildCompletedLiftSession({
    reps: 15,
    weight: 20,
    effort: 9,
    endedAt: "2026-07-13T12:00:00.000Z"
  });
  const withHighEffort = evaluateProgression([hardLatest, hardPrevious], gobletSquat, {
    target: defaultTarget,
    availableWeights: USER_WEIGHTS,
    now: new Date("2026-07-20T12:00:00.000Z")
  });
  assert.notEqual(withHighEffort.type, SUGGESTION_TYPES.INCREASE_WEIGHT);
  assert.equal(withHighEffort.type, SUGGESTION_TYPES.REDUCE_ONE_SET);
});

test("evaluateProgression suggests adding reps when close to the top of the range", () => {
  const session = buildCompletedLiftSession({
    reps: 13,
    weight: 20,
    effort: 7,
    endedAt: "2026-07-20T12:00:00.000Z"
  });

  const suggestion = evaluateProgression([session], gobletSquat, {
    target: defaultTarget,
    now: new Date("2026-07-20T12:00:00.000Z")
  });
  assert.equal(suggestion.type, SUGGESTION_TYPES.ADD_REPS_PER_SET);
});

test("suggests add reps total when no heavier dumbbell is available", () => {
  const first = buildCompletedLiftSession({
    reps: 15,
    weight: 30,
    effort: 7,
    endedAt: "2026-07-13T12:00:00.000Z"
  });
  const second = buildCompletedLiftSession({
    reps: 15,
    weight: 30,
    effort: 8,
    endedAt: "2026-07-20T12:00:00.000Z"
  });

  const suggestion = buildProgressionSuggestion([second, first], gobletSquat, {
    target: { ...defaultTarget, weight: 30 },
    availableWeights: USER_WEIGHTS,
    now: new Date("2026-07-20T12:00:00.000Z")
  });
  assert.equal(suggestion.type, SUGGESTION_TYPES.ADD_REPS_TOTAL);
});

test("getSessionsWithLift returns completed sessions newest first", () => {
  const older = buildCompletedLiftSession({ endedAt: "2026-07-13T12:00:00.000Z" });
  const newer = buildCompletedLiftSession({ endedAt: "2026-07-20T12:00:00.000Z" });
  const sessions = getSessionsWithLift([older, newer], "goblet-squat");
  assert.equal(sessions[0].id, newer.id);
});

test("dismissed suggestion suppresses matching dismiss key", () => {
  const proposed = { ...defaultTarget, weight: 25 };
  const dismissKey = buildDismissKey("goblet-squat", SUGGESTION_TYPES.INCREASE_WEIGHT, proposed);
  const dismissed = createProgressionSuggestion({
    exerciseId: "goblet-squat",
    type: SUGGESTION_TYPES.INCREASE_WEIGHT,
    currentTarget: defaultTarget,
    proposedTarget: proposed,
    reason: "test",
    evidence: "test",
    status: SUGGESTION_STATUS.DISMISSED
  });

  const result = isWeightIncreaseEligible(
    [
      buildCompletedLiftSession({ endedAt: "2026-07-20T12:00:00.000Z" }),
      buildCompletedLiftSession({ endedAt: "2026-07-13T12:00:00.000Z" })
    ],
    gobletSquat,
    defaultTarget,
    { availableWeights: USER_WEIGHTS, dismissedKeys: [dismissKey] }
  );
  assert.equal(result.eligible, false);
  assert.match(result.reason, /dismissed/i);
});

test("per-set sharp pain blocks weight increase eligibility", () => {
  const session = buildCompletedLiftSession({
    reps: 15,
    weight: 20,
    effort: 7,
    endedAt: "2026-07-20T12:00:00.000Z"
  });
  session.sets = session.sets.map((set) => ({ ...set, painDuringSet: "sharp" }));

  const result = isWeightIncreaseEligible(
    [session, buildCompletedLiftSession({ endedAt: "2026-07-13T12:00:00.000Z" })],
    gobletSquat,
    defaultTarget,
    { availableWeights: USER_WEIGHTS }
  );
  assert.equal(result.eligible, false);
  assert.match(result.reason, /pain/i);
});
