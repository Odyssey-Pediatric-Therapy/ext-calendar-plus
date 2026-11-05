import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const root = new URL('../../src/files/client/custom/modules/more-timelines/src/views/calendar/', import.meta.url);
function load(file, dependencies, espo) {
  let result;
  vm.runInNewContext(readFileSync(new URL(file, root), 'utf8'), {
    define: (name, names, factory) => { result = factory(...names.map(name => dependencies[name])); },
    Espo: espo, document: {},
  });
  return result;
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
class BaseTimeline {
  constructor() { this.options = {}; this.baseFetches = 0; }
  setup() { this.calendarType = this.storedType || 'shared'; this.isCustomViewAvailable = this.allowed; }
  getCalendarTypeDataList() { return this.allowed ? [{type: 'single'}, {type: 'shared'}] : [{type: 'single'}]; }
  getCalendarTypeLabel(type) { return type; }
  data() { return {calendarTypeSelectEnabled: this.getCalendarTypeDataList().length > 1}; }
  initUserList() { this.userList = [{id: 'me'}]; }
  actionShowSharedCalendarOptions() { this.sharedOptionsOpened = true; }
  initGroupsDataSet() { this.groupsDataSet = this.userList; }
  fillColor(event) { event.style = 'background-color:#70c173;'; }
  fetchEvents(from, to, callback) { this.baseFetches++; callback(['event']); }
  addHandler() {}
  on() {}
}
function fixture(list = []) {
  const espo = {Ajax: {postRequest: async () => ({users: []})}, Ui: {notify() {}}, Utils: {clone: structuredClone, cloneDeep: structuredClone}};
  const definitions = load('../../calendar-definitions.js', {}, espo);
  const colors = load('../../calendar-colors.js', {}, espo);
  const Timeline = load('timeline.js', {'crm:views/calendar/timeline': BaseTimeline, 'more-timelines:calendar-definitions': definitions, 'more-timelines:calendar-colors': colors}, espo);
  const view = new Timeline();
  view.allowed = true;
  const storage = {};
  view.getStorage = () => ({get: (category, key) => storage[key], set: (category, key, value) => { storage[key] = value; }});
  const preferences = {moreTimelinesList: list};
  view.getPreferences = () => ({get: key => preferences[key]});
  view.getUser = () => ({id: 'me', get: () => 'Me'});
  view.getParentView = () => ({openCalendarEditor: item => { view.editedCalendar = item; }});
  view.getAcl = () => ({getPermissionLevel: () => view.allowed ? 'all' : 'no'});
  view.removed = false;
  view.leftMargin = 1; view.rightMargin = 1;
  return {view, espo, preferences};
}
const date = {clone() { return this; }, subtract() { return this; }, add() { return this; }};

test('saved timelines extend the selector and retain named selection after setup', () => {
  const {view} = fixture([{id: 'a', name: 'Clinical Team'}, {id: 'b', name: 'Scheduling'}]);
  view.storedType = 'saved-a';
  view.setup();
  assert.equal(view.calendarType, 'saved-a');
  assert.deepEqual(plain(view.calendarTypeList), ['single', 'shared', 'saved-a', 'saved-b']);
  assert.equal(view.getCalendarTypeDataList()[2].label, 'Clinical Team');
  assert.equal(view.getCalendarTypeLabel('saved-b'), 'Scheduling');
  view.initUserList();
  assert.deepEqual(plain(view.userList), []);
});

test('personal-only permissions exclude saved timelines even with a previously saved selection', () => {
  const {view} = fixture([{id: 'a', name: 'Clinical Team'}]);
  view.allowed = false;
  view.storedType = 'saved-a';
  view.setup();
  assert.equal(view.calendarType, 'single');
  assert.equal(view.getCalendarTypeDataList().length, 1);
});

test('team and individual IDs resolve before events are fetched', async () => {
  const {view, espo} = fixture([{id: 'a', name: 'A', teamIdList: ['team'], userIdList: ['person']}]);
  view.calendarType = 'saved-a';
  espo.Ajax.postRequest = async (url, body) => {
    assert.equal(url, 'MoreTimelines/Users');
    assert.deepEqual(plain(body), {teamIdList: ['team'], userIdList: ['person']});
    return {users: [{id: 'person', name: 'Person'}]};
  };
  let result;
  await view.fetchEvents(date, date, events => { result = events; });
  assert.deepEqual(plain(view.userList), [{id: 'person', name: 'Person'}]);
  assert.deepEqual(result, ['event']);
  assert.equal(view.baseFetches, 1);
});

test('empty team does not fall back to current user or unfiltered event request', async () => {
  const {view} = fixture([{id: 'a', name: 'Empty'}]);
  view.calendarType = 'saved-a';
  let result;
  await view.fetchEvents(date, date, events => { result = events; });
  assert.deepEqual(plain(result), []);
  assert.equal(view.baseFetches, 0);
});

test('a stale team resolution cannot replace a newly selected timeline', async () => {
  const {view, espo} = fixture([{id: 'a', name: 'A'}, {id: 'b', name: 'B'}]);
  const resolvers = [];
  espo.Ajax.postRequest = () => new Promise(resolve => resolvers.push(resolve));
  view.calendarType = 'saved-a';
  let oldCalled = false;
  const first = view.fetchEvents(date, date, () => { oldCalled = true; });
  view.calendarType = 'saved-b';
  const second = view.fetchEvents(date, date, () => {});
  resolvers[1]({users: [{id: 'b'}]});
  await second;
  resolvers[0]({users: [{id: 'a'}]});
  await first;
  assert.equal(oldCalled, false);
  assert.deepEqual(plain(view.userList), [{id: 'b'}]);
});

function modalFixture() {
  class Modal {}
  const espo = {Utils: {clone: structuredClone, cloneDeep: structuredClone}};
  const definitions = load('../../calendar-definitions.js', {}, espo);
  const CalendarModal = load('modals/calendar.js', {'views/modal': Modal, 'more-timelines:calendar-definitions': definitions}, espo);
  const TimelineModal = load('modals/timeline.js', {'more-timelines:views/calendar/modals/calendar': CalendarModal}, espo);
  const modal = new TimelineModal();
  const state = {list: [{id: 'a', name: 'Original'}], fail: false};
  modal.options = {calendar: {...state.list[0], source: 'timeline', mode: 'timeline'}, onSave: item => { state.saved = item; }};
  modal.getPreferences = () => ({
    get: key => key === 'moreTimelinesList' ? state.list : [],
    set: (key, value) => { state.list = value; },
    save: async data => { state.list = data.moreTimelinesList; if (state.fail) throw new Error('Failed'); },
  });
  modal.disableButton = () => {};
  modal.enableButton = () => {};
  modal.close = () => { state.closed = true; };
  return {modal, state};
}

test('renaming changes only the selected saved timeline', async () => {
  const {modal, state} = modalFixture();
  state.list.push({id: 'b', name: 'Other'});
  await modal.persist({id: 'a', name: 'Renamed', mode: 'timeline', userIdList: ['person']});
  assert.equal(state.list.length, 2);
  assert.equal(state.list.find(item => item.id === 'b').name, 'Other');
  assert.equal(state.list.find(item => item.id === 'a').name, 'Renamed');
  assert.equal(state.list[0].id, 'a');
  assert.equal(state.closed, true);
});

test('failed preference save restores previous data and keeps editor open', async () => {
  const {modal, state} = modalFixture();
  state.fail = true;
  await modal.persist({id: 'a', name: 'Unsaved', mode: 'timeline'});
  assert.deepEqual(plain(state.list), [{id: 'a', name: 'Original'}]);
  assert.equal(state.closed, undefined);
  assert.equal(state.saved, undefined);
});

test('removing a named timeline preserves other timelines', async () => {
  const {modal, state} = modalFixture();
  state.list.push({id: 'b', name: 'Other'});
  await modal.persist(null);
  assert.deepEqual(plain(state.list), [{id: 'b', name: 'Other'}]);
  assert.equal(state.saved, null);
});


test('built-in Shared selection and its options remain available alongside saved timelines', () => {
  const {view} = fixture([{id: 'a', name: 'A'}]);
  view.storedType = 'shared';
  view.setup();
  assert.equal(view.calendarType, 'shared');
  assert.deepEqual(plain(view.getCalendarTypeDataList()).map(item => item.type), ['single', 'shared', 'saved-a']);
  assert.equal(view.data().calendarTypeSelectEnabled, true);
  assert.equal(view.data().timelineEditable, true);
  view.actionShowSharedCalendarOptions();
  assert.equal(view.editedCalendar.source, 'shared');
  assert.deepEqual(plain(view.editedCalendar.userIdList), ['me']);
});

test('default Timeline preserves legacy user selections without writing or changing saved calendars', async () => {
  const {view, espo, preferences} = fixture([{id: 'saved', name: 'Saved calendar'}]);
  const legacy = [{id: 'bob', name: 'Bob'}, {id: 'ann', name: 'Ann'}];
  preferences.sharedCalendarUserList = legacy;
  view.setup();
  view.initUserList();
  assert.deepEqual(plain(view.userList), []);
  espo.Ajax.postRequest = async (url, body) => {
    assert.deepEqual(plain(body), {teamIdList: [], userIdList: ['bob', 'ann']});
    return {users: legacy};
  };
  await view.fetchEvents(date, date, () => {});
  assert.deepEqual(plain(view.userList), legacy);
  assert.equal(preferences.moreTimelinesSharedSelection, undefined);
  assert.equal(preferences.moreTimelinesList.length, 1);
});

test('default Timeline resolves teams and people on every refresh, including empty teams', async () => {
  const {view, espo, preferences} = fixture();
  preferences.moreTimelinesSharedSelection = {teamIdList: ['team'], userIdList: ['ann']};
  view.setup();
  let count = 0;
  espo.Ajax.postRequest = async (url, body) => {
    assert.deepEqual(plain(body), {teamIdList: ['team'], userIdList: ['ann']});
    count++;
    return {users: count === 1 ? [{id: 'ann', name: 'Ann'}] : []};
  };
  await view.fetchEvents(date, date, () => {});
  let second;
  await view.fetchEvents(date, date, events => { second = events; });
  assert.equal(count, 2);
  assert.equal(view.baseFetches, 1);
  assert.deepEqual(plain(second), []);
  assert.deepEqual(plain(view.userList), []);
});

test('timeline labels use the same person color registry and configured entity gradient', () => {
  const {view} = fixture();
  view.userList = [{id: 'ann', name: 'Ann'}];
  view.colors = {Task: '#70c173'};
  const event = {scope: 'Task', group: 'ann', type: 'box'};
  view.fillColor(event);
  const person = view.getStorage().get('moreTimelines', 'userColors').ann;
  assert.equal(event.style.includes(`${person} 0%`), true);
  assert.equal(event.style.includes('#70c173 100%'), true);
  const background = {scope: 'Task', group: 'ann', type: 'background'};
  view.fillColor(background);
  assert.equal(background.style.includes('linear-gradient'), false);
});
