import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import moment from 'moment-timezone';
import vm from 'node:vm';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const source = new URL('src/files/client/custom/modules/calendar-plus/src/', root);

function load(file, dependencies = {}, globals = {}) {
  let exported;
  vm.runInNewContext(readFileSync(new URL(file, source), 'utf8'), {
    define: (name, names, factory) => {
      exported = factory(...names.map((name) => dependencies[name]));
    },
    ...globals,
  });
  return exported;
}

const Availability = load('calendar-availability.js');
const time = (value) => Date.parse(`2026-11-09T${value}:00Z`);
const busy = (from, to, flag = 'isBusyRange') => ({
  dateStart: `2026-11-09 ${from}:00`,
  dateEnd: `2026-11-09 ${to}:00`,
  [flag]: true,
});
const halfHour = 30 * 60 * 1000;

test('common slots exclude everyone’s overlapping busy periods and accept abutting events', () => {
  const data = {
    a: [busy('09:00', '10:00'), busy('10:45', '12:00')],
    b: [busy('09:30', '10:15')],
  };
  assert.equal(
    Availability.findSlot(data, ['a', 'b'], time('09:00'), time('18:00'), halfHour),
    time('10:15'),
  );
  assert.equal(
    Availability.findSlot(data, ['a', 'b'], time('10:20'), time('18:00'), halfHour),
    time('12:00'),
  );
});

test('nested, unsorted ranges merge without exposing false gaps', () => {
  const data = { a: [busy('11:00', '12:00'), busy('09:00', '11:30')], b: [busy('09:30', '10:00')] };
  assert.equal(
    Availability.findSlot(data, ['a', 'b'], time('09:00'), time('18:00'), halfHour),
    time('12:00'),
  );
});

test('non-working ranges block slots and malformed or missing availability never means free', () => {
  const data = {
    a: [busy('00:00', '09:00', 'isNonWorkingRange')],
    b: [busy('00:00', '10:00', 'isNonWorkingRange')],
  };
  assert.equal(
    Availability.findSlot(data, ['a', 'b'], time('08:00'), time('18:00'), halfHour),
    time('10:00'),
  );
  assert.throws(
    () => Availability.findSlot({ a: [] }, ['a', 'b'], time('09:00'), time('18:00'), halfHour),
    Availability.UnavailableError,
  );
  assert.throws(
    () =>
      Availability.findSlot(
        { a: [{ isBusyRange: true }] },
        ['a'],
        time('09:00'),
        time('18:00'),
        halfHour,
      ),
    Availability.UnavailableError,
  );
});

test('free calendars, five-minute rounding, and exhausted windows retain correct boundaries', () => {
  assert.equal(
    Availability.findSlot({ a: [] }, ['a'], time('09:02'), time('10:00'), halfHour),
    time('09:05'),
  );
  assert.equal(
    Availability.findSlot(
      { a: [busy('09:00', '18:00')] },
      ['a'],
      time('09:00'),
      time('18:00'),
      halfHour,
    ),
    null,
  );
  assert.equal(
    Availability.findSlot({ a: [] }, ['a'], time('17:30'), time('18:00'), halfHour),
    time('17:30'),
  );
});

function fixture(request, attributes = {}, now = () => 0) {
  const listeners = [];
  class Scheduler {
    setup() {}
    listenTo(model, event, listener) {
      listeners.push(listener);
    }
    once(event, listener) {
      this.onRemove = listener;
    }
  }
  const View = load(
    'views/scheduler/scheduler.js',
    {
      'crm:views/scheduler/scheduler': Scheduler,
      'calendar-plus:calendar-availability': Availability,
      moment,
    },
    { Espo: { Ajax: { getRequest: request } }, Date: { now } },
  );
  const view = new View();
  const state = {
    dateStart: '2026-11-09 09:00:00',
    dateEnd: '2026-11-09 09:30:00',
    usersIds: ['b'],
    assignedUserId: 'a',
    ...attributes,
  };
  let changed = new Set();
  view.model = {
    entityType: 'Meeting',
    id: 'existing-meeting',
    get: (name) => state[name],
    hasChanged: (name) => changed.has(name),
    set(values) {
      changed = new Set(Object.keys(values));
      Object.assign(state, values);
      listeners.forEach((listener) => listener(this));
    },
  };
  Object.assign(view, {
    startField: 'dateStart',
    endField: 'dateEnd',
    usersField: 'users',
    assignedUserField: 'assignedUser',
    timeline: {},
    removed: false,
    isRemoved() {
      return this.removed;
    },
    getDateTime: () => ({
      getTimeZone: () => 'UTC',
      getReadableDateFormat: () => 'YYYY-MM-DD',
      internalDateTimeFormat: 'YYYY-MM-DD HH:mm:ss',
    }),
    translate: (key) => key,
    searchStatus: { textContent: '' },
    searchButton: {},
  });
  view.setup();
  return { view, state };
}

test('scheduler preserves duration, advances on repeated clicks, and excludes the edited record', async () => {
  const calls = [];
  const { view, state } = fixture(async (url, query) => {
    calls.push({ url, query });
    return { a: [busy('09:00', '10:00')], b: [] };
  });
  await view.actionNextAvailable();
  assert.equal(state.dateStart, '2026-11-09 10:00:00');
  assert.equal(state.dateEnd, '2026-11-09 10:30:00');
  assert.equal(calls[0].url, 'Timeline/busyRanges');
  assert.equal(calls[0].query.entityId, 'existing-meeting');
  assert.equal(calls[0].query.userIdList, 'a,b');
  assert.equal(view.searching, false);
  await view.actionNextAvailable();
  assert.equal(state.dateStart, '2026-11-09 10:05:00');
});

test('scheduler uses native owner inclusion and refuses all-day or incomplete events', async () => {
  const { view } = fixture(async () => {
    throw new Error('must not request');
  });
  view.eventAssignedUserIsAttendeeDisabled = true;
  assert.deepEqual(Array.from(view.searchState().users), ['b']);
  view.model.set({ isAllDay: true });
  assert.equal(view.searchState(), null);
  await view.actionNextAvailable();
  view.model.set({ isAllDay: false, dateEnd: null });
  assert.equal(view.searchState(), null);
});

test('changed participants and removed schedulers discard in-flight search results', async () => {
  for (const remove of [false, true]) {
    let resolve;
    const { view, state } = fixture(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = view.actionNextAvailable();
    if (remove) {
      view.removed = true;
      view.onRemove();
    } else view.model.set({ usersIds: ['c'] });
    resolve({ a: [], b: [] });
    await pending;
    assert.equal(state.dateStart, '2026-11-09 09:00:00');
  }
});

test('missing permissions and network failures leave unsaved dates unchanged', async () => {
  for (const response of [
    async () => ({ a: [] }),
    async () => {
      throw new Error('network');
    },
  ]) {
    const { view, state } = fixture(response);
    await view.actionNextAvailable();
    assert.equal(state.dateStart, '2026-11-09 09:00:00');
    assert.equal(state.dateEnd, '2026-11-09 09:30:00');
    assert.notEqual(view.searchStatus.textContent, '');
    assert.equal(view.searching, false);
  }
});

test('working hours in another timezone find the next eligible local day across DST', async () => {
  const calls = [];
  const { view, state } = fixture(
    async (url, query) => {
      calls.push(query);
      const start = moment.utc(query.from);
      const end = moment.utc(query.to);
      if (calls.length === 1)
        return {
          a: [{ isNonWorkingRange: true, dateStart: query.from, dateEnd: query.to }],
          b: [],
        };
      return {
        a: [
          {
            isNonWorkingRange: true,
            dateStart: query.from,
            dateEnd: start.clone().add(9, 'hours').format('YYYY-MM-DD HH:mm:ss'),
          },
        ],
        b: [
          {
            isNonWorkingRange: true,
            dateStart: end.clone().subtract(6, 'hours').format('YYYY-MM-DD HH:mm:ss'),
            dateEnd: query.to,
          },
        ],
      };
    },
    { dateStart: '2026-10-31 23:00:00', dateEnd: '2026-10-31 23:30:00' },
  );
  view.getDateTime = () => ({
    getTimeZone: () => 'America/Denver',
    internalDateTimeFormat: 'YYYY-MM-DD HH:mm:ss',
  });
  await view.actionNextAvailable();
  assert.equal(calls[0].from, '2026-10-31 06:00:00');
  assert.equal(calls[1].to, '2026-11-02 07:00:00');
  assert.equal(state.dateStart, '2026-11-01 15:00:00');
});

test('slots may cross midnight after the following day has been checked', async () => {
  let requests = 0;
  const { view, state } = fixture(
    async () => {
      requests++;
      return { a: [], b: [] };
    },
    {
      dateStart: '2026-11-09 23:00:00',
      dateEnd: '2026-11-10 00:00:00',
    },
  );
  await view.actionNextAvailable();
  assert.equal(requests, 2);
  assert.equal(state.dateStart, '2026-11-09 23:05:00');
  assert.equal(state.dateEnd, '2026-11-10 00:05:00');
});

test('search continues beyond fourteen days when requests are inexpensive', async () => {
  let requests = 0;
  const { view, state } = fixture(async (url, query) => {
    requests++;
    return {
      a: requests <= 45 ? [{ isBusyRange: true, dateStart: query.from, dateEnd: query.to }] : [],
      b: [],
    };
  });
  await view.actionNextAvailable();
  assert.equal(requests, 46);
  assert.equal(
    state.dateStart,
    moment.utc('2026-11-09').add(45, 'days').format('YYYY-MM-DD HH:mm:ss'),
  );
  assert.equal(view.pendingSearch, null);
});

test('expensive searches offer continuation and resume without re-querying earlier days', async () => {
  let now = 0;
  const queries = [];
  const { view, state } = fixture(
    async (url, query) => {
      queries.push(query);
      now += 4000;
      return {
        a:
          queries.length === 1
            ? [{ isBusyRange: true, dateStart: query.from, dateEnd: query.to }]
            : [],
        b: [],
      };
    },
    {},
    () => now,
  );
  await view.actionNextAvailable();
  assert.equal(state.dateStart, '2026-11-09 09:00:00');
  assert.equal(view.searchButton.textContent, 'Continue searching');
  assert.equal(view.searchStatus.textContent, 'Continue scheduler search');
  assert.ok(view.pendingSearch);
  await view.actionNextAvailable();
  assert.equal(queries.length, 2);
  assert.equal(queries[1].from, queries[0].to);
  assert.equal(state.dateStart, '2026-11-10 00:00:00');
  assert.equal(view.searchButton.textContent, 'Next available');
});

test('continuing retains a matching slot that starts before midnight', async () => {
  let now = 0;
  let requests = 0;
  const { view, state } = fixture(
    async () => {
      requests++;
      now += 4000;
      return { a: [], b: [] };
    },
    {
      dateStart: '2026-11-09 23:00:00',
      dateEnd: '2026-11-10 00:00:00',
    },
    () => now,
  );
  await view.actionNextAvailable();
  assert.ok(view.pendingSearch);
  await view.actionNextAvailable();
  assert.equal(requests, 2);
  assert.equal(state.dateStart, '2026-11-09 23:05:00');
  assert.equal(state.dateEnd, '2026-11-10 00:05:00');
});

test('changing participants discards a paused search and checks the new group from the entered time', async () => {
  let now = 0;
  const queries = [];
  const { view, state } = fixture(
    async (url, query) => {
      queries.push(query);
      now += 4000;
      return queries.length === 1
        ? { a: [{ isBusyRange: true, dateStart: query.from, dateEnd: query.to }], b: [] }
        : { a: [], c: [] };
    },
    {},
    () => now,
  );
  await view.actionNextAvailable();
  assert.ok(view.pendingSearch);
  view.model.set({ usersIds: ['c'] });
  assert.equal(view.pendingSearch, null);
  await view.actionNextAvailable();
  assert.equal(queries[1].from, queries[0].from);
  assert.equal(queries[1].userIdList, 'a,c');
  assert.equal(state.dateStart, '2026-11-09 09:05:00');
});

test('clicking again skips conflicts to reach the next matching window', async () => {
  const { view, state } = fixture(async () => ({
    a: [busy('09:00', '10:00'), busy('10:30', '12:00')],
    b: [],
  }));
  await view.actionNextAvailable();
  assert.equal(state.dateStart, '2026-11-09 10:00:00');
  await view.actionNextAvailable();
  assert.equal(state.dateStart, '2026-11-09 12:00:00');
});

test('Meetings and Calls both register the extended native scheduler', () => {
  for (const scope of ['Meeting', 'Call']) {
    const file = new URL(
      `src/files/custom/Espo/Modules/CalendarPlus/Resources/metadata/clientDefs/${scope}.json`,
      root,
    );
    assert.equal(
      JSON.parse(readFileSync(file)).schedulerView,
      'calendar-plus:views/scheduler/scheduler',
    );
  }
});

test('read-only schedulers and missing start times cannot change model dates', async () => {
  const { view, state } = fixture(async () => {
    throw new Error('must not request');
  });
  view.getParentView = () => ({ mode: 'detail' });
  assert.equal(view.searchState(), null);
  await view.actionNextAvailable();
  assert.equal(state.dateStart, '2026-11-09 09:00:00');
  view.getParentView = () => ({ mode: 'edit', readOnly: true });
  assert.equal(view.searchState(), null);
  view.getParentView = () => ({ mode: 'edit' });
  view.model.set({ dateStart: undefined });
  assert.equal(view.searchState(), null);
});

test('a known long busy period skips directly to the next potentially available date', async () => {
  const queries = [];
  const { view, state } = fixture(async (url, query) => {
    queries.push(query);
    return {
      a: [{ isBusyRange: true, dateStart: '2026-11-09 00:00:00', dateEnd: '2028-01-01 00:00:00' }],
      b: [],
    };
  });
  await view.actionNextAvailable();
  assert.equal(queries.length, 2);
  assert.equal(queries[1].from, '2028-01-01 00:00:00');
  assert.equal(state.dateStart, '2028-01-01 00:00:00');
  assert.equal(state.dateEnd, '2028-01-01 00:30:00');
});

test('scheduler panels supply the entity scope before native scheduler selection', () => {
  class NativePanel {
    setup() {
      this.selectedScheduler = this.getMetadata().get(['clientDefs', this.scope, 'schedulerView']);
    }
  }
  const Panel = load('views/scheduler/panel.js', {
    'crm:views/meeting/record/panels/scheduler': NativePanel,
  });
  for (const scope of ['Meeting', 'Call']) {
    const file = new URL(
      `src/files/custom/Espo/Modules/CalendarPlus/Resources/metadata/clientDefs/${scope}.json`,
      root,
    );
    const metadata = JSON.parse(readFileSync(file));
    const panel = new Panel();
    panel.model = { entityType: scope };
    panel.getMetadata = () => ({
      get: ([group, entity, key]) => (entity === scope ? metadata[key] : undefined),
    });
    panel.setup();
    assert.equal(panel.scope, scope);
    assert.equal(panel.selectedScheduler, 'calendar-plus:views/scheduler/scheduler');
    for (const mode of ['detail', 'edit', 'editSmall']) {
      assert.equal(
        metadata.bottomPanels[mode].find((item) => item.name === 'scheduler').view,
        'calendar-plus:views/scheduler/panel',
      );
    }
  }
});
