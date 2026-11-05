define('calendar-plus:views/calendar/timeline', [
  'crm:views/calendar/timeline', 'calendar-plus:calendar-definitions', 'calendar-plus:views/calendar/event-tooltip',
], (Timeline, Definitions, EventTooltip) => {
  return class extends Timeline {
    template = 'calendar-plus:calendar/timeline';

    setup() {
      this.eventAppearances = new Map();
      this.tooltipEvents = new Map();
      this.eventTooltip = new EventTooltip(this);
      this.calendarTypeList = ['single', 'shared', ...this.getTimelines().map(item => `saved-${item.id}`)];
      super.setup();
      if (!this.calendarTypeList.includes(this.calendarType) ||
          (!this.isCustomViewAvailable && this.calendarType.startsWith('saved-'))) {
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

    createView(name, view, options, callback) {
      return super.createView(name, name === 'modeButtons' ? 'calendar-plus:views/calendar/mode-buttons' : view, options, callback);
    }

    getTimelines() {
      return Definitions.list(this.getPreferences()).filter(item => item.mode === 'timeline');
    }

    getSelectedTimeline() {
      if (this.isCustomViewAvailable === false) return;
      return this.options.calendarItem || this.getTimelines().find(item => `saved-${item.id}` === this.calendarType);
    }

    isDefaultSharedTimeline() {
      return this.calendarType === 'shared' && this.isCustomViewAvailable &&
        !this.options.userId && !this.options.userList;
    }

    getMembershipSelection() {
      return this.getSelectedTimeline() || (this.isDefaultSharedTimeline() ?
        Definitions.sharedTimeline(this.getPreferences(), this.getUser()) : null);
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
        timelineEditable: !!this.getSelectedTimeline() || (this.calendarType === 'shared' && this.isCustomViewAvailable),
      };
    }

    getCalendarTypeDataList() {
      const list = super.getCalendarTypeDataList();
      if (!this.options.userId && this.getAcl().getPermissionLevel('userCalendar') !== 'no') {
        this.getTimelines().forEach(item => list.push({
          type: `saved-${item.id}`, label: item.name, disabled: this.calendarType !== `saved-${item.id}`,
        }));
      }
      return list;
    }

    getCalendarTypeLabel(type) {
      const item = this.getTimelines().find(item => `saved-${item.id}` === type);
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

    convertEvent(record) {
      const event = super.convertEvent(record);
      if (event) {
        // Use the same detailed tooltip as the grid calendars instead of vis's title popup.
        delete event.title;
        if (record.scope && event.type !== 'background') {
          this.tooltipEvents.set(event.id, {id: event.id, title: record.name, extendedProps: {
            ...record, recordId: record.id, calendarUserIds: [event.group],
          }});
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
        this.eventAppearances.set(element, {event});
        this.eventTooltip.attach(element);
      }
    }

    runFetch() {
      // Initial loading creates the timeline through afterRender's callback.
      if (!this.timeline) return;
      return super.runFetch();
    }

    async fetchEvents(from, to, callback) {
      this.eventTooltip.refresh();
      this.tooltipEvents.clear();
      const revision = this.fetchRevision = (this.fetchRevision || 0) + 1;
      const deliver = events => {
        if (this.removed || revision !== this.fetchRevision) return;
        callback(events);
        if (this.timeline) {
          const isNew = this.tooltipTimeline !== this.timeline;
          const configuredGap = this.getConfig().get('calendarPlusTimelineEventGap');
          const gap = Number.isFinite(configuredGap) ? Math.max(0, Math.min(100, Math.round(configuredGap))) : 0;
          if (isNew || gap !== this.timelineEventGap) {
            this.timelineEventGap = gap;
            this.timeline.setOptions({margin: {item: {horizontal: gap, vertical: 12}, axis: 6}});
            // Margin changes alone do not invalidate vis's existing row assignments.
            this.timeline.setItems(events);
          }
          if (isNew) {
            this.tooltipTimeline = this.timeline;
            this.timeline.on('changed', () => this.syncTimelineTooltips());
          }
        }
        this.syncTimelineTooltips();
        this.$el?.find('.calendar-type-button-group button[data-toggle="dropdown"]').prop('disabled', false);
      };
      const item = this.getMembershipSelection();
      if (item) {
        try {
          const data = await Espo.Ajax.postRequest('CalendarPlus/Users', {
            teamIdList: item.teamIdList || [], userIdList: item.userIdList || [],
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
