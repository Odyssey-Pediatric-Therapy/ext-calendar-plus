// Compatibility for callers using the original timeline editor module.
define('more-timelines:views/calendar/modals/timeline', ['more-timelines:views/calendar/modals/calendar'], CalendarModal => {
  return class extends CalendarModal {
    constructor(options = {}) {
      super({...options, calendar: options.timeline ? {...options.timeline, source: 'timeline', mode: 'timeline'} : null});
    }
  };
});
