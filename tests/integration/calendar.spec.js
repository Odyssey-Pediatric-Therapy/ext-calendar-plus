import { execFileSync } from 'node:child_process';
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

test("inactive team members use their team option, independently of explicit users", async ({ request }) => {
  const selection = { teamIdList: [f.teams.operations.id] };
  const cases = [
    { data: selection, includesInactive: false },
    {
      data: { ...selection, includeInactiveUsers: true },
      includesInactive: false,
    },
    {
      data: {
        ...selection,
        teamColumns: { [f.teams.operations.id]: { showInactiveUsers: true } },
      },
      includesInactive: true,
    },
    {
      data: { ...selection, userIdList: [f.people.james.id] },
      includesInactive: false,
    },
    {
      data: {
        ...selection,
        userIdList: [f.people.james.id],
        includeInactiveUsers: true,
      },
      includesInactive: true,
    },
  ];

  for (const { data, includesInactive } of cases) {
    const response = await resolve(request, data);
    expect(response.ok()).toBeTruthy();
    const ids = (await response.json()).users.map((user) => user.id);
    expect(ids.includes(f.people.james.id)).toBe(includesInactive);
  }
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
    if (event.scope !== "Task") {
      expect(saved.usersIds).toContain(f.people.amelia.id);
    }
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

function calendarLoad(overrides = {}) {
  return {
    type: 'grid', from: `${f.from} 00:00:00`, to: `${f.to} 23:59:59`,
    selection: { userIdList: [f.people.amelia.id], teamIdList: [] },
    scopeList: ['Meeting', 'Call', 'Task'], agenda: true, workingTime: true,
    ...overrides,
  };
}

test("one calendar response includes events, people, working hours, and complete projections", async ({ request }) => {
  const response = await request.post('/api/v1/CalendarPlus/Load', {
    headers: authentication(), data: calendarLoad(),
  });
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data.users.map((user) => user.id)).toEqual([f.people.amelia.id]);
  expect(Array.isArray(data.ranges)).toBeTruthy();
  for (const event of Object.values(f.events)) {
    const record = await (await request.get(`/api/v1/${event.scope}/${event.id}`, {
      headers: authentication(),
    })).json();
    const loaded = data.events.find((item) => item.scope === event.scope && item.id === event.id);
    expect(loaded).toBeDefined();
    const projection = loaded.calendarPlusDetails;
    for (const field of ['name', 'status', 'assignedUserName',
      'usersNames', 'usersColumns', 'contactsNames', 'contactsColumns', 'leadsNames', 'leadsColumns',
      'collaboratorsNames']) {
      if (record[field] !== undefined) {
        expect(projection[field]).toEqual(record[field]);
      }
    }
    expect(projection).not.toHaveProperty('description');
    expect(projection).not.toHaveProperty('dateStart');
    expect(projection).not.toHaveProperty('dateEnd');
  }
});

test("calendar loads require authentication, valid ranges and permitted selections", async ({ request }) => {
  const endpoint = '/api/v1/CalendarPlus/Load';
  expect((await request.post(endpoint, { data: calendarLoad() })).status()).toBe(401);
  for (const overrides of [{ from: null }, { to: 'invalid' }, { type: 'bad' },
    { from: '2026-01-01 00:00:00', to: '2027-01-01 00:00:00' },
    { selection: [] }, { scopeList: 'bad' }, { workingTime: 'yes' }]) {
    expect((await request.post(endpoint, {
      headers: authentication(), data: calendarLoad(overrides),
    })).status()).toBe(400);
  }
  expect((await request.post(endpoint, {
    headers: authentication(f.accounts.personalOnly), data: calendarLoad(),
  })).status()).toBe(403);
  const empty = await request.post(endpoint, {
    headers: authentication(), data: calendarLoad({ selection: { userIdList: [], teamIdList: [] } }),
  });
  expect(await empty.json()).toEqual({ users: [], events: [], ranges: [] });
});

test("complete calendar loads retain record and field permissions", async ({ request }) => {
  const response = await request.post('/api/v1/CalendarPlus/Load', {
    headers: authentication(f.accounts.detailsRestricted),
    data: calendarLoad({ selection: {
      userIdList: [f.accounts.detailsRestricted.id, f.people.amelia.id], teamIdList: [],
    } }),
  });
  expect(response.ok()).toBeTruthy();
  const { events } = await response.json();
  const own = events.find((event) => event.id === f.detailFixtureId);
  expect(own).toBeDefined();
  expect(events.some((event) => event.id === f.events.meeting.id)).toBe(false);
  expect(own.calendarPlusDetails.name).toContain('Restricted detail projection');
  for (const field of ['location', 'usersNames', 'usersColumns']) {
    expect(own.calendarPlusDetails).not.toHaveProperty(field);
  }
});

test("bulk detail SQL query count stays constant as the event count grows", () => {
  const counts = JSON.parse(execFileSync(process.env.CP_TEST_PHP || 'php', [
    new URL('../support/bulk-detail-query-count.php', import.meta.url).pathname,
  ], { encoding: 'utf8' }));
  expect(counts.one.records).toBe(1);
  expect(counts.many.records).toBeGreaterThan(20);
  expect(counts.many.selects).toBe(counts.one.selects);
  expect(counts.many.selects).toBeLessThan(10);
});

for (const type of ['grid', 'timeline']) {
  test(`complete ${type} load preserves Espo's native event selection`, async ({ request }) => {
    const input = calendarLoad({ type, to: `${f.to} 23:59:00` });
    const response = await request.post('/api/v1/CalendarPlus/Load', {
      headers: authentication(), data: input,
    });
    expect(response.ok()).toBeTruthy();
    const complete = await response.json();
    const params = {
      from: type === 'timeline' ? input.from.slice(0, 16) : input.from,
      to: type === 'timeline' ? input.to.slice(0, 16) : input.to,
      scopeList: input.scopeList.join(','), userIdList: f.people.amelia.id,
    };
    const native = await request.get(`/api/v1/${type === 'timeline' ? 'Timeline' : 'Activities'}`, {
      headers: authentication(), params,
    });
    expect(native.ok()).toBeTruthy();
    const body = await native.json();
    const expected = type === 'timeline'
      ? Object.entries(body).flatMap(([userId, events]) => events.map((event) => ({ ...event, userId })))
      : body;
    const normalize = (events) => events.map(({ calendarPlusDetails, ...event }) => event)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(normalize(complete.events)).toEqual(normalize(expected));
  });
}

test('a personal calendar load preserves native events without requiring shared-calendar permission', async ({ request }) => {
  const input = calendarLoad({ selection: null });
  delete input.selection;
  const headers = authentication(f.accounts.personalOnly);
  const response = await request.post('/api/v1/CalendarPlus/Load', { headers, data: input });
  expect(response.ok()).toBeTruthy();
  const complete = await response.json();
  const native = await request.get('/api/v1/Activities', { headers, params: {
    from: input.from, to: input.to, scopeList: input.scopeList.join(','), agenda: 'true',
  } });
  expect(native.ok()).toBeTruthy();
  expect(complete.events.map(({ calendarPlusDetails, ...event }) => event)).toEqual(await native.json());
});
