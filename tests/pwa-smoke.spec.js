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
    const cache = await caches.open("workout-plan-2-v9");
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
