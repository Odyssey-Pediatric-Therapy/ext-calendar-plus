import { test, expect } from '@playwright/test';
import { fixtures as f, authentication, login, resetPreferences, calendarUrl } from '../support/fixtures.js';

async function resetLayout(request, scope) {
  const response = await request.post('/api/v1/Layout/action/resetToDefault', {
    headers: authentication(), data: { scope, name: 'calendarPlusTooltip' },
  });

  expect(response.ok()).toBeTruthy();
}

async function dragField(page, field, target) {
  await field.scrollIntoViewIfNeeded();

  const from = await field.boundingBox();
  const to = await target.boundingBox();

  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + from.height / 2 + 10, { steps: 4 });
  await page.mouse.move(to.x + 30, to.y + 12, { steps: 20 });
  await page.mouse.up();
}

test.beforeEach(async ({ request, page }) => {
  await resetPreferences(request);
  await resetLayout(request, 'Meeting');
  await resetLayout(request, 'CLayoutSession');
  await login(page);
});

test.afterEach(async ({ request }) => {
  await resetLayout(request, 'Meeting');
  await resetLayout(request, 'CLayoutSession');
  await request.put('/api/v1/Settings', {
    headers: authentication(), data: { calendarPlusTooltipEnabled: true },
  });
});

test('Layout Manager edits, saves empty, and resets tooltips while disabled', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Drag-and-drop check uses a mouse.');

  const disabled = await request.put('/api/v1/Settings', {
    headers: authentication(), data: { calendarPlusTooltipEnabled: false },
  });

  expect(disabled.ok()).toBeTruthy();

  await page.goto('/#Admin/layouts/scope=Meeting&type=calendarPlusTooltip');
  await page.reload();

  const enabled = page.locator('#layout ul.enabled');
  const inactive = page.locator('#layout ul.disabled');

  await expect(page.locator('#layout-header')).toContainText('Calendar Tooltip');
  await expect(enabled.locator('[data-name=":attendees"]')).toBeVisible();
  await dragField(page, inactive.locator('[data-name="description"]'), enabled);
  await expect(enabled.locator('[data-name="description"]')).toBeVisible();

  const saved = page.waitForResponse((response) =>
    response.request().method() === 'PUT' && response.url().endsWith('/Meeting/layout/calendarPlusTooltip'));

  await page.locator('button[data-action="save"]').click();
  expect((await saved).ok()).toBeTruthy();

  while (await enabled.locator('li.cell').count()) {
    const count = await enabled.locator('li.cell').count();

    await dragField(page, enabled.locator('li.cell').first(), inactive);
    await expect(enabled.locator('li.cell')).toHaveCount(count - 1);
  }

  const savedEmpty = page.waitForResponse((response) =>
    response.request().method() === 'PUT' && response.url().endsWith('/Meeting/layout/calendarPlusTooltip'));

  await page.locator('button[data-action="save"]').click();
  expect((await savedEmpty).ok()).toBeTruthy();
  await page.reload();
  await expect(enabled.locator('li.cell')).toHaveCount(0);
  await expect(inactive.locator('[data-name=":attendees"]')).toBeVisible();

  await page.locator('button[data-action="resetToDefault"]').click();
  await page.locator('.dialog-confirm [data-name="confirm"]').click();
  await expect(enabled.locator('[data-name=":attendees"]')).toBeVisible();
  await expect(inactive.locator('[data-name="description"]')).toBeVisible();
});

test('a custom tooltip layout formats scheduled dates, false booleans, and zero currency', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Hover tooltips require a mouse.');

  const saved = await request.put('/api/v1/CLayoutSession/layout/calendarPlusTooltip', {
    headers: authentication(),
    data: ['dateEndScheduled', 'confirmed', 'cost'].map((name) => ({ name })),
  });

  expect(saved.ok()).toBeTruthy();

  await page.goto(calendarUrl('agendaWeek'));

  const event = page.locator('.fc-event:visible').filter({ hasText: 'Custom tooltip session' }).first();

  await expect(event).toBeVisible();
  await event.hover();

  const tooltip = page.locator('.cp-calendar-event-tooltip');

  await expect(tooltip).toBeVisible();
  await expect(tooltip.locator('dt')).toHaveText(['dateEndScheduled', 'confirmed', 'cost']);
  await expect(tooltip.locator('dd').nth(0)).toContainText('12:30');
  await expect(tooltip.locator('dd').nth(1)).toHaveText('No');
  await expect(tooltip.locator('dd').nth(2)).toHaveText('0 USD');
});
