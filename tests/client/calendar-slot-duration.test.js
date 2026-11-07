import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);

const read = (path) => readFileSync(new URL(path, root), 'utf8');

const internal = vm.runInNewContext(
  read('site/client/modules/crm/lib/original/fullcalendar.js') + '; FullCalendar.Internal',
  { setTimeout, clearTimeout },
);
// Exercise EspoCRM's actual renderer rather than duplicating its duration formatting.
const core = read('site/client/modules/crm/src/views/calendar/calendar.js');
const method = core.slice(
  core.indexOf('    afterRender() {'),
  core.indexOf('    handleScrollToNow() {'),
);

function fixture(minutes, mode, fail = false) {
  let options;
  let render;
  const scheduled = [];
  const fullCalendar = {
    Calendar: class {
      constructor(element, value) {
        options = value;
      }

      render() {
        const slot = internal.createDuration(options.slotDuration);
        assert.ok(slot, 'FullCalendar must parse the slot duration');
        assert.equal(slot.milliseconds, Number(minutes) * 60000);
      }
    },
  };
  const Base = vm.runInNewContext('(class {' + method + '})', {
    FullCalendar: fullCalendar,
    setTimeout: (callback) => {
      if (fail) throw new Error('render failure');

      scheduled.push(callback);
    },
  });
  vm.runInNewContext(
    read('src/files/client/custom/modules/calendar-plus/src/views/calendar/calendar.js'),
    {
      define: (name, deps, factory) => {
        render = factory(Base, fullCalendar, {}, class {}, { viewSettings: () => ({}) });
      },
    },
  );
  const view = new render();
  Object.assign(view, {
    slotDuration: minutes,
    scrollHour: 8,
    options: { height: 600 },
    viewMode: mode,
    modeViewMap: { agendaDay: 'timeGridDay', agendaWeek: 'timeGridWeek' },
    date: '2026-11-05',
    colors: { '': '#558BBD' },
    rangeSeparator: ' – ',
    $el: { find: () => ({ get: () => ({}) }) },
    getDateTime: () => ({ timeFormat: 'HH:mm', weekStart: 1, timeZone: 'America/Denver' }),
    getPreferences: () => ({}),
    applyViewSettings() {},
    handleScrollToNow() {},
    updateDate() {},
  });

  return { view, scheduled, options: () => options };
}

test('native Day and Week rendering accepts 5, 10, 15, and 30 minute slots and preserves numeric preferences', () => {
  for (const mode of ['agendaDay', 'agendaWeek'])
    for (const minutes of [5, 10, 15, 30]) {
      const { view, scheduled, options } = fixture(minutes, mode);
      view.afterRender();
      assert.equal(view.slotDuration, minutes);
      for (const callback of scheduled) callback();
      assert.equal(options().slotDuration, `00:${String(minutes).padStart(2, '0')}:00`);
      assert.equal(options().snapDuration, minutes * 60000);
    }
});

test('a render failure does not leave the slot duration preference converted to a string', () => {
  const { view } = fixture(5, 'agendaDay', true);
  assert.throws(() => view.afterRender(), /render failure/);
  assert.equal(view.slotDuration, 5);
});
