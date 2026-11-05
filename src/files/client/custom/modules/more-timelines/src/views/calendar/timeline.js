define('more-timelines:views/calendar/timeline', [
  'crm:views/calendar/timeline', 'more-timelines:calendar-definitions', 'more-timelines:calendar-colors',
], (Timeline, Definitions, Colors) => {
  return class extends Timeline {
    template = 'more-timelines:calendar/timeline';

    setup() {
      this.calendarTypeList = ['single', 'shared', ...this.getTimelines().map(item => `saved-${item.id}`)];
      super.setup();
      if (!this.calendarTypeList.includes(this.calendarType) ||
          (!this.isCustomViewAvailable && this.calendarType.startsWith('saved-'))) {
        this.calendarType = 'single';
      }
      this.on('remove', () => { this.removed = true; this.fetchRevision++; });
    }

    createView(name, view, options, callback) {
      return super.createView(name, name === 'modeButtons' ? 'more-timelines:views/calendar/mode-buttons' : view, options, callback);
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

    fillColor(event) {
      super.fillColor(event);
      if (!event.scope || event.type === 'background') return;
      this.userColors ||= Colors.assignUsers(this.getStorage(), this.userList || []);
      const person = Colors.userColor(this.userColors, event.group);
      const entity = Colors.entityColor(this, event.scope);
      event.style += `background-image:${Colors.gradient(person, entity)};border-color:${person};color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.55);`;
    }

    runFetch() {
      // Initial loading creates the timeline through afterRender's callback.
      if (!this.timeline) return;
      return super.runFetch();
    }

    async fetchEvents(from, to, callback) {
      const revision = this.fetchRevision = (this.fetchRevision || 0) + 1;
      const deliver = events => {
        if (this.removed || revision !== this.fetchRevision) return;
        callback(events);
        this.$el?.find('.calendar-type-button-group button[data-toggle="dropdown"]').prop('disabled', false);
      };
      const item = this.getMembershipSelection();
      if (item) {
        try {
          const data = await Espo.Ajax.postRequest('MoreTimelines/Users', {
            teamIdList: item.teamIdList || [], userIdList: item.userIdList || [],
          });
          if (this.removed || revision !== this.fetchRevision) return;
          this.userList = data.users;
          this.userColors = Colors.assignUsers(this.getStorage(), this.userList);
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
