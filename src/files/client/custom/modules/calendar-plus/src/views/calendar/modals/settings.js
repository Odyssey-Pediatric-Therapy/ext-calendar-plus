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
      });
      this.model.name = 'CalendarViewSettings';
      const rows = [];
      this.settingNames = [];
      const add = (name, label, Field = Bool, params = {}) => {
        this.settingNames.push(name);
        rows.push([{view: new Field({name, labelText: this.translate(label, 'labels', 'Calendar'), params})}, false]);
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
      if (this.getConfig().get('calendarPlusTooltipEnabled') !== false) add('showTooltips', 'Show tooltips');
      this.recordView = new Record({model: this.model, detailLayout: [{rows}]});
      this.assignView('record', this.recordView);
    }

    async actionSave() {
      if (this.saving) return;
      const data = this.recordView.processFetch();
      if (this.recordView.validate()) return;
      const values = Object.fromEntries(this.settingNames.map(name => [name,
        ['slotDuration', 'scrollHour'].includes(name) ? Number(data[name]) :
          ['visibleTimeStart', 'visibleTimeEnd'].includes(name) ? data[name]?.trim() : data[name] === true]));
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
