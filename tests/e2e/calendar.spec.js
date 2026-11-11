import { test, expect } from "@playwright/test";
import {
  fixtures as f,
  login,
  calendarUrl,
  resetPreferences,
  authentication,
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

test("each calendar load uses one complete response without follow-up data requests", async ({ page, request }, testInfo) => {
  const recordReads = [];
  const separateLoads = [];
  page.on('request', (request) => {
    if (/\/api\/v1\/(Activities|Timeline|CalendarPlus\/(Users|WorkingTimeRanges|EventDetails))(?:\?|$)/.test(request.url())) {
      separateLoads.push(request.url());
    }
  });
  const detailResponses = [];
  page.on("response", (response) => {
    if (response.url().endsWith('/CalendarPlus/Load')) {
      detailResponses.push(response.status());
    }
  });
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      /\/api\/v1\/(Meeting|Call|Task)\/[^/?]+(?:\?|$)/.test(request.url())
    ) {
      recordReads.push(request.url());
    }
  });
  await page.goto(calendarUrl("view-cp-test-week"));
  const event = page.locator(".fc-event:visible").filter({ hasText: "[CP Test]" }).first();
  await expect(event).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(recordReads).toEqual([]);
  expect(detailResponses.length).toBe(1);
  expect(separateLoads).toEqual([]);
  expect(detailResponses.every((status) => status === 200)).toBeTruthy();
  if (testInfo.project.name === 'chromium') {
    await event.hover();
    await expect(page.locator('.cp-calendar-event-tooltip')).toBeVisible();
    expect(recordReads).toEqual([]);
  }
  await event.click();
  await page.locator('.modal-dialog [data-name="edit"]').click();
  const save = page.locator('.modal-dialog [data-name="save"]');
  await expect(save).toBeVisible();
  await page.waitForLoadState("networkidle");
  const name = page.locator('.modal-dialog input[data-name="name"]');
  const originalName = await name.inputValue();
  await name.fill(`${originalName} performance check`);
  recordReads.length = 0;
  const saved = page.waitForResponse((response) =>
    response.request().method() === "PUT" && /\/api\/v1\/(Meeting|Call|Task)\//.test(response.url()),
  );
  const refreshed = page.waitForResponse((response) =>
    response.url().endsWith('/CalendarPlus/Load'),
  );
  await save.click();
  const savedResponse = await saved;
  try {
    expect(savedResponse.ok()).toBeTruthy();
    await refreshed;
    await page.waitForLoadState("networkidle");
    await expect(event).toBeVisible();
    expect(recordReads).toEqual([]);
    expect(detailResponses.length).toBe(2);
    expect(separateLoads).toEqual([]);
    expect(detailResponses.every((status) => status === 200)).toBeTruthy();
  } finally {
    const restored = await request.put(savedResponse.url(), {
      headers: authentication(),
      data: { name: originalName },
    });
    expect(restored.ok()).toBeTruthy();
  }
});

test('grid and timeline tooltips show actual attendees outside the selected calendar', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Hover tooltips require a mouse.');

  const endpoint = `/api/v1/Meeting/${f.events.meeting.id}`;
  const headers = authentication();
  const originalResponse = await request.get(endpoint, { headers });
  const original = await originalResponse.json();
  const attendee = f.people.harper;
  const changed = await request.put(endpoint, {
    headers,
    data: {
      usersIds: [...new Set([...original.usersIds, attendee.id, f.accounts.admin.id])],
      usersColumns: {
        ...original.usersColumns,
        [attendee.id]: { status: 'Accepted' },
        [f.accounts.admin.id]: { status: 'Accepted' },
      },
    },
  });

  expect(changed.ok()).toBeTruthy();

  const recordReads = [];

  page.on('request', (request) => {
    if (request.method() === 'GET' && /\/api\/v1\/Meeting\/[^/?]+/.test(request.url())) {
      recordReads.push(request.url());
    }
  });

  try {
    for (const mode of ['week', 'day', 'timeline', 'agendaWeek']) {
      let route = `view-cp-test-${mode}`;

      if (mode === 'agendaWeek') {
        route = mode;
      }

      await page.goto(calendarUrl(route));

      const event = page.locator('.fc-event:visible, .vis-item:visible')
        .filter({ hasText: f.events.meeting.name }).first();

      await expect(event).toBeVisible();
      await page.waitForLoadState('networkidle');
      await event.hover();

      const tooltip = page.locator('.cp-calendar-event-tooltip');
      const attendees = tooltip.locator('.cp-calendar-event-attendees');

      await expect(tooltip).toBeVisible();
      await expect(attendees).toContainText(attendee.name);
      await expect(attendees.locator('.cp-calendar-attendance-accepted')).toHaveCount(3);
      await expect(tooltip).not.toContainText('Calendar users');

      if (mode === 'agendaWeek') {
        expect(recordReads).toEqual([]);

        await event.click();
        await page.locator('.modal-dialog [data-name="edit"]').click();
        await page.locator('.modal-dialog input[data-name="name"]').fill(`${original.name} save check`);
        await page.waitForLoadState('networkidle');

        recordReads.length = 0;

        const refreshed = page.waitForResponse((response) => response.url().endsWith('/CalendarPlus/Load'));

        await page.locator('.modal-dialog [data-name="save"]').click();
        await refreshed;
        await expect(page.locator('.modal-dialog')).toBeHidden();
        await page.waitForLoadState('networkidle');
        await event.hover();
        await expect(attendees).toContainText(attendee.name);
        await expect(attendees.locator('.cp-calendar-attendance-accepted')).toHaveCount(3);
      }
    }

    expect(recordReads).toEqual([]);
  } finally {
    const restored = await request.put(endpoint, {
      headers,
      data: {
        name: original.name,
        usersIds: original.usersIds,
        usersColumns: original.usersColumns,
      },
    });

    expect(restored.ok()).toBeTruthy();
  }
});
