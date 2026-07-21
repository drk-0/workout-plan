import { EXERCISES } from "./exercises.js";

export function getExerciseBySlug(slug) {
  return EXERCISES.find((item) => item.slug === slug) || null;
}

export function getSubstitutes(exercise) {
  if (!exercise?.substitutes?.length) return [];
  return exercise.substitutes
    .map((sub) => {
      const target = getExerciseBySlug(sub.slug);
      if (!target) return null;
      return { ...sub, exercise: target };
    })
    .filter(Boolean);
}

export function recordSubstitution(session, originalSlug, substituteSlug) {
  const substitutions = [...(session.substitutions || [])];
  substitutions.push({
    originalSlug,
    substituteSlug,
    at: new Date().toISOString()
  });
  return { ...session, substitutions };
}

export function getActiveSubstitute(session, originalSlug) {
  const subs = session?.substitutions || [];
  for (let index = subs.length - 1; index >= 0; index -= 1) {
    if (subs[index].originalSlug === originalSlug) return subs[index].substituteSlug;
  }
  return null;
}

export function resolveLiftSlug(session, slug) {
  return getActiveSubstitute(session, slug) || slug;
}
