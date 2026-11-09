define('calendar-plus:views/calendar/fields/teams', [
  'views/fields/link-multiple-with-columns',
  'crm:views/calendar/fields/teams',
], (Columns, Teams) => {
  return class extends Columns {
    foreignScope = 'Team';
    columnList = ['showInactiveUsers'];
    columnsDefs = {
      showInactiveUsers: {
        type: 'bool',
        default: false,
        field: 'showInactiveUsers',
        scope: 'Calendar',
      },
    };

    getSelectBoolFilterList() {
      return Teams.prototype.getSelectBoolFilterList.call(this);
    }

    addLinkHtml(id, name) {
      const row = super.addLinkHtml(id, name);

      if (!row || !this.isEditMode()) return row;

      // Keep the native relation-column storage, but expose the boolean directly
      // instead of hiding it in the row's dropdown menu.
      row.find('.btn-group').remove();
      const label = document.createElement('label');
      label.style.cssText =
        'display:inline-flex;align-items:center;gap:5px;margin:0 10px 0 0;font-weight:normal;';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = this.columns[id]?.showInactiveUsers === true;
      checkbox.dataset.column = 'showInactiveUsers';
      checkbox.dataset.id = id;
      checkbox.addEventListener('change', () => {
        this.columns[id] ||= {};
        this.columns[id].showInactiveUsers = checkbox.checked;
        this.trigger('change');
      });
      label.append(
        checkbox,
        document.createTextNode(this.translate('Show inactive users', 'labels', 'Calendar')),
      );
      const nameElement = row.find('.link-item-name');
      nameElement.parent().css({ display: 'flex', alignItems: 'center', gap: '12px' });
      nameElement.css({ flex: '1', minWidth: '0' }).after(label);

      return row;
    }
  };
});
