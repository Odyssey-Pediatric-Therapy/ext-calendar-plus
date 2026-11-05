define('more-timelines:views/calendar/calendar-page', [
  'crm:views/calendar/calendar-page', 'more-timelines:views/calendar/modals/calendar', 'more-timelines:calendar-definitions',
], (Page, CalendarModal, Definitions) => {
  return class extends Page {
    setup() {
      const requested = this.mode || this.options.mode || this.getStorage().get('state', 'calendarMode');
      // Let the core page initialize its services while keeping legacy saved timeline routes valid.
      const item = Definitions.find(this.getPreferences(), requested);
      if (item && !this.options.userId && this.getAcl().getPermissionLevel('userCalendar') !== 'no') {
        this.mode = requested;
      } else if (item) {
        this.mode = 'agendaWeek';
      } else if (requested === 'timeline-personal') {
        this.personalTimeline = true;
        this.mode = 'timeline';
      }
      super.setup();
    }

    setupCalendar() {
      const item = Definitions.find(this.getPreferences(), this.mode);
      if (item?.mode === 'timeline' && !this.options.userId && this.getAcl().getPermissionLevel('userCalendar') !== 'no') {
        return this.mountTimeline(item);
      }
      return super.setupCalendar();
    }

    setupTimeline() {
      return this.mountTimeline(null);
    }

    mountTimeline(item) {
      const mode = item?.routeMode || (this.personalTimeline ? 'timeline-personal' : 'timeline');
      this.mode = mode;
      this.createView('calendar', 'more-timelines:views/calendar/timeline', {
        date: this.date, userId: this.options.userId, userName: this.options.userName,
        mode, calendarType: item ? `saved-${item.id}` : this.personalTimeline ? 'single' : 'shared',
        calendarItem: item, fullSelector: '#main > .calendar-container', onSave: () => this.onSave(),
      }, view => {
        let initial = true;
        this.listenTo(view, 'view', (date, selectedMode) => {
          this.date = date;
          this.mode = selectedMode;
          if (!initial) this.updateUrl();
          initial = false;
        });
        this.listenTo(view, 'change:mode', selectedMode => {
          this.mode = selectedMode;
          if (!this.options.userId) this.getStorage().set('state', 'calendarMode', selectedMode);
          this.updateUrl(true);
        });
      });
    }

    async createCustomView() {
      return this.openCalendarEditor();
    }

    async editCustomView() {
      const item = Definitions.find(this.getPreferences(), this.mode);
      if (item) return this.openCalendarEditor(item);
      const calendar = this.getCalendarView();
      if (calendar?.calendarType === 'shared') return calendar.actionShowSharedCalendarOptions();
    }

    async openCalendarEditor(item = null) {
      if (this.options.userId || this.getAcl().getPermissionLevel('userCalendar') === 'no') return;
      const view = new CalendarModal({
        calendar: item,
        onSave: saved => {
          this.mode = saved ? saved.routeMode : 'agendaWeek';
          this.getStorage().set('state', 'calendarMode', this.mode);
          this.updateUrl(false);
          this.getRouter().dispatch('Calendar', 'show', {mode: this.mode, date: this.date,
            userId: this.options.userId, userName: this.options.userName});
        },
      });
      await this.assignView('modal', view);
      await view.render();
    }
  };
});
