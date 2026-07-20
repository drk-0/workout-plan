import { getSetsForLift } from "./workout-data.js";
import { weekKey } from "./progress.js";
import {
  DEFAULT_DUMBBELL_WEIGHTS,
  getDismissedKeys,
  seedTargetFromExercise
} from "./progression-storage.js";

export const DUMBBELL_WEIGHTS = DEFAULT_DUMBBELL_WEIGHTS;
export const MAX_EFFORT_FOR_WEIGHT_INCREASE = 8;
export const HIGH_EFFORT_THRESHOLD = 9;

export const PAIN_LEVELS = ["none", "mild", "moderate", "sharp"];

export const SUGGESTION_TYPES = {
  REPEAT_WEIGHT: "repeat_weight",
  ADD_REPS_PER_SET: "add_reps_per_set",
  ADD_REPS_TOTAL: "add_reps_total",
  INCREASE_WEIGHT: "increase_weight",
  REDUCE_WEIGHT: "reduce_weight",
  REDUCE_ONE_SET: "reduce_one_set",
  SUBSTITUTION: "substitution",
  EASIER_SESSION: "easier_session"
};

export function getNextDumbbell(weight, availableWeights = DEFAULT_DUMBBELL_WEIGHTS) {
  const sorted = [...availableWeights].sort((a, b) => a - b);
  const current = Number(weight) || 0;
  return sorted.find((option) => option > current) ?? null;
}

export function getSessionsWithLift(sessions, liftSlug) {
  return (sessions || [])
    .filter((session) => session.endedAt && getSetsForLift(session, liftSlug).length > 0)
    .sort(
      (a, b) =>
        new Date(b.endedAt || b.startedAt) - new Date(a.endedAt || a.startedAt)
    );
}

export function getOrderedSetsForLift(session, liftSlug) {
  return getSetsForLift(session, liftSlug).sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );
}

export function getTypicalWeight(session, liftSlug) {
  const sets = getOrderedSetsForLift(session, liftSlug).filter((set) => (+set.weight || 0) > 0);
  if (!sets.length) return null;

  const weights = sets.map((set) => +set.weight);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return Math.round((total / weights.length) * 10) / 10;
}

export function getLiftFeedback(session, liftSlug) {
  return session?.liftFeedback?.[liftSlug] || null;
}

export function getPainLevel(feedback) {
  if (!feedback) return null;
  if (feedback.painLevel) return feedback.painLevel;
  if (feedback.pain === true) return "moderate";
  if (feedback.pain === false) return "none";
  return null;
}

export function isBlockingPain(level) {
  return level === "moderate" || level === "sharp";
}

export function hasRequiredFeedback(session, liftSlug) {
  const feedback = getLiftFeedback(session, liftSlug);
  if (!feedback || feedback.effort == null) return false;
  return getPainLevel(feedback) != null;
}

export function targetToProgression(target, exercise) {
  const prog = exercise?.progression || {};
  return {
    type: prog.type || "reps",
    sets: target?.sets || prog.sets || 3,
    repMin: target?.minReps ?? prog.repMin,
    repMax: target?.maxReps ?? prog.repMax,
    usesDumbbells: prog.usesDumbbells !== false
  };
}

export function allPrescribedSetsCompleted(session, liftSlug, progression) {
  const sets = getOrderedSetsForLift(session, liftSlug);
  const prescribedSets = progression.sets || 3;
  return sets.length >= prescribedSets;
}

export function allPrescribedSetsAtRepTop(session, liftSlug, progression) {
  if (!progression || progression.type === "time") return false;

  const sets = getOrderedSetsForLift(session, liftSlug);
  const prescribedSets = progression.sets || 3;
  const repMax = progression.repMax;
  if (!repMax || sets.length < prescribedSets) return false;

  return sets.slice(0, prescribedSets).every((set) => (+set.reps || 0) >= repMax);
}

export function repsBelowMin(session, liftSlug, progression) {
  if (!progression || progression.type === "time") return false;

  const sets = getOrderedSetsForLift(session, liftSlug).slice(0, progression.sets || 3);
  if (sets.length < (progression.sets || 3)) return false;
  const repMin = progression.repMin ?? progression.repMax - 2;
  return sets.some((set) => (+set.reps || 0) < repMin);
}

export function isCloseToRepTop(session, liftSlug, progression) {
  if (!progression || progression.type === "time") return false;

  const sets = getOrderedSetsForLift(session, liftSlug);
  const prescribedSets = progression.sets || 3;
  const repMax = progression.repMax;
  const repMin = progression.repMin ?? repMax - 2;
  if (!repMax || sets.length < prescribedSets) return false;

  const workingSets = sets.slice(0, prescribedSets);
  const atTop = workingSets.every((set) => (+set.reps || 0) >= repMax);
  if (atTop) return false;

  return workingSets.every((set) => {
    const reps = +set.reps || 0;
    return reps >= repMin && reps < repMax;
  });
}

export function countRecentHighEffortSessions(liftSessions, liftSlug, count = 2) {
  let highEffortCount = 0;

  for (const session of liftSessions.slice(0, count)) {
    const effort = getLiftFeedback(session, liftSlug)?.effort;
    if (effort != null && effort >= HIGH_EFFORT_THRESHOLD) {
      highEffortCount += 1;
    }
  }

  return highEffortCount;
}

export function shouldSuggestEasierSession(sessions, now = new Date()) {
  const currentWeek = weekKey(now);
  const completedThisWeek = (sessions || []).filter(
    (session) => session.endedAt && weekKey(session.endedAt) === currentWeek
  );

  if (completedThisWeek.length >= 2) {
    let highEffortLifts = 0;
    for (const session of completedThisWeek) {
      const feedback = session.liftFeedback || {};
      for (const entry of Object.values(feedback)) {
        if (entry?.effort != null && entry.effort >= HIGH_EFFORT_THRESHOLD) {
          highEffortLifts += 1;
        }
      }
    }
    if (highEffortLifts >= 3) return true;
  }

  return shouldMaintainDueToConsistency(sessions, now);
}

export function shouldMaintainDueToConsistency(sessions, now = new Date()) {
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const completed = (sessions || []).filter(
    (session) => session.endedAt && new Date(session.endedAt) >= twoWeeksAgo
  );
  if (completed.length === 0) return true;

  const incomplete = (sessions || []).filter((session) => !session.endedAt);
  if (incomplete.length >= 2) return true;

  return false;
}

export function averageEffort(sessions, liftSlug, count = 2) {
  const efforts = sessions
    .slice(0, count)
    .map((session) => getLiftFeedback(session, liftSlug)?.effort)
    .filter((effort) => effort != null);

  if (!efforts.length) return null;
  const total = efforts.reduce((sum, effort) => sum + effort, 0);
  return Math.round((total / efforts.length) * 10) / 10;
}

export function buildEvidence(sessions, exerciseId, target, exercise = null) {
  const liftSessions = getSessionsWithLift(sessions, exerciseId).slice(0, 2);
  if (!liftSessions.length) {
    return "Not enough completed sessions yet to compare recent performance.";
  }

  const progression = targetToProgression(target, exercise);
  const perSide = progression.type === "reps_per_side" ? " per leg" : "";
  const sessionParts = liftSessions.map((session) => {
    const sets = getOrderedSetsForLift(session, exerciseId).slice(0, progression.sets || 3);
    const reps = sets.map((set) => +set.reps || 0);
    const weight = getTypicalWeight(session, exerciseId);
    const weightPart = weight ? ` at ${weight} lb` : "";
    return `${sets.length} sets of ${reps.join(", ")} reps${perSide}${weightPart}`;
  });

  const efforts = liftSessions
    .map((session) => getLiftFeedback(session, exerciseId)?.effort)
    .filter((effort) => effort != null);
  const avgEffort = efforts.length
    ? Math.round((efforts.reduce((a, b) => a + b, 0) / efforts.length) * 10) / 10
    : null;

  const painReported = liftSessions.some((session) => {
    const level = getPainLevel(getLiftFeedback(session, exerciseId));
    return level && level !== "none";
  });

  const effortPart = avgEffort != null ? ` with average effort of ${avgEffort}` : "";
  const painPart = painReported ? " with pain reported" : " and no pain reported";
  const sessionLabel = liftSessions.length === 1 ? "last session" : "last two sessions";

  return `You completed ${sessionParts.join(" and ")} in your ${sessionLabel}${effortPart}${painPart}.`;
}

export function isWeightIncreaseEligible(sessions, exercise, target, options = {}) {
  const liftSlug = exercise.slug;
  const progression = targetToProgression(target, exercise);
  const liftSessions = getSessionsWithLift(sessions, liftSlug);

  if (progression.type === "time" || !progression.usesDumbbells) {
    return { eligible: false, reason: "This exercise does not use dumbbell weight progression." };
  }

  if (liftSessions.length < 2) {
    return { eligible: false, reason: "Need at least two recent completed sessions." };
  }

  const [latest, previous] = liftSessions;
  if (!allPrescribedSetsCompleted(latest, liftSlug, progression) ||
      !allPrescribedSetsCompleted(previous, liftSlug, progression)) {
    return { eligible: false, reason: "Not all prescribed work sets were completed." };
  }

  if (!allPrescribedSetsAtRepTop(latest, liftSlug, progression) ||
      !allPrescribedSetsAtRepTop(previous, liftSlug, progression)) {
    return { eligible: false, reason: "Top of rep range not reached in two recent sessions." };
  }

  if (!hasRequiredFeedback(latest, liftSlug) || !hasRequiredFeedback(previous, liftSlug)) {
    return { eligible: false, reason: "Effort or pain data missing from recent sessions." };
  }

  const latestFeedback = getLiftFeedback(latest, liftSlug);
  const previousFeedback = getLiftFeedback(previous, liftSlug);
  const avgEffort = averageEffort(liftSessions, liftSlug, 2);

  if (avgEffort == null || avgEffort > MAX_EFFORT_FOR_WEIGHT_INCREASE) {
    return { eligible: false, reason: "Average effort was above the conservative threshold." };
  }

  for (const session of [latest, previous]) {
    const feedback = getLiftFeedback(session, liftSlug);
    if (isBlockingPain(getPainLevel(feedback))) {
      return { eligible: false, reason: "Moderate or sharp pain was recorded." };
    }
    if (feedback?.stoppedEarly) {
      return { eligible: false, reason: "Exercise was stopped early for symptoms." };
    }
  }

  const dismissedKeys = options.dismissedKeys || [];
  const proposedWeight = getNextDumbbell(
    getTypicalWeight(latest, liftSlug),
    options.availableWeights
  );
  if (!proposedWeight) {
    return { eligible: false, reason: "No higher dumbbell is available." };
  }

  const dismissKey = `${liftSlug}|${SUGGESTION_TYPES.INCREASE_WEIGHT}|${JSON.stringify({ ...target, weight: proposedWeight })}`;
  if (dismissedKeys.includes(dismissKey)) {
    return { eligible: false, reason: "You recently dismissed this suggestion." };
  }

  return { eligible: true, reason: "Two qualifying sessions with manageable effort and no pain." };
}

function cloneTarget(target) {
  return target ? { ...target } : null;
}

function buildResult(type, reason, recommendation, currentTarget, proposedTarget, extra = {}) {
  return {
    type,
    reason,
    recommendation,
    currentTarget: cloneTarget(currentTarget),
    proposedTarget: cloneTarget(proposedTarget),
    requiresConfirmation: type === SUGGESTION_TYPES.INCREASE_WEIGHT,
    ...extra
  };
}

export function buildProgressionSuggestion(sessions, exercise, options = {}) {
  const target = options.target || seedTargetFromExercise(exercise, sessions);
  const progression = targetToProgression(target, exercise);
  const liftSlug = exercise.slug;
  const liftSessions = getSessionsWithLift(sessions, liftSlug);
  const latestSession = liftSessions[0] || null;
  const dismissedKeys = options.dismissedKeys || getDismissedKeys(options.suggestions);
  const availableWeights = options.availableWeights || DEFAULT_DUMBBELL_WEIGHTS;
  const currentWeight = latestSession ? getTypicalWeight(latestSession, liftSlug) : target.weight;

  if (shouldSuggestEasierSession(sessions, options.now)) {
    return buildResult(
      SUGGESTION_TYPES.EASIER_SESSION,
      "Recent training load or consistency suggests holding steady.",
      "Consider an easier session: lighter weights, fewer sets, or an extra rest day.",
      target,
      { ...target }
    );
  }

  if (latestSession) {
    const latestPain = getPainLevel(getLiftFeedback(latestSession, liftSlug));
    if (isBlockingPain(latestPain)) {
      return buildResult(
        SUGGESTION_TYPES.SUBSTITUTION,
        "Pain was reported in your last session for this exercise.",
        "Do not progress. Consider a substitution, reduced range, or skipping this exercise next time.",
        target,
        { ...target }
      );
    }
  }

  if (countRecentHighEffortSessions(liftSessions, liftSlug, 2) >= 2) {
    const reduced = { ...target, sets: Math.max(1, (target.sets || 3) - 1) };
    return buildResult(
      SUGGESTION_TYPES.REDUCE_ONE_SET,
      "Effort was 9–10 in your last two sessions here.",
      "Repeat or reduce load. Drop one set or stay at the low end of the rep range next time.",
      target,
      reduced
    );
  }

  if (latestSession && repsBelowMin(latestSession, liftSlug, progression)) {
    const latestEffort = getLiftFeedback(latestSession, liftSlug)?.effort;
    if (latestEffort != null && latestEffort >= HIGH_EFFORT_THRESHOLD && currentWeight) {
      const prevWeight = getPreviousDumbbell(currentWeight, availableWeights);
      return buildResult(
        SUGGESTION_TYPES.REDUCE_WEIGHT,
        "Reps were below the target range with high effort.",
        `Consider reducing to ${prevWeight ?? "a lighter"} lb and repeating.`,
        target,
        { ...target, weight: prevWeight ?? target.weight }
      );
    }
    return buildResult(
      SUGGESTION_TYPES.REPEAT_WEIGHT,
      "Reps were below the bottom of your target range.",
      "Repeat the same weight and aim for clean reps within range.",
      target,
      { ...target }
    );
  }

  const weightEligibility = isWeightIncreaseEligible(sessions, exercise, target, {
    dismissedKeys,
    availableWeights
  });

  if (weightEligibility.eligible) {
    const nextWeight = getNextDumbbell(currentWeight, availableWeights);
    return buildResult(
      SUGGESTION_TYPES.INCREASE_WEIGHT,
      weightEligibility.reason,
      `You may be ready for ${nextWeight} lb (currently ${currentWeight} lb). Confirm only if form stays solid.`,
      target,
      { ...target, weight: nextWeight },
      { suggestedWeight: nextWeight, currentWeight }
    );
  }

  if (liftSessions.length >= 2 &&
      allPrescribedSetsAtRepTop(liftSessions[0], liftSlug, progression) &&
      allPrescribedSetsAtRepTop(liftSessions[1], liftSlug, progression)) {
    const nextWeight = getNextDumbbell(currentWeight, availableWeights);
    if (!nextWeight && progression.usesDumbbells && (+currentWeight || 0) > 0) {
      return buildResult(
        SUGGESTION_TYPES.ADD_REPS_TOTAL,
        "You are at the top of your rep range but no heavier dumbbell is available.",
        "Add 1–2 reps total across sets, or slow the lowering tempo, instead of increasing weight.",
        target,
        { ...target }
      );
    }
    return buildResult(
      SUGGESTION_TYPES.REPEAT_WEIGHT,
      "You reached the top of the rep range but other factors suggest holding load.",
      "Repeat the same weight next time and build consistency before adding load.",
      target,
      { ...target }
    );
  }

  if (latestSession) {
    if (allPrescribedSetsAtRepTop(latestSession, liftSlug, progression)) {
      return buildResult(
        SUGGESTION_TYPES.REPEAT_WEIGHT,
        "You reached the top of the rep range in your last workout.",
        "Repeat the same weight next time and build consistency before adding load.",
        target,
        { ...target }
      );
    }

    if (isCloseToRepTop(latestSession, liftSlug, progression)) {
      return buildResult(
        SUGGESTION_TYPES.ADD_REPS_PER_SET,
        "You are within the target range but not at the top.",
        "Try adding 1 rep per set before increasing weight.",
        target,
        { ...target }
      );
    }
  }

  const nextWeight = getNextDumbbell(currentWeight, availableWeights);
  if (
    liftSessions.length >= 2 &&
    allPrescribedSetsAtRepTop(liftSessions[0], liftSlug, progression) &&
    allPrescribedSetsAtRepTop(liftSessions[1], liftSlug, progression) &&
    !nextWeight &&
    progression.usesDumbbells &&
    (+currentWeight || 0) > 0
  ) {
    return buildResult(
      SUGGESTION_TYPES.ADD_REPS_TOTAL,
      "You are at the top of your rep range but no heavier dumbbell is available.",
      "Add 1–2 reps total across sets, or slow the lowering tempo, instead of increasing weight.",
      target,
      { ...target }
    );
  }

  return buildResult(
    SUGGESTION_TYPES.REPEAT_WEIGHT,
    "Stay conservative until more consistent sessions are logged.",
    currentWeight
      ? `Repeat ${currentWeight} lb and focus on controlled reps.`
      : "Repeat the same weight and focus on controlled reps.",
    target,
    { ...target }
  );
}

export function getPreviousDumbbell(weight, availableWeights = DEFAULT_DUMBBELL_WEIGHTS) {
  const sorted = [...availableWeights].sort((a, b) => a - b);
  const current = Number(weight) || 0;
  const below = sorted.filter((option) => option < current);
  return below.length ? below[below.length - 1] : null;
}

export function evaluateProgression(sessions, exercise, options = {}) {
  const built = buildProgressionSuggestion(sessions, exercise, options);
  return {
    type: built.type,
    message: built.reason,
    suggestion: built.recommendation,
    requiresConfirmation: built.requiresConfirmation,
    suggestedWeight: built.suggestedWeight,
    currentWeight: built.currentWeight,
    evidence: buildEvidence(sessions, exercise.slug, built.currentTarget, exercise),
    currentTarget: built.currentTarget,
    proposedTarget: built.proposedTarget,
    reason: built.reason
  };
}

export function formatSuggestionTitle(suggestion) {
  switch (suggestion.type) {
    case SUGGESTION_TYPES.INCREASE_WEIGHT:
      return "Ready to move up?";
    case SUGGESTION_TYPES.ADD_REPS_PER_SET:
    case SUGGESTION_TYPES.ADD_REPS_TOTAL:
      return "Add reps first";
    case SUGGESTION_TYPES.REDUCE_WEIGHT:
    case SUGGESTION_TYPES.REDUCE_ONE_SET:
      return "Ease up slightly";
    case SUGGESTION_TYPES.SUBSTITUTION:
      return "Consider a change";
    case SUGGESTION_TYPES.EASIER_SESSION:
      return "Consider an easier session";
    default:
      return "Keep building";
  }
}

export function formatSuggestionRecommendation(suggestion) {
  return suggestion.recommendation || suggestion.suggestion || "";
}
