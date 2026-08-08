import { expect, test } from "@playwright/test";

function failOnPageErrors(page) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  return () => expect(errors, "The page emitted JavaScript errors").toEqual([]);
}

async function seedActiveWorkout(page) {
  await page.addInitScript(() => {
    localStorage.setItem("workoutHistory", JSON.stringify([{
      id: "session-browser-test",
      schemaVersion: 2,
      template: "A",
      workout: "Workout A",
      startedAt: new Date().toISOString(),
      endedAt: null,
      completedLifts: [],
      skippedExercises: [],
      substitutions: [],
      progressionDecisions: [],
      sets: [],
      readiness: {
        energy: 3,
        soreness: 2,
        painToday: "none",
        recordedAt: new Date().toISOString(),
        blocked: false,
        blockReasons: [],
        suggestedAdjustments: [],
        acceptedAdjustments: []
      },
      warmUp: {
        completed: true,
        skipped: false,
        completedAt: new Date().toISOString()
      }
    }]));
  });
}

test("starts and renders primary navigation", async ({ page }) => {
  const assertNoPageErrors = failOnPageErrors(page);

  await page.goto("/");

  await expect(page.locator("#app")).toContainText("Workout Plan");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(page.locator("#ios-install")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  assertNoPageErrors();
});

test("pre-workout questions and choices meet contrast requirements", async ({ page }) => {
  const assertNoPageErrors = failOnPageErrors(page);
  await page.goto("/#/readiness/A");

  const question = page.locator(".readiness-card .field-label").first();
  const choice = page.locator(".readiness-card .scale-btn").first();
  await expect(question).toBeVisible();
  await expect(choice).toBeVisible();

  for (const locator of [question, choice]) {
    const contrast = await locator.evaluate(element => {
      const parse = value => value.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number);
      const opaqueBackground = start => {
        let current = start;
        while (current) {
          const color = getComputedStyle(current).backgroundColor;
          const channels = color.match(/\d+(?:\.\d+)?/g).map(Number);
          if (channels.length < 4 || channels[3] > 0) return color;
          current = current.parentElement;
        }
        return "rgb(255, 255, 255)";
      };
      const luminance = rgb => {
        const channels = rgb.map(value => {
          const normalized = value / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const style = getComputedStyle(element);
      const foreground = luminance(parse(style.color));
      const background = luminance(parse(opaqueBackground(element)));
      return (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  }
  assertNoPageErrors();
});

test("substitute picker can be dismissed without changing exercise", async ({ page }) => {
  const assertNoPageErrors = failOnPageErrors(page);
  await seedActiveWorkout(page);
  await page.goto("/#/lift/goblet-squat");

  const dialog = page.getByRole("dialog", { name: "Choose a substitute" });
  await expect(dialog).toBeHidden();
  await page.locator("#set-pain").selectOption("sharp");
  await page.getByRole("button", { name: "Choose Substitute" }).click();
  await expect(dialog).toBeVisible();

  await page.getByRole("button", { name: "Back to Goblet Squat (no change)" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Goblet Squat", level: 1 })).toBeVisible();
  const substitutions = await page.evaluate(() => JSON.parse(localStorage.getItem("workoutHistory"))[0].substitutions);
  expect(substitutions).toEqual([]);
  assertNoPageErrors();
});

test("rest timer announces completion and triggers alarm outputs", async ({ page }) => {
  const assertNoPageErrors = failOnPageErrors(page);
  await seedActiveWorkout(page);
  await page.addInitScript(() => {
    window.__alarmNotes = 0;
    window.__vibrationPattern = null;
    class FakeAudioParam {
      setValueAtTime() {}
      exponentialRampToValueAtTime() {}
    }
    class FakeOscillator {
      constructor() {
        this.frequency = new FakeAudioParam();
      }
      connect() {}
      start() { window.__alarmNotes += 1; }
      stop() {}
      addEventListener() {}
    }
    class FakeGain {
      constructor() {
        this.gain = new FakeAudioParam();
      }
      connect() {}
    }
    class FakeAudioContext {
      constructor() {
        this.currentTime = 0;
        this.destination = {};
        this.state = "running";
      }
      createOscillator() { return new FakeOscillator(); }
      createGain() { return new FakeGain(); }
      resume() { return Promise.resolve(); }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
    Object.defineProperty(Navigator.prototype, "vibrate", {
      configurable: true,
      value(pattern) {
        window.__vibrationPattern = pattern;
        return true;
      }
    });
  });
  await page.goto("/#/lift/goblet-squat");

  await page.getByRole("button", { name: "Start" }).click();
  await page.evaluate(() => {
    const completedAt = Date.now() + 180_000;
    Date.now = () => completedAt;
  });

  await expect(page.getByRole("status")).toHaveText("Rest complete");
  await expect(page.locator(".time")).toHaveClass(/timer-complete/);
  await expect.poll(() => page.evaluate(() => window.__alarmNotes)).toBe(3);
  expect(await page.evaluate(() => window.__vibrationPattern)).toEqual([400, 150, 400, 150, 700]);
  assertNoPageErrors();
});

test("timed exercises use a duration timer and save seconds", async ({ page }) => {
  const assertNoPageErrors = failOnPageErrors(page);
  await seedActiveWorkout(page);
  await page.goto("/#/lift/farmer-carry");

  await expect(page.getByRole("heading", { name: "Timed Set + Rest Timer" })).toBeVisible();
  await expect(page.locator(".round-status")).toHaveText("Round 1 of 3");
  await expect(page.locator(".counter")).toHaveCount(0);
  await page.getByRole("button", { name: "45 sec" }).click();
  await expect(page.locator(".work-time")).toHaveText("0:45");
  await page.locator("#set-effort").selectOption("5");
  await page.locator("#set-pain").selectOption("none");

  for(let round = 1; round <= 3; round++){
    await page.getByRole("button", { name: "Start", exact: true }).first().click();
    await page.evaluate(() => {
      const completedAt = Date.now() + 60_000;
      Date.now = () => completedAt;
    });
    await expect(page.locator(".exercise-timer-status")).toContainText(`Round ${round} complete`);
    await page.getByRole("button", { name: "Save Timed Set" }).click();

    if(round < 3){
      await expect(page.locator(".round-status")).toContainText(`rest before round ${round + 1}`);
      await expect(page.getByRole("button", { name: "Start", exact: true }).first()).toBeDisabled();
      await page.evaluate(() => {
        const restCompletedAt = Date.now() + 90_000;
        Date.now = () => restCompletedAt;
      });
      await expect(page.locator(".rest-timer-status")).toHaveText("Rest complete");
      await expect(page.locator(".round-status")).toContainText(`Round ${round + 1} of 3`);
      await expect(page.getByRole("button", { name: "Start", exact: true }).first()).toBeEnabled();
    }
  }

  const savedSets = await page.evaluate(() => JSON.parse(localStorage.getItem("workoutHistory"))[0].sets);
  expect(savedSets).toHaveLength(3);
  expect(savedSets.every(set => set.lift === "farmer-carry")).toBe(true);
  expect(savedSets.every(set => set.durationSeconds === 45)).toBe(true);
  expect(savedSets.every(set => set.reps === 0)).toBe(true);
  await expect(page.locator(".round-status")).toHaveText("All 3 rounds complete");
  await expect(page.getByRole("button", { name: "All Timed Rounds Saved" })).toBeDisabled();
  assertNoPageErrors();
});

test("@offline reloads and renders after installation", async ({ page, context }) => {
  const assertNoPageErrors = failOnPageErrors(page);

  await page.goto("/");
  await expect(page.locator("#app")).toContainText("Workout Plan");
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => {
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
      });
    }
    const cache = await caches.open("workout-plan-2-v15");
    const expected = [
      "js/health-integration.js",
      "js/health-connect.js",
      "js/health-connect-mapping.js",
      "js/timer-alert.js"
    ];
    const cachedUrls = (await cache.keys()).map(request => new URL(request.url).pathname);
    if (!expected.every(path => cachedUrls.some(url => url.endsWith(path)))) {
      throw new Error("Health integration modules were not precached");
    }
    await registration.update();
  });

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.locator("#app")).toContainText("Workout Plan");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  assertNoPageErrors();
});
