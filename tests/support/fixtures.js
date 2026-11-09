import { readFileSync } from "node:fs";

export const fixtures = JSON.parse(
  readFileSync(new URL("../.runtime/fixtures.json", import.meta.url)),
);

export function authentication(account = fixtures.accounts.admin) {
  return {
    "Espo-Authorization": Buffer.from(
      `${account.username}:${account.password}`,
    ).toString("base64"),
  };
}

export async function resetPreferences(request) {
  const response = await request.put(
    `/api/v1/Preferences/${fixtures.accounts.admin.id}`,
    {
      headers: authentication(),
      data: fixtures.preferences,
    },
  );
  if (!response.ok())
    throw new Error(
      `Cannot reset fixture preferences: ${response.status()} ${await response.text()}`,
    );
}

export async function login(page) {
  await page.goto("/");
  await page
    .locator('input[name="username"]')
    .fill(fixtures.accounts.admin.username);
  await page
    .locator('input[name="password"]')
    .fill(fixtures.accounts.admin.password);
  await page.locator("#btn-login").click();
  await page.locator('input[name="username"]').waitFor({ state: "hidden" });
}

export function calendarUrl(mode) {
  return `/#Calendar/show/mode=${mode}&date=${fixtures.date}`;
}
