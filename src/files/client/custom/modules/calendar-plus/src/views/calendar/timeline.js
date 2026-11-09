define('calendar-plus:views/calendar/timeline', [
  'crm:views/calendar/timeline',
  'calendar-plus:calendar-definitions',
  'calendar-plus:views/calendar/event-tooltip',
  'moment',
  'calendar-plus:active-calendar',
], (Timeline, Definitions, EventTooltip, moment, ActiveCalendar) => {
  // vis requires concrete local dates to anchor a weekly hidden interval.
  // This Saturday-to-Monday reference repeats every week, in every year.
  const WEEKEND_START_REFERENCE = '2026-11-07 00:00:00';
  const WEEKEND_END_REFERENCE = '2026-11-09 00:00:00';

  return class extends Timeline {
    template = 'calendar-plus:calendar/timeline';

    events = {
      ...this.events,

      'click [data-action="searchCalendar"]': function (event) {
        event.preventDefault();
        this.actionSearchCalendar();
      },
    };

    afterRender() {
      const result = super.afterRender();

      ActiveCalendar.register(this);

      return result;
    }

    setup() {
      this.eventAppearances = new Map();
      this.tooltipEvents = new Map();
      this.eventTooltip = new EventTooltip(this);
      this.calendarTypeList = [
        'single',
        'shared',
        ...this.getTimelines().map((item) => `saved-${item.id}`),
      ];
      super.setup();

      if (this.getConfig().get('calendarPlusTasksAllDay') === false) {
        this.allDayScopeList = this.allDayScopeList.filter((scope) => scope !== 'Task');
      }

      if (
        !this.calendarTypeList.includes(this.calendarType) ||
        (!this.isCustomViewAvailable && this.calendarType.startsWith('saved-'))
      ) {
        this.calendarType = 'single';
      }

      this.on('remove', () => {
        this.removed = true;
        this.fetchRevision++;
        this.eventTooltip.reset();
        this.eventAppearances.clear();
        this.tooltipEvents.clear();
      });
    }

    applyViewSettings() {
      const settings = Definitions.viewSettings(this.getPreferences(), this.mode || 'timeline');

      this.eventTooltip.refresh();
      Definitions.applyAppearance(this);

      const appearance = JSON.stringify([settings.eventTextSize, settings.timelineRowHeight]);

      if (this.timeline && this.timelineAppearance !== appearance) {
        this.timelineAppearance = appearance;
        this.timeline.redraw?.();
      }

      const showWeekends = !!this.searchResult || settings.showWeekends !== false;
      const range = (!this.searchResult && Definitions.timeRange(settings)) || {
        start: '00:00:00',
        end: '24:00:00',
      };
      const signature = JSON.stringify([showWeekends, range]);

      if (
        !this.timeline ||
        (this.settingsTimeline === this.timeline && this.timelineSettingsSignature === signature)
      )
        return;

      const hiddenDates = this.hiddenDatesForRange(showWeekends, range);

      const apply = hiddenDates.length || this.timelineHasHiddenDates;

      this.settingsTimeline = this.timeline;
      this.timelineSettingsSignature = signature;
      this.timelineHasHiddenDates = !!hiddenDates.length;

      if (apply) this.timeline.setOptions({ hiddenDates });
    }

    hiddenDatesForRange(showWeekends, range) {
      const hiddenDates = [];

      if (!showWeekends)
        hiddenDates.push({
          start: WEEKEND_START_REFERENCE,
          end: WEEKEND_END_REFERENCE,
          repeat: 'weekly',
        });

      if (range.start !== '00:00:00' || range.end !== '24:00:00') {
        // Anchor the overnight gap to a reference day; vis repeats it daily in local time.
        const start = new Date(WEEKEND_START_REFERENCE.replace(' ', 'T'));

        start.setHours(Number(range.end.slice(0, 2)), Number(range.end.slice(3, 5)), 0, 0);

        const end = new Date(WEEKEND_START_REFERENCE.replace(' ', 'T'));

        end.setDate(end.getDate() + 1);
        end.setHours(Number(range.start.slice(0, 2)), Number(range.start.slice(3, 5)), 0, 0);
        hiddenDates.push({ start, end, repeat: 'daily' });
      }

      return hiddenDates;
    }

    actionSearchCalendar() {
      this.createView(
        'searchModal',
        'calendar-plus:views/calendar/modals/search',
        {
          calendar: this,
        },
        (view) => view.render(),
      );
    }

    showSearchResult(record) {
      this.searchResult = record;
      this.applyViewSettings();

      const date = record.dateStartDate || record.dateStart || record.dateEndDate || record.dateEnd;
      const preview = this.includeSearchResult([])[0];
      const target = preview?.start
        ? moment(preview.start)
        : record.dateStartDate || record.dateEndDate
          ? moment.tz(date, 'YYYY-MM-DD', this.getDateTime().getTimeZone())
          : this.getDateTime().toMoment(date);

      this.timeline.moveTo(target.toDate(), { animation: false });
      this.actionRefresh();
      this.syncTimelineTooltips();
    }

    includeSearchResult(events) {
      if (!this.searchResult?.calendarUserIds?.length) return events;

      const result = [...events];

      for (const userId of this.searchResult.calendarUserIds) {
        if (
          result.some((event) => Definitions.isSearchResult(this, event) && event.group === userId)
        )
          continue;

        const event = this.convertEvent({ ...this.searchResult, userId });

        if (event) result.push(event);
      }

      return result;
    }

    actionToday() {
      this.searchResult = null;
      this.applyViewSettings();

      return super.actionToday();
    }

    createView(name, view, options, callback) {
      const isEventCreate = view === 'crm:views/calendar/modals/edit';
      const viewName = isEventCreate
        ? 'calendar-plus:views/calendar/modals/edit'
        : name === 'modeButtons'
          ? 'calendar-plus:views/calendar/mode-buttons'
          : view;

      return super.createView(
        name,
        viewName,
        isEventCreate ? { ...options, calendarView: this } : options,
        callback,
      );
    }

    getTimelines() {
      return Definitions.list(this.getPreferences()).filter((item) => item.mode === 'timeline');
    }

    getSelectedTimeline() {
      if (this.isCustomViewAvailable === false) return;

      return (
        this.options.calendarItem ||
        this.getTimelines().find((item) => `saved-${item.id}` === this.calendarType)
      );
    }

    isDefaultSharedTimeline() {
      return (
        this.calendarType === 'shared' &&
        this.isCustomViewAvailable &&
        !this.options.userId &&
        !this.options.userList
      );
    }

    getMembershipSelection() {
      return (
        this.getSelectedTimeline() ||
        (this.isDefaultSharedTimeline()
          ? Definitions.sharedTimeline(this.getPreferences(), this.getUser())
          : null)
      );
    }

    selectMode(mode) {
      if (mode === 'timeline') this.getStorage().set('calendar', 'timelineType', 'shared');

      return super.selectMode(mode);
    }

    data() {
      const data = super.data();

      return {
        ...data,
        calendarTypeSelectEnabled: data.calendarTypeSelectEnabled || this.isCustomViewAvailable,
        timelineEditable:
          !!this.getSelectedTimeline() ||
          (this.calendarType === 'shared' && this.isCustomViewAvailable),
      };
    }

    getCalendarTypeDataList() {
      const list = super.getCalendarTypeDataList();

      if (!this.options.userId && this.getAcl().getPermissionLevel('userCalendar') !== 'no') {
        this.getTimelines().forEach((item) =>
          list.push({
            type: `saved-${item.id}`,
            label: item.name,
            disabled: this.calendarType !== `saved-${item.id}`,
          }),
        );
      }

      return list;
    }

    getCalendarTypeLabel(type) {
      const item = this.getTimelines().find((item) => `saved-${item.id}` === type);

      return item ? item.name : super.getCalendarTypeLabel(type);
    }

    initUserList() {
      if (this.getMembershipSelection()) {
        this.userList = [];

        return;
      }

      super.initUserList();
    }

    selectCalendarType(name) {
      super.selectCalendarType(this.calendarTypeList.includes(name) ? name : 'single');
      this.updateTimelineControls();
    }

    updateTimelineControls() {
      if (this.hasView('modeButtons')) this.getModeButtonsView().reRender();
    }

    actionShowSharedCalendarOptions() {
      if (this.isDefaultSharedTimeline()) {
        return this.getParentView().openCalendarEditor(this.getMembershipSelection());
      }

      return super.actionShowSharedCalendarOptions();
    }

    styleDeclinedEvent(event) {
      const color =
        event.color || this.colors[event.scope] || this.getColorFromScopeName(event.scope);
      const faded = this.shadeColor(color, 0.4);

      event.style = `${event.style || ''}background-color:${faded};border-color:${faded};`;
    }

    convertEvent(record) {
      const event = super.convertEvent(record);

      if (event) {
        // Espo turns all-day Task scopes into title-sized boxes at the due time.
        // Tasks with actual start/end times must retain their scheduled range here.
        if (
          record.scope === 'Task' &&
          event.type === 'box' &&
          record.dateStart &&
          record.dateEnd &&
          !record.dateStartDate &&
          !record.dateEndDate
        ) {
          event.type = 'range';
          event.start = this.getDateTime().toMoment(record.dateStart);
          event.end = this.getDateTime().toMoment(record.dateEnd);
        }

        // Use the same detailed tooltip as the grid calendars instead of vis's title popup.
        delete event.title;

        if (record.scope && event.type !== 'background') {
          this.tooltipEvents.set(event.id, {
            id: event.id,
            title: record.name,
            extendedProps: {
              ...record,
              recordId: record.id,
              calendarUserIds: [event.group],
            },
          });
        }
      }

      return event;
    }

    syncTimelineTooltips() {
      const root = this.$timeline?.get(0);

      if (!root) return;

      const elements = new Set(root.querySelectorAll('.vis-item[data-id]'));

      for (const element of this.eventAppearances.keys()) {
        if (!elements.has(element) || !this.tooltipEvents.has(element.getAttribute('data-id'))) {
          this.eventTooltip.detach(element);
          this.eventAppearances.delete(element);
        }
      }

      for (const element of elements) {
        const event = this.tooltipEvents.get(element.getAttribute('data-id'));

        if (!event) continue;

        this.eventAppearances.set(element, { event });
        this.eventTooltip.attach(element);
        Definitions.highlightSearchResult(this);
      }
    }

    runFetch() {
      // Initial loading creates the timeline through afterRender's callback.
      if (!this.timeline) return;

      return super.runFetch();
    }

    applyTimelineEventLayout(events) {
      if (this.timeline) {
        this.applyViewSettings();

        const isNew = this.tooltipTimeline !== this.timeline;
        const configuredGap = this.getConfig().get('calendarPlusTimelineEventGap');
        const spacing = Definitions.viewSettings(
          this.getPreferences(),
          this.mode || 'timeline',
        ).timelineRowHeight;
        const vertical = spacing === 'compact' ? 4 : spacing === 'spacious' ? 22 : 12;
        const gap = Number.isFinite(configuredGap)
          ? Math.max(0, Math.min(100, Math.round(configuredGap)))
          : 0;

        if (isNew || gap !== this.timelineEventGap || vertical !== this.timelineVerticalGap) {
          this.timelineEventGap = gap;
          this.timelineVerticalGap = vertical;
          this.timeline.setOptions({ margin: { item: { horizontal: gap, vertical }, axis: 6 } });
          // Margin changes alone do not invalidate vis's existing row assignments.
          this.timeline.setItems(events);
        }

        if (isNew) {
          this.tooltipTimeline = this.timeline;
          this.timeline.on('changed', () => this.syncTimelineTooltips());
        }
      }
    }

    async fetchEvents(from, to, callback) {
      this.eventTooltip.refresh();
      this.tooltipEvents.clear();

      const revision = (this.fetchRevision = (this.fetchRevision || 0) + 1);

      const deliver = async (events) => {
        events = this.includeSearchResult(events);

        if (Definitions.shouldFilterEvents(this, events)) {
          events = await Definitions.filterEvents(this, events);
        }

        if (this.removed || revision !== this.fetchRevision) return;

        callback(events);

        this.applyTimelineEventLayout(events);

        this.syncTimelineTooltips();
        this.$el
          ?.find('.calendar-type-button-group button[data-toggle="dropdown"]')
          .prop('disabled', false);
      };

      const item = this.getMembershipSelection();

      if (item) {
        try {
          const data = await Espo.Ajax.postRequest('CalendarPlus/Users', {
            ...Definitions.membershipSelection(item),
            ...(Definitions.showInactiveUsers(
              this.getPreferences(),
              this.mode || item.routeMode || 'timeline',
            )
              ? { includeInactiveUsers: true }
              : {}),
          });

          if (this.removed || revision !== this.fetchRevision) return;

          this.userList = data.users;
          this.initGroupsDataSet();

          if (this.timeline) this.timeline.setGroups(this.groupsDataSet);

          if (!this.userList.length) {
            this.fetchedStart = from.clone().subtract(this.leftMargin, 'seconds');
            this.fetchedEnd = to.clone().add(this.rightMargin, 'seconds');
            deliver([]);
            Espo.Ui.notify();

            return;
          }
        } catch (e) {
          if (!this.removed && revision === this.fetchRevision) {
            this.userList = [];
            this.initGroupsDataSet();

            if (this.timeline) this.timeline.setGroups(this.groupsDataSet);

            this.fetchedStart = from.clone();
            this.fetchedEnd = to.clone();
            deliver([]);
          }

          return;
        }
      }

      super.fetchEvents(from, to, deliver);
    }
  };
});
