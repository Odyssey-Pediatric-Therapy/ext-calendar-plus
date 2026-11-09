define('calendar-plus:views/calendar/modals/search', [
  'views/modal',
  'model',
  'views/record/edit-for-modal',
  'views/fields/date',
  'views/fields/varchar',
  'views/fields/multi-enum',
  'views/fields/link',
  'calendar-plus:calendar-search',
  'moment',
  'calendar-plus:calendar-colors',
], (Modal, Model, Record, DateField, Varchar, MultiEnum, Link, Search, moment, Colors) => {
  return class extends Modal {
    className = 'dialog dialog-record cp-calendar-search';

    templateContent =
      '<div class="record-container no-side-margin">{{{record}}}</div><div class="cp-search-results" aria-live="polite"></div>';

    events = {
      ...this.events,
      'keydown .record-container input': function (event) {
        if (
          event.key !== 'Enter' ||
          event.repeat ||
          event.isComposing ||
          event.originalEvent?.isComposing ||
          event.defaultPrevented ||
          event.isDefaultPrevented?.() ||
          event.ctrlKey ||
          event.altKey ||
          event.metaKey ||
          event.target.closest('.selectize-control, .select2-container, [role="combobox"]')
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        void this.actionSearch();
      },
    };

    setup() {
      this.headerText = this.translate('Search calendar', 'labels', 'Calendar');
      this.searchOptions = Search.getOptions(this.options.calendar);
      this.buttonList = [
        {
          name: 'search',
          label: this.translate('Search', 'labels', 'Calendar'),
          style: 'primary',
          onClick: () => this.actionSearch(),
        },
        { name: 'close', label: 'Close', onClick: () => this.close() },
      ];
      this.revision = 0;
      this.results = [];
      this.on('remove', () => {
        this.searchRemoved = true;
        this.revision++;
      });
      const calendar = this.options.calendar;
      const date = calendar.calendar?.getDate() || calendar.date || this.getDateTime().getToday();
      const month = moment(date);
      const scopes = Search.availableScopes(calendar);
      this.model = new Model({
        from: month.clone().startOf('month').format('YYYY-MM-DD'),
        to: month.clone().endOf('month').format('YYYY-MM-DD'),
        title: '',
        scopeList: [],
        statusList: [],
      });
      this.model.name = 'CalendarEventSearch';
      const field = (name, label, Field, params = {}) => ({
        view: new Field({ name, labelText: this.translate(label, 'labels', 'Calendar'), params }),
      });
      const statuses = [
        ...new Set(
          scopes.flatMap(
            (scope) =>
              this.getMetadata().get(['entityDefs', scope, 'fields', 'status', 'options']) || [],
          ),
        ),
      ].filter(Boolean);
      const typeLabels = Object.fromEntries(
        scopes.map((scope) => [scope, this.translate(scope, 'scopeNames')]),
      );
      const statusLabels = Object.fromEntries(
        statuses.map((status) => {
          const scope = scopes.find((scope) =>
            (
              this.getMetadata().get(['entityDefs', scope, 'fields', 'status', 'options']) || []
            ).includes(status),
          );
          return [status, this.getLanguage().translateOption(status, 'status', scope)];
        }),
      );
      this.recordView = new Record({
        model: this.model,
        detailLayout: [
          {
            label: this.translate('Dates and Events', 'labels', 'Calendar'),
            rows: [
              [
                field('from', 'From date', DateField, { required: true }),
                field('to', 'To date', DateField, { required: true }),
              ],
              [
                field('title', 'Title contains', Varchar),
                field('scopeList', 'Event types', MultiEnum, {
                  options: scopes,
                  translatedOptions: typeLabels,
                }),
              ],
              [
                field('statusList', 'Status', MultiEnum, {
                  options: statuses,
                  translatedOptions: statusLabels,
                }),
                false,
              ],
            ],
          },
          {
            label: this.translate('People', 'labels', 'Calendar'),
            rows: [
              [
                field('assignedUser', 'Assigned user', Link, { entity: 'User' }),
                field('attendeeUser', 'Attendee user', Link, { entity: 'User' }),
              ],
              [
                field('attendeeContact', 'Attendee contact', Link, { entity: 'Contact' }),
                field('attendeeLead', 'Attendee lead', Link, { entity: 'Lead' }),
              ],
            ],
          },
        ],
      });
      this.assignView('record', this.recordView);
    }

    afterRender() {
      super.afterRender?.();
      this.renderResults();
    }

    actionResultOptions() {
      this.createView(
        'resultOptions',
        'calendar-plus:views/calendar/modals/search-options',
        {
          onSave: () => {
            if (this.searchRemoved) return;
            this.searchOptions = Search.getOptions(this.options.calendar);
            if (this.hasSearched) void this.actionSearch();
            else this.renderResults();
          },
        },
        (view) => view.render(),
      );
    }

    async actionSearch() {
      if (this.searching) return;
      const filters = this.recordView.processFetch();
      if (this.recordView.validate()) return;
      if (
        !moment(filters.from, 'YYYY-MM-DD', true).isValid() ||
        !moment(filters.to, 'YYYY-MM-DD', true).isValid() ||
        filters.from > filters.to
      ) {
        Espo.Ui.error(this.translate('Invalid search dates', 'messages', 'Calendar'));
        return;
      }
      this.hasSearched = true;
      this.filters = Espo.Utils.cloneDeep(filters);
      this.results = [];
      this.pendingResults = [];
      this.offsets = {};
      this.errors = [];
      await this.loadResults();
    }

    async loadResults() {
      if (this.searching || this.searchRemoved) return;
      this.searching = true;
      this.disableButton('search');
      const revision = ++this.revision;
      this.renderResults(true);
      try {
        const size = Search.getPageSize(this.options.calendar);
        const offsets = { ...this.offsets };

        // Keep a full candidate page for each type before merging the next page.
        // Buffered rows avoid counting List Size once per event type.
        for (const scope of Search.availableScopes(this.options.calendar)) {
          if (this.pendingResults.filter((record) => record.scope === scope).length >= size) {
            offsets[scope] = null;
          }
        }

        const response = await Search.searchPage(this.options.calendar, this.filters, offsets);
        if (this.searchRemoved || revision !== this.revision) return;
        this.appendSearchPage(response, size);
      } catch (error) {
        if (!this.searchRemoved)
          Espo.Ui.error(this.translate('Could not search calendar', 'messages', 'Calendar'));
      } finally {
        if (!this.searchRemoved && revision === this.revision) {
          this.searching = false;
          this.enableButton('search');
          this.renderResults();
        }
      }
    }

    appendSearchPage(response, size) {
      this.offsets = { ...this.offsets, ...response.nextOffsets };
      this.errors = [...new Set([...this.errors, ...response.errors])];
      const records = new Map(
        [...this.pendingResults, ...response.results].map((record) => [
          `${record.scope}:${record.id}`,
          record,
        ]),
      );
      const sorted = [...records.values()].sort((first, second) =>
        Search.compareResults(this.options.calendar, first, second),
      );
      const displayed = new Set(this.results.map((record) => `${record.scope}:${record.id}`));
      const remaining = sorted.filter((record) => !displayed.has(`${record.scope}:${record.id}`));

      this.results.push(...remaining.slice(0, size));
      this.pendingResults = remaining.slice(size);
    }

    renderResults(loading = false) {
      const container = this.el.querySelector('.cp-search-results');
      if (!container) return;
      container.replaceChildren();
      const text = (tag, value, className) => {
        const element = document.createElement(tag);
        element.textContent = value;
        if (className) element.className = className;
        return element;
      };
      const label = (value) => this.translate(value, 'labels', 'Calendar');
      container.append(this.createResultsToolbar(loading, text, label));
      if (this.errors?.length)
        container.append(
          text(
            'p',
            this.translate('Search partial results', 'messages', 'Calendar'),
            'text-warning',
          ),
        );
      if (!loading && this.hasSearched && !this.results.length)
        container.append(text('p', label('No matching events')));
      if (!this.results.length) return;
      container.append(
        text(
          'p',
          this.translate('Search calendar visibility', 'messages', 'Calendar'),
          'text-muted cp-search-hint',
        ),
      );
      const columns = this.searchOptions.columns;
      const wrapper = text('div', '', 'table-responsive');
      const table = text('table', '', 'table table-striped cp-search-table');
      const head = document.createElement('thead');
      const headings = document.createElement('tr');
      headings.append(text('th', label('Event')));
      const columnLabels = {
        when: 'When',
        assignedUser: 'Assigned user',
        attendees: 'Attendees',
        status: 'Status',
      };
      for (const column of columns) headings.append(text('th', label(columnLabels[column])));
      headings.append(text('th', label('Calendar')));
      head.append(headings);
      table.append(head);
      const body = document.createElement('tbody');
      for (const record of this.results) {
        body.append(this.createResultRow(record, columns, text, label));
      }
      table.append(body);
      wrapper.append(table);
      container.append(wrapper);
      if (
        this.pendingResults?.length ||
        Object.values(this.offsets).some((offset) => offset !== null)
      ) {
        const more = text('button', label('Load more'), 'btn btn-default');
        more.type = 'button';
        more.disabled = loading;
        more.addEventListener('click', () => this.loadResults());
        container.append(more);
      }
    }
    resultsSummary(loading, label) {
      if (loading) return label('Searching');
      if (!this.hasSearched) return label('Results');

      const message = this.results.length === 1 ? 'matching event' : 'matching events';
      return `${this.results.length} ${label(message)}`;
    }

    createResultsToolbar(loading, text, label) {
      const toolbar = text('div', '', 'cp-search-toolbar');
      toolbar.append(text('p', this.resultsSummary(loading, label), 'text-muted'));
      const gear = text('button', '', 'btn btn-text btn-icon');
      gear.type = 'button';
      gear.title = label('Search result options');
      gear.setAttribute('aria-label', label('Search result options'));
      gear.disabled = loading;
      const icon = text('span', '', 'fas fa-cog');
      icon.setAttribute('aria-hidden', 'true');
      gear.append(icon);
      gear.addEventListener('click', () => this.actionResultOptions());
      toolbar.append(gear);
      return toolbar;
    }

    formatResultDate(dateTime, date, dateTimeValue) {
      if (date) return dateTime.toDisplayDate(date);
      if (dateTimeValue) return dateTime.toDisplay(dateTimeValue);

      return '';
    }

    createResultRow(record, columns, text, label) {
      const row = document.createElement('tr');
      const title = document.createElement('td');
      const link = text('a', record.name || label('Untitled event'));
      link.href = `#${encodeURIComponent(record.scope)}/view/${encodeURIComponent(record.id)}`;
      const badge = text(
        'span',
        this.translate(record.scope, 'scopeNames'),
        'cp-search-type-badge',
      );
      const color = Colors.entityColor(this.options.calendar, record.scope);
      badge.style.backgroundColor = color;
      badge.style.color = '#fff';
      const type = text('div', '', 'cp-search-event-type');
      type.append(badge);
      title.append(link, type);
      row.append(title);
      const dateTime = this.getDateTime();
      const start = this.formatResultDate(dateTime, record.dateStartDate, record.dateStart);
      const end = this.formatResultDate(dateTime, record.dateEndDate, record.dateEnd);
      const people = ['usersNames', 'contactsNames', 'leadsNames', 'collaboratorsNames'].flatMap(
        (field) => Object.values(record[field] || {}),
      );
      const values = {
        assignedUser: [record.assignedUserName, ...Object.values(record.assignedUsersNames || {})]
          .filter(Boolean)
          .join(', '),
        attendees: [...new Set(people)].join(', '),
        status: record.status
          ? this.getLanguage().translateOption(record.status, 'status', record.scope)
          : '',
      };
      for (const column of columns) {
        const cell = text('td', ['when', 'status'].includes(column) ? '' : values[column]);

        if (column === 'when') {
          for (const date of [start, end].filter(Boolean)) cell.append(text('div', date));
        }

        if (column === 'status' && record.status) {
          const style = Search.statusStyle(this.options.calendar, record.scope, record.status);
          cell.append(text('span', values.status, `label label-md label-state label-${style}`));
        }

        row.append(cell);
      }
      const action = document.createElement('td');
      const button = text('button', label('Show in calendar'), 'btn btn-default btn-sm');
      button.type = 'button';
      const availability = Search.resultAvailability(this.options.calendar, record);
      button.disabled = !availability.canShow;
      if (!availability.canShow) {
        button.title = this.translate(availability.reason, 'messages', 'Calendar');
        action.title = button.title;
      }
      button.addEventListener('click', () => {
        const current = Search.resultAvailability(this.options.calendar, record);
        if (!current.canShow) return;
        this.options.calendar.showSearchResult({ ...record, calendarUserIds: current.userIds });
        this.close();
      });
      action.append(button);
      row.append(action);
      return row;
    }
  };
});
