import { expect, test } from "@playwright/test";

function failOnPageErrors(page) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  return () => expect(errors, "The page emitted JavaScript errors").toEqual([]);
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
    const cache = await caches.open("workout-plan-2-v10");
    const expected = [
      "js/health-integration.js",
      "js/health-connect.js",
      "js/health-connect-mapping.js"
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
