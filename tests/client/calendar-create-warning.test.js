import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const root = new URL('../../src/files/client/custom/modules/calendar-plus/src/', import.meta.url);
function load(file, dependencies = {}, espo = {}, globals = {}) {
  let result;
  vm.runInNewContext(readFileSync(new URL(file, root), 'utf8'), {
    define: (name, names, factory) => {
      result = factory(...names.map((name) => dependencies[name]));
    },
    Espo: espo,
    queueMicrotask,
    ...globals,
  });
  return result;
}
const definitions = load('calendar-definitions.js');
const visibility = load(
  'calendar-visibility.js',
  {
    'calendar-plus:calendar-definitions': definitions,
  },
  {},
  { document: { createElement: () => new Element() } },
);

function calendarFixture() {
  const state = {
    calendarViewDataList: [{ id: 'shared', name: 'Shared' }],
    calendarPlusViewSettings: {},
  };
  const metadata = {
    entityDefs: {
      Task: { fields: { assignedUser: { type: 'link' }, collaborators: { type: 'linkMultiple' } } },
      Meeting: {
        fields: { users: { type: 'linkMultiple' } },
        links: { users: { entity: 'User' } },
      },
      Call: { fields: { users: { type: 'linkMultiple' } }, links: { users: { entity: 'User' } } },
      Custom: {
        fields: { assignedUser: { type: 'link' }, users: { type: 'linkMultiple' } },
        links: { users: { entity: 'User' } },
      },
    },
    scopes: { Task: { canceledStatusList: ['Canceled'] } },
  };
  const config = {};
  const view = {
    mode: 'view-shared',
    options: {},
    sharedUsers: [{ id: 'ann', name: 'Ann' }],
    hiddenUserIds: new Set(),
    enabledScopeList: ['Meeting', 'Call', 'Task', 'Custom'],
    isSharedTimeGrid: () => true,
    getUser: () => ({ id: 'ann' }),
    getMetadata: () => ({ get: (path) => path.reduce((value, key) => value?.[key], metadata) }),
    getPreferences: () => ({ get: (key) => state[key] }),
    getConfig: () => ({ get: (key) => config[key] }),
  };
  return { view, state, metadata, config };
}

test('create warns for excluded task owners while collaborators do not imply calendar membership', () => {
  const { view } = calendarFixture();
  assert.equal(
    visibility.creationWarning(view, 'Task', { assignedUserId: 'bob', collaboratorsIds: ['ann'] }),
    'Created event users not in calendar',
  );
  assert.equal(visibility.creationWarning(view, 'Task', { assignedUserId: 'ann' }), null);
  assert.equal(
    visibility.creationWarning(view, 'Task', {}),
    null,
    'defer while no user is selected',
  );
});

test('Meeting and Call warnings respect attendees and Espo automatic owner-attendee configuration', () => {
  for (const scope of ['Meeting', 'Call']) {
    const { view, config } = calendarFixture();
    assert.equal(
      visibility.creationWarning(view, scope, { assignedUserId: 'bob', usersIds: ['ann'] }),
      null,
    );
    assert.equal(
      visibility.creationWarning(view, scope, { assignedUserId: 'ann', usersIds: [] }),
      null,
    );
    config.eventAssignedUserIsAttendeeDisabled = true;
    assert.equal(
      visibility.creationWarning(view, scope, { assignedUserId: 'ann', usersIds: ['bob'] }),
      'Created event users not in calendar',
    );
    assert.equal(
      visibility.creationWarning(view, scope, {
        assignedUserId: 'bob',
        usersIds: ['ann'],
        usersColumns: { ann: { status: 'Declined' } },
      }),
      'Created event attendees declined',
    );
  }
});

test('visibility warnings support Timeline, personal calendars, custom attendees and multiple assignees', () => {
  const { view, metadata } = calendarFixture();
  assert.equal(
    visibility.creationWarning(view, 'Custom', { assignedUserId: 'bob', usersIds: ['ann'] }),
    null,
  );
  metadata.entityDefs.Task.fields.assignedUsers = { type: 'linkMultiple' };
  assert.equal(
    visibility.creationWarning(view, 'Task', { assignedUserId: 'bob', assignedUsersIds: ['ann'] }),
    null,
  );
  view.isSharedTimeGrid = () => false;
  view.userList = [{ id: 'bob' }];
  assert.equal(
    visibility.creationWarning(view, 'Task', { assignedUsersIds: ['ann'] }),
    'Created event users not in calendar',
  );
  assert.equal(visibility.creationWarning(view, 'Task', { assignedUsersIds: ['bob'] }), null);
  delete view.userList;
  view.options.userId = 'other';
  assert.equal(
    visibility.creationWarning(view, 'Task', { assignedUsersIds: ['ann'] }),
    'Created event users not in calendar',
  );
});

test('warnings explain hidden people, event types and statuses without changing calendar settings', () => {
  const { view, state } = calendarFixture();
  const attributes = { assignedUserId: 'ann', status: 'Canceled' };
  view.hiddenUserIds.add('ann');
  assert.equal(visibility.creationWarning(view, 'Task', attributes), 'Created event users hidden');
  view.hiddenUserIds.clear();
  view.enabledScopeList = ['Meeting'];
  assert.equal(visibility.creationWarning(view, 'Task', attributes), 'Created event type hidden');
  view.enabledScopeList.push('Task');
  state.calendarPlusViewSettings['view:shared'] = { showCanceledEvents: false };
  const before = JSON.stringify(state);
  assert.equal(visibility.creationWarning(view, 'Task', attributes), 'Created event status hidden');
  assert.equal(JSON.stringify(state), before);
});

class Element {
  constructor() {
    this.children = [];
    this.classes = new Set();
    this.classList = {
      toggle: (name, active) => (active ? this.classes.add(name) : this.classes.delete(name)),
    };
  }
  querySelector(selector) {
    return selector === '.modal-body'
      ? null
      : this.children.find((element) => element.className.includes('cp-calendar-create-warning')) ||
          null;
  }
  prepend(element) {
    this.children.unshift(element);
  }
  setAttribute(name, value) {
    this[name] = value;
  }
}

function editorFixture({ succeed = true, existing = false } = {}) {
  const { view: calendar } = calendarFixture();
  const notices = [];
  const model = {
    id: existing ? 'existing' : null,
    entityType: 'Task',
    attributes: { assignedUserId: 'bob' },
    isNew() {
      return !this.id;
    },
    getClonedAttributes() {
      return { ...this.attributes };
    },
  };
  const field = { name: 'assignedUser' };
  const record = { model, fetch: () => ({ ...model.attributes }), getFieldViewList: () => [field] };
  class Base {
    createRecordView(model, callback) {
      callback(record);
    }
    afterRender() {}
    async actionSave() {
      this.saveCalls = (this.saveCalls || 0) + 1;
      if (succeed) model.id = 'saved';
    }
  }
  const Editor = load(
    'views/calendar/modals/edit.js',
    {
      'crm:views/calendar/modals/edit': Base,
      'calendar-plus:calendar-visibility': visibility,
    },
    { Ui: { notify: (...args) => notices.push(args) } },
    { document: { createElement: () => new Element() } },
  );
  const editor = new Editor();
  const listeners = [];
  Object.assign(editor, {
    options: { calendarView: calendar },
    el: new Element(),
    scope: 'Task',
    getRecordView: () => record,
    translate: (value) => value,
    listenTo: (target, event, callback) => listeners.push({ target, event, callback }),
    stopListening() {
      editor.detached = true;
    },
  });
  editor.createRecordView(model);
  editor.afterRender();
  return { editor, model, record, notices, calendar, listeners, field };
}

test('create warning updates as fields change and stays advisory', async () => {
  const { editor, model, notices } = editorFixture();
  const warning = editor.el.children[0];
  assert.equal(warning.hidden, false);
  assert.equal(warning.textContent, 'Created event users not in calendar');
  model.attributes.assignedUserId = 'ann';
  editor.visibilityChanged();
  assert.equal(warning.hidden, true);
  model.attributes.assignedUserId = 'bob';
  editor.visibilityChanged();
  await editor.actionSave();
  assert.equal(editor.saveCalls, 1);
  assert.equal(model.id, 'saved');
  assert.equal(notices.length, 1);
  assert.equal(notices[0][0], 'Created event users not in calendar after save');
  assert.equal(notices[0][1], 'warning');
});

test('failed saves and existing-record edits do not show a created-event warning', async () => {
  const failed = editorFixture({ succeed: false });
  await failed.editor.actionSave();
  assert.equal(failed.model.isNew(), true);
  assert.equal(failed.notices.length, 0);
  const existing = editorFixture({ existing: true });
  assert.equal(existing.editor.el.children[0].hidden, true);
  await existing.editor.actionSave();
  assert.equal(existing.notices.length, 0);
});

test('switching event types rebinds warning updates without retaining the previous model listener', () => {
  const { editor } = editorFixture();
  const next = {
    entityType: 'Meeting',
    isNew: () => true,
    getClonedAttributes: () => ({ usersIds: ['ann'] }),
  };
  editor.createRecordView(next);
  editor.visibilityChanged();
  assert.equal(editor.visibilityModel, next);
  assert.equal(editor.detached, true);
  assert.equal(editor.el.children[0].hidden, true);
});

test('all calendar modes route only their native event-create modal through the warning subclass', () => {
  class Base {
    createView(...args) {
      return args;
    }
  }
  for (const file of ['calendar', 'timeline']) {
    const View = load(`views/calendar/${file}.js`, {
      'crm:views/calendar/calendar': Base,
      'crm:views/calendar/timeline': Base,
      fullcalendar: {},
      'calendar-plus:calendar-colors': {},
      'calendar-plus:views/calendar/event-tooltip': class {},
      'calendar-plus:calendar-definitions': definitions,
    });
    const calendar = new View();
    const options = { attributes: { name: 'Event' } };
    const created = calendar.createView('dialog', 'crm:views/calendar/modals/edit', options);
    assert.equal(created[1], 'calendar-plus:views/calendar/modals/edit');
    assert.equal(created[2].calendarView, calendar);
    assert.equal(created[2].attributes.name, 'Event');
    const unrelated = calendar.createView('other', 'views/modals/edit', options);
    assert.equal(unrelated[1], 'views/modals/edit');
    assert.equal(unrelated[2], options);
  }
});

test('warning returns when switching from excluded to visible and back even if only the field changes', async () => {
  const { editor, model, record, listeners, field } = editorFixture();
  const warning = editor.el.children[0];
  const onChange = listeners.find(
    (listener) => listener.target === field && listener.event === 'change',
  ).callback;
  let selected = 'bob';
  record.fetch = () => ({ assignedUserId: selected });
  assert.equal(warning.hidden, false);

  for (const user of ['ann', 'bob', 'ann', 'bob']) {
    selected = user;
    onChange();
    await Promise.resolve();
    assert.equal(warning.hidden, user === 'ann');
  }

  assert.equal(model.attributes.assignedUserId, 'bob', 'warning checks do not mutate the event');
  assert.equal(listeners.filter((listener) => listener.target === field).length, 1);
  editor.bindVisibilityFields(record);
  assert.equal(listeners.filter((listener) => listener.target === field).length, 1);
});

test('removed attendee and multiple-assignee IDs take priority over stale names', () => {
  const { view, config, metadata } = calendarFixture();
  config.eventAssignedUserIsAttendeeDisabled = true;
  assert.equal(
    visibility.creationWarning(view, 'Meeting', {
      assignedUserId: 'bob',
      usersIds: ['bob'],
      usersNames: { ann: 'Ann', bob: 'Bob' },
    }),
    'Created event users not in calendar',
  );
  metadata.entityDefs.Task.fields.assignedUsers = { type: 'linkMultiple' };
  assert.equal(
    visibility.creationWarning(view, 'Task', {
      assignedUsersIds: ['bob'],
      assignedUsersNames: { ann: 'Ann', bob: 'Bob' },
    }),
    'Created event users not in calendar',
  );
});

function activeCalendarFixture() {
  const active = load('active-calendar.js');
  const { view: calendar } = calendarFixture();
  const removed = [];
  calendar.scopeList = ['Task', 'Meeting', 'Call', 'Custom'];
  calendar.on = (event, callback) => {
    if (event === 'remove') removed.push(callback);
  };
  calendar.el = {
    isConnected: true,
    closest: () => ({}),
    querySelector: () => ({}),
    getClientRects: () => [{}],
  };
  calendar.actionRefresh = () => {
    calendar.refreshes = (calendar.refreshes || 0) + 1;
  };
  active.register(calendar);
  return { active, calendar, removed };
}

test('active calendar detection excludes hidden, removed, disconnected and embedded views', () => {
  const { active, calendar, removed } = activeCalendarFixture();
  assert.equal(active.find(), calendar);
  active.register(calendar);
  assert.equal(removed.length, 1, 'rerenders do not add duplicate lifecycle listeners');
  calendar.el.getClientRects = () => [];
  assert.equal(active.find(), null);
  calendar.el.getClientRects = () => [{}];
  calendar.el.isConnected = false;
  assert.equal(active.find(), null);
  calendar.el.isConnected = true;
  calendar.el.closest = () => null;
  assert.equal(active.find(), null);
  calendar.el.closest = () => ({});
  calendar.el.querySelector = () => null;
  assert.equal(active.find(), null);
  calendar.el.querySelector = () => ({});
  removed[0]();
  assert.equal(active.find(), null);
});

class Events {
  constructor() {
    this.callbacks = {};
  }
  on(name, callback) {
    (this.callbacks[name] ||= []).push(callback);
  }
  trigger(name, ...args) {
    for (const callback of this.callbacks[name] || []) callback(...args);
  }
}

function quickAddFixture() {
  const { active, calendar } = activeCalendarFixture();
  const notices = [],
    timers = [];
  const model = new Events();
  Object.assign(model, {
    entityType: 'Task',
    attributes: { assignedUserId: 'bob' },
    isNew() {
      return !this.id;
    },
    getClonedAttributes() {
      return { ...this.attributes };
    },
  });
  const field = new Events();
  const view = new Events();
  Object.assign(view, {
    model,
    options: { type: 'editSmall' },
    el: new Element(),
    fetch: () => ({ ...model.attributes }),
    getFieldViewList: () => [field],
    listenTo: (target, event, callback) => target.on(event, callback),
    translate: (value) => value,
    isRemoved: () => false,
  });
  const Handler = load(
    'handlers/quick-create-warning.js',
    {
      'calendar-plus:active-calendar': active,
      'calendar-plus:calendar-visibility': visibility,
    },
    { Ui: { notify: (...args) => notices.push(args) } },
    {
      setTimeout: (callback) => {
        timers.push(callback);
      },
    },
  );
  const handler = new Handler(view);
  return { handler, view, model, field, calendar, active, notices, timers };
}

test('Quick Add warns only with a visible calendar and follows repeated user-field changes', async () => {
  const { handler, view, model, field } = quickAddFixture();
  handler.process();
  view.trigger('after:render');
  const warning = view.el.children[0];
  assert.equal(warning.hidden, false);
  let selected = 'ann';
  view.fetch = () => ({ assignedUserId: selected });
  for (const user of ['ann', 'bob', 'ann', 'bob']) {
    selected = user;
    field.trigger('change');
    await Promise.resolve();
    assert.equal(warning.hidden, user === 'ann');
  }
  assert.equal(model.attributes.assignedUserId, 'bob');
});

test('Quick Add refreshes the visible calendar and warns after successful creation only', () => {
  const { handler, view, model, calendar, timers, notices } = quickAddFixture();
  handler.process();
  view.trigger('after:render');
  view.trigger('before:save');
  assert.equal(timers.length, 0);
  model.id = 'created';
  view.trigger('after:save');
  assert.equal(notices.length, 0, 'wait for the native create notification first');
  timers[0]();
  assert.equal(calendar.refreshes, 1);
  assert.equal(notices[0][0], 'Created event users not in calendar after save');
  assert.equal(notices[0][1], 'warning');
});

test('Quick Add visible events refresh without a warning and other pages keep native behavior', () => {
  const shown = quickAddFixture();
  shown.model.attributes.assignedUserId = 'ann';
  shown.handler.process();
  shown.view.trigger('after:render');
  assert.equal(shown.view.el.children[0].hidden, true);
  shown.view.trigger('before:save');
  shown.model.id = 'created';
  shown.view.trigger('after:save');
  shown.timers[0]();
  assert.equal(shown.calendar.refreshes, 1);
  assert.equal(shown.notices.length, 0);

  const otherPage = quickAddFixture();
  otherPage.calendar.el.isConnected = false;
  otherPage.handler.process();
  otherPage.view.trigger('after:render');
  assert.equal(otherPage.view.el.children.length, 0);
  assert.deepEqual(otherPage.view.callbacks, {});
});

test('Quick Add hook skips existing records, unrelated entities, full forms, and calendar-owned warning forms', () => {
  for (const change of [
    ({ model }) => {
      model.id = 'existing';
    },
    ({ model }) => {
      model.entityType = 'Contact';
    },
    ({ view }) => {
      view.options.type = 'edit';
    },
    ({ view }) => {
      view.options.calendarPlusVisibilityWarningHandled = true;
    },
  ]) {
    const fixture = quickAddFixture();
    change(fixture);
    fixture.handler.process();
    assert.deepEqual(fixture.view.callbacks, {});
    assert.equal(fixture.view.el.children.length, 0);
  }
  const { editor } = editorFixture();
  const options = {};
  editor.handleRecordViewOptions(options);
  assert.equal(options.calendarPlusVisibilityWarningHandled, true);
});

test('Quick Add warning and notification stop applying if the calendar is no longer visible', () => {
  const { handler, view, model, calendar, timers, notices } = quickAddFixture();
  handler.process();
  view.trigger('after:render');
  assert.equal(view.el.children[0].hidden, false);
  calendar.el.isConnected = false;
  model.trigger('change');
  assert.equal(view.el.children[0].hidden, true);
  view.trigger('before:save');
  model.id = 'created';
  view.trigger('after:save');
  timers[0]();
  assert.equal(notices.length, 0);
  assert.equal(calendar.refreshes, undefined);
});

test('Quick Add warning hooks append to native record setup handlers', () => {
  const metadata = JSON.parse(
    readFileSync(
      new URL(
        '../../src/files/custom/Espo/Modules/CalendarPlus/Resources/metadata/clientDefs/Global.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.deepEqual(metadata.viewSetupHandlers['record/edit'], [
    '__APPEND__',
    'calendar-plus:handlers/quick-create-warning',
  ]);
});

test('shared visibility predicts owner attendees only for create and never mutates event data', () => {
  const { view } = calendarFixture();
  const attributes = { assignedUserId: 'ann', usersIds: ['bob'], usersNames: { bob: 'Bob' } };
  const before = JSON.stringify(attributes);
  assert.deepEqual(Array.from(visibility.includedUserIds(view, 'Meeting', attributes)), []);
  assert.deepEqual(
    Array.from(visibility.includedUserIds(view, 'Meeting', attributes, { forCreate: true })),
    ['ann'],
  );
  assert.equal(visibility.creationWarning(view, 'Meeting', attributes), null);
  assert.equal(
    JSON.stringify(attributes),
    before,
    'checking visibility must not add real attendees',
  );
});
