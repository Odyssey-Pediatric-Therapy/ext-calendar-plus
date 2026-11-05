define('calendar-plus:views/calendar/mode-buttons', [
  'crm:views/calendar/mode-buttons', 'calendar-plus:calendar-definitions',
], (ModeButtons, Definitions) => {
  return class extends ModeButtons {
    template = 'calendar-plus:calendar/mode-buttons';

    events = {
      'click [data-action="toggleInactiveUsers"]': function (event) {
        event.preventDefault();
        event.stopPropagation();
        void this.actionToggleInactiveUsers();
      },
      'keydown [data-action="toggleInactiveUsers"]': function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        void this.actionToggleInactiveUsers();
      },
    };

    async actionToggleInactiveUsers() {
      const parent = this.getCalendarParentView();
      if (this.savingInactiveUsers || !this.data().inactiveUsersAvailable) return;
      const preferences = this.getPreferences();
      const previous = preferences.get('calendarPlusViewSettings');
      const key = Definitions.viewSettingsKey(preferences, this.mode);
      const next = {...(previous || {}), [key]: {...(previous?.[key] || {}),
        showInactiveUsers: !Definitions.showInactiveUsers(preferences, this.mode)}};
      this.savingInactiveUsers = true;
      try {
        await preferences.save({calendarPlusViewSettings: next}, {patch: true, wait: true});
      } catch (error) {
        preferences.set('calendarPlusViewSettings', previous);
        Espo.Ui.error(this.translate('Could not save view settings', 'messages', 'Calendar'));
        return;
      } finally {
        this.savingInactiveUsers = false;
      }
      if (!parent.sharedRemoved && !parent.removed) {
        this.reRender();
        parent.actionRefresh();
      }
    }

    getModeDataList(originalOrder) {
      const primaryModes = ['month', 'agendaWeek', 'agendaDay', 'timeline'];
      const core = super.getModeDataList(originalOrder);
      const list = primaryModes.map(mode => core.find(item => item.mode === mode) || {
        mode, label: this.translate(mode, 'modes', 'Calendar'),
        labelShort: this.translate(mode, 'modes', 'Calendar').slice(0, 2),
      });
      list.push(...core.filter(item => !primaryModes.includes(item.mode) && !item.mode.startsWith('view-')));
      if (this.isCustomViewAvailable) {
        for (const [index, item] of Definitions.list(this.getPreferences()).entries()) {
          list.push({mode: item.routeMode, label: item.name, labelShort: item.name.slice(0, 2), separatorBefore: index === 0});
        }
      }
      return list;
    }

    data() {
      const parent = this.getCalendarParentView();
      const modes = this.getModeDataList();
      const selected = modes.find(item => item.mode === this.mode);
      const inactiveUsersAvailable = this.isCustomViewAvailable &&
        (!!Definitions.find(this.getPreferences(), this.mode) || parent.calendarType === 'shared');
      return {...super.data(), inactiveUsersAvailable,
        showInactiveUsers: Definitions.showInactiveUsers(this.getPreferences(), this.mode), allModeDataList: modes, selectedModeLabel: selected?.label || this.translate('Calendar', 'scopeNames'), calendarEditable: this.isCustomViewAvailable &&
        (!!Definitions.find(this.getPreferences(), this.mode) || parent.calendarType === 'shared')};
    }
  };
});
