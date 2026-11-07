define('calendar-plus:views/calendar/modals/settings', [
  'views/modal',
  'model',
  'views/record/edit-for-modal',
  'calendar-plus:views/calendar/settings-form',
  'calendar-plus:calendar-definitions',
], (Modal, Model, Record, SettingsForm, Definitions) => {
  return class extends Modal {
    className = 'dialog dialog-record';

    templateContent = '<div class="record-container no-side-margin">{{{record}}}</div>';

    setup() {
      this.on('remove', () => {
        this.settingsRemoved = true;
      });
      this.headerText = this.translate('Calendar Settings', 'labels', 'Calendar');
      this.buttonList = [
        { name: 'save', label: 'Save', style: 'primary', onClick: () => this.actionSave() },
        { name: 'cancel', label: 'Cancel', onClick: () => this.close() },
      ];
      const parent = this.options.calendar;
      this.settingsForm = new SettingsForm(this);
      this.settingsMode = Definitions.normalizeMode(parent.viewMode || parent.mode);
      this.model = new Model({
        ...this.settingsForm.defaults(this.options.mode, parent),
        mode: this.settingsMode,
      });
      this.model.name = 'CalendarViewSettings';
      const detailLayout = this.settingsForm.layout(
        this.settingsMode,
        this.options.inactiveUsersAvailable,
      );
      this.settingNames = this.settingsForm.settingNames;

      this.recordView = new Record({
        model: this.model,
        detailLayout,
        dynamicLogicDefs: this.settingsForm.dynamicLogicDefs(),
      });
      this.assignView('record', this.recordView);
    }

    async actionSave() {
      if (this.saving) return;

      const data = this.recordView.processFetch();

      if (!data || this.recordView.validate()) return;

      const values = this.settingsForm.values(data, this.settingsMode);
      if (!values) return;

      const preferences = this.getPreferences();
      const previous = preferences.get('calendarPlusViewSettings');
      const key = Definitions.viewSettingsKey(preferences, this.options.mode);
      const next = { ...(previous || {}), [key]: { ...(previous?.[key] || {}), ...values } };
      this.saving = true;
      this.disableButton('save');

      try {
        await preferences.save({ calendarPlusViewSettings: next }, { patch: true, wait: true });
      } catch (error) {
        preferences.set('calendarPlusViewSettings', previous);

        if (!this.settingsRemoved) {
          Espo.Ui.error(this.translate('Could not save view settings', 'messages', 'Calendar'));
          this.enableButton('save');
        }

        return;
      } finally {
        this.saving = false;
      }

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
