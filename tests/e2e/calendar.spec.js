import { test, expect } from "@playwright/test";
import {
  fixtures as f,
  login,
  calendarUrl,
  resetPreferences,
} from "../support/fixtures.js";

test.beforeEach(async ({ request, page }) => {
  await resetPreferences(request);
  await login(page);
});

test("saved calendar modes render real events when switching views", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(calendarUrl("view-cp-test-week"));
  for (const mode of ["week", "day", "month", "timeline"]) {
    if (mode !== "week") {
      await page.locator(".cp-calendar-picker > button").click();
      await page
        .locator(`[data-action="mode"][data-mode="view-cp-test-${mode}"]`)
        .click();
    }
    await expect(page.locator(".cp-calendar-picker-label")).toHaveText(
      `[CP Test] Team ${mode}`,
    );
    await expect(
      page
        .locator(".fc-event:visible, .vis-item:visible")
        .filter({ hasText: "[CP Test]" })
        .first(),
    ).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("search is available and opens from the active calendar", async ({
  page,
}) => {
  await page.goto(calendarUrl("view-cp-test-week"));
  await page.locator('[data-action="searchCalendar"]').click();
  await expect(page.locator(".modal-dialog")).toBeVisible();
  const dialog = page.locator(".modal-dialog");
  await dialog.locator('input[data-name="title"]').fill("Search target");
  await dialog.locator('input[data-name="title"]').press("Enter");
  await expect(dialog.locator(".cp-search-results")).toContainText(
    "1 matching event",
  );
  await expect(dialog.locator(".cp-search-results")).toContainText(
    f.events.search.name,
  );
  await expect(dialog.locator(".cp-search-results")).not.toContainText(
    "matching events",
  );
});
