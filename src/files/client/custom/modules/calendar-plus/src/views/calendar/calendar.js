define('calendar-plus:views/calendar/calendar', [
  'crm:views/calendar/calendar',
  'fullcalendar',
  'calendar-plus:calendar-colors',
  'calendar-plus:views/calendar/event-tooltip',
  'calendar-plus:calendar-definitions',
  'calendar-plus:active-calendar',
], (Calendar, FullCalendar, Colors, EventTooltip, Definitions, ActiveCalendar) => {
  // Share the standard calendar's editing callbacks; no scheduler plugin is required.
  const optionNames = [
    'slotMinTime',
    'slotMaxTime',
    'slotDuration',
    'slotLabelInterval',
    'slotLabelFormat',
    'eventTimeFormat',
    'timeZone',
    'firstDay',
    'scrollTime',
    'snapDuration',
    'nowIndicator',
    'weekends',
    'editable',
    'selectable',
    'selectMirror',
    'longPressDelay',
    'allDayText',
    'eventClick',
    'eventAllow',
    'eventDrop',
    'eventResize',
  ];

  return class extends Calendar {
    template = 'calendar-plus:calendar/calendar';

    events = {
      ...this.events,
      'click [data-action="searchCalendar"]': function (event) {
        event.preventDefault();
        this.actionSearchCalendar();
      },
    };

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
      const preview = this.includeSearchResult([])[0];
      const date =
        (preview?.start && this.getDateTime().toMoment(preview.start).format('YYYY-MM-DD')) ||
        record.dateStartDate ||
        record.dateEndDate ||
        this.getDateTime()
          .toMoment(record.dateStart || record.dateEnd)
          .format('YYYY-MM-DD');
      this.calendar.gotoDate(date);
      this.updateDate();
      if (record.dateStart && !record.dateStartDate) {
        this.calendar.scrollToTime(
          this.getDateTime().toMoment(record.dateStart).format('HH:mm:ss'),
        );
      }
      this.actionRefresh();
      Definitions.highlightSearchResult(this);
    }

    includeSearchResult(events) {
      if (
        !this.searchResult?.calendarUserIds?.length ||
        events.some((event) => Definitions.isSearchResult(this, event))
      )
        return events;

      const [event] = this.convertToFcEvents([this.searchResult]);
      if (!event) return events;
      const ids = this.searchResult.calendarUserIds;

      // A search-only preview is read-only; opening the record uses normal permissions.
      return [
        ...events,
        {
          ...event,
          calendarUserIds: ids,
          visibleCalendarUserIds: ids,
          editable: false,
          startEditable: false,
          durationEditable: false,
        },
      ];
    }

    clearSearchReveal() {
      if (!this.searchResult) return;
      this.searchResult = null;
      for (const element of this.eventAppearances.keys())
        element.classList.toggle('cp-search-match', false);
      this.applyViewSettings();
    }

    actionPrevious() {
      this.clearSearchReveal();
      return super.actionPrevious();
    }

    actionNext() {
      this.clearSearchReveal();
      return super.actionNext();
    }

    actionToday() {
      this.clearSearchReveal();
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

    selectMode(mode) {
      if (mode === 'timeline') this.getStorage().set('calendar', 'timelineType', 'shared');

      if (mode === 'timeline-personal') return this.trigger('change:mode', mode, true);

      const previousMode = this.mode;
      const revision = this.requestRevision;
      const result = super.selectMode(mode);

      if (this.mode === mode && this.calendar) {
        this.applyViewSettings(true);

        // A cached Week range can cover Day without invoking the event source again.
        if (previousMode !== mode && this.requestRevision === revision) {
          this.calendar.refetchEvents();
        }
      }

      return result;
    }

    setup() {
      super.setup();
      this.baseSlotDuration = this.slotDuration;
      this.baseScrollHour = this.scrollHour;

      if (this.getConfig().get('calendarPlusTasksAllDay') === false) {
        this.allDayScopeList = this.allDayScopeList.filter((scope) => scope !== 'Task');
      }

      this.extendedProps = [...this.extendedProps, 'calendarUserIds', 'visibleCalendarUserIds'];
      const hidden =
        Definitions.viewSettings(this.getPreferences(), this.mode).rememberHiddenPeople === false
          ? []
          : this.getStorage().get('calendarPlus', this.personFilterKey());
      this.hiddenUserIds = new Set(
        Array.isArray(hidden) ? hidden.filter((id) => typeof id === 'string') : [],
      );
      this.eventElements = new Map();
      this.eventAppearances = new Map();
      this.eventTooltip = new EventTooltip(this);
      this.dayCalendars = [];
      this.sharedUsers = [];
      this.sharedEvents = [];
      this.requestRevision = 0;
      this.pendingPersonDrops = new Set();
      this.on('remove', () => {
        this.sharedRemoved = true;
        this.resetCalendarRendering();
      });
    }

    afterRender() {
      // Core concatenates minutes into HH:mm:ss; FullCalendar requires two minute digits.
      const stored = Definitions.viewSettings(this.getPreferences(), this.mode);
      this.restoreTimePreferences(stored);

      const minutes = this.slotDuration;
      this.slotDuration = String(minutes).padStart(2, '0');

      try {
        const result = super.afterRender();
        ActiveCalendar.register(this);
        this.applyViewSettings();

        return result;
      } finally {
        this.slotDuration = minutes;
      }
    }

    restoreTimePreferences(settings) {
      this.slotDuration = this.baseSlotDuration ?? this.slotDuration;
      this.scrollHour = this.baseScrollHour ?? this.scrollHour;

      if ([5, 10, 15, 30].includes(settings.slotDuration))
        this.slotDuration = settings.slotDuration;

      if (
        Number.isInteger(settings.scrollHour) &&
        settings.scrollHour >= 0 &&
        settings.scrollHour <= 23
      )
        this.scrollHour = settings.scrollHour;
    }

    applyViewSettings(scroll = false) {
      const settings = Definitions.viewSettings(this.getPreferences(), this.mode);
      Definitions.applyAppearance(this);

      if (!this.calendar) return;

      const signature = JSON.stringify([
        this.mode,
        settings,
        this.searchResult?.scope,
        this.searchResult?.id,
      ]);

      if (
        !scroll &&
        this.viewSettingsCalendar === this.calendar &&
        this.viewSettingsSignature === signature
      )
        return;

      this.viewSettingsCalendar = this.calendar;
      this.viewSettingsSignature = signature;
      this.restoreTimePreferences(settings);

      const range = (!this.searchResult && Definitions.timeRange(settings)) || {
        start: '00:00:00',
        end: '24:00:00',
      };
      this.eventTooltip?.refresh();
      this.calendar.batchRendering(() => {
        this.calendar.setOption('slotMinTime', range.start);
        this.calendar.setOption('slotMaxTime', range.end);
        this.calendar.setOption('weekends', !!this.searchResult || settings.showWeekends !== false);
        this.calendar.setOption(
          'slotDuration',
          `00:${String(this.slotDuration).padStart(2, '0')}:00`,
        );
        this.calendar.setOption('snapDuration', Number(this.slotDuration) * 60 * 1000);
        this.calendar.setOption('scrollTime', this.visibleScrollTime());
      });

      if (scroll) {
        this.clearDayColumns();
        this.syncSharedLayout();
        this.calendar.scrollToTime(this.visibleScrollTime());

        if (this.dayColumnsElement) this.syncColumnScroll();
      }

      this.refreshEventGradients();
    }

    visibleScrollTime() {
      const range = (!this.searchResult &&
        Definitions.timeRange(Definitions.viewSettings(this.getPreferences(), this.mode))) || {
        start: '00:00:00',
        end: '24:00:00',
      };

      const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

      const start = minutes(range.start);
      const slot = Number(this.slotDuration) || 30;
      const searchedTime =
        this.searchResult?.dateStart && !this.searchResult.dateStartDate
          ? this.getDateTime().toMoment(this.searchResult.dateStart).format('HH:mm:ss')
          : null;
      const preferred = searchedTime ? minutes(searchedTime) : (this.scrollHour ?? 8) * 60;
      const target = Math.max(start, Math.min(preferred, minutes(range.end) - 1));
      const aligned = start + Math.floor((target - start) / slot) * slot;

      return `${String(Math.floor(aligned / 60)).padStart(2, '0')}:${String(aligned % 60).padStart(2, '0')}:00`;
    }

    handleScrollToNow() {
      // An explicit scroll-hour preference takes priority over today's automatic scroll.
      if (
        Definitions.viewSettings(this.getPreferences(), this.mode).scrollHour != null ||
        this.options.scrollHour != null ||
        this.getPreferences().get('calendarScrollHour') != null
      )
        return;

      return super.handleScrollToNow();
    }

    prepareRender() {
      // Saving a shared view re-renders this instance after replacing its DOM.
      this.resetCalendarRendering();

      return super.prepareRender();
    }

    resetCalendarRendering() {
      this.eventTooltip.reset();
      this.finishPersonDropDrag();
      this.requestRevision++;
      this.clearDayColumns();
      this.clearLegend();
      this.legendButtons = new Map();
      this.eventElements.clear();
      this.eventAppearances.clear();
      this.hoveredUserId = null;
      this.focusedUserId = null;
      this.sharedUsers = [];
      this.sharedEvents = [];
      this.calendar?.destroy();
      this.calendar = null;
    }

    setupMode() {
      super.setupMode();
      const item = (this.getPreferences().get('calendarViewDataList') || []).find(
        (entry) => entry.id === this.viewId,
      );
      this.selectedUserIds = item?.userIdList || [];

      if (this.isCustomView && (this.teamIdList?.length || this.selectedUserIds.length)) {
        this.viewMode =
          { basicDay: 'agendaDay', basicWeek: 'agendaWeek' }[this.viewMode] || this.viewMode;
      }
    }

    isSharedTimeGrid() {
      return (
        this.isCustomView &&
        !!(this.teamIdList?.length || this.selectedUserIds?.length) &&
        ['agendaDay', 'agendaWeek', 'month'].includes(this.viewMode)
      );
    }

    isAgendaMode() {
      return (this.isSharedTimeGrid() && this.viewMode !== 'month') || super.isAgendaMode();
    }

    usePersonGradient() {
      return (
        ['agendaWeek', 'month'].includes(this.viewMode) &&
        this.getConfig().get('calendarPlusColorGradientEnabled') !== false &&
        Definitions.viewSettings(this.getPreferences(), this.mode).showGradient !== false
      );
    }

    statusColor(color, event) {
      const ended =
        event.isDeclined ||
        (this.getEventTypeCompletedStatusList?.(event.scope) || []).includes(event.status) ||
        (this.getEventTypeCanceledStatusList?.(event.scope) || []).includes(event.status);

      if (!color || !ended) return color;
      // Match Espo's status shading; generated person colors can also use HSL.

      if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) return this.shadeColor(color, 0.4);

      const shade = this.getThemeManager().getParam('isDark') ? '#000' : '#fff';

      return `color-mix(in srgb, ${color} 60%, ${shade} 40%)`;
    }

    colorForEvent(event, userId) {
      const color =
        this.usePersonGradient() && userId
          ? this.colorForUser(userId)
          : event.originalColor ||
            Colors.entityColor(this, event.scope) ||
            (userId ? this.colorForUser(userId) : undefined);

      return this.statusColor(color, event) || event.color;
    }

    fillColor(event) {
      super.fillColor(event);
      const ids = event.visibleCalendarUserIds || event.calendarUserIds;

      if (this.isSharedTimeGrid() && ids?.length) {
        event.color = this.colorForEvent(event, ids[0]);
      }
    }

    styleDeclinedEvent(event) {
      const ids = event.visibleCalendarUserIds || event.calendarUserIds;
      event.color = ids?.length
        ? this.colorForEvent(event, ids[0])
        : this.statusColor(event.originalColor || Colors.entityColor(this, event.scope), event);
    }

    assignUserColors(users) {
      this.userColors = Colors.assignUsers(this.getStorage(), users);
    }

    colorForUser(id) {
      return Colors.userColor(this.userColors, id);
    }

    async fetchEvents(from, to, callback) {
      this.eventTooltip.refresh();
      this.syncSharedLayout();

      if (!this.isSharedTimeGrid()) {
        const revision = ++this.requestRevision;

        return super.fetchEvents(from, to, async (events) => {
          events = this.includeSearchResult(events);
          if (Definitions.shouldFilterEvents(this, events)) {
            events = await Definitions.filterEvents(this, events);
          }

          if (!this.sharedRemoved && revision === this.requestRevision) callback(events);
        });
      }

      const revision = ++this.requestRevision;

      const current = () => !this.sharedRemoved && revision === this.requestRevision;

      Espo.Ui.notifyWait();

      try {
        const item = Definitions.find(this.getPreferences(), this.mode);
        const selection = Definitions.membershipSelection({
          teamIdList: this.teamIdList || [],
          userIdList: this.selectedUserIds || [],
          ...item,
        });
        const { users } = await Espo.Ajax.postRequest('CalendarPlus/Users', {
          ...selection,
          ...(Definitions.showInactiveUsers(this.getPreferences(), this.mode)
            ? { includeInactiveUsers: true }
            : {}),
        });

        if (!current()) return;

        const query = {
          from,
          to,
          agenda: this.viewMode !== 'month',
          userIdList: users.map((user) => user.id).join(','),
          scopeList: this.enabledScopeList.join(','),
        };
        const data = users.length ? await Espo.Ajax.getRequest('Activities', query) : [];

        if (!current()) return;

        const events = this.convertSharedEvents(data, users);
        const filtered = await Definitions.filterEvents(this, this.includeSearchResult(events));

        if (!current()) return;

        // Publish users and events together only after all asynchronous work is current.
        this.sharedUsers = users;
        this.assignUserColors(users);
        this.sharedEvents = filtered.map((event) => ({
          ...event,
          color: this.colorForEvent(event, event.calendarUserIds[0]),
        }));
        callback(this.sharedEvents.map((event) => this.filteredEvent(event)));
        this.syncSharedLayout();
        Espo.Ui.notify();
      } catch (error) {
        if (!current()) return;

        this.sharedUsers = [];
        this.sharedEvents = [];
        callback([]);
        this.syncSharedLayout();
        Espo.Ui.error(this.translate('Could not load shared calendar', 'messages', 'Calendar'));
      }
    }

    convertSharedEvents(data, users) {
      const allowedIds = new Set(users.map((user) => user.id));
      const merged = new Map();
      for (const event of data) {
        const key = `${event.scope}-${event.id}`;
        const previous = merged.get(key);
        const ids = [
          ...new Set([
            ...(previous?.userIdList || []),
            ...(event.userIdList || []),
            ...(event.userId ? [event.userId] : []),
          ]),
        ];
        merged.set(key, { ...event, userIdList: ids });
      }
      const records = [...merged.values()];
      return this.convertToFcEvents(records)
        .map((event, index) => {
          const ids = records[index].userIdList.filter((id) => allowedIds.has(id)).sort();

          return {
            ...event,
            calendarUserIds: ids,
            color: this.colorForEvent(event, ids[0]),
            textColor: '#fff',
          };
        })
        .filter((event) => event.calendarUserIds.length || event.display === 'inverse-background');
    }

    updateDate() {
      // Core creates FullCalendar asynchronously, after afterRender returns.
      this.applyViewSettings();
      super.updateDate();
      this.syncSharedLayout();
    }

    syncSharedLayout() {
      if (!this.calendar || this.sharedRemoved) return;

      this.calendar.setOption('eventContent', (info) => this.sharedEventContent(info));
      this.calendar.setOption('eventDidMount', (info) => this.registerEventElement(info));
      this.calendar.setOption('eventWillUnmount', (info) => this.unregisterEventElement(info));
      this.calendar.setOption('eventResizeStart', () => this.eventTooltip.hide());
      this.calendar.setOption('eventDragStart', () => this.eventTooltip.hide());

      if (!this.isSharedTimeGrid()) {
        this.clearDayColumns();
        this.clearLegend();
        this.$calendar.show();

        return;
      }

      this.calendar.setOption('slotEventOverlap', false);
      this.calendar.setOption(
        'eventDragStart',
        this.viewMode === 'agendaWeek'
          ? (info) => this.startPersonDropDrag(info, this.calendar)
          : () => this.eventTooltip.hide(),
      );
      this.calendar.setOption(
        'eventDragStop',
        this.viewMode === 'agendaWeek' ? (info) => this.stopPersonDropDrag(info) : null,
      );
      this.renderLegend();

      if (this.viewMode === 'agendaDay') {
        this.$calendar.hide();
        this.renderDayColumns();
      } else {
        this.clearDayColumns();
        this.$calendar.show();
        this.calendar.updateSize();
      }

      this.refreshEventGradients();
    }

    sharedEventContent(info) {
      const frame = document.createElement('div');
      frame.className = 'fc-event-main-frame cp-calendar-event-content';

      if (info.timeText) {
        const time = document.createElement('div');
        time.className = 'fc-event-time';
        time.textContent = info.timeText;
        frame.append(time);
      }

      const titleContainer = document.createElement('div');
      titleContainer.className = 'fc-event-title-container';
      const title = document.createElement('div');
      title.className = 'fc-event-title';
      title.textContent = info.event.title;
      titleContainer.append(title);
      frame.append(titleContainer);

      return { domNodes: [frame] };
    }

    personFilterKey() {
      return `hiddenCalendarUsers:${this.viewId || this.mode}`;
    }

    visibleUsers() {
      return this.sharedUsers.filter(
        (user) =>
          !this.hiddenUserIds.has(user.id) || this.searchResult?.calendarUserIds?.includes(user.id),
      );
    }

    filteredEvent(event) {
      const ids = event.calendarUserIds.filter(
        (id) => Definitions.isSearchResult(this, event) || !this.hiddenUserIds.has(id),
      );
      const background = event.display === 'inverse-background';

      return {
        ...event,
        visibleCalendarUserIds: ids,
        display: ids.length || background ? event.display || 'block' : 'none',
        color: this.colorForEvent(event, ids[0]),
      };
    }

    setPersonVisible(id, visible) {
      if (visible) this.hiddenUserIds.delete(id);
      else this.hiddenUserIds.add(id);

      this.applyPersonFilters();
    }

    setAllPeopleVisible(visible) {
      for (const user of this.sharedUsers) {
        if (visible) this.hiddenUserIds.delete(user.id);
        else this.hiddenUserIds.add(user.id);
      }
      this.applyPersonFilters();
    }

    applyPersonFilters() {
      this.eventTooltip.hide();
      // Toggling visibility should not leave the clicked button's focus/hover spotlight active.
      this.hoveredUserId = null;
      this.focusedUserId = null;
      this.getStorage().set(
        'calendarPlus',
        this.personFilterKey(),
        Definitions.viewSettings(this.getPreferences(), this.mode).rememberHiddenPeople === false
          ? []
          : [...this.hiddenUserIds],
      );
      // Keep the original event source so Refresh and date navigation still fetch normally.
      this.calendar.batchRendering(() => {
        for (const event of this.calendar.getEvents()) {
          const source = this.sharedEvents.find((item) => item.id === event.id);

          if (!source) continue;

          const filtered = this.filteredEvent(source);
          event.setExtendedProp('visibleCalendarUserIds', filtered.visibleCalendarUserIds);
          event.setProp('display', filtered.display);
          event.setProp('backgroundColor', filtered.color);
          event.setProp('borderColor', filtered.color);
        }
      });
      this.refreshEventGradients();
      this.refreshLegendState();

      if (this.viewMode === 'agendaDay') this.renderDayColumns();

      this.updatePersonHighlight();
    }

    registerEventElement(info, userId) {
      this.eventElements.set(
        info.el,
        userId ? [userId] : info.event.extendedProps.calendarUserIds || [],
      );
      this.eventAppearances.set(info.el, { event: info.event, userId });

      if (info.event.extendedProps.scope && info.event.display !== 'inverse-background') {
        this.eventTooltip.attach(info.el);
      }

      this.paintEventGradient(info.el, info.event, userId);
      Definitions.highlightSearchResult(this);
      this.updatePersonHighlight();
    }

    unregisterEventElement(info) {
      this.eventTooltip.detach(info.el);
      this.eventElements.delete(info.el);
      this.eventAppearances.delete(info.el);
    }

    refreshEventGradients() {
      for (const [element, { event, userId }] of this.eventAppearances) {
        this.paintEventGradient(element, event, userId);
      }
    }

    paintEventGradient(element, event, userId) {
      // Mounted EventApi objects can outlive a refetch; use the current membership data.
      const source = this.sharedEvents.find((item) => item.id === event.id);
      const ids = (source?.calendarUserIds || event.extendedProps.calendarUserIds || []).filter(
        (id) => !this.hiddenUserIds.has(id),
      );
      const person = userId || ids[0];
      const record = { ...event.extendedProps, ...source };
      const entity = this.statusColor(
        record.originalColor || Colors.entityColor(this, record.scope),
        record,
      );
      const personColor = person ? this.statusColor(this.colorForUser(person), record) : null;
      const styled = !!person && !!entity && event.display !== 'inverse-background';
      const gradient = styled && this.usePersonGradient();
      element.classList.toggle('cp-event-gradient', gradient);
      element.style.backgroundImage = gradient ? Colors.gradient(personColor, entity) : '';

      if (styled) {
        element.style.backgroundColor = gradient ? personColor : entity;
        element.style.borderColor = gradient ? personColor : entity;
      }
    }

    updatePersonHighlight() {
      const candidate = this.hoveredUserId || this.focusedUserId;
      const id = candidate && !this.hiddenUserIds.has(candidate) ? candidate : null;
      for (const [element, ids] of this.eventElements) {
        element.classList.toggle('cp-person-event-dimmed', !!id && !ids.includes(id));
        element.classList.toggle('cp-person-event-highlighted', !!id && ids.includes(id));
      }
    }

    colorSwatch(id) {
      const swatch = document.createElement('span');
      const name = this.sharedUsers.find((user) => user.id === id)?.name || '';
      const parts = name.trim().split(/\s+/).filter(Boolean);
      swatch.textContent = (
        parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)
      ).toUpperCase();
      swatch.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;flex-shrink:0;border-radius:50%;border:2px solid ${this.colorForUser(id)};background:#fff;color:#222;font-size:10px;font-weight:700;line-height:1;`;
      swatch.title = name;
      swatch.setAttribute('aria-label', name);

      return swatch;
    }

    refreshLegendState() {
      for (const [id, { button, status }] of this.legendButtons || []) {
        const visible = !this.hiddenUserIds.has(id);
        button.setAttribute('aria-pressed', String(visible));
        button.style.opacity = visible ? '1' : '0.5';
        status.textContent = visible ? '✓' : '−';
        button.title = this.translate(
          visible ? 'Hide person events' : 'Show person events',
          'labels',
          'Calendar',
        );
      }
    }

    renderLegend() {
      if (!this.legendElement) {
        this.legendElement = document.createElement('div');
        this.legendElement.setAttribute(
          'aria-label',
          this.translate('Calendar users', 'labels', 'Calendar'),
        );
        this.legendElement.className = 'dropdown cp-person-legend';
        this.legendElement.style.cssText = 'padding:10px 0;';
        this.$calendar.before(this.legendElement);
      }

      this.legendElement.replaceChildren();
      const style = document.createElement('style');
      style.textContent =
        '.cp-person-event-dimmed {opacity:.18 !important;} .cp-person-event-highlighted {outline:2px solid var(--text-color, #222);outline-offset:2px;} .cp-person-toggle:focus-visible {outline:2px solid var(--text-color, #222);outline-offset:2px;}';
      this.legendElement.append(style);
      const toggle = this.createLegendToggle();
      const items = document.createElement('div');
      items.className = 'dropdown-menu cp-person-legend-items';
      items.setAttribute('role', 'group');
      items.setAttribute('aria-label', this.translate('Calendar users', 'labels', 'Calendar'));
      this.legendElement.append(toggle, items);
      this.legendItems = items;
      this.legendButtons = new Map();
      this.hoveredUserId = null;
      this.focusedUserId = null;
      for (const user of this.sharedUsers) {
        const { button, status } = this.createPersonToggle(user);
        this.legendButtons.set(user.id, { button, status });
        items.append(button);
      }

      this.appendLegendActions(items);

      this.refreshLegendState();
      this.updatePersonHighlight();
      this.updateLegendLayout();
      if (!this.legendResizeObserver && typeof ResizeObserver !== 'undefined') {
        this.legendResizeObserver = new ResizeObserver(() => this.updateLegendLayout());
        this.legendResizeObserver.observe(this.legendElement);
      }
    }

    createLegendToggle() {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'btn btn-default dropdown-toggle cp-person-legend-toggle';
      toggle.setAttribute('data-toggle', 'dropdown');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.disabled = !this.sharedUsers.length;
      const icon = document.createElement('span');
      icon.className = 'fas fa-users';
      icon.setAttribute('aria-hidden', 'true');
      const caret = document.createElement('span');
      caret.className = 'caret';
      caret.setAttribute('aria-hidden', 'true');
      toggle.append(
        icon,
        document.createTextNode(this.translate('Calendar users', 'labels', 'Calendar')),
        caret,
      );
      return toggle;
    }

    createPersonToggle(user) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-default btn-sm cp-person-toggle';
      button.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
      const status = document.createElement('span');
      status.setAttribute('aria-hidden', 'true');
      const badge = this.colorSwatch(user.id);
      badge.setAttribute('aria-hidden', 'true');
      button.append(badge, document.createTextNode(user.name), status);
      button.addEventListener('click', (event) => {
        event?.stopPropagation();
        if (!this.personDropDrag) this.setPersonVisible(user.id, this.hiddenUserIds.has(user.id));
      });
      button.addEventListener('mouseenter', () => {
        this.hoveredUserId = user.id;
        this.updatePersonHighlight();
      });
      button.addEventListener('mouseleave', () => {
        this.hoveredUserId = null;
        this.updatePersonHighlight();
      });
      button.addEventListener('focus', () => {
        this.focusedUserId = user.id;
        this.updatePersonHighlight();
      });
      button.addEventListener('blur', () => {
        this.focusedUserId = null;
        this.updatePersonHighlight();
      });
      return { button, status };
    }

    appendLegendActions(items) {
      if (this.sharedUsers.length) {
        for (const [label, visible] of [
          ['Show all people', true],
          ['Hide all people', false],
        ]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn btn-text btn-sm';
          button.textContent = this.translate(label, 'labels', 'Calendar');
          button.addEventListener('click', (event) => {
            event?.stopPropagation();
            this.setAllPeopleVisible(visible);
          });
          items.append(button);
        }
      } else {
        const empty = document.createElement('span');
        empty.textContent = this.translate('No calendar users', 'messages', 'Calendar');
        items.append(empty);
      }
    }

    updateLegendLayout() {
      const legend = this.legendElement;
      if (!legend?.clientWidth || !this.legendItems) return;

      // Measure the single-row buttons even while the live menu is collapsed.
      const measure = this.legendItems.cloneNode(true);
      measure.className = 'cp-person-legend-measure';
      measure.setAttribute('aria-hidden', 'true');
      measure.style.cssText =
        'position:absolute;visibility:hidden;pointer-events:none;display:flex;flex-wrap:nowrap;align-items:center;gap:8px;width:max-content;max-width:none;top:0;left:0;';
      legend.append(measure);
      const requiredWidth = measure.getBoundingClientRect().width;
      measure.remove();
      legend.classList.toggle('cp-person-legend-compact', requiredWidth > legend.clientWidth + 1);
    }

    clearLegend() {
      this.legendResizeObserver?.disconnect();
      this.legendResizeObserver = null;
      this.legendElement?.remove();
      this.legendElement = null;
      this.legendItems = null;
    }

    clearDayColumns() {
      for (const { calendar } of this.dayCalendars || []) calendar.destroy();
      this.dayCalendars = [];
      this.dayColumnsElement?.remove();
      this.dayColumnsElement = null;
    }

    renderDayColumns() {
      const users = this.visibleUsers();
      const key = users.map((user) => `${user.id}:${user.name}`).join('|');
      const date = this.calendar.getDate().valueOf();
      const dateChanged = this.dayColumnsDate !== date;
      this.dayColumnsDate = date;
      let reposition = dateChanged;
      let scrollTop;

      if (key !== this.dayColumnsKey || !this.dayColumnsElement) {
        // An empty loading placeholder has no meaningful scroll position to restore.
        scrollTop =
          !dateChanged && this.dayCalendars.length ? this.dayColumnsElement?.scrollTop : undefined;
        const scrollLeft = this.dayColumnsElement?.scrollLeft;
        this.clearDayColumns();
        this.dayColumnsKey = key;
        this.dayColumnsElement = document.createElement('div');
        this.dayColumnsElement.className = 'calendar-plus-day-columns';
        const style = document.createElement('style');
        style.textContent =
          '.calendar-plus-day-columns .fc-daygrid-day-frame {height:76px;min-height:76px;max-height:76px;overflow:auto;} .calendar-plus-day-columns .fc-timegrid-slot {height:24px;}';
        this.dayColumnsElement.append(style);
        this.dayColumnsElement.style.cssText =
          'display:flex;overflow-x:auto;align-items:flex-start;';
        this.$calendar.after(this.dayColumnsElement);
        for (const user of users) this.createDayColumn(user);

        if (!users.length && this.sharedUsers.length) {
          const empty = document.createElement('p');
          empty.className = 'text-muted';
          empty.textContent = this.translate('All calendar people hidden', 'messages', 'Calendar');
          this.dayColumnsElement.append(empty);
        }

        reposition = true;

        if (scrollLeft !== undefined) this.dayColumnsElement.scrollLeft = scrollLeft;
      }

      for (const { calendar, userId } of this.dayCalendars) {
        calendar.batchRendering(() => {
          calendar.gotoDate(this.calendar.getDate());
          calendar.removeAllEventSources();
          calendar.removeAllEvents();
          calendar.addEventSource(
            this.sharedEvents
              .filter(
                (event) =>
                  event.calendarUserIds.includes(userId) || event.display === 'inverse-background',
              )
              .map((event) => ({ ...event, color: this.colorForEvent(event, userId) })),
          );
        });
      }

      if (reposition) {
        const container = this.dayColumnsElement;
        this.syncColumnScroll(scrollTop);
        // Reapply once event sources and date changes have completed their DOM updates.
        queueMicrotask(() => {
          if (
            !this.sharedRemoved &&
            this.dayColumnsElement === container &&
            this.dayColumnsDate === date
          ) {
            this.syncColumnScroll(scrollTop);
          }
        });
      }
    }

    createDayColumn(user) {
      const column = document.createElement('section');
      column.style.cssText = 'flex:1 0 220px;min-width:220px;';
      const header = document.createElement('div');
      header.style.cssText = `position:sticky;top:0;z-index:5;background:var(--table-bg, #fff);height:44px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:10px;font-weight:600;text-align:center;border-top:3px solid ${this.colorForUser(user.id)};`;
      header.title = user.name;
      header.textContent = user.name;
      const body = document.createElement('div');
      column.append(header, body);
      this.dayColumnsElement.append(column);
      const options = Object.fromEntries(
        optionNames.map((name) => [name, this.calendar.getOption(name)]),
      );
      const select = this.calendar.getOption('select');
      const calendar = new FullCalendar.Calendar(body, {
        ...options,
        initialView: 'timeGridDay',
        initialDate: this.calendar.getDate(),
        headerToolbar: false,
        dayHeaders: false,
        slotEventOverlap: false,
        // A shared scroll container keeps every user's time slots aligned.
        height: 'auto',
        allDaySlot: true,
        dayMaxEvents: 2,
        droppable: true,
        select: (info) => {
          const original = this.options;
          this.options = { ...original, userId: user.id, userName: user.name };

          try {
            select(info);
          } finally {
            this.options = original;
          }

          calendar.unselect();
        },
        eventAllow: (drop, event) =>
          !!this.personDropDrag &&
          this.dayCalendars.some((item) => item.calendar === this.personDropDrag.calendar) &&
          (!options.eventAllow || options.eventAllow(drop, event)),
        eventDragStart: (info) => this.startPersonDropDrag(info, calendar),
        eventDragStop: (info) => this.stopPersonDropDrag(info),
        eventLeave: (info) => {
          if (this.personDropDrag) this.personDropDrag.restoreSource = info.revert;
        },
        eventReceive: (info) => this.receivePersonDrop(info, user.id),
        eventContent: (info) => this.sharedEventContent(info),
        eventDidMount: (info) => this.registerEventElement(info, user.id),
        eventWillUnmount: (info) => this.unregisterEventElement(info),
        eventDrop: async (info) => {
          await options.eventDrop(info);
          this.actionRefresh();
        },
        eventResize: async (info) => {
          await options.eventResize(info);
          this.actionRefresh();
        },
      });
      this.dayCalendars.push({ calendar, userId: user.id });
      calendar.render();
    }

    legendUserAt(jsEvent) {
      const point = jsEvent?.changedTouches?.[0] || jsEvent?.touches?.[0] || jsEvent;

      if (!point || !Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return null;

      for (const [id, { button }] of this.legendButtons || []) {
        const rect = button.getBoundingClientRect();

        if (
          rect.right > rect.left &&
          rect.bottom > rect.top &&
          point.clientX >= rect.left &&
          point.clientX <= rect.right &&
          point.clientY >= rect.top &&
          point.clientY <= rect.bottom
        )
          return id;
      }

      return null;
    }

    personDropField(scope) {
      for (const name of ['users', 'collaborators']) {
        const field = this.getMetadata().get(['entityDefs', scope, 'fields', name]);
        const link = this.getMetadata().get(['entityDefs', scope, 'links', name]);

        if (field?.type === 'linkMultiple' && link?.entity === 'User') return name;
      }

      return 'assignedUser';
    }

    startPersonDropDrag(info, calendar) {
      this.eventTooltip.hide();
      this.finishPersonDropDrag();
      this.personDropDrag = { event: info.event, calendar };
      this.legendElement?.classList.toggle('cp-person-drop-active', true);
      const label = {
        users: 'Drop to add attendee',
        collaborators: 'Drop to add collaborator',
        assignedUser: 'Drop to reassign',
      }[this.personDropField(info.event.extendedProps?.scope)];
      for (const [id, { button }] of this.legendButtons || []) {
        button.title =
          this.translate(label, 'labels', 'Calendar') +
          ' · ' +
          (this.sharedUsers.find((user) => user.id === id)?.name || '');
      }
      this.personDropPointerMove = (event) => {
        const target = this.legendUserAt(event);
        for (const [id, { button }] of this.legendButtons || []) {
          button.classList.toggle('cp-person-drop-target', id === target);
        }
      };
      document.addEventListener('pointermove', this.personDropPointerMove);
      document.addEventListener('touchmove', this.personDropPointerMove, { passive: true });
    }

    stopPersonDropDrag(info) {
      const drag = this.personDropDrag;
      const userId = this.legendUserAt(info.jsEvent);

      if (drag && userId) {
        drag.legendDrop = true;
        // The legend is outside FullCalendar's date grid; its own drag reverts naturally.
        void this.dropEventOnPerson(info.event, userId);
      }
      // FullCalendar emits eventLeave/eventReceive immediately after eventDragStop.

      queueMicrotask(() => {
        if (this.personDropDrag === drag) this.finishPersonDropDrag();
      });
    }

    finishPersonDropDrag() {
      if (this.personDropPointerMove) {
        document.removeEventListener('pointermove', this.personDropPointerMove);
        document.removeEventListener('touchmove', this.personDropPointerMove);
        this.personDropPointerMove = null;
      }

      this.personDropDrag = null;
      this.legendElement?.classList.toggle('cp-person-drop-active', false);
      for (const { button } of this.legendButtons?.values() || []) {
        button.classList.toggle('cp-person-drop-target', false);
      }
      this.refreshLegendState();
    }

    async receivePersonDrop(info, userId) {
      const drag = this.personDropDrag;
      const receivingCalendar = this.dayCalendars.find((item) => item.userId === userId)?.calendar;

      const revert = () => {
        if (this.sharedRemoved) return;

        const targetActive = this.dayCalendars.some((item) => item.calendar === receivingCalendar);
        const sourceActive = this.dayCalendars.some((item) => item.calendar === drag?.calendar);

        if (targetActive) info.revert();

        if (sourceActive) drag?.restoreSource?.();

        if (!targetActive || (drag && !sourceActive)) this.actionRefresh();
      };
      // Only accept events dragged from a column in this shared calendar.

      if (
        !drag ||
        drag.legendDrop ||
        !this.dayCalendars.some((item) => item.calendar === drag.calendar) ||
        drag.event.id !== info.event.id ||
        drag.event.allDay !== info.event.allDay
      ) {
        revert();

        return;
      }

      return this.dropEventOnPerson(info.event, userId, {
        moveTime: true,
        originalEvent: drag.event,
        revert,
      });
    }

    movedEventDates(event, originalEvent) {
      const props = event.extendedProps;
      const attributes = {};
      const delta = event.start.getTime() - originalEvent.start.getTime();
      for (const name of ['dateStart', 'dateEnd']) {
        if (!props[name]) continue;

        const value = this.getDateTime()
          .toMoment(props[name])
          .add(delta, 'milliseconds')
          .format(this.getDateTime().internalDateTimeFormat);
        attributes[name] = this.convertDateTime(value);
      }

      if (props.dateStartDate) attributes.dateStartDate = event.startStr.slice(0, 10);

      if (props.dateEndDate) {
        const end = new Date((event.endStr || event.startStr).slice(0, 10) + 'T00:00:00Z');

        if (event.endStr) end.setUTCDate(end.getUTCDate() - 1);

        attributes.dateEndDate = end.toISOString().slice(0, 10);
      }

      return attributes;
    }

    async dropEventOnPerson(
      event,
      userId,
      { moveTime = false, originalEvent = null, revert = () => {} } = {},
    ) {
      const { scope, recordId } = event.extendedProps;
      const key = `${scope}-${recordId}`;
      const user = this.sharedUsers.find((item) => item.id === userId);

      if (!user || !scope || !recordId || this.pendingPersonDrops.has(key)) {
        revert();

        return false;
      }

      this.pendingPersonDrops.add(key);

      try {
        const fieldName = this.personDropField(scope);
        this.assertPersonFieldEditable(scope, fieldName);

        const model = await this.getModelFactory().create(scope);
        model.id = recordId;
        await model.fetch();

        if (!this.getAcl().checkModel(model, 'edit')) throw new Error('Event is not editable.');

        const dates = moveTime ? this.movedEventDates(event, originalEvent) : {};
        this.assertDropDatesEditable(scope, dates);
        const attributes = this.personDropAttributes(model, fieldName, userId, dates);

        if (Object.keys(attributes).length) {
          Espo.Ui.notify(this.translate('saving', 'messages'));
          this.options.onSave?.();
          await model.save(attributes, { patch: true, wait: true });
        }

        if (!this.sharedRemoved) {
          this.hiddenUserIds.delete(userId);
          this.getStorage().set(
            'calendarPlus',
            this.personFilterKey(),
            Definitions.viewSettings(this.getPreferences(), this.mode).rememberHiddenPeople ===
              false
              ? []
              : [...this.hiddenUserIds],
          );
          this.actionRefresh();
          Espo.Ui.notify();
        }

        return true;
      } catch (error) {
        revert();

        if (!this.sharedRemoved)
          Espo.Ui.error(this.translate('Could not update event', 'messages', 'Calendar'));

        return false;
      } finally {
        this.pendingPersonDrops.delete(key);
      }
    }

    assertPersonFieldEditable(scope, fieldName) {
      const field = this.getMetadata().get(['entityDefs', scope, 'fields', fieldName]);

      if (
        !field ||
        field.readOnly ||
        field.readOnlyAfterCreate ||
        field.disabled ||
        !this.getAcl().checkField(scope, fieldName, 'edit')
      ) {
        throw new Error('The participant or assignment field is not editable.');
      }

      if (fieldName !== 'assignedUser' && !this.getAcl().checkField(scope, fieldName, 'read')) {
        throw new Error('The current participant list is not readable.');
      }
    }

    assertDropDatesEditable(scope, dates) {
      for (const name of Object.keys(dates)) {
        const fieldName = name.endsWith('Date') ? name.slice(0, -4) : name;
        const dateField = this.getMetadata().get(['entityDefs', scope, 'fields', fieldName]);

        if (dateField?.readOnly || !this.getAcl().checkField(scope, fieldName, 'edit')) {
          throw new Error('Dates are not editable.');
        }
      }
    }

    personDropAttributes(model, fieldName, userId, dates) {
      const attributes = { ...dates };

      if (fieldName !== 'assignedUser') {
        const attribute = `${fieldName}Ids`;
        const participantIds = model.get(attribute);

        if (!Array.isArray(participantIds))
          throw new Error('The current participant list is unavailable.');
        // Append only: preserve all existing participants, response statuses, and ownership.

        if (!participantIds.includes(userId))
          attributes[attribute] = [...new Set([...participantIds, userId])];
      } else if (model.get('assignedUserId') !== userId) {
        attributes.assignedUserId = userId;
      }
      return attributes;
    }

    syncColumnScroll(scrollTop) {
      // The columns have natural height inside one vertical viewport.
      const container = this.dayColumnsElement;
      container.style.maxHeight = `${this.getCalculatedHeight()}px`;
      container.style.overflowY = 'auto';

      if (scrollTop !== undefined) {
        container.scrollTop = scrollTop;

        return;
      }

      const slot = container.querySelector(`[data-time="${this.visibleScrollTime()}"]`);

      if (slot) {
        const header = container.querySelector('section > div:first-child');
        const headerHeight = header?.getBoundingClientRect().height || 0;
        container.scrollTop = Math.max(
          0,
          (container.scrollTop || 0) +
            slot.getBoundingClientRect().top -
            container.getBoundingClientRect().top -
            headerHeight,
        );
      }
    }

    addModel(model) {
      this.eventTooltip.refresh();

      if (this.isSharedTimeGrid()) return this.actionRefresh();

      return super.addModel(model);
    }

    updateModel(model) {
      this.eventTooltip.refresh();

      if (this.isSharedTimeGrid()) return this.actionRefresh();

      return super.updateModel(model);
    }

    removeModel(model) {
      this.eventTooltip.refresh();

      if (this.isSharedTimeGrid()) return this.actionRefresh();

      return super.removeModel(model);
    }
  };
});
