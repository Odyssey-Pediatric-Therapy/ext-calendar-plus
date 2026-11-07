define('calendar-plus:views/calendar/modals/search-options', [
  'views/modal',
  'model',
  'views/record/edit-for-modal',
  'views/fields/multi-enum',
  'views/fields/enum',
  'calendar-plus:calendar-search',
], (Modal, Model, Record, MultiEnum, Enum, Search) => {
  return class extends Modal {
    className = 'dialog dialog-record';

    templateContent = '<div class="record-container no-side-margin">{{{record}}}</div>';

    setup() {
      this.on('remove', () => {
        this.optionsRemoved = true;
      });
      this.headerText = this.translate('Search result options', 'labels', 'Calendar');
      this.buttonList = [
        { name: 'save', label: 'Save', style: 'primary', onClick: () => this.actionSave() },
        { name: 'cancel', label: 'Cancel', onClick: () => this.close() },
      ];
      const current = Search.getOptions(this);
      this.model = new Model({ ...current, columns: [...current.columns] });
      this.model.name = 'CalendarSearchOptions';
      const label = (value) => this.translate(value, 'labels', 'Calendar');
      const columnLabels = {
        when: label('When'),
        assignedUser: label('Assigned user'),
        attendees: label('Attendees'),
        status: label('Status'),
      };
      const field = (name, title, Field, params) => ({
        view: new Field({ name, labelText: label(title), params }),
      });
      this.recordView = new Record({
        model: this.model,
        detailLayout: [
          {
            rows: [
              [
                field('columns', 'Additional columns', MultiEnum, {
                  options: Search.optionalColumns,
                  translatedOptions: columnLabels,
                }),
                false,
              ],
              [
                field('sortBy', 'Sort by', Enum, {
                  required: true,
                  options: ['date', 'title'],
                  translatedOptions: { date: label('Date'), title: label('Event') },
                }),
                field('sortDirection', 'Sort order', Enum, {
                  required: true,
                  options: ['desc', 'asc'],
                  translatedOptions: { desc: label('Descending'), asc: label('Ascending') },
                }),
              ],
            ],
          },
        ],
      });
      this.assignView('record', this.recordView);
    }

    async actionSave() {
      if (this.saving) return;
      const data = this.recordView.processFetch();
      if (this.recordView.validate()) return;
      if (
        !['date', 'title'].includes(data.sortBy) ||
        !['asc', 'desc'].includes(data.sortDirection) ||
        !Array.isArray(data.columns) ||
        data.columns.some((column) => !Search.optionalColumns.includes(column))
      )
        return;
      const preferences = this.getPreferences();
      const previous = preferences.get('calendarPlusSearchSettings');
      const next = {
        ...(previous || {}),
        columns: [...new Set(data.columns)],
        sortBy: data.sortBy,
        sortDirection: data.sortDirection,
      };
      this.saving = true;
      this.disableButton('save');
      try {
        await preferences.save({ calendarPlusSearchSettings: next }, { patch: true, wait: true });
      } catch (error) {
        preferences.set('calendarPlusSearchSettings', previous);
        if (!this.optionsRemoved) {
          this.enableButton('save');
          Espo.Ui.error(this.translate('Could not save search options', 'messages', 'Calendar'));
        }
        return;
      } finally {
        this.saving = false;
      }
      if (this.optionsRemoved) return;
      this.options.onSave();
      this.close();
    }
  };
});
