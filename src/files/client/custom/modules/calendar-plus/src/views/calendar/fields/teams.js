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
      if (!this.isEditMode()) return super.addLinkHtml(id, name);

      // Own the editable row markup; native Columns still handles values, removal, and ordering.
      const row = document.createElement('div');
      row.className = 'list-group-item cp-team-row';
      row.classList.add('link-' + id);
      row.dataset.id = id;

      const teamName = document.createElement('div');
      teamName.className = 'cp-team-name';
      teamName.textContent = name;

      const label = document.createElement('label');
      label.className = 'cp-team-inactive';
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

      const remove = document.createElement('a');
      remove.setAttribute('role', 'button');
      remove.tabIndex = 0;
      remove.dataset.id = id;
      remove.dataset.action = 'clearLink';
      const icon = document.createElement('span');
      icon.className = 'fas fa-times';
      remove.append(icon);

      row.append(teamName, label, remove);
      this.$el.find('.link-container').append(row);

      return $(row);
    }
  };
});
