define('calendar-plus:views/admin/settings', ['views/settings/record/edit'], SettingsEdit => {
  return class extends SettingsEdit {
    layoutName = 'calendarPlusSettings';
    saveAndContinueEditingAction = false;

    dynamicLogicDefs = {
      fields: {
        calendarPlusTooltipDelay: {
          visible: {
            conditionGroup: [{type: 'isTrue', attribute: 'calendarPlusTooltipEnabled'}],
          },
        },
      },
    };

    setup() {
      for (const name of ['calendarPlusTooltipEnabled', 'calendarPlusColorGradientEnabled']) {
        if (this.model.get(name) == null) this.model.set(name, true);
      }
      if (this.model.get('calendarPlusTimelineEventGap') == null) this.model.set('calendarPlusTimelineEventGap', 0);
      if (this.model.get('calendarPlusTooltipDelay') == null) this.model.set('calendarPlusTooltipDelay', 1);
      super.setup();
    }
  };
});
