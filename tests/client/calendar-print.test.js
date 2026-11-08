import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const root = new URL('../../src/files/client/custom/modules/calendar-plus/', import.meta.url);
const source = readFileSync(new URL('src/calendar-print.js', root), 'utf8');

function fixture({ blocked = false, fail = false } = {}) {
  let Printer;
  const events = [];
  const errors = [];
  const previews = [];
  const timers = [];
  const attributes = {};
  const action = {
    setAttribute: (name, value) => {
      attributes[name] = value;
    },
    removeAttribute: (name) => {
      delete attributes[name];
    },
  };
  const element = {
    isConnected: true,
    querySelector: (selector) =>
      selector.includes('printCalendar') ? action : { textContent: 'November 2026' },
  };
  const state = { fail };
  const espo = {
    loader: {
      requirePromise: async (name) => {
        events.push(name);
        if (state.fail) throw new Error('Library unavailable');
        return {};
      },
    },
    Ui: { error: (message) => errors.push(message) },
  };
  const downloads = [];
  const doc = {
    body: { append() {} },
    createElement: () => {
      const link = { click: () => downloads.push(link), remove() {} };
      return link;
    },
  };
  vm.runInNewContext(source, {
    define: (name, dependencies, factory) => {
      Printer = factory();
    },
    Espo: espo,
    window: {
      open: () => {
        events.push('open');
        if (blocked) return null;
        const preview = {
          document: { body: {} },
          location: {
            replace: (url) => {
              preview.url = url;
            },
          },
          close: () => {
            preview.closed = true;
          },
        };
        previews.push(preview);
        return preview;
      },
    },
    document: doc,
    Blob,
    URL: {
      createObjectURL: () => 'blob:calendar',
      revokeObjectURL: (url) => events.push(`revoke:${url}`),
    },
    setTimeout: (callback) => {
      timers.push(callback);
    },
  });
  const printer = new Printer({ el: element, translate: (text) => text }, 'Team / Week');
  printer.capture = async () => {
    events.push('capture');
    return {};
  };
  printer.createPdf = async () => {
    events.push('pdf');
    return new Uint8Array([1, 2]);
  };
  return {
    Printer,
    printer,
    events,
    errors,
    previews,
    downloads,
    timers,
    attributes,
    state,
    element,
  };
}

test('Print calendar opens its tab before asynchronous work and opens the PDF without changing the calendar', async () => {
  const f = fixture();
  const run = f.printer.run();
  await f.printer.run();
  await run;
  assert.equal(f.events[0], 'open');
  assert.equal(f.events.filter((value) => value === 'capture').length, 1);
  assert.equal(f.previews[0].url, 'blob:calendar');
  assert.equal(f.previews[0].opener, null);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.errors.length, 0);
  assert.equal(f.printer.busy, false);
  assert.equal(f.attributes['aria-disabled'], undefined);
  f.timers[0]();
  assert.equal(f.events.at(-1), 'revoke:blob:calendar');
});

test('blocked preview tabs fall back to a safely named PDF download', async () => {
  const f = fixture({ blocked: true });
  await f.printer.run();
  assert.equal(f.downloads.length, 1);
  assert.equal(f.downloads[0].href, 'blob:calendar');
  assert.equal(f.downloads[0].download, 'Team - Week — November 2026.pdf');
  assert.equal(f.errors.length, 0);
});

test('failed print libraries close the empty tab, reset controls, and can be retried', async () => {
  const f = fixture({ fail: true });
  await f.printer.run();
  assert.equal(f.previews[0].closed, true);
  assert.equal(f.errors.length, 1);
  assert.equal(f.printer.busy, false);
  assert.equal(f.attributes['aria-disabled'], undefined);
  f.state.fail = false;
  await f.printer.run();
  assert.equal(f.previews[1].url, 'blob:calendar');
});

test('closing a print preview or removing the calendar cancels without opening a PDF', async () => {
  const f = fixture();
  const run = f.printer.run();
  f.previews[0].closed = true;
  await run;
  assert.equal(f.events.includes('capture'), false);
  assert.equal(f.printer.busy, false);
  f.element.isConnected = false;
  await f.printer.run();
  assert.equal(f.previews.length, 1);
});

test('the bundled pdf-lib produces a real one-page A4 PDF with calendar metadata', async () => {
  const context = { setTimeout, clearTimeout, Uint8Array, ArrayBuffer };
  context.window = context;
  const realm = vm.createContext(context);
  vm.runInContext(readFileSync(new URL('lib/pdf-lib.min.js', root), 'utf8'), realm);
  context.define = (name, dependencies, factory) => {
    context.Printer = factory();
  };
  vm.runInContext(source, realm);
  const printer = new context.Printer({}, 'Calendar');
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
  for (const landscape of [false, true]) {
    const bytes = await printer.createPdf(
      { width: landscape ? 1200 : 600, height: 800, toDataURL: () => png },
      context.PDFLib,
      'Team calendar – November 2026',
    );
    assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
    const pdf = await context.PDFLib.PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
    assert.equal(pdf.getTitle(), 'Team calendar – November 2026');
    assert.equal(pdf.getCreator(), 'Calendar Plus');
    const page = pdf.getPages()[0];
    assert.equal(page.getWidth() > page.getHeight(), landscape);
    assert.ok(page.getWidth() >= 595 && page.getWidth() <= 842);
  }
});

test('the options menu routes click and keyboard print to the active calendar', () => {
  let Buttons;
  const parent = {};
  let calls = 0;
  class Printer {
    constructor(view, name) {
      assert.equal(view, parent);
      assert.equal(name, 'Team week');
    }
    run() {
      calls++;
    }
  }
  vm.runInNewContext(readFileSync(new URL('src/views/calendar/mode-buttons.js', root), 'utf8'), {
    define: (name, deps, factory) => {
      Buttons = factory(class {}, {}, Printer);
    },
  });
  const buttons = new Buttons();
  buttons.getCalendarParentView = () => parent;
  buttons.data = () => ({ selectedModeLabel: 'Team week' });
  const event = { preventDefault() {}, stopPropagation() {} };
  buttons.events['click [data-action="printCalendar"]'].call(buttons, event);
  for (const key of ['Enter', ' ', 'Escape']) {
    buttons.events['keydown [data-action="printCalendar"]'].call(buttons, { ...event, key });
  }
  assert.equal(calls, 3);
});
