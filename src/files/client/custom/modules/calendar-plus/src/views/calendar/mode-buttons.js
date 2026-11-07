define('calendar-plus:views/calendar/mode-buttons', [
  'crm:views/calendar/mode-buttons',
  'calendar-plus:calendar-definitions',
], (ModeButtons, Definitions) => {
  return class extends ModeButtons {
    template = 'calendar-plus:calendar/mode-buttons';

    events = {
      'click [data-action="settings"]': function (event) {
        event.preventDefault();
        event.stopPropagation();
        this.actionSettings();
      },
      'keydown [data-action="settings"]': function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;

        event.preventDefault();
        event.stopPropagation();
        this.actionSettings();
      },
    };

    actionSettings() {
      const parent = this.getCalendarParentView();
      this.createView(
        'settingsModal',
        'calendar-plus:views/calendar/modals/settings',
        {
          calendar: parent,
          mode: this.mode,
          inactiveUsersAvailable: this.data().inactiveUsersAvailable,
        },
        (view) => view.render(),
      );
    }

    getModeDataList(originalOrder) {
      const primaryModes = ['month', 'agendaWeek', 'agendaDay', 'timeline'];
      const core = super.getModeDataList(originalOrder);
      const list = primaryModes.map(
        (mode) =>
          core.find((item) => item.mode === mode) || {
            mode,
            label: this.translate(mode, 'modes', 'Calendar'),
            labelShort: this.translate(mode, 'modes', 'Calendar').slice(0, 2),
          },
      );
      list.push(
        ...core.filter(
          (item) => !primaryModes.includes(item.mode) && !item.mode.startsWith('view-'),
        ),
      );

      if (this.isCustomViewAvailable) {
        for (const [index, item] of Definitions.list(this.getPreferences()).entries()) {
          list.push({
            mode: item.routeMode,
            label: item.name,
            labelShort: item.name.slice(0, 2),
            separatorBefore: index === 0,
          });
        }
      }

      return list;
    }

    data() {
      const parent = this.getCalendarParentView();
      const modes = this.getModeDataList();
      const selected = modes.find((item) => item.mode === this.mode);
      const inactiveUsersAvailable =
        this.isCustomViewAvailable &&
        (!!Definitions.find(this.getPreferences(), this.mode) || parent.calendarType === 'shared');

      return {
        ...super.data(),
        inactiveUsersAvailable,
        showInactiveUsers: Definitions.showInactiveUsers(this.getPreferences(), this.mode),
        allModeDataList: modes,
        selectedModeLabel: selected?.label || this.translate('Calendar', 'scopeNames'),
        calendarEditable:
          this.isCustomViewAvailable &&
          (!!Definitions.find(this.getPreferences(), this.mode) ||
            parent.calendarType === 'shared'),
      };
    }
  };
});
