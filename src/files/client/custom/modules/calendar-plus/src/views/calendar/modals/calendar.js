define('calendar-plus:views/calendar/modals/calendar', [
  'views/modal',
  'model',
  'views/record/edit-for-modal',
  'views/fields/varchar',
  'views/fields/enum',
  'calendar-plus:views/calendar/fields/users',
  'crm:views/calendar/fields/teams',
  'calendar-plus:calendar-definitions',
  'calendar-plus:views/calendar/settings-form',
], (Modal, Model, Record, Varchar, Enum, Users, Teams, Definitions, SettingsForm) => {
  return class extends Modal {
    className = 'dialog dialog-record';

    templateContent = '<div class="record-container no-side-margin">{{{record}}}</div>';

    constructor(options) {
      super(options);
      this.options = options;
    }

    setup() {
      this.on('remove', () => {
        this.calendarEditorRemoved = true;
      });

      const item = this.options.calendar;
      const membershipOnly = item?.source === 'shared';
      const settingsOnly = item?.source === 'personal';

      this.settingsForm = new SettingsForm(this);

      const routeMode =
        item?.routeMode ||
        (item?.id
          ? `${item.source === 'timeline' ? 'view-timeline-' : 'view-'}${item.id}`
          : 'timeline');

      this.headerText = this.translate(
        membershipOnly ? 'Edit Timeline' : item ? 'Edit Calendar' : 'Create Calendar',
        'labels',
        'Calendar',
      );
      this.buttonList = [
        {
          name: 'save',
          label: item ? 'Save' : 'Create',
          style: 'primary',

          onClick: () => this.actionSave(),
        },
        { name: 'cancel', label: 'Cancel', onClick: () => this.close() },
      ];

      if (item && !membershipOnly && !settingsOnly)
        this.dropdownItemList.push({
          name: 'remove',
          label: 'Remove',

          onClick: () => this.actionRemove(),
        });

      this.model = new Model(
        Espo.Utils.cloneDeep({
          ...this.settingsForm.defaults(item ? routeMode : null, this.options.calendarView),
          name: item?.name || '',
          mode: Definitions.normalizeMode(item?.mode || 'agendaWeek'),
          usersIds: item?.userIdList || [],
          usersNames: item?.userNames || {},
          teamsIds: item?.teamIdList || [],
          teamsNames: item?.teamNames || {},
          membershipMode: item?.membershipMode === 'static' ? 'static' : 'dynamic',
        }),
      );
      this.model.name = 'CalendarView';

      const rows = this.calendarRows(membershipOnly, settingsOnly);
      const settingsLayout = this.settingsForm.layout(
        this.model.attributes.mode,
        !settingsOnly,
        !settingsOnly && !membershipOnly,
      );

      this.recordView = new Record({
        model: this.model,
        detailLayout: [...(rows.length ? [{ rows }] : []), ...settingsLayout],
        dynamicLogicDefs: this.settingsForm.dynamicLogicDefs(),
      });
      this.assignView('record', this.recordView);
    }

    calendarRows(membershipOnly, settingsOnly) {
      const rows = [];

      if (!membershipOnly && !settingsOnly) {
        rows.push([
          {
            view: new Varchar({
              name: 'name',
              labelText: this.translate('name', 'fields'),
              params: { required: true, maxLength: 100 },
            }),
          },
          {
            view: new Enum({
              name: 'mode',
              labelText: this.translate('Calendar Type', 'labels', 'Calendar'),
              params: {
                required: true,
                options: ['agendaDay', 'agendaWeek', 'month', 'timeline'],
                translatedOptions: Object.fromEntries(
                  ['agendaDay', 'agendaWeek', 'month', 'timeline'].map((mode) => [
                    mode,
                    this.translate(mode, 'modes', 'Calendar'),
                  ]),
                ),
              },
            }),
          },
        ]);
      }

      if (!settingsOnly)
        rows.push(
          [
            {
              view: new Users({
                name: 'users',
                labelText: this.translate('users', 'fields'),
                tooltipText: this.translate('Calendar Users Order Help', 'messages', 'Calendar'),
                params: { tooltip: true },
              }),
            },
            false,
          ],
          [
            {
              view: new Teams({
                name: 'teams',
                labelText: this.translate('teams', 'fields'),
                tooltipText: this.translate('Calendar Teams Order Help', 'messages', 'Calendar'),
                params: { tooltip: true },
              }),
            },
            false,
          ],
          [
            {
              view: new Enum({
                name: 'membershipMode',
                labelText: this.translate('Calendar Membership', 'labels', 'Calendar'),
                tooltipText: this.translate('Calendar Membership Help', 'messages', 'Calendar'),
                params: {
                  required: true,
                  tooltip: true,
                  options: ['dynamic', 'static'],
                  translatedOptions: {
                    dynamic: this.translate('Dynamic Membership', 'labels', 'Calendar'),
                    static: this.translate('Static Membership', 'labels', 'Calendar'),
                  },
                },
              }),
            },
            false,
          ],
        );

      return rows;
    }

    modeForSave(data) {
      const calendar = this.options.calendar;

      if (calendar?.source === 'shared') return 'timeline';

      if (calendar?.source === 'personal') return calendar.mode;

      return data.mode;
    }

    async actionSave() {
      if (this.saving) return;

      const data = this.recordView.processFetch();

      if (!data || this.recordView.validate()) return;

      const membershipOnly = this.options.calendar?.source === 'shared';
      const mode = this.modeForSave(data);

      this.settingValues = this.settingsForm.values(data, mode);

      if (!this.settingValues) return;

      if (this.options.calendar?.source === 'personal') return this.persistPersonalSettings();

      const name = membershipOnly ? 'Timeline' : data.name;

      if (
        !name?.trim() ||
        !(data.usersIds?.length || data.teamsIds?.length) ||
        !['agendaDay', 'agendaWeek', 'month', 'timeline'].includes(mode)
      ) {
        Espo.Ui.error(this.translate('Select Calendar Members', 'messages', 'Calendar'));

        return;
      }

      const item = {
        id: membershipOnly
          ? undefined
          : this.options.calendar?.id || Math.random().toString(36).slice(2, 12),
        name: name.trim(),
        mode,
        userIdList: data.usersIds || [],
        userNames: data.usersNames || {},
        teamIdList: data.teamsIds || [],
        teamNames: data.teamsNames || {},
        membershipMode: data.membershipMode === 'static' ? 'static' : 'dynamic',
      };

      this.saving = true;
      this.disableButton('save');
      this.disableButton('remove');

      try {
        if (item.membershipMode === 'static') {
          // Capture inactive members too, so Show inactive users can reveal them later.
          const { users } = await Espo.Ajax.postRequest('CalendarPlus/Users', {
            teamIdList: item.teamIdList,
            userIdList: item.userIdList,
            includeInactiveUsers: true,
          });

          if (this.calendarEditorRemoved) return;

          item.staticUserIdList = this.staticUserIds(users);

          if (item.staticUserIdList.length > 500) {
            Espo.Ui.error(this.translate('Static Calendar Member Limit', 'messages', 'Calendar'));
            this.enableButton('save');
            this.enableButton('remove');

            return;
          }
        }

        await this.persist(item);
      } catch (error) {
        if (this.calendarEditorRemoved) return;

        this.enableButton('save');
        this.enableButton('remove');
        Espo.Ui.error(this.translate('Could not capture calendar members', 'messages', 'Calendar'));
      } finally {
        this.saving = false;
      }
    }

    staticUserIds(users) {
      if (
        !Array.isArray(users) ||
        users.some(
          (user) => !user || typeof user.id !== 'string' || !user.id || user.id.length > 100,
        )
      ) {
        throw new Error('Invalid member response.');
      }

      return [...new Set(users.map((user) => user.id))];
    }

    async actionRemove() {
      if (['shared', 'personal'].includes(this.options.calendar?.source)) return;

      await this.confirm(this.translate('confirmation', 'messages'));
      await this.persist(null);
    }

    settingsPatch(key) {
      const previous = this.getPreferences().get('calendarPlusViewSettings') || {};

      return { ...previous, [key]: { ...previous[key], ...this.settingValues } };
    }

    async persistPersonalSettings() {
      const preferences = this.getPreferences();
      const previous = preferences.get('calendarPlusViewSettings');

      this.saving = true;
      this.disableButton('save');

      try {
        await preferences.save(
          {
            calendarPlusViewSettings: this.settingsPatch(this.options.calendar.routeMode),
          },
          { patch: true, wait: true },
        );
      } catch (error) {
        preferences.set('calendarPlusViewSettings', previous);

        if (!this.calendarEditorRemoved) {
          this.enableButton('save');
          Espo.Ui.error(this.translate('Could not save view settings', 'messages', 'Calendar'));
        }

        return;
      } finally {
        this.saving = false;
      }

      if (this.calendarEditorRemoved) return;

      this.options.onSave(this.options.calendar);
      this.close();
    }

    async persistSharedSelection(item) {
      const preferences = this.getPreferences();
      const key = 'calendarPlusSharedSelection';
      const original = preferences.get(key);
      const previous = original ? Espo.Utils.cloneDeep(original) : original;
      const previousSettings = preferences.get('calendarPlusViewSettings');
      const selection = {
        teamIdList: item.teamIdList,
        teamNames: item.teamNames,
        userIdList: item.userIdList,
        userNames: item.userNames,
        membershipMode: item.membershipMode || 'dynamic',
        ...(item.membershipMode === 'static' ? { staticUserIdList: item.staticUserIdList } : {}),
      };

      try {
        await preferences.save(
          { [key]: selection, calendarPlusViewSettings: this.settingsPatch('timeline') },
          { patch: true, wait: true },
        );
      } catch (error) {
        preferences.set(key, previous);
        preferences.set('calendarPlusViewSettings', previousSettings);
        this.enableButton('save');
        this.enableButton('remove');

        return;
      }

      if (this.calendarEditorRemoved) return;

      this.options.onSave({
        ...selection,
        source: 'shared',
        mode: 'timeline',
        routeMode: 'timeline',
      });
      this.close();
    }

    async persist(item) {
      this.disableButton('save');
      this.disableButton('remove');

      const preferences = this.getPreferences();

      if (this.options.calendar?.source === 'shared') return this.persistSharedSelection(item);

      const previous = Object.fromEntries(
        ['calendarViewDataList', 'calendarPlusList'].map((key) => [
          key,
          Espo.Utils.cloneDeep(preferences.get(key) || []),
        ]),
      );
      const original = this.options.calendar;
      // Keep legacy timelines in their existing list until their type changes.
      const source =
        original?.source === 'timeline' && item?.mode === 'timeline' ? 'timeline' : 'calendar';
      const targetKey = source === 'timeline' ? 'calendarPlusList' : 'calendarViewDataList';
      const oldKey = original?.source === 'timeline' ? 'calendarPlusList' : 'calendarViewDataList';
      const next = Espo.Utils.cloneDeep(previous);

      if (original && oldKey === targetKey) {
        next[oldKey] = next[oldKey].flatMap((entry) =>
          entry.id === original.id ? (item ? [item] : []) : [entry],
        );
      } else {
        if (original) next[oldKey] = next[oldKey].filter((entry) => entry.id !== original.id);

        if (item) next[targetKey].push(item);
      }

      const previousSettings = preferences.get('calendarPlusViewSettings');

      if (item && this.settingValues)
        next.calendarPlusViewSettings = this.settingsPatch(`view:${item.id}`);

      try {
        await preferences.save(next, { patch: true, wait: true });
      } catch (error) {
        for (const [key, value] of Object.entries(previous)) preferences.set(key, value);

        preferences.set('calendarPlusViewSettings', previousSettings);
        this.enableButton('save');
        this.enableButton('remove');

        return;
      }

      if (this.calendarEditorRemoved) return;

      this.options.onSave(
        item
          ? {
              ...item,
              source,
              routeMode: source === 'timeline' ? `view-timeline-${item.id}` : `view-${item.id}`,
            }
          : null,
      );
      this.close();
    }
  };
});
