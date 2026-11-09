import { test, expect } from "@playwright/test";
import {
  fixtures as f,
  authentication,
  resetPreferences,
} from "../support/fixtures.js";

async function resolve(request, data, account) {
  return request.post("/api/v1/CalendarPlus/Users", {
    headers: authentication(account),
    data,
  });
}

test("calendar user resolution requires authentication", async ({
  request,
}) => {
  const response = await request.post("/api/v1/CalendarPlus/Users", {
    data: {},
  });
  expect(response.status()).toBe(401);
});

test("explicit users preserve stored order, remove duplicates and exclude API users", async ({
  request,
}) => {
  const ids = [
    f.people.maya.id,
    f.people.amelia.id,
    f.people.maya.id,
    f.accounts.api.id,
  ];
  const response = await resolve(request, { userIdList: ids });
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).users.map((user) => user.id)).toEqual(
    ids.slice(0, 2),
  );
});

test("teams expand in selection order without duplicate members", async ({
  request,
}) => {
  const first = await resolve(request, { teamIdList: [f.teams.sales.id] });
  const second = await resolve(request, { teamIdList: [f.teams.delivery.id] });
  const combined = await resolve(request, {
    teamIdList: [f.teams.sales.id, f.teams.delivery.id],
  });
  const ids = (response) => response.users.map((user) => user.id);
  const expected = [
    ...new Set([...ids(await first.json()), ...ids(await second.json())]),
  ];
  expect(expected.length).toBeGreaterThan(7);
  expect(ids(await combined.json())).toEqual(expected);
});

test("inactive team members are opt-in", async ({ request }) => {
  const selection = { teamIdList: [f.teams.operations.id] };
  const active = await resolve(request, selection);
  const all = await resolve(request, {
    ...selection,
    includeInactiveUsers: true,
  });
  expect((await active.json()).users.map((user) => user.id)).not.toContain(
    f.people.james.id,
  );
  expect((await all.json()).users.map((user) => user.id)).toContain(
    f.people.james.id,
  );
});

test("calendar and team permissions are enforced on the server", async ({
  request,
}) => {
  expect((await resolve(request, {}, f.accounts.personalOnly)).status()).toBe(
    403,
  );
  expect(
    (
      await resolve(
        request,
        { teamIdList: [f.teams.delivery.id] },
        f.accounts.teamOnly,
      )
    ).status(),
  ).toBe(403);
  const allowed = await resolve(
    request,
    { teamIdList: [f.teams.success.id] },
    f.accounts.teamOnly,
  );
  expect(allowed.ok()).toBeTruthy();
});

for (const data of [
  { userIdList: "invalid" },
  { userIdList: Array(301).fill("test") },
  { teamIdList: Array(101).fill("test") },
  { includeInactiveUsers: "true" },
]) {
  test(`invalid calendar selection is rejected: ${JSON.stringify(data).slice(0, 65)}`, async ({
    request,
  }) => {
    expect((await resolve(request, data)).status()).toBe(400);
  });
}

test("saved calendar preferences round-trip through the real API", async ({
  request,
}) => {
  await resetPreferences(request);
  const response = await request.get(
    `/api/v1/Preferences/${f.accounts.admin.id}`,
    { headers: authentication() },
  );
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).calendarViewDataList).toEqual(
    f.preferences.calendarViewDataList,
  );
});

test("fixture events persist owners, attendees, times and statuses", async ({
  request,
}) => {
  for (const event of Object.values(f.events)) {
    const response = await request.get(`/api/v1/${event.scope}/${event.id}`, {
      headers: authentication(),
    });
    expect(response.ok()).toBeTruthy();
    const saved = await response.json();
    expect(saved.assignedUserId).toBe(f.people.amelia.id);
    expect(saved.dateStart).toContain(f.date);
    expect(new Date(saved.dateEnd) > new Date(saved.dateStart)).toBeTruthy();
    if (event.scope !== "Task")
      expect(saved.usersIds).toContain(f.people.amelia.id);
  }
});

test("invalid view settings are rejected without replacing saved preferences", async ({
  request,
}) => {
  await resetPreferences(request);
  const response = await request.put(
    `/api/v1/Preferences/${f.accounts.admin.id}`,
    {
      headers: authentication(),
      data: { calendarPlusViewSettings: { month: { slotDuration: 7 } } },
    },
  );
  expect(response.status()).toBe(400);
  const saved = await request.get(
    `/api/v1/Preferences/${f.accounts.admin.id}`,
    { headers: authentication() },
  );
  expect((await saved.json()).calendarViewDataList).toEqual(
    f.preferences.calendarViewDataList,
  );
});

test("attendee and collaborator updates persist without changing the assigned user", async ({
  request,
}) => {
  for (const [event, field] of [
    [f.events.meeting, "usersIds"],
    [f.events.task, "collaboratorsIds"],
  ]) {
    const endpoint = `/api/v1/${event.scope}/${event.id}`;
    const original = await (
      await request.get(endpoint, { headers: authentication() })
    ).json();
    try {
      const people = [
        ...new Set([...(original[field] || []), f.people.isabella.id]),
      ];
      const update = await request.put(endpoint, {
        headers: authentication(),
        data: { [field]: people },
      });
      expect(update.ok()).toBeTruthy();
      const saved = await (
        await request.get(endpoint, { headers: authentication() })
      ).json();
      expect(saved[field]).toContain(f.people.isabella.id);
      expect(saved.assignedUserId).toBe(original.assignedUserId);
    } finally {
      const restored = await request.put(endpoint, {
        headers: authentication(),
        data: { [field]: original[field] || [] },
      });
      expect(restored.ok()).toBeTruthy();
    }
  }
});
