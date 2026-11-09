define('calendar-plus:views/scheduler/scheduler', [
  'crm:views/scheduler/scheduler',
  'calendar-plus:calendar-availability',
  'moment',
], (Scheduler, Availability, moment) => {
  const SEARCH_BUDGET_MS = 3000;

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
      const signature = JSON.stringify([state.start.valueOf(), state.duration, state.users, zone]);
      const search =
        this.pendingSearch?.signature === signature
          ? this.pendingSearch
          : {
              signature,
              earliest: Availability.roundUp(state.start.valueOf() + 1),
              availability: Object.fromEntries(state.users.map((id) => [id, []])),
            };
      search.day ||= moment.utc(search.earliest).tz(zone).startOf('day');
      const started = Date.now();
      this.pendingSearch = null;

      try {
        while (search.day.isValid()) {
          const day = search.day;
          const nextDay = day.clone().add(1, 'day');
          const format = this.getDateTime().internalDateTimeFormat;

          if (!nextDay.isValid() || !nextDay.isAfter(day)) break;

          const query = {
            from: day.clone().utc().format(format),
            to: nextDay.clone().utc().format(format),
            userIdList: state.users.join(','),
            entityType: this.model.entityType,
          };

          if (this.model.id) query.entityId = this.model.id;

          const data = await Espo.Ajax.getRequest('Timeline/busyRanges', query);

          if (this.isRemoved() || revision !== this.searchRevision) return;

          for (const userId of state.users) {
            if (!data || !Object.hasOwn(data, userId) || !Array.isArray(data[userId])) {
              throw new Availability.UnavailableError(
                'Availability is missing for a selected user.',
              );
            }

            search.availability[userId].push(...data[userId]);
          }

          const slot = Availability.findSlot(
            search.availability,
            state.users,
            search.earliest,
            nextDay.valueOf(),
            state.duration,
          );

          if (slot !== null) {
            this.model.set({
              [this.startField]: moment.utc(slot).format(format),
              [this.endField]: moment.utc(slot + state.duration).format(format),
            });

            return;
          }

          // Earlier starts have been ruled out; retain enough history for a slot
          // crossing this boundary without accumulating every previously checked day.
          const nextPossible = Availability.findSlot(
            search.availability,
            state.users,
            search.earliest,
            Number.MAX_SAFE_INTEGER,
            state.duration,
          );
          search.earliest = Math.max(
            search.earliest,
            nextPossible ?? search.earliest,
            Availability.roundUp(nextDay.valueOf() - state.duration + 1),
          );
          search.day = moment
            .utc(Math.max(nextDay.valueOf(), search.earliest))
            .tz(zone)
            .startOf('day');

          for (const userId of state.users) {
            search.availability[userId] = search.availability[userId].filter(
              (range) => moment.utc(range.dateEnd).valueOf() > search.earliest,
            );
          }

          // Pause by request cost, not by an arbitrary final date. The next click
          // continues from this cursor rather than querying the same days again.
          if (Date.now() - started >= SEARCH_BUDGET_MS) {
            this.pendingSearch = search;
            this.setSearchStatus(
              this.translate('Continue scheduler search', 'messages', 'Calendar').replace(
                '{date}',
                search.day
                  .clone()
                  .subtract(1, 'day')
                  .format(this.getDateTime().getReadableDateFormat()),
              ),
            );

            return;
          }
        }

        this.setSearchStatus(this.translate('No further scheduler dates', 'messages', 'Calendar'));
      } catch (error) {
        if (this.isRemoved() || revision !== this.searchRevision) return;

        this.setSearchStatus(
          this.translate(
            error instanceof Availability.UnavailableError
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
