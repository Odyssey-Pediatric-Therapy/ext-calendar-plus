define('calendar-plus:views/admin/layouts/tooltip', ['views/admin/layouts/default-side-panel'], (Rows) => {
  return class extends Rows {
    dataAttributeList = ['name'];

    validate() {
      return true;
    }

    readDataFromLayout(model, layout) {
      const available = this.getMetadata().get(['clientDefs', this.scope, 'calendarPlusTooltipFields']) || [];
      const selected = [];

      for (const item of layout || []) {
        let name = item;

        if (typeof item === 'object') {
          name = item.name;
        }

        if (available.includes(name) && !selected.includes(name)) {
          selected.push(name);
        }
      }

      const label = (name) => {
        if (name === ':attendees') {
          return this.translate('Attendees', 'labels', 'Calendar');
        }

        return this.translate(name, 'fields', this.scope);
      };

      this.enabledFieldsList = selected;
      this.enabledFields = selected.map((name) => ({ name, labelText: label(name) }));
      this.rowLayout = this.enabledFields;
      this.itemsData = {};

      for (const name of selected) {
        this.itemsData[name] = { name };
      }

      this.disabledFields = available
        .filter((name) => !selected.includes(name))
        .map((name) => ({ name, labelText: label(name) }))
        .sort((a, b) => a.labelText.localeCompare(b.labelText));
    }
  };
});
