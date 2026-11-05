define('calendar-plus:views/admin/settings', ['views/settings/record/edit'], SettingsEdit => {
  return class extends SettingsEdit {
    layoutName = 'calendarPlusSettings';
    saveAndContinueEditingAction = false;

    setup() {
      for (const name of ['calendarPlusTooltipEnabled', 'calendarPlusColorGradientEnabled']) {
        if (this.model.get(name) == null) this.model.set(name, true);
      }
      super.setup();
    }
  };
});
