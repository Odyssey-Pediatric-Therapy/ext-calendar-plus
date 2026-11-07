import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const root = new URL('../../src/files/client/custom/modules/calendar-plus/src/', import.meta.url);
function load(file, dependencies = {}, espo = {}) {
  let exported;
  vm.runInNewContext(readFileSync(new URL(file, root), 'utf8'), {
    define: (name, names, factory) => {
      exported = factory(
        ...names.map((name) =>
          name === 'calendar-plus:views/calendar/settings-form'
            ? load('views/calendar/settings-form.js', dependencies, espo)
            : dependencies[name],
        ),
      );
    },
    Espo: espo,
  });

  return exported;
}
const definitions = load('calendar-definitions.js');
function fixture(item = null) {
  class Modal {
    constructor(options) {
      this.options = options;
      this.dropdownItemList = [];
    }

    on(name, callback) {
      this.onRemove = callback;
    }
  }
  class Model {
    constructor(data) {
      this.attributes = data;
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
  const espo = {
    Utils: { clone: structuredClone, cloneDeep: structuredClone },
    Ui: { error() {} },
  };
  const Editor = load(
    'views/calendar/modals/calendar.js',
    {
      'views/modal': Modal,
      model: Model,
      'views/record/edit-for-modal': Record,
      'views/fields/bool': Field,
      'views/fields/varchar': Field,
      'views/fields/enum': Field,
      'calendar-plus:views/calendar/fields/users': Field,
      'crm:views/calendar/fields/teams': Field,
      'calendar-plus:calendar-definitions': definitions,
    },
    espo,
  );
  const state = {
    calendarViewDataList: [
      { id: 'grid', name: 'Team week', mode: 'basicWeek', teamIdList: ['team'] },
    ],
    calendarPlusList: [
      { id: 'legacy', name: 'Old timeline', userIdList: ['ann'], teamIdList: ['team'] },
    ],
    fail: false,
  };
  const editor = new Editor({
    calendar: item,
    onSave: (saved) => {
      state.saved = saved;
    },
  });
  editor.translate = (value) => value;
  editor.assignView = () => {};
  editor.disableButton = () => {};
  editor.enableButton = () => {};
  editor.close = () => {
    state.closed = true;
  };
  editor.getConfig = () => ({ get: () => undefined });
  editor.getPreferences = () => ({
    get: (key) => state[key],
    set: (key, value) => {
      state[key] = value;
    },
    save: async (data) => {
      Object.assign(state, data);

      if (state.fail) throw new Error('Save failed');
    },
  });

  return { editor, state, espo };
}

test('one editor exposes Day, Week, Month, and Timeline with both team and people selection', () => {
  const { editor } = fixture();
  editor.setup();
  const rows = editor.recordView.options.detailLayout[0].rows;
  assert.deepEqual(Array.from(rows[0][1].view.options.params.options), [
    'agendaDay',
    'agendaWeek',
    'month',
    'timeline',
  ]);
  assert.equal(rows[1][0].view.options.name, 'teams');
  assert.equal(rows[2][0].view.options.name, 'users');
  assert.equal(editor.headerText, 'Create Calendar');
});

test('creating every calendar type saves people and teams in the unified list', async () => {
  for (const mode of ['agendaDay', 'agendaWeek', 'month', 'timeline']) {
    const { editor, state } = fixture();
    editor.setup();
    Object.assign(editor.model.attributes, {
      name: 'New calendar',
      mode,
      usersIds: ['bob'],
      teamsIds: ['team'],
    });
    await editor.actionSave();
    const saved = state.calendarViewDataList.find((item) => item.name === 'New calendar');
    assert.equal(saved.mode, mode);
    assert.deepEqual(Array.from(saved.userIdList), ['bob']);
    assert.deepEqual(Array.from(saved.teamIdList), ['team']);
    assert.equal(state.saved.routeMode, `view-${saved.id}`);
    assert.equal(state.calendarPlusList.length, 1);
  }
});

test('legacy timelines stay available and changing type preserves their ID and memberships', async () => {
  const original = {
    id: 'legacy',
    name: 'Old timeline',
    mode: 'timeline',
    source: 'timeline',
    userIdList: ['ann'],
    teamIdList: ['team'],
  };
  const { editor, state } = fixture(original);
  editor.setup();
  editor.model.attributes.mode = 'agendaDay';
  await editor.actionSave();
  assert.equal(state.calendarPlusList.length, 0);
  const saved = state.calendarViewDataList.find((item) => item.id === 'legacy');
  assert.deepEqual(Array.from(saved.userIdList), ['ann']);
  assert.deepEqual(Array.from(saved.teamIdList), ['team']);
  assert.equal(state.saved.routeMode, 'view-legacy');
});

test('editing an existing calendar preserves order; a failed conversion restores both lists', async () => {
  const { editor, state } = fixture({ id: 'grid', source: 'calendar' });
  await editor.persist({ id: 'grid', name: 'Renamed', mode: 'timeline', userIdList: ['ann'] });
  assert.equal(state.calendarViewDataList[0].name, 'Renamed');
  const failure = fixture({ id: 'legacy', source: 'timeline' });
  failure.state.fail = true;
  await failure.editor.persist({
    id: 'legacy',
    name: 'Converted',
    mode: 'month',
    userIdList: ['ann'],
  });
  assert.equal(failure.state.calendarPlusList.length, 1);
  assert.equal(failure.state.calendarViewDataList.length, 1);
  assert.equal(failure.state.closed, undefined);
});

test('the right selector keeps the shared Timeline and saved calendars without a personal timeline entry', () => {
  const { state } = fixture();
  class ModeButtons {
    getModeDataList() {
      return [
        { mode: 'month' },
        { mode: 'agendaWeek' },
        { mode: 'timeline', label: 'Timeline' },
        { mode: 'view-grid' },
      ];
    }

    data() {
      return {};
    }
  }
  const Buttons = load('views/calendar/mode-buttons.js', {
    'crm:views/calendar/mode-buttons': ModeButtons,
    'calendar-plus:calendar-definitions': definitions,
  });
  const buttons = new Buttons();
  buttons.isCustomViewAvailable = true;
  buttons.translate = (value) => value;
  buttons.getPreferences = () => ({ get: (key) => state[key] });
  const modes = buttons.getModeDataList().map((item) => item.mode);
  assert.deepEqual(Array.from(modes), [
    'month',
    'agendaWeek',
    'agendaDay',
    'timeline',
    'view-grid',
    'view-timeline-legacy',
  ]);
  assert.equal(
    buttons.getModeDataList().find((item) => item.mode === 'timeline').label,
    'Timeline',
  );
  buttons.mode = 'view-timeline-legacy';
  buttons.getCalendarParentView = () => ({});
  assert.equal(buttons.data().calendarEditable, true);
  assert.equal(buttons.data().selectedModeLabel, 'Old timeline');
  assert.deepEqual(
    Array.from(buttons.data().allModeDataList.slice(0, 4), (item) => item.mode),
    ['month', 'agendaWeek', 'agendaDay', 'timeline'],
  );
  buttons.isCustomViewAvailable = false;
  assert.equal(
    buttons.getModeDataList().some((item) => item.mode.startsWith('view-')),
    false,
  );
});

test('saved timeline routes mount the timeline renderer and saving reopens even an unchanged route', async () => {
  const { state } = fixture();
  class Page {
    setup() {}

    setupCalendar() {
      this.usedGrid = true;
    }
  }
  class Editor {
    constructor(options) {
      this.options = options;
    }

    async render() {}
  }
  const CalendarPage = load('views/calendar/calendar-page.js', {
    'crm:views/calendar/calendar-page': Page,
    'calendar-plus:views/calendar/modals/calendar': Editor,
    'calendar-plus:calendar-definitions': definitions,
  });
  const page = new CalendarPage();
  page.options = { mode: 'view-timeline-legacy' };
  page.getPreferences = () => ({ get: (key) => state[key] });
  page.getAcl = () => ({ getPermissionLevel: () => 'all' });
  page.getStorage = () => ({ get: () => null, set() {} });
  page.createView = (name, view, options) => {
    page.mounted = { view, options };
  };
  page.setup();
  page.setupCalendar();
  assert.equal(page.mounted.view, 'calendar-plus:views/calendar/timeline');
  assert.equal(page.mounted.options.calendarType, 'saved-legacy');
  assert.equal(page.mounted.options.mode, 'view-timeline-legacy');
  page.getCalendarView = () => ({});
  page.assignView = async (name, view) => {
    page.editor = view;
  };
  page.updateUrl = () => {};
  page.getRouter = () => ({
    dispatch: (controller, action, options) => {
      page.reopened = options;
    },
  });
  await page.editCustomView();
  assert.equal(page.editor.options.calendar.id, 'legacy');
  page.editor.options.onSave({ routeMode: 'view-timeline-legacy' });
  assert.equal(page.reopened.mode, 'view-timeline-legacy');
});

test('the built-in Timeline always opens shared even if an old named selection is stored', () => {
  class Page {}
  const CalendarPage = load('views/calendar/calendar-page.js', {
    'crm:views/calendar/calendar-page': Page,
    'calendar-plus:calendar-definitions': definitions,
  });
  const page = new CalendarPage();
  page.options = {};
  page.getStorage = () => ({ get: () => 'saved-legacy' });
  page.createView = (name, view, options) => {
    page.mounted = options;
  };
  page.setupTimeline();
  assert.equal(page.mounted.calendarType, 'shared');
  assert.equal(page.mounted.mode, 'timeline');
  assert.equal(page.mounted.calendarItem, null);
});

test('default Timeline editor preserves old users and exposes membership settings', () => {
  const { editor, state } = fixture();
  state.sharedCalendarUserList = [{ id: 'bob', name: 'Bob' }];
  editor.options.calendar = definitions.sharedTimeline(editor.getPreferences(), {
    id: 'me',
    get: () => 'Me',
  });
  editor.setup();
  assert.deepEqual(Array.from(editor.model.attributes.usersIds), ['bob']);
  const rows = editor.recordView.options.detailLayout[0].rows;
  assert.deepEqual(
    Array.from(rows, (row) => row[0].view.options.name),
    ['teams', 'users', 'membershipMode'],
  );
  assert.equal(editor.dropdownItemList.length, 0);
  assert.equal(editor.headerText, 'Edit Timeline');
});

test('default Timeline saves teams and people without creating a named calendar or changing legacy users', async () => {
  const { editor, state } = fixture();
  state.sharedCalendarUserList = [{ id: 'bob', name: 'Bob' }];
  editor.options.calendar = definitions.sharedTimeline(editor.getPreferences(), {
    id: 'me',
    get: () => 'Me',
  });
  editor.setup();
  Object.assign(editor.model.attributes, { teamsIds: ['team'], teamsNames: { team: 'Team' } });
  await editor.actionSave();
  assert.deepEqual(Array.from(state.calendarPlusSharedSelection.teamIdList), ['team']);
  assert.deepEqual(Array.from(state.calendarPlusSharedSelection.userIdList), ['bob']);
  assert.equal(state.calendarViewDataList.length, 1);
  assert.equal(state.calendarPlusList.length, 1);
  assert.deepEqual(state.sharedCalendarUserList, [{ id: 'bob', name: 'Bob' }]);
  assert.equal(state.saved.routeMode, 'timeline');
});

test('failed default Timeline save restores its selection and leaves the editor open', async () => {
  const { editor, state } = fixture();
  state.calendarPlusSharedSelection = { teamIdList: ['old'], userIdList: ['bob'] };
  editor.options.calendar = definitions.sharedTimeline(editor.getPreferences(), {
    id: 'me',
    get: () => 'Me',
  });
  editor.setup();
  editor.model.attributes.teamsIds = ['new'];
  state.fail = true;
  await editor.actionSave();
  assert.deepEqual(Array.from(state.calendarPlusSharedSelection.teamIdList), ['old']);
  assert.equal(state.closed, undefined);
});

test('editing default membership is isolated until Save', () => {
  const { editor, state } = fixture();
  state.calendarPlusSharedSelection = { teamIdList: ['old'], userIdList: ['bob'] };
  editor.options.calendar = definitions.sharedTimeline(editor.getPreferences(), {
    id: 'me',
    get: () => 'Me',
  });
  editor.setup();
  editor.model.attributes.teamsIds.push('new');
  assert.deepEqual(state.calendarPlusSharedSelection.teamIdList, ['old']);
});

test('Calendar Plus settings default on without overwriting saved false values', () => {
  class Settings {
    setup() {
      this.parentInitialized = true;
    }
  }
  const View = load('views/admin/settings.js', { 'views/settings/record/edit': Settings });
  const view = new View();
  const values = { calendarPlusColorGradientEnabled: false, calendarPlusTasksAllDay: false };
  view.model = {
    get: (name) => values[name],
    set: (name, value) => {
      values[name] = value;
    },
  };
  view.setup();
  assert.equal(values.calendarPlusTooltipEnabled, true);
  assert.equal(values.calendarPlusTimelineEventGap, 0);
  assert.equal(values.calendarPlusTooltipDelay, 1);
  assert.equal(values.calendarPlusTasksAllDay, false);
  assert.equal(values.calendarPlusColorGradientEnabled, false);
  assert.equal(view.layoutName, 'calendarPlusSettings');
  assert.equal(view.parentInitialized, true);
});

test('Admin uses the shared Extension Settings section with a Calendar Plus row with enabled feature defaults and a configurable Timeline gap', () => {
  const resources = new URL(
    '../../src/files/custom/Espo/Modules/CalendarPlus/Resources/',
    import.meta.url,
  );
  const panel = JSON.parse(
    readFileSync(new URL('metadata/app/adminPanel.json', resources)),
  ).extensionSettings;
  const item = panel.itemList.find((item) => typeof item === 'object');
  assert.equal(panel.label, 'Extension Settings');
  assert.equal(item.label, 'Calendar Plus');
  assert.equal(item.url, '#Admin/calendarPlusSettings');
  const fields = JSON.parse(
    readFileSync(new URL('metadata/entityDefs/Settings.json', resources)),
  ).fields;
  assert.equal(fields.calendarPlusTooltipEnabled.default, true);
  assert.equal(fields.calendarPlusColorGradientEnabled.default, true);
  assert.equal(fields.calendarPlusTasksAllDay.default, true);
  assert.equal(fields.calendarPlusTooltipDelay.default, 1);
  assert.equal(fields.calendarPlusTooltipDelay.min, 0);
  assert.equal(fields.calendarPlusTimelineEventGap.default, 0);
  assert.equal(fields.calendarPlusTimelineEventGap.min, 0);
  assert.equal(fields.calendarPlusTimelineEventGap.max, 100);
  assert.equal(
    fields.calendarPlusTooltipEnabled.onlyAdmin,
    undefined,
    'runtime flags must be readable by regular calendar users',
  );
});

test('Calendar Plus settings preserve an existing Timeline gap', () => {
  const View = load('views/admin/settings.js', {
    'views/settings/record/edit': class {
      setup() {}
    },
  });
  const view = new View();
  const values = { calendarPlusTimelineEventGap: 10 };
  view.model = {
    get: (name) => values[name],
    set: (name, value) => {
      values[name] = value;
    },
  };
  view.setup();
  assert.equal(values.calendarPlusTimelineEventGap, 10);
});

test('Calendar Plus settings preserve saved zero and fractional tooltip delays', () => {
  const View = load('views/admin/settings.js', {
    'views/settings/record/edit': class {
      setup() {}
    },
  });
  for (const delay of [0, 0.5, 2]) {
    const view = new View();
    const values = { calendarPlusTooltipDelay: delay };
    view.model = {
      get: (name) => values[name],
      set: (name, value) => {
        values[name] = value;
      },
    };
    view.setup();
    assert.equal(values.calendarPlusTooltipDelay, delay);
  }
});

test('tooltip delay is beside the enable checkbox and hides without losing its value', () => {
  const View = load('views/admin/settings.js', {
    'views/settings/record/edit': class {
      setup() {}
    },
  });
  const exported = {};
  vm.runInNewContext(
    readFileSync(
      new URL('../../site/client/lib/transpiled/src/dynamic-logic.js', import.meta.url),
      'utf8',
    ),
    {
      define: (name, deps, factory) => factory(exported, { inject: () => () => {} }, class {}),
    },
  );
  const settings = new View();
  const values = { calendarPlusTooltipEnabled: false, calendarPlusTooltipDelay: 2.5 };
  const states = [];
  const model = { has: (name) => name in values, get: (name) => values[name] };
  const logic = new exported.default(settings.dynamicLogicDefs, {
    model,
    hideField: (name) => states.push([name, false]),
    showField: (name) => states.push([name, true]),
  });
  logic.process();
  values.calendarPlusTooltipEnabled = true;
  logic.process();
  values.calendarPlusTooltipEnabled = false;
  logic.process();
  assert.deepEqual(states, [
    ['calendarPlusTooltipDelay', false],
    ['calendarPlusTooltipDelay', true],
    ['calendarPlusTooltipDelay', false],
  ]);
  assert.equal(values.calendarPlusTooltipDelay, 2.5);
  const layout = JSON.parse(
    readFileSync(
      new URL(
        '../../src/files/custom/Espo/Modules/CalendarPlus/Resources/layouts/Settings/calendarPlusSettings.json',
        import.meta.url,
      ),
    ),
  );
  assert.deepEqual(
    layout[0].rows[0].map((cell) => cell.name),
    ['calendarPlusTooltipEnabled', 'calendarPlusTooltipDelay'],
  );
  assert.deepEqual(
    layout[0].rows[1].map((cell) => cell.name),
    ['calendarPlusColorGradientEnabled', 'calendarPlusTasksAllDay'],
  );
});

function inactiveMenuFixture(state = {}, mode = 'view-grid', fail = false) {
  class Base {
    data() {
      return {};
    }

    getModeDataList() {
      return [];
    }
  }
  const errors = [];
  const Buttons = load(
    'views/calendar/mode-buttons.js',
    {
      'crm:views/calendar/mode-buttons': Base,
      'calendar-plus:calendar-definitions': definitions,
    },
    { Ui: { error: (message) => errors.push(message) } },
  );
  state.calendarViewDataList ||= [{ id: 'grid', name: 'Grid', mode: 'agendaWeek' }];
  const parent = {
    calendarType: mode === 'timeline' ? 'shared' : undefined,
    actionRefresh() {
      this.refreshes = (this.refreshes || 0) + 1;
    },
  };
  const saves = [];
  const preferences = {
    get: (key) => state[key],
    set: (key, value) => {
      state[key] = value;
    },
    save: async (data, options) => {
      saves.push({ data, options });
      Object.assign(state, data);

      if (fail) throw new Error('Save failed');
    },
  };
  const view = new Buttons();
  Object.assign(view, {
    mode,
    isCustomViewAvailable: true,
    getCalendarParentView: () => parent,
    getPreferences: () => preferences,
    translate: (key) => key,
    reRender() {
      this.renders = (this.renders || 0) + 1;
    },
  });

  return { view, parent, saves, state, errors };
}

test('inactive-user choice follows a saved calendar ID and appears in its edit dialog', () => {
  const { editor, state } = fixture({ id: 'grid', source: 'calendar' });
  state.calendarPlusViewSettings = { 'view:grid': { showInactiveUsers: true } };
  editor.setup();
  assert.equal(editor.model.attributes.showInactiveUsers, true);
  const rows = editor.recordView.options.detailLayout[0].rows;
  assert.equal(
    rows.some((row) => row.some((cell) => cell && cell.view.options.name === 'showInactiveUsers')),
    false,
  );
  state.calendarViewDataList = [];
  state.calendarPlusList = [{ id: 'grid', name: 'Timeline' }];
  assert.equal(definitions.showInactiveUsers(editor.getPreferences(), 'view-timeline-grid'), true);
  const template = readFileSync(
    new URL('../res/templates/calendar/mode-buttons.tpl', root),
    'utf8',
  );
  assert.equal(template.includes('data-action="settings"'), false);
  assert.ok(
    editor.recordView.options.detailLayout.some((panel) =>
      panel.rows.some((row) =>
        row.some((cell) => cell && cell.view.options.name === 'showInactiveUsers'),
      ),
    ),
  );
});

test('calendar user picker includes inactive internal users only when enabled without losing team filters', () => {
  class Users {
    getSelectPrimaryFilterName() {
      return 'active';
    }

    getSelectBoolFilterList() {
      return ['onlyMyTeam'];
    }
  }
  const Picker = load('views/calendar/fields/users.js', {
    'crm:views/calendar/fields/users': Users,
  });
  const picker = new Picker();
  let enabled = false;
  picker.model = { get: () => enabled };
  assert.equal(picker.getSelectPrimaryFilterName(), 'active');
  enabled = true;
  assert.equal(picker.getSelectPrimaryFilterName(), 'internal');
  assert.deepEqual(picker.getSelectBoolFilterList(), ['onlyMyTeam']);
});

test('all built-in calendars expose their edit button and the separate Settings action is removed', () => {
  for (const mode of ['month', 'agendaWeek', 'agendaDay', 'timeline']) {
    const { view } = inactiveMenuFixture({}, mode);
    view.mode = mode;
    assert.equal(view.data().calendarEditable, true);
    assert.equal(typeof view.actionSettings, 'undefined');
  }
});

test('new and existing calendars default to dynamic membership and expose the static option', () => {
  for (const item of [null, { id: 'grid', name: 'Existing', source: 'calendar' }]) {
    const { editor } = fixture(item);
    editor.setup();
    assert.equal(editor.model.attributes.membershipMode, 'dynamic');
    const row = editor.recordView.options.detailLayout[0].rows.find(
      (row) => row[0].view.options.name === 'membershipMode',
    );
    assert.deepEqual(Array.from(row[0].view.options.params.options), ['dynamic', 'static']);
  }
});

test('every calendar type captures a deduplicated static list including inactive members when saved', async () => {
  for (const mode of ['agendaDay', 'agendaWeek', 'month', 'timeline']) {
    const { editor, state, espo } = fixture();
    const calls = [];
    espo.Ajax = {
      postRequest: async (url, body) => {
        calls.push({ url, body });

        return { users: [{ id: 'ann' }, { id: 'former' }, { id: 'bob' }, { id: 'bob' }] };
      },
    };
    editor.setup();
    Object.assign(editor.model.attributes, {
      name: 'Static calendar',
      mode,
      teamsIds: ['team'],
      usersIds: ['bob'],
      membershipMode: 'static',
    });
    await editor.actionSave();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'CalendarPlus/Users');
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body)), {
      teamIdList: ['team'],
      userIdList: ['bob'],
      includeInactiveUsers: true,
    });
    const stored = state.calendarViewDataList.find((item) => item.name === 'Static calendar');
    assert.equal(stored.membershipMode, 'static');
    assert.deepEqual(Array.from(stored.staticUserIdList), ['ann', 'former', 'bob']);
    assert.deepEqual(Array.from(stored.teamIdList), ['team']);
    assert.deepEqual(Array.from(stored.userIdList), ['bob']);
    assert.equal(state.closed, true);
  }
});

test('default Timeline can capture static membership and switch back to dynamic without stale snapshot data', async () => {
  const { editor, state, espo } = fixture();
  editor.options.calendar = {
    source: 'shared',
    routeMode: 'timeline',
    teamIdList: ['team'],
    userIdList: [],
  };
  espo.Ajax = { postRequest: async () => ({ users: [{ id: 'ann' }, { id: 'bob' }] }) };
  editor.setup();
  editor.model.attributes.membershipMode = 'static';
  await editor.actionSave();
  assert.equal(state.calendarPlusSharedSelection.membershipMode, 'static');
  assert.deepEqual(Array.from(state.calendarPlusSharedSelection.staticUserIdList), ['ann', 'bob']);
  const shared = definitions.sharedTimeline(editor.getPreferences(), { id: 'me', get: () => 'Me' });
  assert.deepEqual(JSON.parse(JSON.stringify(definitions.membershipSelection(shared))), {
    teamIdList: [],
    userIdList: ['ann', 'bob'],
  });
  editor.model.attributes.membershipMode = 'dynamic';
  espo.Ajax.postRequest = async () => {
    throw new Error('Dynamic saves must not capture members');
  };
  await editor.actionSave();
  assert.equal(state.calendarPlusSharedSelection.membershipMode, 'dynamic');
  assert.equal(state.calendarPlusSharedSelection.staticUserIdList, undefined);
  assert.equal(state.calendarViewDataList.length, 1);
});

test('failed static capture leaves preferences untouched and an empty resolved team remains an empty snapshot', async () => {
  const { editor, state, espo } = fixture();
  editor.setup();
  Object.assign(editor.model.attributes, {
    name: 'Static calendar',
    teamsIds: ['empty-team'],
    membershipMode: 'static',
  });
  const before = JSON.stringify(state.calendarViewDataList);
  espo.Ajax = {
    postRequest: async () => {
      throw new Error('Failed');
    },
  };
  await editor.actionSave();
  assert.equal(JSON.stringify(state.calendarViewDataList), before);
  assert.equal(state.closed, undefined);
  assert.equal(editor.saving, false);
  espo.Ajax.postRequest = async () => ({ users: [] });
  await editor.actionSave();
  const stored = state.calendarViewDataList.find((item) => item.name === 'Static calendar');
  assert.equal(stored.membershipMode, 'static');
  assert.deepEqual(Array.from(stored.staticUserIdList), []);
  assert.deepEqual(JSON.parse(JSON.stringify(definitions.membershipSelection(stored))), {
    teamIdList: [],
    userIdList: [],
  });
});

test('static saves reject unsupported snapshot sizes and ignore repeated Save clicks during capture', async () => {
  const { editor, state, espo } = fixture();
  editor.setup();
  Object.assign(editor.model.attributes, {
    name: 'Static calendar',
    teamsIds: ['team'],
    membershipMode: 'static',
  });
  let resolve;
  let captures = 0;
  espo.Ajax = {
    postRequest: () => {
      captures++;

      return new Promise((done) => {
        resolve = done;
      });
    },
  };
  const pending = editor.actionSave();
  await editor.actionSave();
  assert.equal(captures, 1);
  resolve({ users: Array.from({ length: 501 }, (_, i) => ({ id: `user-${i}` })) });
  await pending;
  assert.equal(state.calendarViewDataList.length, 1);
  assert.equal(state.closed, undefined);
  assert.equal(editor.saving, false);
});

test('saving an existing static calendar explicitly refreshes its captured users while preserving its identity and view settings', async () => {
  const item = {
    id: 'grid',
    name: 'Static calendar',
    source: 'calendar',
    mode: 'agendaWeek',
    teamIdList: ['team'],
    userIdList: [],
    membershipMode: 'static',
    staticUserIdList: ['old-member'],
  };
  const { editor, state, espo } = fixture(item);
  state.calendarViewDataList = [{ ...item }];
  state.calendarPlusViewSettings = { 'view:grid': { showInactiveUsers: true } };
  editor.setup();
  assert.equal(editor.model.attributes.membershipMode, 'static');
  espo.Ajax = { postRequest: async () => ({ users: [{ id: 'current-member' }] }) };
  await editor.actionSave();
  assert.equal(state.calendarViewDataList[0].id, 'grid');
  assert.deepEqual(Array.from(state.calendarViewDataList[0].staticUserIdList), ['current-member']);
  assert.equal(state.calendarPlusViewSettings['view:grid'].showInactiveUsers, true);
});

test('closing the calendar editor during static capture prevents saving a late response', async () => {
  const { editor, state, espo } = fixture();
  editor.setup();
  Object.assign(editor.model.attributes, {
    name: 'Static calendar',
    teamsIds: ['team'],
    membershipMode: 'static',
  });
  let resolve;
  espo.Ajax = {
    postRequest: () =>
      new Promise((done) => {
        resolve = done;
      }),
  };
  const pending = editor.actionSave();
  editor.onRemove();
  resolve({ users: [{ id: 'ann' }] });
  await pending;
  assert.equal(state.calendarViewDataList.length, 1);
  assert.equal(state.saved, undefined);
});

function settingsFixture({
  mode = 'agendaWeek',
  inactive = true,
  config = {},
  stored = {},
  fail = false,
} = {}) {
  class Modal {
    on(name, fn) {
      this.onRemove = fn;
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
  const errors = [];
  const Settings = load(
    'views/calendar/modals/settings.js',
    {
      'views/modal': Modal,
      model: Model,
      'views/record/edit-for-modal': Record,
      'views/fields/bool': Field,
      'views/fields/enum': Field,
      'views/fields/varchar': Field,
      'calendar-plus:calendar-definitions': definitions,
    },
    { Ui: { error: (message) => errors.push(message) } },
  );
  const state = {
    calendarViewDataList: [{ id: 'grid', name: 'Grid' }],
    calendarScrollHour: 0,
    calendarSlotDuration: 10,
    calendarPlusViewSettings: { 'view:grid': stored, other: { showWeekends: false } },
  };
  const saves = [];
  const parent = {
    viewMode: mode,
    scrollHour: 6,
    applyViewSettings(value) {
      this.applied = value;
    },
    actionRefresh() {
      this.refreshes = (this.refreshes || 0) + 1;
    },
  };
  const view = new Settings();
  Object.assign(view, {
    options: { calendar: parent, mode: 'view-grid', inactiveUsersAvailable: inactive },
    getPreferences: () => ({
      get: (key) => state[key],
      set: (key, value) => {
        state[key] = value;
      },
      save: async (data, options) => {
        saves.push({ data, options });
        Object.assign(state, data);

        if (fail) throw new Error();
      },
    }),
    getConfig: () => ({ get: (key) => config[key] }),
    translate: (key) => key,
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

  return { view, state, saves, parent, errors };
}

test('view Settings exposes relevant controls and honors admin feature gates', () => {
  const week = settingsFixture();
  assert.deepEqual(Array.from(week.view.settingNames), [
    'showInactiveUsers',
    'showWeekends',
    'visibleTimeStart',
    'visibleTimeEnd',
    'slotDuration',
    'scrollHour',
    'showGradient',
    'eventTextSize',
    'showDeclinedEvents',
    'showCanceledEvents',
    'showCompletedEvents',
    'rememberHiddenPeople',
    'showTooltips',
    'tooltipAttendees',
    'tooltipAssignee',
    'tooltipLocation',
    'tooltipStatus',
  ]);
  assert.equal(week.view.model.attributes.scrollHour, '0');
  assert.equal(week.view.model.attributes.slotDuration, '10');
  const gated = settingsFixture({
    mode: 'month',
    inactive: false,
    config: { calendarPlusColorGradientEnabled: false, calendarPlusTooltipEnabled: false },
  });
  assert.deepEqual(Array.from(gated.view.settingNames), [
    'showWeekends',
    'eventTextSize',
    'showDeclinedEvents',
    'showCanceledEvents',
    'showCompletedEvents',
  ]);
  const timeline = settingsFixture({ mode: 'timeline' });
  assert.deepEqual(Array.from(timeline.view.settingNames), [
    'showInactiveUsers',
    'showWeekends',
    'visibleTimeStart',
    'visibleTimeEnd',
    'eventTextSize',
    'showDeclinedEvents',
    'showCanceledEvents',
    'showCompletedEvents',
    'dayBoundary',
    'timelineRowHeight',
    'showTooltips',
    'tooltipAttendees',
    'tooltipAssignee',
    'tooltipLocation',
    'tooltipStatus',
  ]);
});

test('view Settings saves one view atomically, preserves hidden values, and applies immediately', async () => {
  const { view, state, saves, parent } = settingsFixture({
    stored: { showTooltips: false, futureOption: 17 },
  });
  assert.equal(saves.length, 0, 'opening and canceling do not write preferences');
  Object.assign(view.model.attributes, {
    showWeekends: false,
    showInactiveUsers: true,
    slotDuration: '5',
    scrollHour: '0',
    showGradient: false,
  });
  await view.actionSave();
  assert.deepEqual(JSON.parse(JSON.stringify(state.calendarPlusViewSettings['view:grid'])), {
    showTooltips: false,
    futureOption: 17,
    showWeekends: false,
    showInactiveUsers: true,
    eventTextSize: 'medium',
    showDeclinedEvents: true,
    showCanceledEvents: true,
    showCompletedEvents: true,
    rememberHiddenPeople: true,
    tooltipAttendees: true,
    tooltipAssignee: true,
    tooltipLocation: true,
    tooltipStatus: true,
    slotDuration: 5,
    scrollHour: 0,
    showGradient: false,
    visibleTimeStart: '00:00',
    visibleTimeEnd: '24:00',
  });
  assert.equal(state.calendarPlusViewSettings.other.showWeekends, false);
  assert.equal(state.calendarScrollHour, 0);
  assert.equal(state.calendarSlotDuration, 10);
  assert.equal(saves[0].options.wait, true);
  assert.equal(saves[0].options.patch, true);
  assert.equal(parent.applied, true);
  assert.equal(parent.refreshes, 1);
  assert.equal(view.closed, true);
});

test('failed view Settings save restores preferences and leaves the dialog open for retry', async () => {
  const { view, state, parent, errors } = settingsFixture({
    fail: true,
    stored: { showTooltips: false },
  });
  const original = state.calendarPlusViewSettings;
  view.model.attributes.showTooltips = true;
  await view.actionSave();
  assert.equal(state.calendarPlusViewSettings, original);
  assert.equal(parent.refreshes, undefined);
  assert.equal(view.closed, undefined);
  assert.equal(view.enabled, true);
  assert.equal(errors.length, 1);
});

test('visible time range accepts clock or compact input, persists per view, and rejects invalid or reversed bounds', async () => {
  const valid = settingsFixture();
  Object.assign(valid.view.model.attributes, { visibleTimeStart: '0800', visibleTimeEnd: '15:00' });
  await valid.view.actionSave();
  assert.equal(valid.state.calendarPlusViewSettings['view:grid'].visibleTimeStart, '08:00');
  assert.equal(valid.state.calendarPlusViewSettings['view:grid'].visibleTimeEnd, '15:00');
  for (const [start, end] of [
    ['15:00', '08:00'],
    ['08:00', '08:00'],
    ['24:00', '24:00'],
    ['08:60', '15:00'],
    ['08:00', '25:00'],
    ['', '15:00'],
  ]) {
    const { view, saves, errors } = settingsFixture();
    Object.assign(view.model.attributes, { visibleTimeStart: start, visibleTimeEnd: end });
    await view.actionSave();
    assert.equal(saves.length, 0);
    assert.equal(errors.length, 1);
    assert.equal(view.closed, undefined);
  }
});

test('all additional view options save without overwriting other view settings', async () => {
  const { view, state } = settingsFixture({ mode: 'timeline' });
  Object.assign(view.model.attributes, {
    eventTextSize: 'large',
    showDeclinedEvents: false,
    dayBoundary: 'black',
    timelineRowHeight: 'compact',
    tooltipAttendees: false,
    tooltipAssignee: false,
    tooltipLocation: false,
    tooltipStatus: false,
  });
  await view.actionSave();
  const saved = state.calendarPlusViewSettings['view:grid'];
  assert.equal(saved.eventTextSize, 'large');
  assert.equal(saved.showDeclinedEvents, false);
  assert.equal(saved.dayBoundary, 'black');
  assert.equal(saved.timelineRowHeight, 'compact');
  assert.equal(saved.tooltipAttendees, false);
  assert.equal(saved.tooltipAssignee, false);
  assert.equal(saved.tooltipLocation, false);
  assert.equal(saved.tooltipStatus, false);
  assert.equal(state.calendarPlusViewSettings.other.showWeekends, false);
});

test('declined-event filter uses the current attendee response, preserves canceled and unreadable events, and bounds requests', async () => {
  const settings = { showDeclinedEvents: false };
  let active = 0,
    peak = 0,
    requests = 0;
  const view = {
    mode: 'month',
    getPreferences: () => ({ get: () => ({ month: settings }) }),
    getUser: () => ({ id: 'me' }),
    eventTooltip: {
      loadDetails: async (event) => {
        requests++;
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;

        if (event.extendedProps.recordId === 'denied') return null;

        return {
          usersColumns: {
            me: { status: event.extendedProps.recordId === 'declined' ? 'Declined' : 'Accepted' },
            other: { status: 'Declined' },
          },
        };
      },
    },
  };
  const events = ['declined', 'canceled', 'denied', 'accepted', 'more1', 'more2'].map(
    (recordId) => ({
      scope: 'Meeting',
      recordId,
      status: recordId === 'canceled' ? 'Not Held' : 'Planned',
    }),
  );
  events.push({ scope: 'Task', recordId: 'task' }, { type: 'background' });
  const filtered = await definitions.filterEvents(view, events);
  assert.deepEqual(
    Array.from(filtered, (event) => event.recordId),
    ['canceled', 'denied', 'accepted', 'more1', 'more2', 'task', undefined],
  );
  assert.equal(requests, 6);
  assert.ok(peak <= 4);
  settings.showDeclinedEvents = true;
  assert.equal(await definitions.filterEvents(view, events), events);
  assert.equal(requests, 12);
});

test('view Settings groups related controls into labeled panels and omits unavailable panels', () => {
  const { view } = settingsFixture();
  const panels = view.recordView.options.detailLayout;
  assert.deepEqual(
    Array.from(panels, (panel) => panel.label),
    ['Display', 'Time Range', 'People and Events', 'Tooltips'],
  );

  const fieldNames = (panel) =>
    Array.from(panel.rows).flatMap((row) =>
      Array.from(row)
        .filter(Boolean)
        .map((cell) => cell.view.options.name),
    );
  assert.deepEqual(fieldNames(panels.find((panel) => panel.name === 'tooltips')), [
    'showTooltips',
    'tooltipAttendees',
    'tooltipAssignee',
    'tooltipLocation',
    'tooltipStatus',
  ]);
  assert.deepEqual(fieldNames(panels.find((panel) => panel.name === 'timeRange')), [
    'visibleTimeStart',
    'visibleTimeEnd',
    'slotDuration',
    'scrollHour',
  ]);
  assert.deepEqual(fieldNames(panels.find((panel) => panel.name === 'people')), [
    'showInactiveUsers',
    'showDeclinedEvents',
    'showCanceledEvents',
    'showCompletedEvents',
    'rememberHiddenPeople',
  ]);

  const restricted = settingsFixture({
    mode: 'month',
    inactive: false,
    config: { calendarPlusTooltipEnabled: false },
  });
  assert.deepEqual(
    Array.from(restricted.view.recordView.options.detailLayout, (panel) => panel.name),
    ['display', 'people'],
  );
});

test('canceled-event visibility uses entity cancellation metadata independently from attendee responses', async () => {
  const settings = { showCanceledEvents: false };
  const view = {
    mode: 'timeline',
    getPreferences: () => ({ get: () => ({ timeline: settings }) }),
    getEventTypeCanceledStatusList: (scope) => (scope === 'Meeting' ? ['Not Held'] : ['Canceled']),
  };
  const events = [
    { scope: 'Meeting', status: 'Not Held', recordId: 'canceled-meeting' },
    { scope: 'Meeting', status: 'Held', recordId: 'completed-meeting' },
    { extendedProps: { scope: 'Task', status: 'Canceled', recordId: 'canceled-task' } },
    { scope: 'Task', status: 'Completed', recordId: 'completed-task' },
    { type: 'background', scope: 'Task', status: 'Canceled' },
  ];
  assert.equal(definitions.shouldFilterEvents(view), true);
  assert.deepEqual(Array.from(await definitions.filterEvents(view, events)), [
    events[1],
    events[3],
    events[4],
  ]);
  settings.showCanceledEvents = true;
  assert.equal(definitions.shouldFilterEvents(view), false);
  assert.equal(await definitions.filterEvents(view, events), events);
  const modal = settingsFixture({ stored: { showCanceledEvents: false } });
  assert.equal(modal.view.model.attributes.showCanceledEvents, false);
  await modal.view.actionSave();
  assert.equal(modal.state.calendarPlusViewSettings['view:grid'].showCanceledEvents, false);
});

test('visible declined invitations get their own class and faded style without marking other attendees responses', async () => {
  const styles = [];
  const view = {
    mode: 'month',
    getPreferences: () => ({ get: () => ({}) }),
    getUser: () => ({ id: 'me' }),
    eventTooltip: {
      loadDetails: async ({ extendedProps }) => ({
        usersColumns: {
          me: { status: extendedProps.recordId === 'declined' ? 'Declined' : 'Accepted' },
          other: { status: 'Declined' },
        },
      }),
    },
    styleDeclinedEvent: (event) => styles.push(event.recordId),
  };
  const events = [
    { scope: 'Meeting', recordId: 'declined', className: ['existing'] },
    { scope: 'Call', recordId: 'accepted', className: 'existing' },
  ];
  assert.equal(definitions.shouldFilterEvents(view, events), true);
  const result = await definitions.filterEvents(view, events);
  assert.equal(result.length, 2);
  assert.equal(events[0].isDeclined, true);
  assert.deepEqual(Array.from(events[0].className), ['existing', 'cp-event-declined']);
  assert.equal(events[1].isDeclined, undefined);
  assert.deepEqual(styles, ['declined']);
});

test('search-revealed events bypass canceled and declined hiding without changing the saved filters', async () => {
  const settings = { showCanceledEvents: false, showDeclinedEvents: false };
  const view = {
    mode: 'month',
    searchResult: { id: 'match', scope: 'Meeting' },
    getPreferences: () => ({ get: () => ({ month: settings }) }),
    getUser: () => ({ id: 'me' }),
    getEventTypeCanceledStatusList: () => ['Not Held'],
    eventTooltip: { loadDetails: async () => ({ usersColumns: { me: { status: 'Declined' } } }) },
  };
  const records = [
    { recordId: 'match', scope: 'Meeting', status: 'Not Held' },
    { recordId: 'other', scope: 'Meeting', status: 'Not Held' },
  ];
  const filtered = await definitions.filterEvents(view, records);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].recordId, 'match');
  assert.equal(settings.showCanceledEvents, false);
  assert.equal(settings.showDeclinedEvents, false);
});

test('calendar membership and settings save together, retaining other calendars and unavailable options', async () => {
  const { editor, state } = fixture({
    id: 'grid',
    source: 'calendar',
    name: 'Team week',
    mode: 'agendaWeek',
    userIdList: ['ann'],
  });
  state.calendarPlusViewSettings = {
    'view:grid': { showTooltips: false, dayBoundary: 'black' },
    month: { showWeekends: false },
  };
  editor.setup();
  Object.assign(editor.model.attributes, {
    showWeekends: false,
    slotDuration: '5',
    visibleTimeStart: '08:00',
    visibleTimeEnd: '15:00',
    showInactiveUsers: true,
  });
  const saves = [];
  const preferences = editor.getPreferences();
  const save = preferences.save;
  preferences.save = async (data, options) => {
    saves.push({ data, options });
    await save(data);
  };
  editor.getPreferences = () => preferences;
  await editor.actionSave();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].options.wait, true);
  assert.ok(saves[0].data.calendarViewDataList);
  const stored = state.calendarPlusViewSettings['view:grid'];
  assert.equal(stored.slotDuration, 5);
  assert.equal(stored.visibleTimeStart, '08:00');
  assert.equal(stored.showWeekends, false);
  assert.equal(stored.showTooltips, false);
  assert.equal(stored.showInactiveUsers, true);
  assert.equal(stored.dayBoundary, 'black');
  assert.equal(state.calendarPlusViewSettings.month.showWeekends, false);
});

test('built-in calendars save settings without requiring membership or creating a saved calendar', async () => {
  for (const mode of ['month', 'agendaWeek', 'agendaDay']) {
    const item = { source: 'personal', mode, routeMode: mode };
    const { editor, state } = fixture(item);
    editor.setup();
    const names = editor.recordView.options.detailLayout.flatMap((panel) =>
      panel.rows.flatMap((row) => row.filter(Boolean).map((cell) => cell.view.options.name)),
    );
    assert.equal(names.includes('users'), false);
    assert.equal(names.includes('showInactiveUsers'), false);
    assert.equal(names.includes('showTooltips'), true);
    assert.equal(editor.dropdownItemList.length, 0);
    const data = { ...editor.model.attributes, showWeekends: false };
    delete data.mode; // Native record fetch only includes fields present in the form.
    editor.recordView.processFetch = () => data;
    await editor.actionSave();
    assert.equal(state.calendarPlusViewSettings[mode].showWeekends, false);
    assert.equal(state.calendarViewDataList.length, 1);
    assert.equal(state.calendarPlusList.length, 1);
    assert.equal(state.saved.routeMode, mode);
  }
});

test('the default Timeline saves membership and view options in one request', async () => {
  const { editor, state } = fixture({
    source: 'shared',
    mode: 'timeline',
    routeMode: 'timeline',
    userIdList: ['ann'],
  });
  editor.setup();
  const data = { ...editor.model.attributes, dayBoundary: 'black', showInactiveUsers: true };
  delete data.mode;
  editor.recordView.processFetch = () => data;
  await editor.actionSave();
  assert.deepEqual(Array.from(state.calendarPlusSharedSelection.userIdList), ['ann']);
  assert.equal(state.calendarPlusViewSettings.timeline.dayBoundary, 'black');
  assert.equal(state.calendarPlusViewSettings.timeline.showInactiveUsers, true);
  assert.equal(state.calendarViewDataList.length, 1);
});

test('failed combined saves restore membership and view settings and keep the editor open', async () => {
  for (const item of [
    { source: 'calendar', id: 'grid', name: 'Week', mode: 'agendaWeek', userIdList: ['ann'] },
    { source: 'shared', mode: 'timeline', routeMode: 'timeline', userIdList: ['ann'] },
    { source: 'personal', mode: 'month', routeMode: 'month' },
  ]) {
    const { editor, state } = fixture(item);
    state.calendarPlusViewSettings = { month: { showWeekends: true } };
    const before = structuredClone(state);
    state.fail = true;
    editor.setup();
    editor.model.attributes.showWeekends = false;
    await editor.actionSave();
    assert.deepEqual(state.calendarPlusViewSettings, before.calendarPlusViewSettings);
    assert.deepEqual(state.calendarViewDataList, before.calendarViewDataList);
    assert.equal(state.calendarPlusSharedSelection, undefined);
    assert.equal(state.closed, undefined);
  }
});

test('changing calendar type updates relevant settings through native dynamic visibility', () => {
  const { editor } = fixture();
  editor.setup();
  const exported = {};
  vm.runInNewContext(
    readFileSync(
      new URL('../../site/client/lib/transpiled/src/dynamic-logic.js', import.meta.url),
      'utf8',
    ),
    {
      define: (name, deps, factory) => factory(exported, { inject: () => () => {} }, class {}),
    },
  );
  const visibility = {};
  const attributes = editor.model.attributes;
  const logic = new exported.default(editor.recordView.options.dynamicLogicDefs, {
    model: { has: (name) => name in attributes, get: (name) => attributes[name] },
    showField: (name) => {
      visibility[name] = true;
    },
    hideField: (name) => {
      visibility[name] = false;
    },
    showPanel() {},
    hidePanel() {},
  });
  for (const mode of ['agendaWeek', 'timeline', 'month', 'agendaDay']) {
    attributes.mode = mode;
    logic.process();
    assert.equal(visibility.dayBoundary, mode === 'timeline');
    assert.equal(visibility.slotDuration, ['agendaWeek', 'agendaDay'].includes(mode));
    assert.equal(visibility.showGradient, ['agendaWeek', 'month'].includes(mode));
    assert.equal(visibility.visibleTimeStart, mode !== 'month');
    for (const enabled of [false, true, false]) {
      attributes.showTooltips = enabled;
      logic.process();
      assert.equal(visibility.showTooltips, true);
      for (const name of [
        'tooltipAttendees',
        'tooltipAssignee',
        'tooltipLocation',
        'tooltipStatus',
      ]) {
        assert.equal(visibility[name], enabled);
      }
    }
  }
});

test('built-in edit actions open the relevant form, including users restricted to their own calendar', async () => {
  class Page {}
  class Editor {
    constructor(options) {
      this.options = options;
    }
    async render() {}
  }
  const CalendarPage = load('views/calendar/calendar-page.js', {
    'crm:views/calendar/calendar-page': Page,
    'calendar-plus:views/calendar/modals/calendar': Editor,
    'calendar-plus:calendar-definitions': definitions,
  });
  for (const mode of ['month', 'agendaWeek', 'agendaDay', 'timeline-personal']) {
    const page = new CalendarPage();
    page.mode = mode;
    page.options = {};
    page.getPreferences = () => ({ get() {} });
    page.getAcl = () => ({ getPermissionLevel: () => 'no' });
    const calendar = { mode };
    page.getCalendarView = () => calendar;
    page.assignView = async (name, view) => {
      page.editor = view;
    };
    await page.editCustomView();
    assert.equal(page.editor.options.calendar.source, 'personal');
    assert.equal(page.editor.options.calendar.routeMode, mode);
    assert.equal(
      page.editor.options.calendar.mode,
      mode === 'timeline-personal' ? 'timeline' : mode,
    );
    assert.equal(page.editor.options.calendarView, calendar);
  }
});

test('saving with hidden tooltip details retains their values when fields are omitted from fetch', async () => {
  const { editor, state } = fixture({ source: 'personal', mode: 'month', routeMode: 'month' });
  state.calendarPlusViewSettings = {
    month: {
      tooltipAttendees: false,
      tooltipAssignee: true,
      tooltipLocation: false,
      tooltipStatus: true,
    },
  };
  editor.setup();
  const data = { ...editor.model.attributes, showTooltips: false };
  for (const name of ['tooltipAttendees', 'tooltipAssignee', 'tooltipLocation', 'tooltipStatus'])
    delete data[name];
  editor.recordView.processFetch = () => data;
  await editor.actionSave();
  const saved = state.calendarPlusViewSettings.month;
  assert.equal(saved.showTooltips, false);
  assert.equal(saved.tooltipAttendees, false);
  assert.equal(saved.tooltipAssignee, true);
  assert.equal(saved.tooltipLocation, false);
  assert.equal(saved.tooltipStatus, true);
});

test('completed-event visibility uses each entity metadata independently from canceled statuses', async () => {
  const settings = { showCompletedEvents: false };
  const view = {
    mode: 'timeline',
    getPreferences: () => ({ get: () => ({ timeline: settings }) }),
    getEventTypeCompletedStatusList: (scope) =>
      ({ Task: ['Completed'], Meeting: ['Held'], CustomEvent: ['Done', 'Closed'] })[scope] || [],
    getEventTypeCanceledStatusList: () => ['Canceled'],
  };
  const events = [
    { scope: 'Task', status: 'Completed' },
    { extendedProps: { scope: 'Meeting', status: 'Held' } },
    { scope: 'CustomEvent', status: 'Done' },
    { scope: 'CustomEvent', status: 'Closed' },
    { scope: 'Task', status: 'Canceled' },
    { scope: 'Task', status: 'In Progress' },
    { scope: 'UnknownEvent', status: 'Completed' },
    { type: 'background', scope: 'Task', status: 'Completed' },
  ];
  assert.equal(definitions.shouldFilterEvents(view), true);
  assert.deepEqual(Array.from(await definitions.filterEvents(view, events)), events.slice(4));
  settings.showCanceledEvents = false;
  assert.deepEqual(Array.from(await definitions.filterEvents(view, events)), events.slice(5));
  view.searchResult = { scope: 'CustomEvent', id: 'target' };
  const result = { scope: 'CustomEvent', status: 'Done', recordId: 'target' };
  assert.deepEqual(Array.from(await definitions.filterEvents(view, [result])), [result]);
  settings.showCompletedEvents = true;
  settings.showCanceledEvents = true;
  assert.equal(definitions.shouldFilterEvents(view), false);
  assert.equal(await definitions.filterEvents(view, events), events);
});

test('Show completed events defaults on and saves independently for each calendar', async () => {
  const { editor, state } = fixture({ source: 'personal', mode: 'month', routeMode: 'month' });
  editor.setup();
  assert.equal(editor.model.attributes.showCompletedEvents, true);
  editor.model.attributes.showCompletedEvents = false;
  await editor.actionSave();
  assert.equal(state.calendarPlusViewSettings.month.showCompletedEvents, false);
  const stored = settingsFixture({ stored: { showCompletedEvents: false } });
  assert.equal(stored.view.model.attributes.showCompletedEvents, false);
});
