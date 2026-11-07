define('calendar-plus:views/calendar/modals/settings', [
  'views/modal', 'model', 'views/record/edit-for-modal', 'views/fields/bool', 'views/fields/enum', 'views/fields/varchar',
  'calendar-plus:calendar-definitions',
], (Modal, Model, Record, Bool, Enum, Varchar, Definitions) => {
  return class extends Modal {
    className = 'dialog dialog-record';
    templateContent = '<div class="record-container no-side-margin">{{{record}}}</div>';

    setup() {
      this.on('remove', () => { this.settingsRemoved = true; });
      this.headerText = this.translate('Calendar Settings', 'labels', 'Calendar');
      this.buttonList = [
        {name: 'save', label: 'Save', style: 'primary', onClick: () => this.actionSave()},
        {name: 'cancel', label: 'Cancel', onClick: () => this.close()},
      ];
      const parent = this.options.calendar;
      const preferences = this.getPreferences();
      const stored = Definitions.viewSettings(preferences, this.options.mode);
      this.model = new Model({
        showInactiveUsers: stored.showInactiveUsers === true,
        showWeekends: stored.showWeekends !== false,
        slotDuration: String(stored.slotDuration ?? (preferences.get('calendarSlotDuration') || parent.baseSlotDuration || 30)),
        scrollHour: String(stored.scrollHour ?? preferences.get('calendarScrollHour') ?? parent.scrollHour ?? 6),
        visibleTimeStart: (Definitions.timeRange(stored)?.start || '00:00:00').slice(0, 5),
        visibleTimeEnd: (Definitions.timeRange(stored)?.end || '24:00:00').slice(0, 5),
        showGradient: stored.showGradient !== false,
        showTooltips: stored.showTooltips !== false,
        eventTextSize: ['small', 'large'].includes(stored.eventTextSize)
          ? stored.eventTextSize
          : 'medium',
        dayBoundary: ['strong', 'black'].includes(stored.dayBoundary)
          ? stored.dayBoundary
          : 'subtle',
        timelineRowHeight: ['compact', 'spacious'].includes(stored.timelineRowHeight)
          ? stored.timelineRowHeight
          : 'comfortable',
        showDeclinedEvents: stored.showDeclinedEvents !== false,
        showCanceledEvents: stored.showCanceledEvents !== false,
        rememberHiddenPeople: stored.rememberHiddenPeople !== false,
        tooltipAttendees: stored.tooltipAttendees !== false,
        tooltipAssignee: stored.tooltipAssignee !== false,
        tooltipLocation: stored.tooltipLocation !== false,
        tooltipStatus: stored.tooltipStatus !== false,
      });
      this.model.name = 'CalendarViewSettings';

      const sections = [
        { name: 'display', label: 'Display', rows: [] },
        { name: 'timeRange', label: 'Time Range', rows: [] },
        { name: 'people', label: 'People and Events', rows: [] },
        { name: 'tooltips', label: 'Tooltips', rows: [] },
      ];

      const sectionFields = {
        timeRange: ['visibleTimeStart', 'visibleTimeEnd', 'slotDuration', 'scrollHour'],
        people: [
          'showInactiveUsers',
          'showDeclinedEvents',
          'showCanceledEvents',
          'rememberHiddenPeople',
        ],
        tooltips: [
          'showTooltips',
          'tooltipAttendees',
          'tooltipAssignee',
          'tooltipLocation',
          'tooltipStatus',
        ],
      };

      this.settingNames = [];
      const add = (name, label, Field = Bool, params = {}) => {
        this.settingNames.push(name);

        const sectionName =
          Object.keys(sectionFields).find((key) => sectionFields[key].includes(name)) || 'display';

        const section = sections.find((item) => item.name === sectionName);

        section.rows.push([{view: new Field({name, labelText: this.translate(label, 'labels', 'Calendar'), params})}, false]);
      };
      if (this.options.inactiveUsersAvailable) add('showInactiveUsers', 'Show inactive users');
      add('showWeekends', 'Show weekends');
      const mode = Definitions.normalizeMode(parent.viewMode || parent.mode);
      if (['agendaDay', 'agendaWeek', 'timeline'].includes(mode)) {
        add('visibleTimeStart', 'Show from', Varchar, {required: true, maxLength: 5});
        add('visibleTimeEnd', 'Show until', Varchar, {required: true, maxLength: 5});
      }
      if (['agendaDay', 'agendaWeek'].includes(mode)) {
        add('slotDuration', 'Time slot duration', Enum, {required: true, options: ['5', '10', '15', '30'],
          translatedOptions: Object.fromEntries([5, 10, 15, 30].map(n => [String(n), `${n} min`]))});
        add('scrollHour', 'Scroll to hour', Enum, {required: true,
          options: Array.from({length: 24}, (_, hour) => String(hour)),
          translatedOptions: Object.fromEntries(Array.from({length: 24}, (_, hour) => [String(hour), `${String(hour).padStart(2, '0')}:00`]))});
      }
      if (['agendaWeek', 'month'].includes(mode) && this.getConfig().get('calendarPlusColorGradientEnabled') !== false) {
        add('showGradient', 'Show color gradient');
      }

      const choice = (name, label, options) =>
        add(name, label, Enum, {
          required: true,
          options,
          translatedOptions: Object.fromEntries(
            options.map((value) => [value, this.translate(value, 'labels', 'Calendar')]),
          ),
        });

      choice('eventTextSize', 'Event text size', ['small', 'medium', 'large']);

      add('showDeclinedEvents', 'Show declined events');

      add('showCanceledEvents', 'Show canceled events');

      if (this.options.inactiveUsersAvailable && mode !== 'timeline') add('rememberHiddenPeople', 'Remember hidden people');

      if (mode === 'timeline') {
        choice('dayBoundary', 'Day boundary contrast', ['subtle', 'strong', 'black']);
        choice('timelineRowHeight', 'Timeline row spacing', ['compact', 'comfortable', 'spacious']);
      }

      if (this.getConfig().get('calendarPlusTooltipEnabled') !== false) {
        add('showTooltips', 'Show tooltips');
        add('tooltipAttendees', 'Tooltip attendees');
        add('tooltipAssignee', 'Tooltip assignee');
        add('tooltipLocation', 'Tooltip location');
        add('tooltipStatus', 'Tooltip status');
      }

      const detailLayout = sections
        .filter((section) => section.rows.length)
        .map((section) => ({
          name: section.name,
          label: this.translate(section.label, 'labels', 'Calendar'),
          rows: section.rows,
        }));

      this.recordView = new Record({ model: this.model, detailLayout });

      this.assignView('record', this.recordView);
    }

    async actionSave() {
      if (this.saving) return;
      const data = this.recordView.processFetch();
      if (this.recordView.validate()) return;
      const values = Object.fromEntries(this.settingNames.map(name => [name,
        ['slotDuration', 'scrollHour'].includes(name) ? Number(data[name]) :
          ['visibleTimeStart', 'visibleTimeEnd'].includes(name) ? data[name]?.trim() : ['eventTextSize', 'dayBoundary', 'timelineRowHeight'].includes(name)
                ? data[name]
                : data[name] === true]));
      if (values.slotDuration != null && ![5, 10, 15, 30].includes(values.slotDuration) ||
          values.scrollHour != null && (!Number.isInteger(values.scrollHour) || values.scrollHour < 0 || values.scrollHour > 23)) return;
      if (this.settingNames.includes('visibleTimeStart')) {
        const range = Definitions.timeRange(values);
        if (!range) {
          Espo.Ui.error(this.translate('Invalid visible time range', 'messages', 'Calendar'));
          return;
        }
        values.visibleTimeStart = range.start.slice(0, 5);
        values.visibleTimeEnd = range.end.slice(0, 5);
      }

      for (const [name, options] of Object.entries({
        eventTextSize: ['small', 'medium', 'large'],
        dayBoundary: ['subtle', 'strong', 'black'],
        timelineRowHeight: ['compact', 'comfortable', 'spacious'],
      })) {
        if (this.settingNames.includes(name) && !options.includes(values[name])) return;
      }

      const preferences = this.getPreferences();
      const previous = preferences.get('calendarPlusViewSettings');
      const key = Definitions.viewSettingsKey(preferences, this.options.mode);
      const next = {...(previous || {}), [key]: {...(previous?.[key] || {}), ...values}};
      this.saving = true;
      this.disableButton('save');
      try {
        await preferences.save({calendarPlusViewSettings: next}, {patch: true, wait: true});
      } catch (error) {
        preferences.set('calendarPlusViewSettings', previous);
        if (!this.settingsRemoved) {
          Espo.Ui.error(this.translate('Could not save view settings', 'messages', 'Calendar'));
          this.enableButton('save');
        }
        return;
      } finally { this.saving = false; }
      if (this.settingsRemoved) return;
      const parent = this.options.calendar;
      if (!parent.sharedRemoved && !parent.removed) {
        parent.applyViewSettings?.(true);
        parent.actionRefresh();
      }
      this.close();
    }
  };
});
