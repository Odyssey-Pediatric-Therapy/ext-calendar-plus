import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const root = new URL('../../src/files/client/custom/modules/calendar-plus/src/', import.meta.url);
function load(file, dependencies = {}, espo = {}) {
  let exported;
  vm.runInNewContext(readFileSync(new URL(file, root), 'utf8'), {
    define: (name, names, factory) => { exported = factory(...names.map(name => dependencies[name])); }, Espo: espo,
  });
  return exported;
}
const definitions = load('calendar-definitions.js');
function fixture(item = null) {
  class Modal { constructor(options) { this.options = options; this.dropdownItemList = []; } }
  class Model { constructor(data) { this.attributes = data; } }
  class Field { constructor(options) { this.options = options; } }
  class Record {
    constructor(options) { this.options = options; }
    processFetch() { return this.options.model.attributes; }
    validate() { return false; }
  }
  const espo = {Utils: {clone: structuredClone, cloneDeep: structuredClone}, Ui: {error() {}}};
  const Editor = load('views/calendar/modals/calendar.js', {
    'views/modal': Modal, model: Model, 'views/record/edit-for-modal': Record,
    'views/fields/varchar': Field, 'views/fields/enum': Field,
    'crm:views/calendar/fields/users': Field, 'crm:views/calendar/fields/teams': Field,
    'calendar-plus:calendar-definitions': definitions,
  }, espo);
  const state = {calendarViewDataList: [{id: 'grid', name: 'Team week', mode: 'basicWeek', teamIdList: ['team']}],
    calendarPlusList: [{id: 'legacy', name: 'Old timeline', userIdList: ['ann'], teamIdList: ['team']}], fail: false};
  const editor = new Editor({calendar: item, onSave: saved => { state.saved = saved; }});
  editor.translate = value => value;
  editor.assignView = () => {};
  editor.disableButton = () => {};
  editor.enableButton = () => {};
  editor.close = () => { state.closed = true; };
  editor.getPreferences = () => ({get: key => state[key], set: (key, value) => { state[key] = value; },
    save: async data => { Object.assign(state, data); if (state.fail) throw new Error('Save failed'); }});
  return {editor, state};
}

test('one editor exposes Day, Week, Month, and Timeline with both team and people selection', () => {
  const {editor} = fixture();
  editor.setup();
  const rows = editor.recordView.options.detailLayout[0].rows;
  assert.deepEqual(Array.from(rows[0][1].view.options.params.options), ['agendaDay', 'agendaWeek', 'month', 'timeline']);
  assert.equal(rows[1][0].view.options.name, 'teams');
  assert.equal(rows[2][0].view.options.name, 'users');
  assert.equal(editor.headerText, 'Create Calendar');
});

test('creating every calendar type saves people and teams in the unified list', async () => {
  for (const mode of ['agendaDay', 'agendaWeek', 'month', 'timeline']) {
    const {editor, state} = fixture();
    editor.setup();
    Object.assign(editor.model.attributes, {name: 'New calendar', mode, usersIds: ['bob'], teamsIds: ['team']});
    await editor.actionSave();
    const saved = state.calendarViewDataList.find(item => item.name === 'New calendar');
    assert.equal(saved.mode, mode);
    assert.deepEqual(Array.from(saved.userIdList), ['bob']);
    assert.deepEqual(Array.from(saved.teamIdList), ['team']);
    assert.equal(state.saved.routeMode, `view-${saved.id}`);
    assert.equal(state.calendarPlusList.length, 1);
  }
});

test('legacy timelines stay available and changing type preserves their ID and memberships', async () => {
  const original = {id: 'legacy', name: 'Old timeline', mode: 'timeline', source: 'timeline', userIdList: ['ann'], teamIdList: ['team']};
  const {editor, state} = fixture(original);
  editor.setup();
  editor.model.attributes.mode = 'agendaDay';
  await editor.actionSave();
  assert.equal(state.calendarPlusList.length, 0);
  const saved = state.calendarViewDataList.find(item => item.id === 'legacy');
  assert.deepEqual(Array.from(saved.userIdList), ['ann']);
  assert.deepEqual(Array.from(saved.teamIdList), ['team']);
  assert.equal(state.saved.routeMode, 'view-legacy');
});

test('editing an existing calendar preserves order; a failed conversion restores both lists', async () => {
  const {editor, state} = fixture({id: 'grid', source: 'calendar'});
  await editor.persist({id: 'grid', name: 'Renamed', mode: 'timeline', userIdList: ['ann']});
  assert.equal(state.calendarViewDataList[0].name, 'Renamed');
  const failure = fixture({id: 'legacy', source: 'timeline'});
  failure.state.fail = true;
  await failure.editor.persist({id: 'legacy', name: 'Converted', mode: 'month', userIdList: ['ann']});
  assert.equal(failure.state.calendarPlusList.length, 1);
  assert.equal(failure.state.calendarViewDataList.length, 1);
  assert.equal(failure.state.closed, undefined);
});

test('the right selector keeps the shared Timeline and saved calendars without a personal timeline entry', () => {
  const {state} = fixture();
  class ModeButtons {
    getModeDataList() { return [{mode: 'month'}, {mode: 'agendaWeek'}, {mode: 'timeline', label: 'Timeline'}, {mode: 'view-grid'}]; }
    data() { return {}; }
  }
  const Buttons = load('views/calendar/mode-buttons.js', {
    'crm:views/calendar/mode-buttons': ModeButtons, 'calendar-plus:calendar-definitions': definitions,
  });
  const buttons = new Buttons();
  buttons.isCustomViewAvailable = true;
  buttons.translate = value => value;
  buttons.getPreferences = () => ({get: key => state[key]});
  const modes = buttons.getModeDataList().map(item => item.mode);
  assert.deepEqual(Array.from(modes), ['month', 'agendaWeek', 'agendaDay', 'timeline', 'view-grid', 'view-timeline-legacy']);
  assert.equal(buttons.getModeDataList().find(item => item.mode === 'timeline').label, 'Timeline');
  buttons.mode = 'view-timeline-legacy';
  buttons.getCalendarParentView = () => ({});
  assert.equal(buttons.data().calendarEditable, true);
  assert.equal(buttons.data().selectedModeLabel, 'Old timeline');
  assert.deepEqual(Array.from(buttons.data().allModeDataList.slice(0, 4), item => item.mode),
    ['month', 'agendaWeek', 'agendaDay', 'timeline']);
  buttons.isCustomViewAvailable = false;
  assert.equal(buttons.getModeDataList().some(item => item.mode.startsWith('view-')), false);
});

test('saved timeline routes mount the timeline renderer and saving reopens even an unchanged route', async () => {
  const {state} = fixture();
  class Page { setup() {} setupCalendar() { this.usedGrid = true; } }
  class Editor { constructor(options) { this.options = options; } async render() {} }
  const CalendarPage = load('views/calendar/calendar-page.js', {
    'crm:views/calendar/calendar-page': Page, 'calendar-plus:views/calendar/modals/calendar': Editor,
    'calendar-plus:calendar-definitions': definitions,
  });
  const page = new CalendarPage();
  page.options = {mode: 'view-timeline-legacy'};
  page.getPreferences = () => ({get: key => state[key]});
  page.getAcl = () => ({getPermissionLevel: () => 'all'});
  page.getStorage = () => ({get: () => null, set() {}});
  page.createView = (name, view, options) => { page.mounted = {view, options}; };
  page.setup();
  page.setupCalendar();
  assert.equal(page.mounted.view, 'calendar-plus:views/calendar/timeline');
  assert.equal(page.mounted.options.calendarType, 'saved-legacy');
  assert.equal(page.mounted.options.mode, 'view-timeline-legacy');
  page.assignView = async (name, view) => { page.editor = view; };
  page.updateUrl = () => {};
  page.getRouter = () => ({dispatch: (controller, action, options) => { page.reopened = options; }});
  await page.editCustomView();
  assert.equal(page.editor.options.calendar.id, 'legacy');
  page.editor.options.onSave({routeMode: 'view-timeline-legacy'});
  assert.equal(page.reopened.mode, 'view-timeline-legacy');
});

test('the built-in Timeline always opens shared even if an old named selection is stored', () => {
  class Page {}
  const CalendarPage = load('views/calendar/calendar-page.js', {
    'crm:views/calendar/calendar-page': Page, 'calendar-plus:calendar-definitions': definitions,
  });
  const page = new CalendarPage();
  page.options = {};
  page.getStorage = () => ({get: () => 'saved-legacy'});
  page.createView = (name, view, options) => { page.mounted = options; };
  page.setupTimeline();
  assert.equal(page.mounted.calendarType, 'shared');
  assert.equal(page.mounted.mode, 'timeline');
  assert.equal(page.mounted.calendarItem, null);
});

test('default Timeline editor preserves old users and exposes only Teams and Users', () => {
  const {editor, state} = fixture();
  state.sharedCalendarUserList = [{id: 'bob', name: 'Bob'}];
  editor.options.calendar = definitions.sharedTimeline(editor.getPreferences(), {id: 'me', get: () => 'Me'});
  editor.setup();
  assert.deepEqual(Array.from(editor.model.attributes.usersIds), ['bob']);
  const rows = editor.recordView.options.detailLayout[0].rows;
  assert.deepEqual(Array.from(rows, row => row[0].view.options.name), ['teams', 'users']);
  assert.equal(editor.dropdownItemList.length, 0);
  assert.equal(editor.headerText, 'Edit Timeline');
});

test('default Timeline saves teams and people without creating a named calendar or changing legacy users', async () => {
  const {editor, state} = fixture();
  state.sharedCalendarUserList = [{id: 'bob', name: 'Bob'}];
  editor.options.calendar = definitions.sharedTimeline(editor.getPreferences(), {id: 'me', get: () => 'Me'});
  editor.setup();
  Object.assign(editor.model.attributes, {teamsIds: ['team'], teamsNames: {team: 'Team'}});
  await editor.actionSave();
  assert.deepEqual(Array.from(state.calendarPlusSharedSelection.teamIdList), ['team']);
  assert.deepEqual(Array.from(state.calendarPlusSharedSelection.userIdList), ['bob']);
  assert.equal(state.calendarViewDataList.length, 1);
  assert.equal(state.calendarPlusList.length, 1);
  assert.deepEqual(state.sharedCalendarUserList, [{id: 'bob', name: 'Bob'}]);
  assert.equal(state.saved.routeMode, 'timeline');
});

test('failed default Timeline save restores its selection and leaves the editor open', async () => {
  const {editor, state} = fixture();
  state.calendarPlusSharedSelection = {teamIdList: ['old'], userIdList: ['bob']};
  editor.options.calendar = definitions.sharedTimeline(editor.getPreferences(), {id: 'me', get: () => 'Me'});
  editor.setup();
  editor.model.attributes.teamsIds = ['new'];
  state.fail = true;
  await editor.actionSave();
  assert.deepEqual(Array.from(state.calendarPlusSharedSelection.teamIdList), ['old']);
  assert.equal(state.closed, undefined);
});

test('editing default membership is isolated until Save', () => {
  const {editor, state} = fixture();
  state.calendarPlusSharedSelection = {teamIdList: ['old'], userIdList: ['bob']};
  editor.options.calendar = definitions.sharedTimeline(editor.getPreferences(), {id: 'me', get: () => 'Me'});
  editor.setup();
  editor.model.attributes.teamsIds.push('new');
  assert.deepEqual(state.calendarPlusSharedSelection.teamIdList, ['old']);
});

test('Calendar Plus settings default on without overwriting saved false values', () => {
  class Settings { setup() { this.parentInitialized = true; } }
  const View = load('views/admin/settings.js', {'views/settings/record/edit': Settings});
  const view = new View();
  const values = {calendarPlusColorGradientEnabled: false};
  view.model = {get: name => values[name], set: (name, value) => { values[name] = value; }};
  view.setup();
  assert.equal(values.calendarPlusTooltipEnabled, true);
  assert.equal(values.calendarPlusTimelineEventGap, 0);
  assert.equal(values.calendarPlusTooltipDelay, 1);
  assert.equal(values.calendarPlusColorGradientEnabled, false);
  assert.equal(view.layoutName, 'calendarPlusSettings');
  assert.equal(view.parentInitialized, true);
});

test('Admin uses the shared Extension Settings section with a Calendar Plus row with enabled feature defaults and a configurable Timeline gap', () => {
  const resources = new URL('../../src/files/custom/Espo/Modules/CalendarPlus/Resources/', import.meta.url);
  const panel = JSON.parse(readFileSync(new URL('metadata/app/adminPanel.json', resources))).extensionSettings;
  const item = panel.itemList.find(item => typeof item === 'object');
  assert.equal(panel.label, 'Extension Settings');
  assert.equal(item.label, 'Calendar Plus');
  assert.equal(item.url, '#Admin/calendarPlusSettings');
  const fields = JSON.parse(readFileSync(new URL('metadata/entityDefs/Settings.json', resources))).fields;
  assert.equal(fields.calendarPlusTooltipEnabled.default, true);
  assert.equal(fields.calendarPlusColorGradientEnabled.default, true);
  assert.equal(fields.calendarPlusTooltipDelay.default, 1);
  assert.equal(fields.calendarPlusTooltipDelay.min, 0);
  assert.equal(fields.calendarPlusTimelineEventGap.default, 0);
  assert.equal(fields.calendarPlusTimelineEventGap.min, 0);
  assert.equal(fields.calendarPlusTimelineEventGap.max, 100);
  assert.equal(fields.calendarPlusTooltipEnabled.onlyAdmin, undefined, 'runtime flags must be readable by regular calendar users');
});


test('Calendar Plus settings preserve an existing Timeline gap', () => {
  const View = load('views/admin/settings.js', {'views/settings/record/edit': class { setup() {} }});
  const view = new View();
  const values = {calendarPlusTimelineEventGap: 10};
  view.model = {get: name => values[name], set: (name, value) => { values[name] = value; }};
  view.setup();
  assert.equal(values.calendarPlusTimelineEventGap, 10);
});


test('Calendar Plus settings preserve saved zero and fractional tooltip delays', () => {
  const View = load('views/admin/settings.js', {'views/settings/record/edit': class { setup() {} }});
  for (const delay of [0, 0.5, 2]) {
    const view = new View();
    const values = {calendarPlusTooltipDelay: delay};
    view.model = {get: name => values[name], set: (name, value) => { values[name] = value; }};
    view.setup();
    assert.equal(values.calendarPlusTooltipDelay, delay);
  }
});


test('tooltip delay is beside the enable checkbox and hides without losing its value', () => {
  const View = load('views/admin/settings.js', {'views/settings/record/edit': class { setup() {} }});
  const exported = {};
  vm.runInNewContext(readFileSync(new URL('../../site/client/lib/transpiled/src/dynamic-logic.js', import.meta.url), 'utf8'), {
    define: (name, deps, factory) => factory(exported, {inject: () => () => {}}, class {}),
  });
  const settings = new View();
  const values = {calendarPlusTooltipEnabled: false, calendarPlusTooltipDelay: 2.5};
  const states = [];
  const model = {has: name => name in values, get: name => values[name]};
  const logic = new exported.default(settings.dynamicLogicDefs, {
    model,
    hideField: name => states.push([name, false]),
    showField: name => states.push([name, true]),
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
  const layout = JSON.parse(readFileSync(new URL('../../src/files/custom/Espo/Modules/CalendarPlus/Resources/layouts/Settings/calendarPlusSettings.json', import.meta.url)));
  assert.deepEqual(layout[0].rows[0].map(cell => cell.name), ['calendarPlusTooltipEnabled', 'calendarPlusTooltipDelay']);
});
