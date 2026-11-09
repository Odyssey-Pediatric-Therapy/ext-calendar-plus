define('calendar-plus:views/scheduler/scheduler', ['crm:views/scheduler/scheduler', 'moment'], (
  Scheduler,
  moment,
) => {
  return class extends Scheduler {
    events = {
      ...this.events,

      'click [data-action="nextAvailable"]': function (event) {
        event.preventDefault();
        event.stopPropagation();
        void this.actionNextAvailable();
      },
    };

    setup() {
      super.setup();

      this.searchRevision = 0;
      this.searching = false;
      this.pendingSearch = null;

      this.listenTo(this.model, 'change', (model) => {
        const fields = [
          this.startField,
          this.endField,
          'isAllDay',
          this.usersField + 'Ids',
          this.assignedUserField + 'Id',
        ];

        if (!fields.some((field) => model.hasChanged(field))) return;

        this.searchRevision++;
        this.searching = false;
        this.pendingSearch = null;
        this.setSearchStatus('');
        this.updateSearchButton();
      });

      this.once('remove', () => {
        this.searchRevision++;
        this.pendingSearch = null;
      });
    }

    afterRender() {
      super.afterRender();

      if (!this.schedulerEditable()) return;

      const toolbar = document.createElement('div');
      Object.assign(toolbar.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '8px',
        marginBottom: '8px',
      });

      this.searchStatus = document.createElement('span');
      this.searchStatus.className = 'text-muted small';
      this.searchStatus.setAttribute('role', 'status');
      this.searchStatus.textContent = this.searchMessage || '';

      this.searchButton = document.createElement('button');
      this.searchButton.type = 'button';
      this.searchButton.className = 'btn btn-default btn-sm';
      this.searchButton.dataset.action = 'nextAvailable';

      toolbar.append(this.searchStatus, this.searchButton);
      this.el.prepend(toolbar);
      this.updateSearchButton();
    }

    fetch(from, to, callback) {
      return super.fetch(from, to, (events) => {
        callback(events);
        this.updateSearchButton();
      });
    }

    schedulerEditable() {
      const panel = this.getParentView?.();

      return panel?.mode !== 'detail' && !panel?.readOnly && !panel?.readOnlyLocked;
    }

    searchState() {
      const startValue = this.model.get(this.startField);
      const endValue = this.model.get(this.endField);

      if (!this.schedulerEditable() || this.model.get('isAllDay') || !startValue || !endValue) {
        return null;
      }

      const start = moment.utc(startValue);
      const end = moment.utc(endValue);
      const userIds = [...(this.model.get(this.usersField + 'Ids') || [])];
      const assigned = this.model.get(this.assignedUserField + 'Id');

      if (!this.eventAssignedUserIsAttendeeDisabled && assigned) userIds.unshift(assigned);

      const users = [...new Set(userIds.filter(Boolean))];
      const duration = end.valueOf() - start.valueOf();

      if (!start.isValid() || !end.isValid() || duration <= 0 || !users.length) return null;

      return { start, duration, users };
    }

    updateSearchButton() {
      if (!this.searchButton) return;

      const ready = !!this.searchState();
      this.searchButton.disabled = this.searching || !this.timeline || !ready;
      this.searchButton.textContent = this.translate(
        this.searching
          ? 'Finding available time'
          : this.pendingSearch
            ? 'Continue searching'
            : 'Next available',
        'labels',
        'Calendar',
      );
      this.searchButton.title = this.translate(
        ready ? 'Find next available help' : 'Choose timed scheduler values',
        'messages',
        'Calendar',
      );
    }

    setSearchStatus(message) {
      this.searchMessage = message;

      if (this.searchStatus) this.searchStatus.textContent = message;
    }

    async actionNextAvailable() {
      const state = this.searchState();

      if (this.searching || !this.timeline || !state || this.isRemoved()) return;

      const revision = ++this.searchRevision;
      this.searching = true;
      this.setSearchStatus('');
      this.updateSearchButton();

      const zone = this.getDateTime().getTimeZone();
      const format = this.getDateTime().internalDateTimeFormat;
      const signature = JSON.stringify([state.start.valueOf(), state.duration, state.users, zone]);
      const cursor = this.pendingSearch?.signature === signature ? this.pendingSearch.cursor : null;
      this.pendingSearch = null;

      try {
        const query = {
          dateStart: state.start.clone().utc().format('YYYY-MM-DD HH:mm:ss'),
          duration: state.duration / 1000,
          userIdList: state.users,
          timeZone: zone,
          entityType: this.model.entityType,
        };

        if (this.model.id) query.entityId = this.model.id;
        if (cursor) query.cursor = cursor;

        const result = await Espo.Ajax.postRequest('CalendarPlus/NextAvailable', query);

        if (this.isRemoved() || revision !== this.searchRevision) return;

        if (result.status === 'found') {
          const start = moment.utc(result.dateStart);
          const end = moment.utc(result.dateEnd);

          if (
            !result.dateStart ||
            !result.dateEnd ||
            !start.isValid() ||
            !end.isValid() ||
            !start.isAfter(state.start) ||
            end.diff(start) !== state.duration
          ) {
            throw new Error('Invalid availability result.');
          }

          this.model.set({
            [this.startField]: start.format(format),
            [this.endField]: end.format(format),
          });

          return;
        }

        if (result.status === 'continue') {
          const through = moment.utc(result.searchedThrough);

          if (
            !result.searchedThrough ||
            !through.isValid() ||
            typeof result.cursor !== 'string' ||
            !result.cursor
          ) {
            throw new Error('Invalid availability continuation.');
          }

          this.pendingSearch = { signature, cursor: result.cursor };
          this.setSearchStatus(
            this.translate('Continue scheduler search', 'messages', 'Calendar').replace(
              '{date}',
              through.tz(zone).format(this.getDateTime().getReadableDateFormat()),
            ),
          );

          return;
        }

        if (result.status === 'unavailable' || result.status === 'exhausted') {
          this.setSearchStatus(
            this.translate(
              result.status === 'unavailable'
                ? 'Scheduler availability unavailable'
                : 'No further scheduler dates',
              'messages',
              'Calendar',
            ),
          );

          return;
        }

        throw new Error('Invalid availability response.');
      } catch (error) {
        if (this.isRemoved() || revision !== this.searchRevision) return;

        this.setSearchStatus(
          this.translate(
            error.status === 403
              ? 'Scheduler availability unavailable'
              : 'Could not find scheduler time',
            'messages',
            'Calendar',
          ),
        );
      } finally {
        if (!this.isRemoved() && revision === this.searchRevision) {
          this.searching = false;
          this.updateSearchButton();
        }
      }
    }
  };
});
