import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const context = {
  module: { exports: {} },
  exports: {},
  define: Object.assign(() => {}, { amd: false }),
};
vm.runInNewContext(read('site/client/lib/original/moment.js'), context);
const moment = context.module.exports;
context.require = () => moment;
vm.runInNewContext(read('site/client/lib/original/moment-timezone.js'), context);
context.moment = moment;
vm.runInNewContext(read('site/client/lib/original/moment-timezone-data.js'), context);

const source = 'src/files/client/custom/modules/calendar-plus/src/';
const plain = (value) => JSON.parse(JSON.stringify(value));
function load(file, dependencies, espo = {}) {
  let exported;
  vm.runInNewContext(read(source + file), {
    define: (name, names, factory) => {
      exported = factory(...names.map((name) => dependencies[name]));
    },
    Espo: espo,
  });
  return exported;
}

const visibilityDefinitions = load('calendar-definitions.js', {});
const visibility = load('calendar-visibility.js', {
  'calendar-plus:calendar-definitions': visibilityDefinitions,
});

function fixture(getRequest = async () => ({ list: [], total: 0 })) {
  const fields = {
    name: { type: 'varchar' },
    dateStart: { type: 'datetime' },
    dateEnd: { type: 'datetime' },
    assignedUser: { type: 'link' },
    users: { type: 'linkMultiple' },
    contacts: { type: 'linkMultiple' },
    leads: { type: 'linkMultiple' },
    status: { options: ['Planned', 'Held', 'Not Held'] },
  };
  const definitions = {
    Meeting: { fields },
    Call: { fields },
    Task: {
      fields: {
        name: fields.name,
        dateStart: fields.dateStart,
        dateEnd: fields.dateEnd,
        assignedUser: fields.assignedUser,
        dateStartDate: { type: 'date' },
        dateEndDate: { type: 'date' },
        status: { options: ['Not Started', 'Completed'] },
        collaborators: { type: 'linkMultiple' },
      },
    },
    Hidden: { fields },
  };
  const view = {
    scopeList: ['Meeting', 'Call', 'Task', 'Hidden'],
    getConfig: () => ({ get: (name) => (name === 'recordsPerPage' ? 25 : 5) }),
    getMetadata: () => ({
      get: (path) => path.slice(1).reduce((value, key) => value?.[key], definitions),
    }),
    getAcl: () => ({ checkScope: (scope) => scope !== 'Hidden' }),
    getDateTime: () => ({ getTimeZone: () => 'America/Denver' }),
  };
  const search = load(
    'calendar-search.js',
    { moment, 'calendar-plus:calendar-visibility': visibility },
    { Ajax: { getRequest } },
  );
  return { view, search, definitions };
}

const filters = { from: '2026-11-01', to: '2026-11-01' };

test('calendar search limits event types to accessible calendar entities', () => {
  const { view, search } = fixture();
  assert.deepEqual(Array.from(search.availableScopes(view)), ['Meeting', 'Call', 'Task']);
});

test('date search uses overlapping intervals and timezone-correct inclusive dates across DST', () => {
  const { view, search } = fixture();
  const query = plain(search.buildQuery(view, 'Meeting', filters));
  const interval = query.where[0].value[0].value;
  assert.equal(interval[0].value[0].type, 'lessThan');
  assert.equal(interval[0].value[0].value, '2026-11-02 07:00:00');
  assert.equal(interval[1].value[0].value, '2026-11-01 06:00:00');
  assert.equal(
    interval[1].value[1].value[0].type,
    'isNull',
    'missing end dates fall back to the start',
  );
  const task = plain(search.buildQuery(view, 'Task', filters));
  assert.equal(task.where[0].value[1].value[0].value[0].value, '2026-11-02');
});

test('search combines literal title, owner, user/contact/lead attendees, and per-type status filters', () => {
  const { view, search } = fixture();
  const query = plain(
    search.buildQuery(view, 'Meeting', {
      ...filters,
      title: '  Project % review  ',
      assignedUserId: 'owner',
      attendeeUserId: 'person',
      attendeeContactId: 'contact',
      attendeeLeadId: 'lead',
      statusList: ['Planned', 'Completed'],
    }),
  );
  assert.deepEqual(query.where.slice(1), [
    { type: 'contains', attribute: 'name', value: 'Project % review' },
    { type: 'equals', attribute: 'assignedUserId', value: 'owner' },
    { type: 'linkedWith', attribute: 'users', value: ['person'] },
    { type: 'linkedWith', attribute: 'contacts', value: ['contact'] },
    { type: 'linkedWith', attribute: 'leads', value: ['lead'] },
    { type: 'in', attribute: 'status', value: ['Planned'] },
  ]);
  assert.ok(query.select.includes('assignedUserName'));
  assert.ok(query.select.includes('usersNames'));
  assert.equal(search.buildQuery(view, 'Task', { ...filters, attendeeUserId: 'person' }), null);
  assert.equal(search.buildQuery(view, 'Task', { ...filters, statusList: ['Planned'] }), null);
});

test('date-only custom events use dates instead of datetime strings', () => {
  const { view, search, definitions } = fixture();
  definitions.Meeting.fields = {
    name: { type: 'varchar' },
    dateStart: { type: 'date' },
    dateEnd: { type: 'date' },
  };
  const interval = plain(search.buildQuery(view, 'Meeting', filters)).where[0].value[0].value;
  assert.equal(interval[0].value[0].value, '2026-11-02');
  assert.equal(interval[1].value[0].value, '2026-11-01');
});

test('search pages selected types and handles failures without discarding accessible results', async () => {
  const calls = [];
  const { view, search } = fixture(async (scope, query) => {
    calls.push({ scope, query });
    if (scope === 'Call') throw new Error('Forbidden');
    return {
      list: Array.from({ length: query.offset ? 2 : 25 }, (_, index) => ({
        id: String(query.offset + index),
        name: 'Event',
      })),
      total: 27,
    };
  });
  const first = await search.searchPage(view, {
    ...filters,
    scopeList: ['Meeting', 'Call', 'Hidden'],
  });
  assert.equal(first.results.length, 25);
  assert.deepEqual(Array.from(first.errors), ['Call']);
  assert.equal(first.nextOffsets.Meeting, 25);
  assert.equal(first.nextOffsets.Call, null);
  const second = await search.searchPage(
    view,
    { ...filters, scopeList: ['Meeting', 'Call', 'Hidden'] },
    first.nextOffsets,
  );
  assert.equal(second.results.length, 2);
  assert.equal(second.nextOffsets.Meeting, null);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].query.offset, 25);
});

function modalFixture(searchPage, searchOptions = {}) {
  class Modal {
    on(name, callback) {
      this.onRemove = callback;
    }
  }
  class Model {
    constructor(attributes) {
      this.attributes = attributes;
    }
  }
  class Field {
    constructor(options) {
      this.options = options;
    }
  }
  class Record {
    constructor(options) {
      this.options = options;
    }
    processFetch() {
      return this.options.model.attributes;
    }
    validate() {
      return false;
    }
  }
  const { view: calendar } = fixture();
  calendar.date = '2026-11-05';
  const errors = [];
  const SearchModal = load(
    'views/calendar/modals/search.js',
    {
      'views/modal': Modal,
      model: Model,
      'views/record/edit-for-modal': Record,
      'views/fields/date': Field,
      'views/fields/varchar': Field,
      'views/fields/multi-enum': Field,
      'views/fields/link': Field,
      moment,
      'calendar-plus:calendar-search': {
        availableScopes: () => ['Meeting'],
        getPageSize: () => 25,
        getOptions: () => ({ columns: ['when', 'status'], sortBy: 'date', sortDirection: 'desc' }),
        compareResults: (view, first, second) =>
          (
            second.dateStartDate ||
            second.dateStart ||
            second.dateEndDate ||
            second.dateEnd ||
            ''
          ).localeCompare(
            first.dateStartDate || first.dateStart || first.dateEndDate || first.dateEnd || '',
          ) || (first.name || '').localeCompare(second.name || ''),
        searchPage,
        ...searchOptions,
      },
    },
    { Utils: { cloneDeep: structuredClone }, Ui: { error: (message) => errors.push(message) } },
  );
  const modal = new SearchModal();
  Object.assign(modal, {
    options: { calendar },
    getDateTime: () => ({ getToday: () => '2026-11-07' }),
    getMetadata: calendar.getMetadata,
    getLanguage: () => ({ translateOption: (value) => value }),
    translate: (value) => value,
    assignView() {},
    disableButton() {},
    enableButton() {},
    renderResults() {
      this.renders = (this.renders || 0) + 1;
    },
  });
  modal.setup();
  return { modal, errors };
}

test('search modal defaults to the displayed month and validates dates before querying', async () => {
  let requests = 0;
  const { modal, errors } = modalFixture(async () => {
    requests++;
    return { results: [], errors: [], nextOffsets: {} };
  });
  assert.equal(modal.model.attributes.from, '2026-11-01');
  assert.equal(modal.model.attributes.to, '2026-11-30');
  Object.assign(modal.model.attributes, { from: '2026-11-10', to: '2026-11-01' });
  await modal.actionSearch();
  assert.equal(requests, 0);
  assert.equal(errors.length, 1);
});

test('closing search ignores late results, and fresh searches replace earlier results', async () => {
  let finish;
  const { modal } = modalFixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = modal.actionSearch();
  modal.onRemove();
  finish({ results: [{ id: 'late', scope: 'Meeting' }], errors: [], nextOffsets: {} });
  await pending;
  assert.equal(modal.results.length, 0);
  const fresh = modalFixture(async () => ({
    results: [{ id: 'one', scope: 'Meeting' }],
    errors: [],
    nextOffsets: { Meeting: null },
  })).modal;
  await fresh.actionSearch();
  await fresh.actionSearch();
  assert.equal(fresh.results.length, 1);
  assert.equal(fresh.searching, false);
});

test('both calendar headers expose an accessible search button immediately beside Refresh', () => {
  for (const mode of ['calendar', 'timeline']) {
    const template = read(
      `src/files/client/custom/modules/calendar-plus/res/templates/calendar/${mode}.tpl`,
    );
    assert.match(
      template,
      /data-action="refresh"[\s\S]*?data-action="searchCalendar"[\s\S]*?aria-label=/,
    );
  }
});

test('calendar and Timeline search buttons invoke the modal without replacing existing handlers', () => {
  class Base {
    events = { 'click existing': () => {} };
  }
  for (const file of ['calendar', 'timeline']) {
    const View = load(`views/calendar/${file}.js`, {
      'crm:views/calendar/calendar': Base,
      'crm:views/calendar/timeline': Base,
      fullcalendar: {},
      'calendar-plus:calendar-colors': {},
      'calendar-plus:views/calendar/event-tooltip': class {},
      'calendar-plus:calendar-definitions': {},
      moment,
    });
    const view = new View();
    let opened = false;
    view.actionSearchCalendar = () => {
      opened = true;
    };
    view.events['click [data-action="searchCalendar"]'].call(view, { preventDefault() {} });
    assert.equal(opened, true);
    assert.equal(typeof view.events['click existing'], 'function');
  }
});

test('search navigation preserves the calendar mode and uses local dates for all-day Timeline results', () => {
  const dependencies = {
    'crm:views/calendar/calendar': class {},
    'crm:views/calendar/timeline': class {},
    fullcalendar: {},
    'calendar-plus:calendar-colors': {},
    'calendar-plus:views/calendar/event-tooltip': class {},
    'calendar-plus:calendar-definitions': {
      highlightSearchResult() {},
      isSearchResult() {
        return false;
      },
    },
    moment,
  };
  const Calendar = load('views/calendar/calendar.js', dependencies);
  const grid = new Calendar();
  const dates = [],
    times = [];
  Object.assign(grid, {
    mode: 'view-team',
    calendar: {
      gotoDate: (value) => dates.push(value),
      scrollToTime: (value) => times.push(value),
    },
    getDateTime: () => ({ toMoment: (value) => moment.utc(value).tz('America/Denver') }),
    updateDate() {},
    applyViewSettings() {},
    actionRefresh() {},
  });
  grid.showSearchResult({ scope: 'Meeting', id: 'meeting', dateStart: '2026-11-05 16:00:00' });
  assert.deepEqual(dates, ['2026-11-05']);
  assert.deepEqual(times, ['09:00:00']);
  assert.equal(grid.mode, 'view-team');

  const Timeline = load('views/calendar/timeline.js', dependencies);
  const timeline = new Timeline();
  const targets = [];
  Object.assign(timeline, {
    timeline: { moveTo: (value) => targets.push(value) },
    getDateTime: () => ({
      getTimeZone: () => 'America/Denver',
      toMoment: (value) => moment.utc(value).tz('America/Denver'),
    }),
    syncTimelineTooltips() {},
    applyViewSettings() {},
    actionRefresh() {},
  });
  timeline.showSearchResult({ id: 'all-day', scope: 'Task', dateStartDate: '2026-11-05' });
  assert.equal(targets[0].toISOString(), '2026-11-05T07:00:00.000Z');
});

test('search requests descending dates and keeps merged results newest first', async () => {
  const { view, search } = fixture();
  assert.equal(search.buildQuery(view, 'Meeting', filters).order, 'desc');
  const { modal } = modalFixture(async () => ({
    results: [
      { id: 'older', scope: 'Meeting', dateStart: '2026-11-03 09:00:00' },
      { id: 'newer', scope: 'Task', dateEnd: '2026-11-08 09:00:00' },
      { id: 'middle', scope: 'Call', dateStart: '2026-11-05 09:00:00' },
    ],
    errors: [],
    nextOffsets: {},
  }));
  await modal.actionSearch();
  assert.deepEqual(
    Array.from(modal.results, (record) => record.id),
    ['newer', 'middle', 'older'],
  );
});

test('search uses the global regular List Size and falls back to Espo default for invalid values', () => {
  const { view, search } = fixture();
  for (const [size, expected] of [
    [7, 7],
    [50, 50],
    [undefined, 20],
    [0, 20],
    [-2, 20],
  ]) {
    view.getConfig = () => ({ get: (name) => (name === 'recordsPerPage' ? size : 3) });
    assert.equal(search.getPageSize(view), expected);
    assert.equal(search.buildQuery(view, 'Meeting', filters).maxSize, expected);
  }
});

test('the global page size applies to the combined result list and buffered rows remain available', async () => {
  let requests = 0;
  const records = Array.from({ length: 60 }, (_, index) => ({
    id: String(index),
    scope: index % 2 ? 'Call' : 'Meeting',
    dateStart: `2026-11-${String(30 - Math.floor(index / 2)).padStart(2, '0')} 09:00:00`,
  }));
  const { modal } = modalFixture(async () => {
    requests++;
    return {
      results: requests === 1 ? records : [],
      errors: [],
      nextOffsets: { Meeting: null, Call: null },
    };
  });
  await modal.actionSearch();
  assert.equal(modal.results.length, 25);
  assert.equal(modal.pendingResults.length, 35);
  await modal.loadResults();
  assert.equal(modal.results.length, 50);
  assert.equal(modal.pendingResults.length, 10);
  await modal.loadResults();
  assert.equal(modal.results.length, 60);
  assert.equal(modal.pendingResults.length, 0);
  assert.equal(new Set(modal.results.map((record) => record.id)).size, 60);
  assert.equal(modal.results[0].dateStart, '2026-11-30 09:00:00');
});

test('combined paging preserves descending date order across types while applying List Size once', async () => {
  const data = {
    Meeting: [25, 23, 21, 19, 17],
    Call: [24, 22, 20, 18, 16],
  };
  const calls = [];
  const { search } = fixture(async (scope, query) => {
    calls.push(query.maxSize);
    const dates = data[scope];
    return {
      list: dates.slice(query.offset, query.offset + query.maxSize).map((day) => ({
        id: `${scope}-${day}`,
        dateStart: `2026-11-${day} 09:00:00`,
      })),
      total: dates.length,
    };
  });
  const { modal } = modalFixture(search.searchPage, {
    availableScopes: search.availableScopes,
    getPageSize: search.getPageSize,
  });
  modal.options.calendar.getConfig = () => ({ get: () => 3 });
  modal.model.attributes.scopeList = ['Meeting', 'Call'];
  await modal.actionSearch();
  assert.equal(modal.results.length, 3);
  await modal.loadResults();
  assert.equal(modal.results.length, 6);
  await modal.loadResults();
  await modal.loadResults();
  assert.deepEqual(
    Array.from(modal.results, (record) => Number(record.dateStart.slice(8, 10))),
    [25, 24, 23, 22, 21, 20, 19, 18, 17, 16],
  );
  assert.ok(calls.every((size) => size === 3));
});

test('Enter submits search inputs without hijacking pickers, composition, or other keyboard actions', () => {
  const { modal } = modalFixture(async () => ({ results: [], errors: [], nextOffsets: {} }));
  let searches = 0;
  modal.actionSearch = () => {
    searches++;
  };
  const handler = modal.events['keydown .record-container input'];
  const event = (overrides = {}) => ({
    key: 'Enter',
    target: { closest: () => null },
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
    ...overrides,
  });
  const enter = event();
  handler.call(modal, enter);
  assert.equal(searches, 1);
  assert.equal(enter.prevented, true);
  assert.equal(enter.stopped, true);

  for (const overrides of [
    { key: 'Escape' },
    { repeat: true },
    { isComposing: true },
    { originalEvent: { isComposing: true } },
    { defaultPrevented: true },
    { isDefaultPrevented: () => true },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { target: { closest: () => ({}) } },
  ]) {
    handler.call(modal, event(overrides));
  }
  assert.equal(searches, 1);
});

test('search options default to a compact date column and descending date sort', () => {
  const { view, search } = fixture();
  assert.deepEqual(plain(search.getOptions(view)), {
    columns: ['when', 'status'],
    sortBy: 'date',
    sortDirection: 'desc',
  });
  view.getPreferences = () => ({
    get: () => ({
      columns: ['status', 'attendees', 'status', 'invalid'],
      sortBy: 'bad',
      sortDirection: 'bad',
    }),
  });
  assert.deepEqual(plain(search.getOptions(view)), {
    columns: ['status', 'attendees'],
    sortBy: 'date',
    sortDirection: 'desc',
  });
  view.getPreferences = () => ({ get: () => ({ columns: [] }) });
  assert.deepEqual(Array.from(search.getOptions(view).columns), []);
});

test('saved sorting controls both native queries and merged result order', () => {
  const { view, search } = fixture();
  const options = { sortBy: 'title', sortDirection: 'asc' };
  view.getPreferences = () => ({ get: () => options });
  assert.equal(search.buildQuery(view, 'Meeting', filters).orderBy, 'name');
  assert.equal(search.buildQuery(view, 'Meeting', filters).order, 'asc');
  const records = [
    { id: 'z', scope: 'Meeting', name: 'Zulu', dateStart: '2026-11-25' },
    { id: 'a', scope: 'Call', name: 'Alpha', dateStart: '2026-11-20' },
  ];
  assert.deepEqual(
    [...records].sort((a, b) => search.compareResults(view, a, b)).map((record) => record.name),
    ['Alpha', 'Zulu'],
  );
  options.sortDirection = 'desc';
  assert.deepEqual(
    [...records].sort((a, b) => search.compareResults(view, a, b)).map((record) => record.name),
    ['Zulu', 'Alpha'],
  );
  options.sortBy = 'date';
  options.sortDirection = 'asc';
  assert.equal(search.buildQuery(view, 'Meeting', filters).orderBy, 'dateStart');
  assert.deepEqual(
    [...records].sort((a, b) => search.compareResults(view, a, b)).map((record) => record.id),
    ['a', 'z'],
  );
});

function resultOptionsFixture(fail = false) {
  class Modal {
    on(name, callback) {
      this.onRemove = callback;
    }
  }
  class Model {
    constructor(attributes) {
      this.attributes = attributes;
    }
  }
  class Field {
    constructor(options) {
      this.options = options;
    }
  }
  class Record {
    constructor(options) {
      this.options = options;
    }
    processFetch() {
      return this.options.model.attributes;
    }
    validate() {
      return false;
    }
  }
  const { search } = fixture();
  const errors = [],
    saves = [];
  const state = {
    calendarPlusSearchSettings: {
      columns: ['when'],
      sortBy: 'date',
      sortDirection: 'desc',
      futureOption: true,
    },
  };
  const Options = load(
    'views/calendar/modals/search-options.js',
    {
      'views/modal': Modal,
      model: Model,
      'views/record/edit-for-modal': Record,
      'views/fields/multi-enum': Field,
      'views/fields/enum': Field,
      'calendar-plus:calendar-search': search,
    },
    { Ui: { error: (message) => errors.push(message) } },
  );
  const view = new Options();
  Object.assign(view, {
    options: {
      onSave: () => {
        view.saved = true;
      },
    },
    translate: (value) => value,
    getPreferences: () => ({
      get: (name) => state[name],
      set: (name, value) => {
        state[name] = value;
      },
      save: async (data, options) => {
        saves.push({ data, options });
        Object.assign(state, data);
        if (fail) throw new Error();
      },
    }),
    assignView() {},
    disableButton() {},
    enableButton() {
      this.enabled = true;
    },
    close() {
      this.closed = true;
    },
  });
  view.setup();
  return { view, state, saves, errors };
}

test('search result options save per-user preferences while retaining unknown settings and allowing no optional columns', async () => {
  const { view, state, saves } = resultOptionsFixture();
  assert.equal(saves.length, 0, 'opening or canceling does not save');
  Object.assign(view.model.attributes, { columns: [], sortBy: 'title', sortDirection: 'asc' });
  await view.actionSave();
  assert.deepEqual(plain(state.calendarPlusSearchSettings), {
    columns: [],
    sortBy: 'title',
    sortDirection: 'asc',
    futureOption: true,
  });
  assert.equal(saves[0].options.patch, true);
  assert.equal(saves[0].options.wait, true);
  assert.equal(view.closed, true);
  assert.equal(view.saved, true);
});

test('failed search options saves restore preferences and keep the dialog open for retry', async () => {
  const { view, state, errors } = resultOptionsFixture(true);
  const previous = state.calendarPlusSearchSettings;
  view.model.attributes.columns.push('status');
  assert.deepEqual(Array.from(previous.columns), ['when'], 'editing does not mutate saved columns');
  await view.actionSave();
  assert.equal(state.calendarPlusSearchSettings, previous);
  assert.equal(view.closed, undefined);
  assert.equal(view.saved, undefined);
  assert.equal(view.enabled, true);
  assert.equal(errors.length, 1);
});

test('entity badges use configured colors and contrasting text for dark and light backgrounds', () => {
  const colors = load('calendar-colors.js', {});
  const calendar = { colors: { Meeting: '#123456', Task: '#f4d03f' } };
  assert.equal(colors.entityColor(calendar, 'Meeting'), '#123456');
  assert.equal(colors.entityColor(calendar, 'Task'), '#f4d03f');
  assert.equal(colors.contrastText('#123456'), '#fff');
  assert.equal(colors.contrastText('#f4d03f'), '#111');
});

test('search status badges resolve each entity type metadata independently with neutral and reference fallbacks', () => {
  const { view, search, definitions } = fixture();
  definitions.Meeting.fields.status.style = { Held: 'success' };
  definitions.Call.fields = { ...definitions.Call.fields, status: { style: { Held: 'warning' } } };
  assert.equal(search.statusStyle(view, 'Meeting', 'Held'), 'success');
  assert.equal(search.statusStyle(view, 'Call', 'Held'), 'warning');
  assert.equal(search.statusStyle(view, 'Meeting', 'Planned'), 'default');
  definitions.Call.fields.status.style.Held = 'danger';
  assert.equal(search.statusStyle(view, 'Call', 'Held'), 'danger');
  definitions.Task.fields.status = { optionsReference: 'Meeting.status' };
  assert.equal(search.statusStyle(view, 'Task', 'Held'), 'success');
});

test('calendar navigation availability depends on loaded users and ignores display filters', () => {
  const { view, search } = fixture();
  view.isSharedTimeGrid = () => true;
  view.sharedUsers = [{ id: 'loaded' }];
  view.hiddenUserIds = new Set(['loaded']);
  view.enabledScopeList = [];
  view.getPreferences = () => ({
    get: () => ({ showCanceledEvents: false, showDeclinedEvents: false }),
  });
  const meeting = {
    scope: 'Meeting',
    id: 'event',
    usersIds: ['loaded'],
    assignedUserId: 'other',
    status: 'Not Held',
    dateStart: '2026-11-07 23:00:00',
  };
  assert.deepEqual(plain(search.resultAvailability(view, meeting)), {
    canShow: true,
    reason: null,
    userIds: ['loaded'],
  });
  assert.equal(search.resultAvailability(view, { ...meeting, usersIds: ['other'] }).canShow, false);
  assert.equal(
    search.resultAvailability(view, { ...meeting, usersIds: ['other'], assignedUserId: 'loaded' })
      .canShow,
    false,
    'Meetings belong on attendee calendars, not an owner who is not attending',
  );
  assert.equal(
    search.resultAvailability(view, {
      scope: 'Task',
      assignedUserId: 'other',
      collaboratorsIds: ['loaded'],
      dateEnd: '2026-11-08',
    }).canShow,
    false,
    'the native Task calendar does not load collaborators',
  );
  assert.equal(
    search.resultAvailability(view, {
      scope: 'Task',
      assignedUserId: 'loaded',
      dateEnd: '2026-11-08',
    }).canShow,
    true,
  );
  view.sharedUsers = [];
  assert.equal(search.resultAvailability(view, meeting).canShow, false);
});

test('personal and Timeline availability use their loaded membership and require a date', () => {
  const { view, search } = fixture();
  view.getUser = () => ({ id: 'me' });
  assert.equal(
    search.resultAvailability(view, {
      scope: 'Task',
      assignedUserId: 'me',
      dateEndDate: '2026-11-08',
    }).canShow,
    true,
  );
  view.options = { userId: 'selected' };
  assert.equal(
    search.resultAvailability(view, {
      scope: 'Task',
      assignedUserId: 'me',
      dateEndDate: '2026-11-08',
    }).canShow,
    false,
  );
  view.userList = [{ id: 'timeline-user' }];
  assert.equal(
    search.resultAvailability(view, {
      scope: 'Call',
      usersNames: { 'timeline-user': 'Person' },
      dateStart: '2026-11-08',
    }).canShow,
    true,
  );
  assert.equal(
    search.resultAvailability(view, { scope: 'Task', assignedUserId: 'timeline-user' }).reason,
    'Search result has no date',
  );
});

test('search shares loaded-user rules while using persisted attendees rather than create-time owner prediction', () => {
  const { view, search } = fixture();
  view.isSharedTimeGrid = () => true;
  view.sharedUsers = [{ id: 'ann' }];
  view.getConfig = () => ({ get: () => false });
  const record = {
    id: 'meeting',
    scope: 'Meeting',
    assignedUserId: 'ann',
    usersIds: ['bob'],
    usersNames: { ann: 'Stale name', bob: 'Bob' },
    dateStart: '2026-11-05 09:00:00',
  };
  const before = JSON.stringify(record);
  assert.equal(search.resultAvailability(view, record).canShow, false);
  assert.equal(JSON.stringify(record), before);
  record.usersIds = ['ann'];
  assert.equal(search.resultAvailability(view, record).canShow, true);
});

test('shared search membership respects assignment field type and custom User relationship metadata', () => {
  const { view, search, definitions } = fixture();
  view.isSharedTimeGrid = () => true;
  view.sharedUsers = [{ id: 'ann' }];
  definitions.Task.fields.assignedUsers = { type: 'varchar' };
  const task = { id: 'task', scope: 'Task', assignedUserId: 'ann', dateEndDate: '2026-11-05' };
  assert.equal(search.resultAvailability(view, task).canShow, true);
  definitions.Task.fields.assignedUsers = { type: 'linkMultiple' };
  task.assignedUsersIds = ['bob'];
  task.assignedUsersNames = { ann: 'Stale name', bob: 'Bob' };
  assert.equal(search.resultAvailability(view, task).canShow, false);
  definitions.Custom = {
    fields: { users: { type: 'linkMultiple' } },
    links: { users: { entity: 'Contact' } },
  };
  const custom = {
    id: 'custom',
    scope: 'Custom',
    usersIds: ['ann'],
    dateStart: '2026-11-05 09:00:00',
  };
  assert.equal(search.resultAvailability(view, custom).canShow, false);
  definitions.Custom.links.users.entity = 'User';
  assert.equal(search.resultAvailability(view, custom).canShow, true);
});
