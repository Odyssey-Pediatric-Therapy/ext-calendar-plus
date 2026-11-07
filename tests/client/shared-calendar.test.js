import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

class Element {
  constructor() {
    this.style = {}; this.children = []; this.listeners = {};
    this.classes = new Set();
    this.classList = {toggle: (name, active) => { if (active) this.classes.add(name); else this.classes.delete(name); }};
  }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  removeEventListener(name) { delete this.listeners[name]; }
  hasAttribute(name) { return this[name] !== undefined; }
  getAttribute(name) { return this[name] || null; }
  removeAttribute(name) { delete this[name]; }
  contains(element) { return this === element || this.children.some(child => child === element || child.contains?.(element)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
  remove() { this.removed = true; }
  querySelector() { return null; }
  getBoundingClientRect() { return this.bounds || {left: 0, right: 0, top: 0, bottom: 0}; }
}
class FakeCalendar {
  constructor(element, options) { this.options = options; this.sources = []; }
  render() {}
  destroy() { this.destroyed = true; }
  batchRendering(fn) { fn(); }
  gotoDate(date) { this.date = date; }
  removeAllEventSources() { this.sources = []; }
  removeAllEvents() {}
  addEventSource(events) { this.sources.push(events); }
  unselect() {}
}
class BaseCalendar {
  setup() {}
  prepareRender() { this.basePrepared = true; }
  setupMode() {
    this.isCustomView = this.mode.startsWith('view-');
    this.viewMode = this.savedMode;
    this.teamIdList = ['team'];
  }
  isAgendaMode() { return this.mode.startsWith('agenda'); }
  on(name, callback) { this.onRemove = callback; }
  convertToFcEvents(data) { return data.map(event => ({...event})); }
  fillColor(event) { event.color = 'type-color'; }
  fetchEvents(from, to, callback) { this.baseFetched = true; callback([]); }
  getCalculatedHeight() { return 600; }
  actionRefresh() { this.refreshes = (this.refreshes || 0) + 1; }
  updateDate() {}
  handleScrollToNow() { this.scrolledToNow = true; }
}
function fixture(savedMode = 'basicDay', tasksAllDay) {
  let View;
  const document = {body: new Element(), documentElement: {clientWidth: 900, clientHeight: 800},
    createElement: () => new Element(), createTextNode: text => ({textContent: text}),
    listeners: new Map(), addEventListener(name, fn) { this.listeners.set(name, fn); },
    removeEventListener(name) { this.listeners.delete(name); }};
  const calls = [];
  const espo = {Ajax: {
    postRequest: async (url, body) => {
      calls.push({url, body});
      return {users: [{id: 'ann', name: 'Ann'}, {id: 'bob', name: 'Bob'}]};
    },
    getRequest: async (url, query) => {
      calls.push({url, query});
      return [
        {id: 'meeting', title: 'Meeting', userIdList: ['ann', 'bob', 'inactive']},
        {id: 'solo', title: 'Solo', userIdList: ['ann']},
        {id: 'hidden', title: 'Hidden', userIdList: ['inactive']},
      ];
    },
  }, Ui: {notifyWait() {}, notify() {}, error() {}}};
  let definitions;
  vm.runInNewContext(readFileSync(new URL('../../src/files/client/custom/modules/calendar-plus/src/calendar-definitions.js', import.meta.url), 'utf8'), {
    define: (name, deps, factory) => { definitions = factory(); },
  });
  let colors;
  vm.runInNewContext(readFileSync(new URL('../../src/files/client/custom/modules/calendar-plus/src/calendar-colors.js', import.meta.url), 'utf8'), {
    define: (name, dependencies, factory) => { colors = factory(); },
  });
  let EventTooltip;
  vm.runInNewContext(readFileSync(new URL('../../src/files/client/custom/modules/calendar-plus/src/views/calendar/event-tooltip.js', import.meta.url), 'utf8'), {
    define: (name, dependencies, factory) => { EventTooltip = factory(); }, document, setTimeout, clearTimeout,
  });
  vm.runInNewContext(readFileSync(new URL('../../src/files/client/custom/modules/calendar-plus/src/views/calendar/calendar.js', import.meta.url), 'utf8'), {
    define: (name, dependencies, factory) => { View = factory(BaseCalendar, {Calendar: FakeCalendar}, colors, EventTooltip, definitions); },
    Espo: espo, document, queueMicrotask,
  });
  const view = new View();
  view.allDayScopeList = ['Task', 'Meeting'];
  view.mode = 'view-saved';
  view.savedMode = savedMode;
  view.options = {};
  view.viewId = 'saved';
  view.getPreferences = () => ({get: () => [{id: 'saved', mode: savedMode}]});
  view.extendedProps = [];
  view.enabledScopeList = ['Meeting'];
  view.translate = value => value;
  const config = {calendarPlusTasksAllDay: tasksAllDay};
  view.getConfig = () => ({get: name => config[name]});
  view.getDateTime = () => ({toDisplay: value => value || '', toDisplayDate: value => value || '', getTimeZone: () => 'America/Denver'});
  const storage = {};
  view.getStorage = () => ({get: (category, key) => storage[key], set: (category, key, value) => { storage[key] = value; }});
  view.$calendar = {before() {}, after() {}, hide() { this.hidden = true; }, show() { this.hidden = false; }};
  view.setupMode();
  view.setup();
  view.scrollHour = 8;
  view.calendar = {
    getDate: () => '2026-11-04',
    getOption: name => ['eventDrop', 'eventResize', 'select'].includes(name) ? async () => {} : undefined,
    setOption(name, value) { (this.options ||= {})[name] = value; }, updateSize() {}, batchRendering(fn) { fn(); }, getEvents: () => [],
    destroy() { this.destroyed = true; },
  };
  return {view, calls, espo, document, config};
}

test('task all-day configuration is honored without changing the default', () => {
  assert.deepEqual(Array.from(fixture().view.allDayScopeList), ['Task', 'Meeting']);
  assert.deepEqual(Array.from(fixture('basicDay', false).view.allDayScopeList), ['Meeting']);
});

test('existing saved shared day/week modes become timed layouts; month uses the shared member filters', () => {
  assert.equal(fixture('basicDay').view.viewMode, 'agendaDay');
  assert.equal(fixture('basicWeek').view.viewMode, 'agendaWeek');
  const {view} = fixture('month');
  assert.equal(view.viewMode, 'month');
  assert.equal(view.isSharedTimeGrid(), true);
  assert.equal(view.isAgendaMode(), false);
});

test('shared fetch resolves active users and fetches timed events once, omitting inactive-only events', async () => {
  const {view, calls} = fixture('basicWeek');
  let result;
  await view.fetchEvents('from', 'to', events => { result = events; });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].query.agenda, true);
  assert.equal(calls[1].query.userIdList, 'ann,bob');
  assert.equal(result.length, 2);
  assert.deepEqual(Array.from(result[0].calendarUserIds), ['ann', 'bob']);
  assert.equal(view.dayCalendars.length, 0);
  assert.equal(view.legendButtons.size, 2);
  assert.equal(view.$calendar.hidden, false);
});

test('day columns show each person, include shared meetings in both, and do not accumulate sources on refresh', async () => {
  const {view} = fixture();
  await view.fetchEvents('from', 'to', () => {});
  assert.equal(view.dayCalendars.length, 2);
  const [ann, bob] = view.dayCalendars;
  assert.equal(ann.calendar.options.initialView, 'timeGridDay');
  assert.equal(ann.calendar.options.allDaySlot, true);
  assert.equal(ann.calendar.sources[0].length, 2);
  assert.equal(bob.calendar.sources[0].length, 1);
  assert.equal(ann.calendar.sources[0][0].color, view.colorForUser('ann'));
  await view.fetchEvents('from', 'to', () => {});
  assert.equal(view.dayCalendars[0].calendar, ann.calendar);
  assert.equal(ann.calendar.sources.length, 1);
  view.onRemove();
  assert.equal(ann.calendar.destroyed, true);
  assert.equal(bob.calendar.destroyed, true);
});

test('day dragging and resizing reuse existing persistence and refresh every participant column', async () => {
  const {view} = fixture();
  let dropped = false;
  let resized = false;
  view.calendar.getOption = name => ({
    eventDrop: async () => { dropped = true; },
    eventResize: async () => { resized = true; },
    select: () => {},
  })[name];
  await view.fetchEvents('from', 'to', () => {});
  const options = view.dayCalendars[0].calendar.options;
  await options.eventDrop({});
  await options.eventResize({});
  assert.equal(dropped, true);
  assert.equal(resized, true);
  assert.equal(view.refreshes, 2);
});

test('slot selection uses the column owner and restores parent options', async () => {
  const {view} = fixture();
  let selectedUser;
  view.calendar.getOption = name => name === 'select' ? () => { selectedUser = view.options.userId; } : undefined;
  const original = view.options;
  await view.fetchEvents('from', 'to', () => {});
  view.dayCalendars[1].calendar.options.select({});
  assert.equal(selectedUser, 'bob');
  assert.equal(view.options, original);
});

test('empty membership skips event requests; stale requests cannot replace fresh members', async () => {
  const {view, espo, calls} = fixture();
  let resolveOld;
  espo.Ajax.postRequest = () => new Promise(resolve => { resolveOld = resolve; });
  let oldDelivered = false;
  const old = view.fetchEvents('from', 'to', () => { oldDelivered = true; });
  espo.Ajax.postRequest = async () => ({users: []});
  await view.fetchEvents('from', 'to', () => {});
  resolveOld({users: [{id: 'ann', name: 'Ann'}]});
  await old;
  assert.equal(oldDelivered, false);
  assert.equal(calls.length, 0);
  assert.equal(view.sharedUsers.length, 0);
});

test('event cards keep only title and time, including shared events', async () => {
  const {view} = fixture('basicWeek');
  await view.fetchEvents('from', 'to', () => {});
  const event = {title: 'Planning', extendedProps: {calendarUserIds: ['ann', 'bob']}};
  const content = view.sharedEventContent({timeText: '09:00', event}).domNodes[0];
  assert.equal(content.className, 'fc-event-main-frame cp-calendar-event-content');
  assert.equal(content.children[1].className, 'fc-event-title-container');
  assert.equal(content.children[1].children[0].textContent, 'Planning');
  assert.equal(content.children.length, 2);
  const day = view.sharedEventContent({timeText: '09:00', event}, 'ann').domNodes[0];
  assert.equal(day.children.length, 2);
});

test('person colors remain distinct and stable across overlapping team selections', () => {
  const {view} = fixture();
  const users = Array.from({length: 10}, (_, index) => ({id: `person${index}`, name: `Person ${index}`}));
  view.assignUserColors(users);
  const original = users.map(user => view.colorForUser(user.id));
  assert.equal(new Set(original).size, 10);
  view.assignUserColors([users[8], users[2]]);
  assert.equal(view.colorForUser(users[2].id), original[2]);
  assert.equal(view.colorForUser(users[8].id), original[8]);
});

function calendarEvent(source) {
  return {
    id: source.id, extendedProps: {calendarUserIds: source.calendarUserIds},
    setExtendedProp(name, value) { this.extendedProps[name] = value; },
    setProp(name, value) { this[name] = value; },
  };
}

test('person toggles filter instantly, preserve shared events for visible attendees, and restore events', async () => {
  const {view, calls} = fixture('basicWeek');
  await view.fetchEvents('from', 'to', () => {});
  const events = view.sharedEvents.map(calendarEvent);
  view.calendar.getEvents = () => events;
  view.legendButtons.get('ann').button.listeners.click();
  assert.equal(events[0].display, 'block');
  assert.deepEqual(Array.from(events[0].extendedProps.visibleCalendarUserIds), ['bob']);
  assert.equal(events[0].backgroundColor, view.colorForUser('bob'));
  assert.equal(events[1].display, 'none');
  assert.equal(view.legendButtons.get('ann').button['aria-pressed'], 'false');
  view.legendButtons.get('ann').button.listeners.click();
  assert.equal(events[1].display, 'block');
  assert.equal(view.legendButtons.get('ann').button['aria-pressed'], 'true');
  assert.equal(calls.length, 2, 'toggling does not refetch');
});

test('hiding a person removes their day column, supports hiding everyone, and restores columns', async () => {
  const {view} = fixture();
  await view.fetchEvents('from', 'to', () => {});
  const oldColumn = view.dayCalendars[0].calendar;
  view.setPersonVisible('ann', false);
  assert.equal(oldColumn.destroyed, true);
  assert.deepEqual(Array.from(view.dayCalendars, item => item.userId), ['bob']);
  view.setAllPeopleVisible(false);
  assert.equal(view.dayCalendars.length, 0);
  view.setAllPeopleVisible(true);
  assert.equal(view.dayCalendars.length, 2);
});

test('hover and keyboard focus highlight one person and dim other events without changing visibility', async () => {
  const {view} = fixture('basicWeek');
  await view.fetchEvents('from', 'to', () => {});
  const ann = new Element();
  const bob = new Element();
  const shared = new Element();
  view.registerEventElement({el: ann, event: {extendedProps: {calendarUserIds: ['ann']}}});
  view.registerEventElement({el: bob, event: {extendedProps: {calendarUserIds: ['bob']}}});
  view.registerEventElement({el: shared, event: {extendedProps: {calendarUserIds: ['ann', 'bob']}}});
  const button = view.legendButtons.get('ann').button;
  button.listeners.mouseenter();
  assert.equal(ann.classes.has('cp-person-event-highlighted'), true);
  assert.equal(shared.classes.has('cp-person-event-highlighted'), true);
  assert.equal(bob.classes.has('cp-person-event-dimmed'), true);
  button.listeners.mouseleave();
  assert.equal(bob.classes.size, 0);
  button.listeners.focus();
  assert.equal(bob.classes.has('cp-person-event-dimmed'), true);
  button.listeners.blur();
  assert.equal(ann.classes.size, 0);
  assert.equal(view.hiddenUserIds.size, 0);
});

test('hidden people stay filtered after refresh, and initials identify people without color', async () => {
  const {view} = fixture('basicWeek');
  await view.fetchEvents('from', 'to', () => {});
  view.setPersonVisible('ann', false);
  let result;
  await view.fetchEvents('from', 'to', events => { result = events; });
  assert.equal(result.find(event => event.id === 'solo').display, 'none');
  assert.deepEqual(Array.from(result[0].visibleCalendarUserIds), ['bob']);
  view.sharedUsers = [{id: 'ann', name: 'Amelia Chen'}];
  assert.equal(view.colorSwatch('ann').textContent, 'AC');
  assert.deepEqual(Array.from(view.getStorage().get('calendarPlus', view.personFilterKey())), ['ann']);
});

test('editing and saving a shared Week view rebuilds the legend and keeps person filters', async () => {
  const {view} = fixture('basicWeek');
  await view.fetchEvents('from', 'to', () => {});
  view.setPersonVisible('ann', false);
  const oldLegend = view.legendElement;
  const oldCalendar = view.calendar;
  view.setupMode();
  view.prepareRender();
  assert.equal(view.basePrepared, true);
  assert.equal(oldLegend.removed, true);
  assert.equal(oldCalendar.destroyed, true);
  assert.equal(view.legendElement, null);
  assert.equal(view.calendar, null);
  const attached = [];
  view.$calendar = {before(element) { attached.push(element); }, show() {}, hide() {}};
  view.calendar = {...oldCalendar, destroyed: false};
  await view.fetchEvents('from', 'to', () => {});
  assert.notEqual(view.legendElement, oldLegend);
  assert.equal(attached[0], view.legendElement);
  assert.equal(view.legendButtons.size, 2);
  assert.equal(view.legendButtons.get('ann').button['aria-pressed'], 'false');
});

test('re-rendering Day destroys old columns and ignores requests started before saving', async () => {
  const {view, espo} = fixture();
  await view.fetchEvents('from', 'to', () => {});
  const oldColumns = view.dayCalendars.map(item => item.calendar);
  let resolve;
  espo.Ajax.postRequest = () => new Promise(done => { resolve = done; });
  let delivered = false;
  const pending = view.fetchEvents('from', 'to', () => { delivered = true; });
  view.prepareRender();
  for (const column of oldColumns) assert.equal(column.destroyed, true);
  assert.equal(view.dayCalendars.length, 0);
  resolve({users: [{id: 'ann', name: 'Ann'}]});
  await pending;
  assert.equal(delivered, false);
  assert.equal(view.legendElement, null);
});

test('individual-only calendars resolve members and deduplicate multi-person activity responses', async () => {
  const {view, espo, calls} = fixture('basicWeek');
  view.getPreferences = () => ({get: () => [{id: 'saved', userIdList: ['ann', 'bob']}]});
  view.setupMode();
  view.teamIdList = null;
  espo.Ajax.getRequest = async () => [
    {id: 'shared', scope: 'Meeting', title: 'Planning', userId: 'ann'},
    {id: 'shared', scope: 'Meeting', title: 'Planning', userId: 'bob'},
  ];
  let result;
  await view.fetchEvents('from', 'to', events => { result = events; });
  assert.deepEqual(Array.from(calls[0].body.userIdList), ['ann', 'bob']);
  assert.equal(result.length, 1);
  assert.deepEqual(Array.from(result[0].calendarUserIds), ['ann', 'bob']);
});

function personDropFixture(mode = 'basicDay') {
  const result = fixture(mode);
  const {view} = result;
  const record = {assignedUserId: 'ann', usersIds: ['guest'], usersColumns: {guest: {status: 'Accepted'}}, contactsIds: ['contact'], leadsIds: ['lead']};
  const saves = [];
  const access = {edit: true, fields: true};
  const model = {id: null, get: name => record[name], fetch: async () => {}, save: async (attributes, options) => {
    saves.push({attributes, options}); Object.assign(record, attributes);
  }};
  const fields = {assignedUser: {type: 'link'}, users: {type: 'linkMultiple'}, dateStart: {type: 'datetime'}, dateEnd: {type: 'datetime'}};
  view.getMetadata = () => ({get: path => path[2] === 'fields' ? fields[path[3]] :
    path[2] === 'links' && ['users', 'collaborators'].includes(path[3]) && fields[path[3]] ? {entity: 'User', type: 'hasMany'} : undefined});
  view.getAcl = () => ({checkModel: () => access.edit, checkField: () => access.fields});
  view.getModelFactory = () => ({create: async () => model});
  view.convertDateTime = value => value;
  view.getDateTime = () => ({internalDateTimeFormat: 'format', toMoment: value => {
    let date = new Date(value.replace(' ', 'T') + 'Z');
    return {add(delta) { date = new Date(date.getTime() + delta); return this; },
      format() { return date.toISOString().slice(0, 19).replace('T', ' '); }};
  }});
  return {...result, record, saves, access, model, fields};
}
function draggedEvent(changes = {}) {
  return {id: 'Meeting-record', allDay: false, start: new Date('2026-11-04T09:00:00Z'),
    startStr: '2026-11-04T09:00:00Z', endStr: '2026-11-04T10:00:00Z',
    extendedProps: {scope: 'Meeting', recordId: 'record', dateStart: '2026-11-04 09:00:00', dateEnd: '2026-11-04 10:00:00'},
    ...changes};
}

test('week drop adds an attendee without changing the assignee or existing participants and statuses', async () => {
  const {view, record, saves} = personDropFixture('basicWeek');
  await view.fetchEvents('from', 'to', () => {});
  assert.equal(await view.dropEventOnPerson(draggedEvent(), 'bob'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(saves[0].attributes)), {usersIds: ['guest', 'bob']});
  assert.equal(saves[0].options.patch, true);
  assert.deepEqual(Array.from(record.usersIds), ['guest', 'bob']);
  assert.equal(record.assignedUserId, 'ann');
  assert.deepEqual(record.usersColumns, {guest: {status: 'Accepted'}});
  assert.deepEqual(record.contactsIds, ['contact']);
  assert.deepEqual(record.leadsIds, ['lead']);
  assert.equal(view.refreshes, 1);
});

test('adding an attendee retains the assignee when already attending', async () => {
  const {view, record} = personDropFixture('basicWeek');
  record.usersIds = ['ann', 'guest'];
  await view.fetchEvents('from', 'to', () => {});
  await view.dropEventOnPerson(draggedEvent(), 'bob');
  assert.deepEqual(Array.from(record.usersIds), ['ann', 'guest', 'bob']);
  assert.equal(record.assignedUserId, 'ann');
});

test('cross-column Day drop adds the attendee and saves new times in a single update', async () => {
  const {view, record, saves} = personDropFixture();
  await view.fetchEvents('from', 'to', () => {});
  const source = view.dayCalendars[0].calendar;
  const target = view.dayCalendars[1].calendar;
  const original = draggedEvent();
  const moved = draggedEvent({start: new Date('2026-11-04T11:00:00Z'), startStr: '2026-11-04T11:00:00Z', endStr: '2026-11-04T12:00:00Z'});
  source.options.eventDragStart({event: original});
  source.options.eventDragStop({event: original, jsEvent: {clientX: 900, clientY: 900}});
  source.options.eventLeave({revert() { throw new Error('Should not revert a successful move.'); }});
  let reverted = false;
  await target.options.eventReceive({event: moved, revert() { reverted = true; }});
  assert.equal(reverted, false);
  assert.equal(target.options.droppable, true);
  assert.equal(saves.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(saves[0].attributes)), {
    usersIds: ['guest', 'bob'], dateStart: '2026-11-04 11:00:00', dateEnd: '2026-11-04 12:00:00',
  });
  assert.deepEqual(Array.from(record.usersIds), ['guest', 'bob']);
  assert.equal(record.assignedUserId, 'ann');
  assert.deepEqual(record.usersColumns, {guest: {status: 'Accepted'}});
  assert.deepEqual(record.contactsIds, ['contact']);
  assert.deepEqual(record.leadsIds, ['lead']);
});

test('failed Day attendee addition restores both the source and destination calendars', async () => {
  const {view, model, record} = personDropFixture();
  await view.fetchEvents('from', 'to', () => {});
  model.save = async () => { throw new Error('Forbidden'); };
  const source = view.dayCalendars[0].calendar;
  const target = view.dayCalendars[1].calendar;
  const event = draggedEvent();
  let sourceRestored = false;
  let targetRemoved = false;
  source.options.eventDragStart({event});
  source.options.eventDragStop({event, jsEvent: {clientX: 900, clientY: 900}});
  source.options.eventLeave({revert() { sourceRestored = true; }});
  await target.options.eventReceive({event, revert() { targetRemoved = true; }});
  assert.equal(sourceRestored, true);
  assert.equal(targetRemoved, true);
  assert.equal(record.assignedUserId, 'ann');
});

test('week legend drop uses the pointer target and preserves the event time', async () => {
  const {view, document} = personDropFixture('basicWeek');
  await view.fetchEvents('from', 'to', () => {});
  const button = view.legendButtons.get('bob').button;
  button.bounds = {left: 100, right: 200, top: 10, bottom: 40};
  const event = draggedEvent();
  let assigned;
  view.dropEventOnPerson = async (...args) => { assigned = args; };
  view.startPersonDropDrag({event}, view.calendar);
  document.listeners.get('pointermove')({clientX: 150, clientY: 20});
  assert.equal(button.classes.has('cp-person-drop-target'), true);
  view.stopPersonDropDrag({event, jsEvent: {clientX: 150, clientY: 20}});
  await Promise.resolve();
  assert.equal(assigned[0], event);
  assert.equal(assigned[1], 'bob');
  assert.equal(assigned[2], undefined, 'legend drops never request a time change');
  assert.equal(document.listeners.size, 0);
  assert.equal(button.classes.has('cp-person-drop-target'), false);
});

test('permission failures and recipients outside the shared view never change attendees or assignment', async () => {
  const {view, saves, access} = personDropFixture();
  await view.fetchEvents('from', 'to', () => {});
  let reverted = 0;
  access.edit = false;
  assert.equal(await view.dropEventOnPerson(draggedEvent(), 'bob', {revert: () => reverted++}), false);
  access.edit = true;
  access.fields = false;
  assert.equal(await view.dropEventOnPerson(draggedEvent(), 'bob', {revert: () => reverted++}), false);
  assert.equal(await view.dropEventOnPerson(draggedEvent(), 'outside', {revert: () => reverted++}), false);
  assert.equal(saves.length, 0);
  assert.equal(reverted, 3);
});

test('all-day moves preserve inclusive dates and timed multi-day events retain their original clock times', () => {
  const {view} = personDropFixture();
  const allDay = draggedEvent({allDay: true, start: new Date('2026-11-04T00:00:00Z'), startStr: '2026-11-04', endStr: '2026-11-07',
    extendedProps: {dateStartDate: '2026-11-04', dateEndDate: '2026-11-06'}});
  assert.deepEqual(JSON.parse(JSON.stringify(view.movedEventDates(allDay, allDay))), {
    dateStartDate: '2026-11-04', dateEndDate: '2026-11-06',
  });
  const multiDay = draggedEvent({allDay: true, start: new Date('2026-11-04T00:00:00Z'), startStr: '2026-11-04', endStr: '2026-11-07',
    extendedProps: {dateStart: '2026-11-04 06:00:00', dateEnd: '2026-11-06 15:00:00'}});
  assert.deepEqual(JSON.parse(JSON.stringify(view.movedEventDates(multiDay, multiDay))), {
    dateStart: '2026-11-04 06:00:00', dateEnd: '2026-11-06 15:00:00',
  });
});

test('Day participant drops check date-field permission before saving any part of the move', async () => {
  const {view, saves, record} = personDropFixture();
  await view.fetchEvents('from', 'to', () => {});
  view.getAcl = () => ({checkModel: () => true, checkField: (scope, field) => field !== 'dateStart'});
  let reverted = false;
  const event = draggedEvent();
  const saved = await view.dropEventOnPerson(event, 'bob', {moveTime: true, originalEvent: event, revert() { reverted = true; }});
  assert.equal(saved, false);
  assert.equal(reverted, true);
  assert.equal(saves.length, 0);
  assert.equal(record.assignedUserId, 'ann');
});

test('a second drop cannot submit a concurrent participant update for the same record', async () => {
  const {view, model, saves} = personDropFixture('basicWeek');
  await view.fetchEvents('from', 'to', () => {});
  let release;
  model.fetch = () => new Promise(resolve => { release = resolve; });
  const first = view.dropEventOnPerson(draggedEvent(), 'bob');
  await Promise.resolve();
  let reverted = false;
  assert.equal(await view.dropEventOnPerson(draggedEvent(), 'ann', {revert() { reverted = true; }}), false);
  release();
  assert.equal(await first, true);
  assert.equal(reverted, true);
  assert.equal(saves.length, 1);
});

test('Day events use solid entity colors instead of person gradients', async () => {
  const {view} = fixture();
  await view.fetchEvents('from', 'to', () => {});
  view.colors = {Task: '#70c173', Call: '#CF605D'};
  const task = new Element();
  const call = new Element();
  view.registerEventElement({el: task, event: {extendedProps: {scope: 'Task', calendarUserIds: ['ann', 'bob']}}}, 'bob');
  view.registerEventElement({el: call, event: {extendedProps: {scope: 'Call', calendarUserIds: ['ann', 'bob']}}}, 'bob');
  assert.equal(task.style.backgroundImage, '');
  assert.equal(call.style.backgroundImage, '');
  assert.equal(task.style.backgroundColor, '#70c173');
  assert.equal(call.style.backgroundColor, '#CF605D');
  assert.equal(task.style.borderColor, '#70c173');
});

test('hiding a participant repaints a shared event gradient using the remaining person', async () => {
  const {view} = fixture('basicWeek');
  await view.fetchEvents('from', 'to', () => {});
  view.colors = {Meeting: '#558BBD'};
  const event = calendarEvent(view.sharedEvents[0]);
  event.extendedProps.scope = 'Meeting';
  const liveEvent = calendarEvent(view.sharedEvents[0]);
  liveEvent.extendedProps.scope = 'Meeting';
  view.calendar.getEvents = () => [liveEvent];
  const element = new Element();
  view.registerEventElement({el: element, event});
  assert.equal(element.style.backgroundImage.includes(`${view.colorForUser('ann')} 0%`), true);
  view.setPersonVisible('ann', false);
  assert.equal(element.style.backgroundImage.includes(`${view.colorForUser('bob')} 0%`), true);
  assert.equal(element.style.backgroundImage.includes('#558BBD 100%'), true);
  view.unregisterEventElement({el: element});
  assert.equal(view.eventAppearances.has(element), false);
});

test('toggling a focused person off then on restores normal emphasis without clicking elsewhere', async () => {
  const {view} = fixture('basicWeek');
  await view.fetchEvents('from', 'to', () => {});
  view.colors = {Meeting: '#558BBD'};
  const ann = new Element();
  const bob = new Element();
  view.registerEventElement({el: ann, event: {extendedProps: {scope: 'Meeting', calendarUserIds: ['ann']}}});
  view.registerEventElement({el: bob, event: {extendedProps: {scope: 'Meeting', calendarUserIds: ['bob']}}});
  const button = view.legendButtons.get('ann').button;
  button.listeners.mouseenter();
  button.listeners.focus();
  assert.equal(bob.classes.has('cp-person-event-dimmed'), true);
  button.listeners.click();
  button.listeners.click();
  button.listeners.mouseleave();
  assert.equal(view.hiddenUserIds.has('ann'), false);
  assert.equal(view.focusedUserId, null);
  assert.equal(ann.classes.has('cp-person-event-highlighted'), false);
  assert.equal(bob.classes.has('cp-person-event-dimmed'), false);
  assert.equal(ann.style.backgroundImage.includes(view.colorForUser('ann')), true);
  assert.equal(bob.style.backgroundImage.includes(view.colorForUser('bob')), true);
});

function tooltipEvent(scope = 'Meeting') {
  return {id: `${scope}-details`, title: 'Planning <img src=x>', extendedProps: {
    scope, recordId: 'details', calendarUserIds: ['ann'],
    dateStart: '2026-11-05 09:00:00', dateEnd: '2026-11-05 10:00:00',
  }};
}

test('event tooltips show times, assignee, and actual attendees beyond the selected calendars', async () => {
  const {view} = fixture('basicWeek');
  await view.fetchEvents('from', 'to', () => {});
  const event = tooltipEvent();
  const record = {name: event.title, assignedUserName: 'Ann', usersNames: {ann: 'Ann', outsider: 'Outside participant'},
    contactsNames: {contact: 'Client contact'}, status: 'Planned', location: 'Room A'};
  view.getModelFactory = () => ({create: async () => ({fetch: async () => {}, get: name => record[name]})});
  const element = new Element();
  view.registerEventElement({el: element, event});
  await view.eventTooltip.show(element);
  const details = await view.eventTooltip.loadDetails(event);
  const summary = view.eventTooltip.detailsFor(event, details);
  assert.equal(summary.rows.some(row => row.value === '2026-11-05 09:00:00'), true);
  assert.equal(summary.rows.find(row => row.label === 'Attendees').value, 'Ann ?, Outside participant ?, Client contact ?');
  assert.equal(summary.rows.find(row => row.label === 'assignedUser').value, 'Ann');
  assert.equal(summary.rows.find(row => row.label === 'location').value, 'Room A');
  const panel = view.eventTooltip.active.panel;
  assert.equal(panel.children[0].textContent, 'Planning <img src=x>');
  assert.equal(element.getAttribute('aria-describedby'), panel.id);
  view.unregisterEventElement({el: element});
  assert.equal(view.eventTooltip.active, null);
  assert.equal(panel.removed, true);
  assert.equal(element.getAttribute('aria-describedby'), null);
});

test('tooltip details are cached until refresh and gracefully retain summaries if record access is denied', async () => {
  const {view} = fixture('basicWeek');
  await view.fetchEvents('from', 'to', () => {});
  let fetches = 0;
  view.getModelFactory = () => ({create: async () => ({fetch: async () => { fetches++; throw new Error('Forbidden'); }})});
  const event = tooltipEvent();
  const results = await Promise.all([view.eventTooltip.loadDetails(event), view.eventTooltip.loadDetails(event)]);
  assert.deepEqual(results, [null, null]);
  assert.equal(fetches, 1);
  const summary = view.eventTooltip.detailsFor(event);
  assert.equal(summary.rows.find(row => row.label === 'Calendar users').value, 'Ann');
  assert.equal(summary.rows.some(row => row.label === 'Attendees'), false);
  view.eventTooltip.refresh();
  await view.eventTooltip.loadDetails(event);
  assert.equal(fetches, 2);
});

test('unmounting an event closes its tooltip and prevents late detail responses from reopening it', async () => {
  const {view} = fixture('month');
  await view.fetchEvents('from', 'to', () => {});
  let release;
  let started;
  const fetching = new Promise(resolve => { started = resolve; });
  view.getModelFactory = () => ({create: async () => ({
    fetch: () => new Promise(resolve => { release = resolve; started(); }), get: () => undefined,
  })});
  const element = new Element();
  view.registerEventElement({el: element, event: tooltipEvent()});
  const loading = view.eventTooltip.show(element);
  await fetching;
  const panel = view.eventTooltip.active.panel;
  view.unregisterEventElement({el: element});
  release();
  await loading;
  assert.equal(panel.removed, true);
  assert.equal(view.eventTooltip.active, null);
  assert.equal(view.eventTooltip.bindings.has(element), false);
});

test('all-day tooltip dates retain inclusive dates and Task people are collaborators rather than meeting attendees', () => {
  const {view} = fixture('month');
  const event = {id: 'Task-date', title: 'Task', extendedProps: {scope: 'Task', calendarUserIds: [],
    dateStartDate: '2026-11-05', dateEndDate: '2026-11-06'}};
  const summary = view.eventTooltip.detailsFor(event, {collaboratorsNames: {bob: 'Bob'}});
  assert.equal(summary.rows.find(row => row.label === 'dateEnd').value, '2026-11-06');
  assert.equal(summary.rows.some(row => row.label === 'Time Zone'), false);
  assert.equal(summary.rows.find(row => row.label === 'collaborators').value, 'Bob');
  assert.equal(summary.rows.some(row => row.label === 'Attendees'), false);
});

test('admin tooltip setting prevents hover/focus details from opening or fetching records', async () => {
  const {view, config} = fixture('basicWeek');
  await view.fetchEvents('from', 'to', () => {});
  config.calendarPlusTooltipEnabled = false;
  let reads = 0;
  view.getModelFactory = () => ({create: async () => { reads++; return {fetch: async () => {}, get: () => undefined}; }});
  const element = new Element();
  view.registerEventElement({el: element, event: tooltipEvent()});
  view.eventTooltip.scheduleShow(element);
  await view.eventTooltip.show(element);
  assert.equal(view.eventTooltip.active == null, true);
  assert.equal(view.eventTooltip.pendingAnchor, null);
  assert.equal(reads, 0);
  config.calendarPlusTooltipEnabled = true;
  await view.eventTooltip.show(element);
  assert.equal(reads, 1);
  assert.equal(view.eventTooltip.active != null, true);
  view.eventTooltip.hide();
});

test('admin gradient setting defaults on for Week/Month and disabling it uses solid entity colors', async () => {
  for (const mode of ['basicWeek', 'month']) {
    const {view, config} = fixture(mode);
    await view.fetchEvents('from', 'to', () => {});
    view.colors = {Meeting: '#558BBD'};
    const element = new Element();
    const event = {extendedProps: {scope: 'Meeting', calendarUserIds: ['ann']}};
    view.registerEventElement({el: element, event});
    assert.equal(element.style.backgroundImage.includes('linear-gradient'), true);
    config.calendarPlusColorGradientEnabled = false;
    view.refreshEventGradients();
    assert.equal(element.style.backgroundImage, '');
    assert.equal(element.style.backgroundColor, '#558BBD');
    assert.equal(view.filteredEvent({scope: 'Meeting', calendarUserIds: ['ann']}).color, '#558BBD');
    config.calendarPlusColorGradientEnabled = true;
    view.refreshEventGradients();
    assert.equal(element.style.backgroundImage.includes('linear-gradient'), true);
  }
});


test('standard Month, Week, and Day calendars mount detailed tooltips and obey the global setting', async () => {
  for (const mode of ['month', 'agendaWeek', 'agendaDay']) {
    const {view, config} = fixture(mode);
    view.isCustomView = false;
    view.mode = mode;
    let reads = 0;
    view.getModelFactory = () => ({create: async () => ({
      fetch: async () => { reads++; }, get: name => ({assignedUserName: 'Ann', usersNames: {bob: 'Bob'}})[name],
    })});
    view.eventTooltip.cache.set('stale', Promise.resolve(null));
    await view.fetchEvents('from', 'to', () => {});
    assert.equal(view.baseFetched, true);
    assert.equal(view.eventTooltip.cache.size, 0);
    const hooks = view.calendar.options;
    const el = new Element();
    hooks.eventDidMount({el, event: tooltipEvent()});
    await view.eventTooltip.show(el);
    assert.equal(reads, 1);
    assert.equal(view.eventTooltip.active.panel.children[0].textContent, 'Planning <img src=x>');
    hooks.eventDragStart();
    assert.equal(view.eventTooltip.active, null);
    config.calendarPlusTooltipEnabled = false;
    await view.eventTooltip.show(el);
    assert.equal(view.eventTooltip.active, null);
    assert.equal(reads, 1);
    hooks.eventWillUnmount({el});
    assert.equal(view.eventTooltip.bindings.size, 0);
    assert.equal(view.eventAppearances.size, 0);
  }
});


test('tooltip delay defaults to one second, honors configuration, and cancels when leaving before it elapses', () => {
  let Tooltip;
  let nextId = 0;
  const pending = new Map();
  vm.runInNewContext(readFileSync(new URL('../../src/files/client/custom/modules/calendar-plus/src/views/calendar/event-tooltip.js', import.meta.url), 'utf8'), {
    define: (name, deps, factory) => { Tooltip = factory(); },
    setTimeout: (callback, delay) => { const id = ++nextId; pending.set(id, {callback, delay}); return id; },
    clearTimeout: id => pending.delete(id),
  });
  const config = {};
  const tooltip = new Tooltip({getConfig: () => ({get: name => config[name]})});
  const anchor = {};
  let shown = 0;
  tooltip.show = () => { shown++; };
  for (const [seconds, expected] of [[undefined, 1000], [null, 1000], [0, 0], [0.5, 500], [2, 2000], [-1, 1000], ['invalid', 1000], [100, 60000]]) {
    config.calendarPlusTooltipDelay = seconds;
    tooltip.scheduleShow(anchor);
    const timer = pending.get(tooltip.showTimer);
    assert.equal(timer.delay, expected);
    const previous = shown;
    tooltip.scheduleHide(anchor);
    assert.equal(pending.has(tooltip.showTimer), false);
    assert.equal(shown, previous);
    tooltip.scheduleShow(anchor);
    pending.get(tooltip.showTimer).callback();
    assert.equal(shown, previous + 1);
    tooltip.hide();
  }
  config.calendarPlusTooltipEnabled = false;
  tooltip.scheduleShow(anchor);
  assert.equal(pending.size, 0);
});


test('attendee indicators include all response statuses for users, contacts, and leads in Meeting and Call tooltips', async () => {
  for (const scope of ['Meeting', 'Call']) {
    const {view} = fixture('month');
    const record = {
      usersNames: {ann: 'Ann', bob: 'Bob', waiting: 'Waiting'},
      usersColumns: {ann: {status: 'Accepted'}, bob: {status: 'Declined'}, waiting: {status: 'None'}},
      contactsNames: {client: 'Client <b>name</b>'}, contactsColumns: {client: {status: 'Tentative'}},
      leadsNames: {lead: 'Lead', unknown: 'Unknown'}, leadsColumns: {unknown: {status: 'Unrecognized'}},
    };
    view.getModelFactory = () => ({create: async () => ({fetch: async () => {}, get: name => record[name]})});
    const event = tooltipEvent(scope);
    const details = await view.eventTooltip.loadDetails(event);
    assert.equal(details.usersColumns.ann.status, 'Accepted');
    const row = view.eventTooltip.detailsFor(event, details).rows.find(row => row.label === 'Attendees');
    assert.equal(row.value, 'Ann ✓, Bob ✕, Waiting ?, Client <b>name</b> ?, Lead ?, Unknown ?');
    assert.deepEqual(Array.from(row.participants, p => p.status), ['Accepted', 'Declined', 'None', 'Tentative', 'None', 'None']);
    assert.deepEqual(Array.from(row.participants, p => p.statusLabel), ['Accepted', 'Declined', 'No answer', 'Tentative', 'No answer', 'No answer']);
    const element = new Element();
    view.registerEventElement({el: element, event});
    await view.eventTooltip.show(element);
    const list = view.eventTooltip.active.panel.children[2];
    const attendees = list.children.find(child => child.className === 'cp-calendar-event-attendees');
    assert.equal(attendees.children.length, 6);
    assert.equal(attendees.children[3].children[0].textContent, 'Client <b>name</b>');
    assert.equal(attendees.children[3].children[1].getAttribute('aria-label'), 'Tentative');
    assert.equal(attendees.children[4].children[1].getAttribute('aria-label'), 'No answer');
    view.eventTooltip.hide();
  }
});

test('custom event attendee status columns get indicators while ordinary collaborators remain a plain list', () => {
  const {view} = fixture('month');
  const custom = tooltipEvent('CWorkshop');
  const details = {usersNames: {one: 'Same name', two: 'Same name'}, usersColumns: {one: {status: 'Accepted'}, two: {status: 'Tentative'}}};
  const row = view.eventTooltip.detailsFor(custom, details).rows.find(row => row.label === 'users');
  assert.equal(row.value, 'Same name ✓, Same name ?');
  assert.equal(row.participants.length, 2);
  const plain = view.eventTooltip.detailsFor(tooltipEvent('Task'), {collaboratorsNames: {bob: 'Bob'}}).rows.find(row => row.label === 'collaborators');
  assert.equal(plain.value, 'Bob');
  assert.equal(plain.participants, undefined);
});


test('Task tooltips omit calendar-user fallback and only show actual collaborators', async () => {
  const {view} = fixture('month');
  view.sharedUsers = [{id: 'ann', name: 'Ann'}];
  const event = tooltipEvent('Task');
  for (const details of [null, {}, {collaboratorsNames: {}}, {usersNames: {ann: 'Ann'}}]) {
    const summary = view.eventTooltip.detailsFor(event, details);
    assert.equal(summary.rows.some(row => ['Calendar users', 'Attendees', 'users', 'collaborators'].includes(row.label)), false);
  }
  const record = {assignedUserName: 'Ann', collaboratorsNames: {bob: 'Bob', maya: 'Maya'}};
  view.getModelFactory = () => ({create: async () => ({fetch: async () => {}, get: name => record[name]})});
  const details = await view.eventTooltip.loadDetails(event);
  assert.equal(details.collaboratorsNames.bob, 'Bob');
  const summary = view.eventTooltip.detailsFor(event, details);
  assert.equal(summary.rows.find(row => row.label === 'collaborators').value, 'Bob, Maya');
  assert.equal(summary.rows.find(row => row.label === 'assignedUser').value, 'Ann');
  assert.equal(summary.rows.some(row => row.label === 'Calendar users'), false);
});


test('shared Day initially scrolls to the configured hour after its empty loading placeholder', async () => {
  for (const hour of [0, 7, 9, 14]) {
    const {view} = fixture();
    view.scrollHour = hour;
    view.renderDayColumns();
    view.dayColumnsElement.scrollTop = 0;
    const create = view.createDayColumn.bind(view);
    view.createDayColumn = user => {
      create(user);
      const container = view.dayColumnsElement;
      container.scrollTop = 0;
      container.getBoundingClientRect = () => ({top: 100});
      container.querySelector = selector => {
        if (selector === 'section > div:first-child') return {getBoundingClientRect: () => ({height: 44})};
        assert.equal(selector, `[data-time="${String(hour).padStart(2, '0')}:00:00"]`);
        return {getBoundingClientRect: () => ({top: 100 + 44 + 80 + hour * 96 - container.scrollTop})};
      };
    };
    view.sharedUsers = [{id: 'ann', name: 'Ann'}, {id: 'bob', name: 'Bob'}];
    view.renderDayColumns();
    await Promise.resolve();
    assert.equal(view.dayColumnsElement.scrollTop, 80 + hour * 96);
    view.dayColumnsElement.scrollTop = 123;
    view.renderDayColumns();
    await Promise.resolve();
    assert.equal(view.dayColumnsElement.scrollTop, 123, 'refresh on the same date preserves manual scrolling');
    view.hiddenUserIds.add('bob');
    view.renderDayColumns();
    await Promise.resolve();
    assert.equal(view.dayColumnsElement.scrollTop, 123, 'changing visible people preserves manual scrolling');
    view.calendar.getDate = () => '2026-11-06';
    view.renderDayColumns();
    await Promise.resolve();
    assert.equal(view.dayColumnsElement.scrollTop, 80 + hour * 96, 'a new date uses the configured hour again');
  }
});

test('an explicit scroll hour takes priority over automatic scrolling toward the current time', () => {
  const {view} = fixture('agendaWeek');
  for (const hour of [0, 9, 14]) {
    view.scrolledToNow = false;
    view.getPreferences = () => ({get: () => hour});
    view.handleScrollToNow();
    assert.equal(view.scrolledToNow, false);
  }
  view.getPreferences = () => ({get: () => null});
  view.handleScrollToNow();
  assert.equal(view.scrolledToNow, true);
});


test('empty attendee lists still add the dropped person without changing the assignee', async () => {
  const {view, record, saves} = personDropFixture('basicWeek');
  record.usersIds = [];
  await view.fetchEvents('from', 'to', () => {});
  assert.equal(await view.dropEventOnPerson(draggedEvent(), 'bob'), true);
  assert.deepEqual(Array.from(record.usersIds), ['bob']);
  assert.equal(record.assignedUserId, 'ann');
  assert.equal(saves[0].attributes.assignedUserId, undefined);
});

test('entities without attendee or collaborator fields reassign the event instead', async () => {
  for (const scope of ['CAppointment', 'CWorkBlock']) {
    const {view, record, saves, fields} = personDropFixture('basicWeek');
    delete fields.users;
    delete record.usersIds;
    await view.fetchEvents('from', 'to', () => {});
    const event = draggedEvent();
    event.extendedProps.scope = scope;
    assert.equal(await view.dropEventOnPerson(event, 'bob'), true);
    assert.deepEqual(JSON.parse(JSON.stringify(saves[0].attributes)), {assignedUserId: 'bob'});
    assert.equal(record.assignedUserId, 'bob');
    assert.equal(record.usersIds, undefined);
  }
});

test('attendee drops support Meetings, Calls, and custom event attendee fields even with a read-only assignee', async () => {
  for (const scope of ['Meeting', 'Call', 'CWorkshop']) {
    const {view, record, fields} = personDropFixture('basicWeek');
    fields.assignedUser.readOnly = true;
    await view.fetchEvents('from', 'to', () => {});
    const event = draggedEvent();
    event.extendedProps.scope = scope;
    assert.equal(await view.dropEventOnPerson(event, 'bob'), true);
    assert.equal(record.assignedUserId, 'ann');
    assert.deepEqual(Array.from(record.usersIds), ['guest', 'bob']);
  }
});

test('dropping onto an existing attendee does not duplicate them or reset their response', async () => {
  const {view, record, saves} = personDropFixture('basicWeek');
  record.usersIds = ['guest', 'bob'];
  record.usersColumns.bob = {status: 'Declined'};
  await view.fetchEvents('from', 'to', () => {});
  assert.equal(await view.dropEventOnPerson(draggedEvent(), 'bob'), true);
  assert.equal(saves.length, 0);
  assert.deepEqual(record.usersIds, ['guest', 'bob']);
  assert.equal(record.usersColumns.bob.status, 'Declined');
  assert.equal(record.assignedUserId, 'ann');
});

test('unreadable or non-editable attendee lists reject the drop without falling back to reassignment', async () => {
  for (const mode of ['readOnly', 'acl', 'missing']) {
    const {view, record, saves, fields} = personDropFixture('basicWeek');
    if (mode === 'readOnly') fields.users.readOnly = true;
    if (mode === 'acl') view.getAcl = () => ({checkModel: () => true, checkField: (scope, field) => field !== 'users'});
    if (mode === 'missing') delete record.usersIds;
    await view.fetchEvents('from', 'to', () => {});
    let reverted = false;
    assert.equal(await view.dropEventOnPerson(draggedEvent(), 'bob', {revert: () => { reverted = true; }}), false);
    assert.equal(reverted, true);
    assert.equal(saves.length, 0);
    assert.equal(record.assignedUserId, 'ann');
  }
});


test('Task and custom event drops append collaborators when there is no attendee field', async () => {
  for (const scope of ['Task', 'CWorkSession']) for (const current of [[], ['existing']]) {
    const {view, record, saves, fields} = personDropFixture('basicWeek');
    delete fields.users;
    fields.collaborators = {type: 'linkMultiple'};
    record.collaboratorsIds = [...current];
    await view.fetchEvents('from', 'to', () => {});
    const event = draggedEvent();
    event.extendedProps.scope = scope;
    view.startPersonDropDrag({event}, view.calendar);
    assert.equal(view.legendButtons.get('bob').button.title.includes('Drop to add collaborator'), true);
    view.finishPersonDropDrag();
    assert.equal(await view.dropEventOnPerson(event, 'bob'), true);
    assert.deepEqual(Array.from(record.collaboratorsIds), [...current, 'bob']);
    assert.equal(record.assignedUserId, 'ann');
    assert.equal(saves[0].attributes.assignedUserId, undefined);
    assert.equal(saves[0].attributes.usersIds, undefined);
    assert.deepEqual(record.usersIds, ['guest']);
  }
});

test('attendees take priority when the entity also supports collaborators', async () => {
  const {view, record, saves, fields} = personDropFixture('basicWeek');
  fields.collaborators = {type: 'linkMultiple'};
  record.collaboratorsIds = ['coworker'];
  await view.fetchEvents('from', 'to', () => {});
  await view.dropEventOnPerson(draggedEvent(), 'bob');
  assert.deepEqual(Array.from(record.usersIds), ['guest', 'bob']);
  assert.deepEqual(record.collaboratorsIds, ['coworker']);
  assert.equal(saves[0].attributes.collaboratorsIds, undefined);
  assert.equal(record.assignedUserId, 'ann');
});

test('Day collaborator drops save participants and time together and avoid duplicating existing collaborators', async () => {
  const {view, record, saves, fields} = personDropFixture();
  delete fields.users;
  fields.collaborators = {type: 'linkMultiple'};
  record.collaboratorsIds = ['existing'];
  await view.fetchEvents('from', 'to', () => {});
  const original = draggedEvent();
  const moved = draggedEvent({start: new Date('2026-11-04T11:00:00Z')});
  moved.extendedProps.scope = 'Task';
  assert.equal(await view.dropEventOnPerson(moved, 'bob', {moveTime: true, originalEvent: original}), true);
  assert.deepEqual(JSON.parse(JSON.stringify(saves[0].attributes)), {
    collaboratorsIds: ['existing', 'bob'], dateStart: '2026-11-04 11:00:00', dateEnd: '2026-11-04 12:00:00',
  });
  assert.equal(record.assignedUserId, 'ann');
  assert.equal(await view.dropEventOnPerson(moved, 'bob'), true);
  assert.equal(saves.length, 1);
  assert.deepEqual(Array.from(record.collaboratorsIds), ['existing', 'bob']);
});

test('collaborator permission failures never fall back to reassignment', async () => {
  for (const mode of ['readOnly', 'acl', 'missing']) {
    const {view, record, saves, fields} = personDropFixture('basicWeek');
    delete fields.users;
    fields.collaborators = {type: 'linkMultiple'};
    record.collaboratorsIds = [];
    if (mode === 'readOnly') fields.collaborators.readOnly = true;
    if (mode === 'acl') view.getAcl = () => ({checkModel: () => true, checkField: (scope, name) => name !== 'collaborators'});
    if (mode === 'missing') delete record.collaboratorsIds;
    await view.fetchEvents('from', 'to', () => {});
    let reverted = false;
    assert.equal(await view.dropEventOnPerson(draggedEvent(), 'bob', {revert: () => { reverted = true; }}), false);
    assert.equal(reverted, true);
    assert.equal(saves.length, 0);
    assert.equal(record.assignedUserId, 'ann');
  }
});


test('Day, Week, and Month resolve inactive members only for the selected view when its top-level toggle is enabled', async () => {
  for (const mode of ['basicDay', 'basicWeek', 'month']) {
    const {view, calls} = fixture(mode);
    const values = {calendarViewDataList: [{id: 'saved', name: 'Demo', mode}],
      calendarPlusViewSettings: {'view:saved': {showInactiveUsers: true}}};
    view.getPreferences = () => ({get: key => values[key]});
    await view.fetchEvents('from', 'to', () => {});
    assert.equal(calls[0].body.includeInactiveUsers, true);
    values.calendarPlusViewSettings['view:saved'].showInactiveUsers = false;
    await view.fetchEvents('from', 'to', () => {});
    assert.equal(calls[2].body.includeInactiveUsers, undefined);
  }
});


test('static Day, Week, and Month use only captured IDs while inactive visibility stays independent', async () => {
  for (const mode of ['basicDay', 'basicWeek', 'month']) {
    const {view, espo} = fixture(mode);
    const item = {id: 'saved', name: 'Static view', mode, teamIdList: ['changed-team'], userIdList: ['new-user'], membershipMode: 'static', staticUserIdList: ['ann', 'former']};
    const values = {calendarViewDataList: [item], calendarPlusViewSettings: {'view:saved': {showInactiveUsers: false}}};
    view.getPreferences = () => ({get: key => values[key]});
    const calls = [];
    espo.Ajax.postRequest = async (url, body) => {
      calls.push(body);
      const all = body.userIdList.map(id => ({id, name: id}));
      return {users: body.includeInactiveUsers ? all : all.filter(u => u.id !== 'former')};
    };
    await view.fetchEvents('from', 'to', () => {});
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {teamIdList: [], userIdList: ['ann', 'former']});
    assert.deepEqual(Array.from(view.sharedUsers, u => u.id), ['ann']);
    values.calendarPlusViewSettings['view:saved'].showInactiveUsers = true;
    item.teamIdList = ['another-team'];
    await view.fetchEvents('from', 'to', () => {});
    assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), {teamIdList: [], userIdList: ['ann', 'former'], includeInactiveUsers: true});
    assert.deepEqual(Array.from(view.sharedUsers, u => u.id), ['ann', 'former']);
    item.staticUserIdList = [];
    await view.fetchEvents('from', 'to', () => {});
    assert.deepEqual(Array.from(view.sharedUsers), []);
  }
});


test('completed and canceled shared events shade both gradient colors and solid day colors', async () => {
  for (const mode of ['basicDay', 'basicWeek', 'month']) {
    const {view} = fixture(mode);
    await view.fetchEvents('from', 'to', () => {});
    view.sharedEvents = [];
    view.colors = {Meeting: '#558BBD'};
    view.getEventTypeCompletedStatusList = () => ['Held'];
    view.getEventTypeCanceledStatusList = () => ['Not Held'];
    const shades = [];
    view.shadeColor = (color, amount) => { shades.push([color, amount]); return `faded(${color})`; };
    for (const status of ['Held', 'Not Held', 'Planned']) {
      const record = {scope: 'Meeting', status};
      const ended = status !== 'Planned';
      const person = view.colorForUser('ann');
      const color = view.colorForEvent(record, 'ann');
      const gradient = view.usePersonGradient();
      assert.equal(color, ended ? `faded(${gradient ? person : '#558BBD'})` : gradient ? person : '#558BBD');
      const element = new Element();
      view.paintEventGradient(element, {display: 'auto', extendedProps: {...record, calendarUserIds: ['ann']}}, 'ann');
      assert.equal(element.style.backgroundColor, color);
      assert.equal(element.style.borderColor, color);
      if (gradient) {
        assert.equal(element.style.backgroundImage.includes(ended ? 'faded(#558BBD)' : '#558BBD'), true);
        assert.equal(element.style.backgroundImage.includes(ended ? `faded(${person})` : person), true);
      } else assert.equal(element.style.backgroundImage, '');
    }
    assert.equal(shades.every(([, amount]) => amount === 0.4), true);
  }
});
