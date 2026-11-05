define('calendar-plus:views/calendar/modals/calendar', [
  'views/modal', 'model', 'views/record/edit-for-modal', 'views/fields/varchar', 'views/fields/enum',
  'crm:views/calendar/fields/users', 'crm:views/calendar/fields/teams', 'calendar-plus:calendar-definitions',
], (Modal, Model, Record, Varchar, Enum, Users, Teams, Definitions) => {
  return class extends Modal {
    className = 'dialog dialog-record';
    templateContent = '<div class="record-container no-side-margin">{{{record}}}</div>';

    constructor(options) {
      super(options);
      this.options = options;
    }

    setup() {
      const item = this.options.calendar;
      const membershipOnly = item?.source === 'shared';
      this.headerText = this.translate(membershipOnly ? 'Edit Timeline' : item ? 'Edit Calendar' : 'Create Calendar', 'labels', 'Calendar');
      this.buttonList = [
        {name: 'save', label: item ? 'Save' : 'Create', style: 'primary', onClick: () => this.actionSave()},
        {name: 'cancel', label: 'Cancel', onClick: () => this.close()},
      ];
      if (item && !membershipOnly) this.dropdownItemList.push({name: 'remove', label: 'Remove', onClick: () => this.actionRemove()});
      this.model = new Model(Espo.Utils.cloneDeep({
        name: item?.name || '', mode: Definitions.normalizeMode(item?.mode || 'agendaWeek'),
        usersIds: item?.userIdList || [], usersNames: item?.userNames || {},
        teamsIds: item?.teamIdList || [], teamsNames: item?.teamNames || {},
      }));
      this.model.name = 'CalendarView';
      const rows = [];
      if (!membershipOnly) {
        rows.push([
          {view: new Varchar({name: 'name', labelText: this.translate('name', 'fields'), params: {required: true, maxLength: 100}})},
          {view: new Enum({name: 'mode', labelText: this.translate('Calendar Type', 'labels', 'Calendar'),
            params: {required: true, options: ['agendaDay', 'agendaWeek', 'month', 'timeline'],
              translatedOptions: Object.fromEntries(['agendaDay', 'agendaWeek', 'month', 'timeline'].map(mode =>
                [mode, this.translate(mode, 'modes', 'Calendar')]))}})},
        ]);
      }
      rows.push(
        [{view: new Teams({name: 'teams', labelText: this.translate('teams', 'fields')})}, false],
        [{view: new Users({name: 'users', labelText: this.translate('users', 'fields')})}, false],
      );
      this.recordView = new Record({model: this.model, detailLayout: [{rows}]});
      this.assignView('record', this.recordView);
    }

    async actionSave() {
      const data = this.recordView.processFetch();
      if (this.recordView.validate()) return;
      const membershipOnly = this.options.calendar?.source === 'shared';
      const name = membershipOnly ? 'Timeline' : data.name;
      const mode = membershipOnly ? 'timeline' : data.mode;
      if (!name?.trim() || !(data.usersIds?.length || data.teamsIds?.length) ||
          !['agendaDay', 'agendaWeek', 'month', 'timeline'].includes(mode)) {
        Espo.Ui.error(this.translate('Select Calendar Members', 'messages', 'Calendar'));
        return;
      }
      await this.persist({
        id: membershipOnly ? undefined : this.options.calendar?.id || Math.random().toString(36).slice(2, 12), name: name.trim(), mode,
        userIdList: data.usersIds || [], userNames: data.usersNames || {},
        teamIdList: data.teamsIds || [], teamNames: data.teamsNames || {},
      });
    }

    async actionRemove() {
      if (this.options.calendar?.source === 'shared') return;
      await this.confirm(this.translate('confirmation', 'messages'));
      await this.persist(null);
    }

    async persistSharedSelection(item) {
      const preferences = this.getPreferences();
      const key = 'calendarPlusSharedSelection';
      const original = preferences.get(key);
      const previous = original ? Espo.Utils.cloneDeep(original) : original;
      const selection = {teamIdList: item.teamIdList, teamNames: item.teamNames,
        userIdList: item.userIdList, userNames: item.userNames};
      try {
        await preferences.save({[key]: selection}, {patch: true});
      } catch (error) {
        preferences.set(key, previous);
        this.enableButton('save');
        return;
      }
      this.options.onSave({...selection, source: 'shared', mode: 'timeline', routeMode: 'timeline'});
      this.close();
    }

    async persist(item) {
      this.disableButton('save');
      this.disableButton('remove');
      const preferences = this.getPreferences();
      if (this.options.calendar?.source === 'shared') return this.persistSharedSelection(item);
      const previous = Object.fromEntries(['calendarViewDataList', 'calendarPlusList'].map(key =>
        [key, Espo.Utils.cloneDeep(preferences.get(key) || [])]));
      const original = this.options.calendar;
      // Keep legacy timelines in their existing list until their type changes.
      const source = original?.source === 'timeline' && item?.mode === 'timeline' ? 'timeline' : 'calendar';
      const targetKey = source === 'timeline' ? 'calendarPlusList' : 'calendarViewDataList';
      const oldKey = original?.source === 'timeline' ? 'calendarPlusList' : 'calendarViewDataList';
      const next = Espo.Utils.cloneDeep(previous);
      if (original && oldKey === targetKey) {
        next[oldKey] = next[oldKey].flatMap(entry => entry.id === original.id ? (item ? [item] : []) : [entry]);
      } else {
        if (original) next[oldKey] = next[oldKey].filter(entry => entry.id !== original.id);
        if (item) next[targetKey].push(item);
      }
      try {
        await preferences.save(next, {patch: true});
      } catch (error) {
        for (const [key, value] of Object.entries(previous)) preferences.set(key, value);
        this.enableButton('save');
        this.enableButton('remove');
        return;
      }
      this.options.onSave(item ? {...item, source, routeMode: source === 'timeline' ? `view-timeline-${item.id}` : `view-${item.id}`} : null);
      this.close();
    }
  };
});
