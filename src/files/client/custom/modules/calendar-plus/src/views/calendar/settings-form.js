define('calendar-plus:views/calendar/settings-form', [
  'views/fields/bool',
  'views/fields/enum',
  'views/fields/varchar',
  'calendar-plus:calendar-definitions',
], (Bool, Enum, Varchar, Definitions) => {
  // Shared by the calendar editor and the settings form; preferences stay keyed by calendar ID.
  return class {
    constructor(view) {
      this.view = view;
    }

    translate(...args) {
      return this.view.translate(...args);
    }

    getPreferences() {
      return this.view.getPreferences();
    }

    getConfig() {
      return this.view.getConfig();
    }

    defaults(routeMode, parent = {}) {
      const preferences = this.getPreferences();
      const stored = Definitions.viewSettings(preferences, routeMode);
      return {
        showInactiveUsers: stored.showInactiveUsers === true,
        showWeekends: stored.showWeekends !== false,
        slotDuration: String(
          stored.slotDuration ??
            (preferences.get('calendarSlotDuration') || parent.baseSlotDuration || 30),
        ),
        scrollHour: String(
          stored.scrollHour ?? preferences.get('calendarScrollHour') ?? parent.scrollHour ?? 6,
        ),
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
        showCompletedEvents: stored.showCompletedEvents !== false,
        rememberHiddenPeople: stored.rememberHiddenPeople !== false,
        tooltipAttendees: stored.tooltipAttendees !== false,
        tooltipAssignee: stored.tooltipAssignee !== false,
        tooltipLocation: stored.tooltipLocation !== false,
        tooltipStatus: stored.tooltipStatus !== false,
      };
    }

    layout(mode, inactiveUsersAvailable, allModes = false) {
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
          'showCompletedEvents',
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

        section.rows.push([
          {
            view: new Field({
              name,
              labelText: this.translate(label, 'labels', 'Calendar'),
              params,
            }),
          },
          false,
        ]);
      };

      if (inactiveUsersAvailable) add('showInactiveUsers', 'Show inactive users');

      add('showWeekends', 'Show weekends');

      if (allModes || ['agendaDay', 'agendaWeek', 'timeline'].includes(mode)) {
        add('visibleTimeStart', 'Show from', Varchar, { required: true, maxLength: 5 });
        add('visibleTimeEnd', 'Show until', Varchar, { required: true, maxLength: 5 });
      }

      if (allModes || ['agendaDay', 'agendaWeek'].includes(mode)) {
        add('slotDuration', 'Time slot duration', Enum, {
          required: true,
          options: ['5', '10', '15', '30'],
          translatedOptions: Object.fromEntries(
            [5, 10, 15, 30].map((n) => [String(n), `${n} min`]),
          ),
        });
        add('scrollHour', 'Scroll to hour', Enum, {
          required: true,
          options: Array.from({ length: 24 }, (_, hour) => String(hour)),
          translatedOptions: Object.fromEntries(
            Array.from({ length: 24 }, (_, hour) => [
              String(hour),
              `${String(hour).padStart(2, '0')}:00`,
            ]),
          ),
        });
      }

      if (
        (allModes || ['agendaWeek', 'month'].includes(mode)) &&
        this.getConfig().get('calendarPlusColorGradientEnabled') !== false
      ) {
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
      add('showCompletedEvents', 'Show completed events');

      if (inactiveUsersAvailable && (allModes || mode !== 'timeline'))
        add('rememberHiddenPeople', 'Remember hidden people');

      if (allModes || mode === 'timeline') {
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
          rows: section.rows.reduce((rows, [field], index) => {
            // Keep the tooltip switch separate from its two-column detail options.
            const columnIndex = section.name === 'tooltips' ? index - 1 : index;

            if (columnIndex < 0 || columnIndex % 2 === 0) rows.push([field, false]);
            else rows[rows.length - 1][1] = field;

            return rows;
          }, []),
        }));

      return detailLayout;
    }

    modesForField(name) {
      if (['visibleTimeStart', 'visibleTimeEnd'].includes(name))
        return ['agendaDay', 'agendaWeek', 'timeline'];
      if (['slotDuration', 'scrollHour'].includes(name)) return ['agendaDay', 'agendaWeek'];
      if (name === 'showGradient') return ['agendaWeek', 'month'];
      if (['dayBoundary', 'timelineRowHeight'].includes(name)) return ['timeline'];
      if (name === 'rememberHiddenPeople') return ['agendaDay', 'agendaWeek', 'month'];
      return ['agendaDay', 'agendaWeek', 'month', 'timeline'];
    }

    namesForMode(mode) {
      return this.settingNames.filter((name) => this.modesForField(name).includes(mode));
    }

    dynamicLogicDefs() {
      const visible = (modes) => ({
        visible: { conditionGroup: [{ type: 'in', attribute: 'mode', value: modes }] },
      });
      return {
        fields: Object.fromEntries(
          this.settingNames.map((name) => [
            name,
            name.startsWith('tooltip')
              ? { visible: { conditionGroup: [{ type: 'isTrue', attribute: 'showTooltips' }] } }
              : visible(this.modesForField(name)),
          ]),
        ),
        panels: { timeRange: visible(['agendaDay', 'agendaWeek', 'timeline']) },
      };
    }

    values(data, mode) {
      data = { ...this.view.model.attributes, ...data };
      const settingNames = this.namesForMode(mode);
      const values = Object.fromEntries(
        settingNames.map((name) => [
          name,
          ['slotDuration', 'scrollHour'].includes(name)
            ? Number(data[name])
            : ['visibleTimeStart', 'visibleTimeEnd'].includes(name)
              ? data[name]?.trim()
              : ['eventTextSize', 'dayBoundary', 'timelineRowHeight'].includes(name)
                ? data[name]
                : data[name] === true,
        ]),
      );

      if (
        (values.slotDuration != null && ![5, 10, 15, 30].includes(values.slotDuration)) ||
        (values.scrollHour != null &&
          (!Number.isInteger(values.scrollHour) || values.scrollHour < 0 || values.scrollHour > 23))
      )
        return;

      if (settingNames.includes('visibleTimeStart')) {
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
        if (settingNames.includes(name) && !options.includes(values[name])) return;
      }
      return values;
    }
  };
});
