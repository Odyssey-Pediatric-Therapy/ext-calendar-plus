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

function fixture(request, attributes = {}) {
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
      moment,
    },
    { Espo: { Ajax: { postRequest: request } } },
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

const found = (start = '2026-11-09 10:00:00', end = '2026-11-09 10:30:00') => ({
  status: 'found',
  dateStart: start,
  dateEnd: end,
});

test('one backend request finds a slot, preserves duration, and excludes the edited record', async () => {
  const calls = [];
  const { view, state } = fixture(async (url, query) => {
    calls.push({ url, query });
    return found();
  });
  await view.actionNextAvailable();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'CalendarPlus/NextAvailable');
  assert.equal(calls[0].query.duration, 1800);
  assert.equal(calls[0].query.entityId, 'existing-meeting');
  assert.deepEqual(Array.from(calls[0].query.userIdList), ['a', 'b']);
  assert.equal(state.dateStart, '2026-11-09 10:00:00');
  assert.equal(state.dateEnd, '2026-11-09 10:30:00');
  assert.equal(view.searching, false);
});

test('clicking again requests the next match after the selected slot', async () => {
  const calls = [];
  const { view, state } = fixture(async (url, query) => {
    calls.push(query);
    return calls.length === 1 ? found() : found('2026-11-09 12:00:00', '2026-11-09 12:30:00');
  });
  await view.actionNextAvailable();
  await view.actionNextAvailable();
  assert.equal(calls[1].dateStart, '2026-11-09 10:00:00');
  assert.equal(state.dateStart, '2026-11-09 12:00:00');
});

test('continuation sends the server cursor and leaves entered dates unchanged until a match', async () => {
  const calls = [];
  const { view, state } = fixture(async (url, query) => {
    calls.push(query);
    return calls.length === 1
      ? { status: 'continue', cursor: 'signed-cursor', searchedThrough: '2026-12-31 23:59:59' }
      : found('2027-01-04 10:00:00', '2027-01-04 10:30:00');
  });
  await view.actionNextAvailable();
  assert.equal(state.dateStart, '2026-11-09 09:00:00');
  assert.equal(view.searchButton.textContent, 'Continue searching');
  await view.actionNextAvailable();
  assert.equal(calls[1].cursor, 'signed-cursor');
  assert.equal(state.dateStart, '2027-01-04 10:00:00');
  assert.equal(view.searchButton.textContent, 'Next available');
});

test('changing participants discards the cursor and stale in-flight results', async () => {
  let resolve;
  const { view, state } = fixture(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  view.pendingSearch = { signature: 'old', cursor: 'old' };
  const pending = view.actionNextAvailable();
  view.model.set({ usersIds: ['c'] });
  resolve(found());
  await pending;
  assert.equal(view.pendingSearch, null);
  assert.equal(state.dateStart, '2026-11-09 09:00:00');
});

test('removed schedulers ignore results and failures never update dates', async () => {
  let resolve;
  const removed = fixture(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = removed.view.actionNextAvailable();
  removed.view.removed = true;
  removed.view.onRemove();
  resolve(found());
  await pending;
  assert.equal(removed.state.dateStart, '2026-11-09 09:00:00');
  for (const response of [
    async () => ({ status: 'unavailable' }),
    async () => ({ status: 'exhausted' }),
    async () => {
      throw new Error('network');
    },
    async () => found('2026-11-09 08:00:00', '2026-11-09 08:30:00'),
    async () => ({ status: 'continue' }),
  ]) {
    const { view, state } = fixture(response);
    await view.actionNextAvailable();
    assert.equal(state.dateStart, '2026-11-09 09:00:00');
    assert.notEqual(view.searchStatus.textContent, '');
    assert.equal(view.searching, false);
  }
});

test('native owner-inclusion rules, all-day values, and read-only panels are respected', async () => {
  const { view } = fixture(async () => {
    throw new Error('must not request');
  });
  view.eventAssignedUserIsAttendeeDisabled = true;
  assert.deepEqual(Array.from(view.searchState().users), ['b']);
  view.model.set({ isAllDay: true });
  assert.equal(view.searchState(), null);
  view.model.set({ isAllDay: false });
  view.getParentView = () => ({ mode: 'detail' });
  assert.equal(view.searchState(), null);
  await view.actionNextAvailable();
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

test('native minute-only model dates are sent to the API with seconds', async () => {
  let query;
  const { view, state } = fixture(async (url, values) => {
    query = values;
    return found();
  });
  view.getDateTime = () => ({
    getTimeZone: () => 'UTC',
    internalDateTimeFormat: 'YYYY-MM-DD HH:mm',
  });
  await view.actionNextAvailable();
  assert.equal(query.dateStart, '2026-11-09 09:00:00');
  assert.equal(state.dateStart, '2026-11-09 10:00');
  assert.equal(state.dateEnd, '2026-11-09 10:30');
});
