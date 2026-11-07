import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const core = read('site/client/modules/crm/src/views/calendar/calendar.js');
const start = core.indexOf('    selectMode(mode) {');
const method = core.slice(start, core.indexOf('    /**', start));
const Native = vm.runInNewContext(`(class {${method}})`);
let Calendar;
vm.runInNewContext(
  read('src/files/client/custom/modules/calendar-plus/src/views/calendar/calendar.js'),
  {
    define: (name, deps, factory) => {
      Calendar = factory(Native, {}, {}, class {}, {}, {});
    },
  },
);

function fixture({ mode = 'agendaWeek', nativeFetch = false } = {}) {
  const view = new Calendar();
  const calls = { fetches: 0, settings: 0, changes: [] };
  Object.assign(view, {
    mode,
    requestRevision: 3,
    fullCalendarModeList: ['agendaWeek', 'agendaDay', 'month'],
    modeViewMap: { agendaWeek: 'timeGridWeek', agendaDay: 'timeGridDay', month: 'dayGridMonth' },
    setupMode() {
      this.viewMode = this.mode;
    },
    updateDate() {},
    hasView: () => false,
    $el: { find: () => ({ addClass() {}, removeClass() {} }) },
    trigger: (...args) => calls.changes.push(args),
    applyViewSettings() {
      calls.settings++;
    },
  });
  view.calendar = {
    changeView() {
      if (nativeFetch) {
        calls.fetches++;
        view.requestRevision++;
      }
    },
    refetchEvents() {
      calls.fetches++;
      view.requestRevision++;
    },
  };
  return { view, calls };
}

test('native Week to Day switches request fresh events when FullCalendar reuses its cached range', () => {
  const { view, calls } = fixture();
  view.selectMode('agendaDay');
  assert.equal(view.mode, 'agendaDay');
  assert.equal(calls.settings, 1);
  assert.equal(calls.fetches, 1);
});

test('view switches do not duplicate a fetch already started by the native calendar', () => {
  const { view, calls } = fixture({ nativeFetch: true });
  view.selectMode('agendaDay');
  assert.equal(calls.fetches, 1);
});

test('reselecting the same view does not fetch and routed custom views leave loading to the new view', () => {
  const current = fixture();
  current.view.selectMode('agendaWeek');
  assert.equal(current.calls.fetches, 0);
  const routed = fixture({ mode: 'view-week' });
  routed.view.selectMode('view-day');
  assert.equal(routed.calls.fetches, 0);
  assert.deepEqual(routed.calls.changes[0], ['change:mode', 'view-day', true]);
});
