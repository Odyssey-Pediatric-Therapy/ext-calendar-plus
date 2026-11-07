import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const root = new URL('../../src/files/client/custom/modules/calendar-plus/src/views/calendar/', import.meta.url);
function load(file, dependencies, espo, globals = {}) {
  let result;
  vm.runInNewContext(readFileSync(new URL(file, root), 'utf8'), {
    define: (name, names, factory) => { result = factory(...names.map(name => dependencies[name])); },
    Espo: espo, document: {}, setTimeout, clearTimeout, ...globals,
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
  convertEvent(record) { return {...record}; }
  fetchEvents(from, to, callback) { this.baseFetches++; callback(['event']); }
  addHandler() {}
  on() {}
}
function fixture(list = []) {
  const espo = {Ajax: {postRequest: async () => ({users: []})}, Ui: {notify() {}}, Utils: {clone: structuredClone, cloneDeep: structuredClone}};
  const definitions = load('../../calendar-definitions.js', {}, espo);
  const EventTooltip = load('event-tooltip.js', {}, espo);
  const Timeline = load('timeline.js', {'crm:views/calendar/timeline': BaseTimeline, 'calendar-plus:calendar-definitions': definitions, 'calendar-plus:views/calendar/event-tooltip': EventTooltip}, espo);
  const view = new Timeline();
  view.eventTooltip = new EventTooltip(view);
  view.eventAppearances = new Map();
  view.tooltipEvents = new Map();
  view.allowed = true;
  const config = {};
  view.allDayScopeList = ['Task', 'Meeting'];
  view.getConfig = () => ({get: name => config[name]});
  const storage = {};
  view.getStorage = () => ({get: (category, key) => storage[key], set: (category, key, value) => { storage[key] = value; }});
  const preferences = {calendarPlusList: list};
  view.getPreferences = () => ({get: key => preferences[key]});
  view.getUser = () => ({id: 'me', get: () => 'Me'});
  view.getParentView = () => ({openCalendarEditor: item => { view.editedCalendar = item; }});
  view.getAcl = () => ({getPermissionLevel: () => view.allowed ? 'all' : 'no'});
  view.removed = false;
  view.leftMargin = 1; view.rightMargin = 1;
  return {view, espo, preferences, config};
}
const date = {clone() { return this; }, subtract() { return this; }, add() { return this; }};

test('task all-day configuration is honored in Timeline without changing the default', () => {
  const defaultView = fixture().view;
  defaultView.setup();
  assert.deepEqual(plain(defaultView.allDayScopeList), ['Task', 'Meeting']);

  const {view, config} = fixture();
  config.calendarPlusTasksAllDay = false;
  view.setup();
  assert.deepEqual(plain(view.allDayScopeList), ['Meeting']);
});

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
    assert.equal(url, 'CalendarPlus/Users');
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
  const CalendarModal = load('modals/calendar.js', {'views/modal': Modal, 'calendar-plus:calendar-definitions': definitions}, espo);
  const TimelineModal = load('modals/timeline.js', {'calendar-plus:views/calendar/modals/calendar': CalendarModal}, espo);
  const modal = new TimelineModal();
  const state = {list: [{id: 'a', name: 'Original'}], fail: false};
  modal.options = {calendar: {...state.list[0], source: 'timeline', mode: 'timeline'}, onSave: item => { state.saved = item; }};
  modal.getPreferences = () => ({
    get: key => key === 'calendarPlusList' ? state.list : [],
    set: (key, value) => { state.list = value; },
    save: async data => { state.list = data.calendarPlusList; if (state.fail) throw new Error('Failed'); },
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
  assert.equal(preferences.calendarPlusSharedSelection, undefined);
  assert.equal(preferences.calendarPlusList.length, 1);
});

test('default Timeline resolves teams and people on every refresh, including empty teams', async () => {
  const {view, espo, preferences} = fixture();
  preferences.calendarPlusSharedSelection = {teamIdList: ['team'], userIdList: ['ann']};
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

test('Timeline labels always use solid entity colors and omit the native title popup', () => {
  const {view, config} = fixture();
  for (const enabled of [true, false]) {
    config.calendarPlusColorGradientEnabled = enabled;
    const event = {scope: 'Task', group: 'ann', type: 'box'};
    view.fillColor(event);
    assert.equal(event.style, 'background-color:#70c173;');
    assert.equal(event.style.includes('linear-gradient'), false);
  }
  assert.equal(view.convertEvent({title: 'Task title'}).title, undefined);
  config.calendarPlusTooltipEnabled = false;
  assert.equal(view.convertEvent({title: 'Task title'}).title, undefined);
});


test('all Timeline types attach the common tooltip to events, skip backgrounds, and clean up removed items', async () => {
  for (const type of ['single', 'shared', 'saved-a']) {
    const {view, config} = fixture([{id: 'a', name: 'Team'}]);
    view.storedType = type;
    view.setup();
    const event = view.convertEvent({id: 'task', name: 'Follow up', scope: 'Task', group: 'ann',
      dateStart: '2026-11-05 09:00:00', dateEnd: '2026-11-05 10:00:00'});
    const background = view.convertEvent({id: 'busy', type: 'background', scope: 'Task'});
    const element = id => ({
      attrs: {'data-id': id}, listeners: {},
      getAttribute(name) { return this.attrs[name]; }, hasAttribute(name) { return name in this.attrs; },
      setAttribute(name, value) { this.attrs[name] = value; },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      removeEventListener(name) { delete this.listeners[name]; },
    });
    const task = element(event.id);
    const busy = element(background.id);
    let elements = [task, busy];
    view.$timeline = {get: () => ({querySelectorAll: () => elements})};
    view.syncTimelineTooltips();
    assert.equal(task.attrs.tabindex, '0');
    assert.equal(typeof task.listeners.mouseenter, 'function');
    assert.equal(typeof task.listeners.focus, 'function');
    assert.equal(view.eventTooltip.bindings.has(busy), false);
    const adapted = view.eventAppearances.get(task).event;
    assert.equal(adapted.extendedProps.recordId, 'task');
    assert.equal(adapted.title, 'Follow up');
    view.getDateTime = () => ({toDisplay: value => value, toDisplayDate: value => value});
    view.translate = name => name;
    const summary = view.eventTooltip.detailsFor(adapted, {collaboratorsNames: {bob: 'Bob'}});
    assert.equal(summary.rows.find(row => row.label === 'collaborators').value, 'Bob');
    config.calendarPlusTooltipEnabled = false;
    let reads = 0;
    view.getModelFactory = () => { reads++; throw new Error('Unexpected read'); };
    await view.eventTooltip.show(task);
    assert.equal(reads, 0);
    elements = [];
    view.syncTimelineTooltips();
    assert.equal(view.eventTooltip.bindings.size, 0);
    assert.equal(view.eventAppearances.size, 0);
  }
});


test('Timeline removes artificial horizontal collisions on creation without changing vertical separation', async () => {
  const {view} = fixture();
  view.calendarType = 'single';
  const options = [];
  const itemSets = [];
  const timeline = {setOptions: value => options.push(plain(value)), setItems: value => itemSets.push(value), on() {}};
  await view.fetchEvents(date, date, () => { view.timeline = timeline; });
  assert.deepEqual(options, [{margin: {item: {horizontal: 0, vertical: 12}, axis: 6}}]);
  await view.fetchEvents(date, date, () => {});
  assert.equal(options.length, 1);
  assert.deepEqual(itemSets, [['event']]);
});


test('Timeline gap uses admin configuration and refresh reapplies a changed gap without duplicate listeners', async () => {
  const {view, config} = fixture();
  view.calendarType = 'single';
  const gaps = [];
  let bindings = 0;
  let itemSets = 0;
  const timeline = {setOptions: value => gaps.push(value.margin.item.horizontal), setItems: () => itemSets++, on: () => bindings++};
  config.calendarPlusTimelineEventGap = 10;
  await view.fetchEvents(date, date, () => { view.timeline = timeline; });
  config.calendarPlusTimelineEventGap = 0;
  await view.fetchEvents(date, date, () => {});
  config.calendarPlusTimelineEventGap = 25;
  await view.fetchEvents(date, date, () => {});
  await view.fetchEvents(date, date, () => {});
  assert.deepEqual(gaps, [10, 0, 25]);
  assert.equal(bindings, 1);
  assert.equal(itemSets, 3);
});

test('Timeline gap rejects invalid values and stays within the supported range', async () => {
  for (const [value, expected] of [[null, 0], ['invalid', 0], [-2, 0], [150, 100]]) {
    const {view, config} = fixture();
    view.calendarType = 'single';
    config.calendarPlusTimelineEventGap = value;
    let horizontal;
    await view.fetchEvents(date, date, () => {
      view.timeline = {setOptions: value => { horizontal = value.margin.item.horizontal; }, setItems() {}, on() {}};
    });
    assert.equal(horizontal, expected);
  }
});


test('saved and default Timelines forward their own per-view inactive-user setting on every refresh', async () => {
  for (const saved of [false, true]) {
    const {view, espo, preferences} = fixture(saved ? [{id: 'a', name: 'Team'}] : []);
    view.setup();
    view.mode = saved ? 'view-timeline-a' : 'timeline';
    view.calendarType = saved ? 'saved-a' : 'shared';
    const key = saved ? 'view:a' : 'timeline';
    preferences.calendarPlusViewSettings = {[key]: {showInactiveUsers: true}};
    const requests = [];
    espo.Ajax.postRequest = async (url, body) => { requests.push(body); return {users: []}; };
    await view.fetchEvents(date, date, () => {});
    assert.equal(requests[0].includeInactiveUsers, true);
    preferences.calendarPlusViewSettings[key].showInactiveUsers = false;
    await view.fetchEvents(date, date, () => {});
    assert.equal(requests[1].includeInactiveUsers, undefined);
  }
});


test('static saved and default Timelines never re-expand teams and respect inactive visibility', async () => {
  for (const saved of [false, true]) {
    const selection = {id: 'a', name: 'Static timeline', teamIdList: ['changed-team'], userIdList: ['new-person'], membershipMode: 'static', staticUserIdList: ['ann', 'former']};
    const {view, espo, preferences} = fixture(saved ? [selection] : []);
    if (!saved) preferences.calendarPlusSharedSelection = selection;
    view.setup();
    view.mode = saved ? 'view-timeline-a' : 'timeline';
    view.calendarType = saved ? 'saved-a' : 'shared';
    const key = saved ? 'view:a' : 'timeline';
    preferences.calendarPlusViewSettings = {[key]: {showInactiveUsers: false}};
    const calls = [];
    espo.Ajax.postRequest = async (url, body) => { calls.push(body); return {users: []}; };
    await view.fetchEvents(date, date, () => {});
    assert.deepEqual(plain(calls[0]), {teamIdList: [], userIdList: ['ann', 'former']});
    preferences.calendarPlusViewSettings[key].showInactiveUsers = true;
    await view.fetchEvents(date, date, () => {});
    assert.deepEqual(plain(calls[1]), {teamIdList: [], userIdList: ['ann', 'former'], includeInactiveUsers: true});
  }
});


test('Timeline weekend visibility follows its view settings and restores weekends when enabled', () => {
  const {view, preferences} = fixture();
  view.mode = 'timeline';
  preferences.calendarPlusViewSettings = {timeline: {showWeekends: false}};
  const options = [];
  view.timeline = {setOptions: value => options.push(plain(value))};
  view.applyViewSettings();
  assert.equal(options[0].hiddenDates[0].repeat, 'weekly');
  preferences.calendarPlusViewSettings.timeline.showWeekends = true;
  view.applyViewSettings();
  assert.deepEqual(options[1].hiddenDates, []);
});


test('Timeline hides hours outside its daily time window, combines weekends, and restores full days', () => {
  const {view, preferences} = fixture();
  view.mode = 'timeline';
  const settings = {showWeekends: false, visibleTimeStart: '08:00', visibleTimeEnd: '15:00'};
  preferences.calendarPlusViewSettings = {timeline: settings};
  const options = [];
  view.timeline = {setOptions: value => options.push(value)};
  view.applyViewSettings();
  const hidden = options[0].hiddenDates;
  assert.equal(hidden.length, 2);
  assert.equal(hidden[0].repeat, 'weekly');
  assert.equal(hidden[1].repeat, 'daily');
  assert.equal(hidden[1].start.getHours(), 15);
  assert.equal(hidden[1].end.getHours(), 8);
  assert.equal(hidden[1].end.getDate(), hidden[1].start.getDate() + 1);
  settings.showWeekends = true; settings.visibleTimeStart = '00:00'; settings.visibleTimeEnd = '24:00';
  view.applyViewSettings();
  assert.equal(options[1].hiddenDates.length, 0);
  settings.visibleTimeStart = '08:00';
  view.applyViewSettings();
  assert.equal(options[2].hiddenDates[0].start.getHours(), 0);
  assert.equal(options[2].hiddenDates[0].end.getHours(), 8);
});
