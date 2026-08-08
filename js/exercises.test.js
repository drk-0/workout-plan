import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { EXERCISES, getWorkoutExercises } from "./exercises.js";

test("Workout B uses Dumbbell Pullover instead of a second main row", () => {
  const workoutB = getWorkoutExercises("B");
  const slugs = workoutB.map(exercise => exercise.slug);

  assert.ok(slugs.includes("dumbbell-pullover"));
  assert.ok(slugs.includes("chest-supported-row"));
  assert.ok(!slugs.includes("one-arm-row"));
});

test("One-Arm Row remains available as a pullover substitute", () => {
  const pullover = EXERCISES.find(exercise => exercise.slug === "dumbbell-pullover");
  const oneArmRow = EXERCISES.find(exercise => exercise.slug === "one-arm-row");

  assert.equal(oneArmRow.workout, "sub");
  assert.ok(pullover.substitutes.some(substitute => substitute.slug === "one-arm-row"));
  assert.equal(pullover.progression.type, "reps");
  assert.equal(pullover.progression.repMin, 10);
  assert.equal(pullover.progression.repMax, 15);
  assert.equal(pullover.imageSlug, undefined);
  assert.ok(existsSync("assets/exercises/dumbbell-pullover.png"));
});
