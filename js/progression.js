import { getSetsForLift } from "./workout-data.js";
import { weekKey } from "./progress.js";

export const DUMBBELL_WEIGHTS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];
export const MAX_EFFORT_FOR_WEIGHT_INCREASE = 8;
export const HIGH_EFFORT_THRESHOLD = 9;

export const SUGGESTION_TYPES = {
  REPEAT_WEIGHT: "repeat_weight",
  ADD_REPS: "add_reps",
  INCREASE_WEIGHT: "increase_weight",
  REDUCE_VOLUME: "reduce_volume",
  DELOAD_WEEK: "deload_week"
};

export function getNextDumbbell(weight) {
  const current = Number(weight) || 0;
  return DUMBBELL_WEIGHTS.find((option) => option > current) ?? null;
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

export function allPrescribedSetsAtRepTop(session, liftSlug, progression) {
  if (!progression || progression.type === "time") return false;

  const sets = getOrderedSetsForLift(session, liftSlug);
  const prescribedSets = progression.sets || 3;
  const repMax = progression.repMax;
  if (!repMax || sets.length < prescribedSets) return false;

  return sets.slice(0, prescribedSets).every((set) => (+set.reps || 0) >= repMax);
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

export function shouldSuggestDeloadWeek(sessions, now = new Date()) {
  const currentWeek = weekKey(now);
  const completedThisWeek = (sessions || []).filter(
    (session) => session.endedAt && weekKey(session.endedAt) === currentWeek
  );

  if (completedThisWeek.length < 2) return false;

  let highEffortLifts = 0;
  for (const session of completedThisWeek) {
    const feedback = session.liftFeedback || {};
    for (const entry of Object.values(feedback)) {
      if (entry?.effort != null && entry.effort >= HIGH_EFFORT_THRESHOLD) {
        highEffortLifts += 1;
      }
    }
  }

  return highEffortLifts >= 3;
}

function baseSuggestion(type, message, suggestion, extra = {}) {
  return {
    type,
    message,
    suggestion,
    requiresConfirmation: false,
    ...extra
  };
}

export function evaluateProgression(sessions, exercise, now = new Date()) {
  const progression = exercise?.progression;
  if (!progression) {
    return baseSuggestion(
      SUGGESTION_TYPES.REPEAT_WEIGHT,
      "Progress gradually.",
      "Focus on clean reps and stop with 1–3 good reps left."
    );
  }

  const liftSlug = exercise.slug;
  const liftSessions = getSessionsWithLift(sessions, liftSlug);
  const latestSession = liftSessions[0] || null;
  const currentWeight = latestSession ? getTypicalWeight(latestSession, liftSlug) : null;

  if (shouldSuggestDeloadWeek(sessions, now)) {
    return baseSuggestion(
      SUGGESTION_TYPES.DELOAD_WEEK,
      "This week has felt demanding.",
      "Consider an easier week: lighter weights, fewer sets, or an extra rest day."
    );
  }

  if (countRecentHighEffortSessions(liftSessions, liftSlug, 2) >= 2) {
    return baseSuggestion(
      SUGGESTION_TYPES.REDUCE_VOLUME,
      "Recent sessions here have been hard.",
      "Keep the same weight but drop one set, or stay at the low end of the rep range next time."
    );
  }

  if (progression.usesDumbbells && progression.type !== "time" && liftSessions.length >= 2) {
    const [latest, previous] = liftSessions;
    const latestTop = allPrescribedSetsAtRepTop(latest, liftSlug, progression);
    const previousTop = allPrescribedSetsAtRepTop(previous, liftSlug, progression);
    const latestFeedback = getLiftFeedback(latest, liftSlug);
    const previousFeedback = getLiftFeedback(previous, liftSlug);
    const effortReported =
      latestFeedback?.effort != null && previousFeedback?.effort != null;
    const effortOk =
      effortReported &&
      latestFeedback.effort <= MAX_EFFORT_FOR_WEIGHT_INCREASE &&
      previousFeedback.effort <= MAX_EFFORT_FOR_WEIGHT_INCREASE;
    const noPain = !latestFeedback?.pain && !previousFeedback?.pain;

    if (latestTop && previousTop && effortOk && noPain) {
      const nextWeight = getNextDumbbell(currentWeight);
      if (nextWeight) {
        return baseSuggestion(
          SUGGESTION_TYPES.INCREASE_WEIGHT,
          `You hit ${progression.repMax} reps on all prescribed sets for two workouts with manageable effort.`,
          `You may be ready for ${nextWeight} lb (currently ${currentWeight} lb). Confirm only if form stays solid.`,
          {
            requiresConfirmation: true,
            suggestedWeight: nextWeight,
            currentWeight
          }
        );
      }
    }
  }

  if (latestSession) {
    if (allPrescribedSetsAtRepTop(latestSession, liftSlug, progression)) {
      return baseSuggestion(
        SUGGESTION_TYPES.REPEAT_WEIGHT,
        "You reached the top of the rep range in your last workout.",
        "Repeat the same weight next time and build consistency before adding load."
      );
    }

    if (isCloseToRepTop(latestSession, liftSlug, progression)) {
      return baseSuggestion(
        SUGGESTION_TYPES.ADD_REPS,
        "You are close to the top of the rep range.",
        "Try adding 1–2 reps per set before increasing weight."
      );
    }
  }

  return baseSuggestion(
    SUGGESTION_TYPES.REPEAT_WEIGHT,
    "Stay conservative.",
    currentWeight
      ? `Repeat ${currentWeight} lb and focus on controlled reps.`
      : "Repeat the same weight and focus on controlled reps."
  );
}

export function formatSuggestionTitle(suggestion) {
  switch (suggestion.type) {
    case SUGGESTION_TYPES.INCREASE_WEIGHT:
      return "Ready to move up?";
    case SUGGESTION_TYPES.ADD_REPS:
      return "Add reps first";
    case SUGGESTION_TYPES.REDUCE_VOLUME:
      return "Ease up slightly";
    case SUGGESTION_TYPES.DELOAD_WEEK:
      return "Consider an easier week";
    default:
      return "Keep building";
  }
}
