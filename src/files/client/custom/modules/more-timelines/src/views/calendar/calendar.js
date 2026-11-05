define('more-timelines:views/calendar/calendar', [
  'crm:views/calendar/calendar', 'fullcalendar', 'more-timelines:calendar-colors', 'more-timelines:views/calendar/event-tooltip',
], (Calendar, FullCalendar, Colors, EventTooltip) => {
  // Share the standard calendar's editing callbacks; no scheduler plugin is required.
  const optionNames = [
    'slotDuration', 'slotLabelInterval', 'slotLabelFormat', 'eventTimeFormat',
    'timeZone', 'firstDay', 'scrollTime', 'snapDuration', 'nowIndicator',
    'editable', 'selectable', 'selectMirror', 'longPressDelay', 'allDayText',
    'eventClick', 'eventAllow', 'eventDrop', 'eventResize',
  ];
  return class extends Calendar {
    template = 'more-timelines:calendar/calendar';

    createView(name, view, options, callback) {
      return super.createView(name, name === 'modeButtons' ? 'more-timelines:views/calendar/mode-buttons' : view, options, callback);
    }

    selectMode(mode) {
      if (mode === 'timeline') this.getStorage().set('calendar', 'timelineType', 'shared');
      if (mode === 'timeline-personal') return this.trigger('change:mode', mode, true);
      return super.selectMode(mode);
    }

    setup() {
      super.setup();
      this.extendedProps = [...this.extendedProps, 'calendarUserIds', 'visibleCalendarUserIds'];
      const hidden = this.getStorage().get('moreTimelines', this.personFilterKey());
      this.hiddenUserIds = new Set(Array.isArray(hidden) ? hidden.filter(id => typeof id === 'string') : []);
      this.eventElements = new Map();
      this.eventAppearances = new Map();
      this.eventTooltip = new EventTooltip(this);
      this.dayCalendars = [];
      this.sharedUsers = [];
      this.sharedEvents = [];
      this.requestRevision = 0;
      this.pendingReassignments = new Set();
      this.on('remove', () => {
        this.sharedRemoved = true;
        this.resetCalendarRendering();
      });
    }

    prepareRender() {
      // Saving a shared view re-renders this instance after replacing its DOM.
      this.resetCalendarRendering();
      return super.prepareRender();
    }

    resetCalendarRendering() {
      this.eventTooltip.reset();
      this.finishReassignmentDrag();
      this.requestRevision++;
      this.clearDayColumns();
      this.legendElement?.remove();
      this.legendElement = null;
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
      const item = (this.getPreferences().get('calendarViewDataList') || []).find(entry => entry.id === this.viewId);
      this.selectedUserIds = item?.userIdList || [];
      if (this.isCustomView && (this.teamIdList?.length || this.selectedUserIds.length)) {
        this.viewMode = {basicDay: 'agendaDay', basicWeek: 'agendaWeek'}[this.viewMode] || this.viewMode;
      }
    }

    isSharedTimeGrid() {
      return this.isCustomView && !!(this.teamIdList?.length || this.selectedUserIds?.length) &&
        ['agendaDay', 'agendaWeek', 'month'].includes(this.viewMode);
    }

    isAgendaMode() {
      return (this.isSharedTimeGrid() && this.viewMode !== 'month') || super.isAgendaMode();
    }

    fillColor(event) {
      super.fillColor(event);
      const ids = event.visibleCalendarUserIds || event.calendarUserIds;
      if (this.isSharedTimeGrid() && ids?.length) {
        event.color = this.viewMode === 'agendaDay' ? Colors.entityColor(this, event.scope) || event.color : this.colorForUser(ids[0]);
      }
    }

    assignUserColors(users) {
      this.userColors = Colors.assignUsers(this.getStorage(), users);
    }

    colorForUser(id) {
      return Colors.userColor(this.userColors, id);
    }

    async fetchEvents(from, to, callback) {
      if (!this.isSharedTimeGrid()) return super.fetchEvents(from, to, callback);
      this.eventTooltip.refresh();
      const revision = ++this.requestRevision;
      const current = () => !this.sharedRemoved && revision === this.requestRevision;
      Espo.Ui.notifyWait();
      try {
        const {users} = await Espo.Ajax.postRequest('MoreTimelines/Users', {teamIdList: this.teamIdList || [], userIdList: this.selectedUserIds || []});
        if (!current()) return;
        const query = {from, to, agenda: this.viewMode !== 'month', userIdList: users.map(user => user.id).join(','),
          scopeList: this.enabledScopeList.join(',')};
        const data = users.length ? await Espo.Ajax.getRequest('Activities', query) : [];
        if (!current()) return;
        this.sharedUsers = users;
        this.assignUserColors(users);
        const allowedIds = new Set(users.map(user => user.id));
        const merged = new Map();
        for (const event of data) {
          const key = `${event.scope}-${event.id}`;
          const previous = merged.get(key);
          const ids = [...new Set([...(previous?.userIdList || []), ...(event.userIdList || []), ...(event.userId ? [event.userId] : [])])];
          merged.set(key, {...event, userIdList: ids});
        }
        const records = [...merged.values()];
        this.sharedEvents = this.convertToFcEvents(records).map((event, index) => {
          const ids = records[index].userIdList.filter(id => allowedIds.has(id)).sort();
          return {...event, calendarUserIds: ids, color: ids.length ? this.colorForUser(ids[0]) : event.color,
            textColor: '#fff'};
        }).filter(event => event.calendarUserIds.length || event.display === 'inverse-background');
        callback(this.sharedEvents.map(event => this.filteredEvent(event)));
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

    updateDate() {
      super.updateDate();
      this.syncSharedLayout();
    }

    syncSharedLayout() {
      if (!this.calendar || this.sharedRemoved) return;
      if (!this.isSharedTimeGrid()) {
        this.clearDayColumns();
        this.legendElement?.remove();
        this.legendElement = null;
        this.$calendar.show();
        return;
      }
      this.calendar.setOption('slotEventOverlap', false);
      this.calendar.setOption('eventContent', info => this.sharedEventContent(info));
      this.calendar.setOption('eventDidMount', info => this.registerEventElement(info));
      this.calendar.setOption('eventWillUnmount', info => this.unregisterEventElement(info));
      this.calendar.setOption('eventDragStart', this.viewMode === 'agendaWeek' ?
        info => this.startReassignmentDrag(info, this.calendar) : null);
      this.calendar.setOption('eventDragStop', this.viewMode === 'agendaWeek' ?
        info => this.stopReassignmentDrag(info) : null);
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
      if (info.timeText) {
        const time = document.createElement('div');
        time.className = 'fc-event-time';
        time.textContent = info.timeText;
        frame.append(time);
      }
      const title = document.createElement('div');
      title.className = 'fc-event-title';
      title.textContent = info.event.title;
      frame.append(title);
      return {domNodes: [frame]};
    }

    personFilterKey() {
      return `hiddenCalendarUsers:${this.viewId || this.mode}`;
    }

    visibleUsers() {
      return this.sharedUsers.filter(user => !this.hiddenUserIds.has(user.id));
    }

    filteredEvent(event) {
      const ids = event.calendarUserIds.filter(id => !this.hiddenUserIds.has(id));
      const background = event.display === 'inverse-background';
      return {...event, visibleCalendarUserIds: ids,
        display: ids.length || background ? event.display || 'block' : 'none',
        color: ids.length ? this.colorForUser(ids[0]) : event.color};
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
      this.getStorage().set('moreTimelines', this.personFilterKey(), [...this.hiddenUserIds]);
      // Keep the original event source so Refresh and date navigation still fetch normally.
      this.calendar.batchRendering(() => {
        for (const event of this.calendar.getEvents()) {
          const source = this.sharedEvents.find(item => item.id === event.id);
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
      this.eventElements.set(info.el, userId ? [userId] : info.event.extendedProps.calendarUserIds || []);
      this.eventAppearances.set(info.el, {event: info.event, userId});
      if (info.event.extendedProps.scope && info.event.display !== 'inverse-background') {
        this.eventTooltip.attach(info.el);
      }
      this.paintEventGradient(info.el, info.event, userId);
      this.updatePersonHighlight();
    }

    unregisterEventElement(info) {
      this.eventTooltip.detach(info.el);
      this.eventElements.delete(info.el);
      this.eventAppearances.delete(info.el);
    }

    refreshEventGradients() {
      for (const [element, {event, userId}] of this.eventAppearances) {
        this.paintEventGradient(element, event, userId);
      }
    }

    paintEventGradient(element, event, userId) {
      // Mounted EventApi objects can outlive a refetch; use the current membership data.
      const source = this.sharedEvents.find(item => item.id === event.id);
      const ids = (source?.calendarUserIds || event.extendedProps.calendarUserIds || [])
        .filter(id => !this.hiddenUserIds.has(id));
      const person = userId || ids[0];
      const entity = Colors.entityColor(this, source?.scope || event.extendedProps.scope);
      const styled = !!person && !!entity && event.display !== 'inverse-background';
      const gradient = styled && this.viewMode !== 'agendaDay';
      element.classList.toggle('mt-event-gradient', gradient);
      element.style.backgroundImage = gradient ? Colors.gradient(this.colorForUser(person), entity) : '';
      if (styled) {
        element.style.backgroundColor = gradient ? this.colorForUser(person) : entity;
        element.style.borderColor = gradient ? this.colorForUser(person) : entity;
      }
    }

    updatePersonHighlight() {
      const candidate = this.hoveredUserId || this.focusedUserId;
      const id = candidate && !this.hiddenUserIds.has(candidate) ? candidate : null;
      for (const [element, ids] of this.eventElements) {
        element.classList.toggle('mt-person-event-dimmed', !!id && !ids.includes(id));
        element.classList.toggle('mt-person-event-highlighted', !!id && ids.includes(id));
      }
    }

    colorSwatch(id) {
      const swatch = document.createElement('span');
      const name = this.sharedUsers.find(user => user.id === id)?.name || '';
      const parts = name.trim().split(/\s+/).filter(Boolean);
      swatch.textContent = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)).toUpperCase();
      swatch.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;flex-shrink:0;border-radius:50%;border:2px solid ${this.colorForUser(id)};background:#fff;color:#222;font-size:10px;font-weight:700;line-height:1;`;
      swatch.title = name;
      swatch.setAttribute('aria-label', name);
      return swatch;
    }

    refreshLegendState() {
      for (const [id, {button, status}] of this.legendButtons || []) {
        const visible = !this.hiddenUserIds.has(id);
        button.setAttribute('aria-pressed', String(visible));
        button.style.opacity = visible ? '1' : '0.5';
        status.textContent = visible ? '✓' : '−';
        button.title = this.translate(visible ? 'Hide person events' : 'Show person events', 'labels', 'Calendar');
      }
    }

    renderLegend() {
      if (!this.legendElement) {
        this.legendElement = document.createElement('div');
        this.legendElement.setAttribute('aria-label', this.translate('Calendar users', 'labels', 'Calendar'));
        this.legendElement.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 0;';
        this.$calendar.before(this.legendElement);
      }
      this.legendElement.replaceChildren();
      const style = document.createElement('style');
      style.textContent = '.mt-person-event-dimmed {opacity:.18 !important;} .mt-person-event-highlighted {outline:2px solid var(--text-color, #222);outline-offset:2px;} .mt-person-toggle:focus-visible {outline:2px solid var(--text-color, #222);outline-offset:2px;}';
      this.legendElement.append(style);
      this.legendButtons = new Map();
      this.hoveredUserId = null;
      this.focusedUserId = null;
      for (const user of this.sharedUsers) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-default btn-sm mt-person-toggle';
        button.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
        const status = document.createElement('span');
        status.setAttribute('aria-hidden', 'true');
        const badge = this.colorSwatch(user.id);
        badge.setAttribute('aria-hidden', 'true');
        button.append(badge, document.createTextNode(user.name), status);
        button.addEventListener('click', () => {
          if (!this.reassignmentDrag) this.setPersonVisible(user.id, this.hiddenUserIds.has(user.id));
        });
        button.addEventListener('mouseenter', () => { this.hoveredUserId = user.id; this.updatePersonHighlight(); });
        button.addEventListener('mouseleave', () => { this.hoveredUserId = null; this.updatePersonHighlight(); });
        button.addEventListener('focus', () => { this.focusedUserId = user.id; this.updatePersonHighlight(); });
        button.addEventListener('blur', () => { this.focusedUserId = null; this.updatePersonHighlight(); });
        this.legendButtons.set(user.id, {button, status});
        this.legendElement.append(button);
      }
      if (this.sharedUsers.length) {
        for (const [label, visible] of [['Show all people', true], ['Hide all people', false]]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn btn-text btn-sm';
          button.textContent = this.translate(label, 'labels', 'Calendar');
          button.addEventListener('click', () => this.setAllPeopleVisible(visible));
          this.legendElement.append(button);
        }
      } else {
        const empty = document.createElement('span');
        empty.textContent = this.translate('No calendar users', 'messages', 'Calendar');
        this.legendElement.append(empty);
      }
      this.refreshLegendState();
      this.updatePersonHighlight();
    }

    clearDayColumns() {
      for (const {calendar} of this.dayCalendars || []) calendar.destroy();
      this.dayCalendars = [];
      this.dayColumnsElement?.remove();
      this.dayColumnsElement = null;
    }

    renderDayColumns() {
      const users = this.visibleUsers();
      const key = users.map(user => `${user.id}:${user.name}`).join('|');
      if (key !== this.dayColumnsKey || !this.dayColumnsElement) {
        const scrollTop = this.dayColumnsElement?.scrollTop;
        const scrollLeft = this.dayColumnsElement?.scrollLeft;
        this.clearDayColumns();
        this.dayColumnsKey = key;
        this.dayColumnsElement = document.createElement('div');
        this.dayColumnsElement.className = 'more-timelines-day-columns';
        const style = document.createElement('style');
        style.textContent = '.more-timelines-day-columns .fc-daygrid-day-frame {height:76px;min-height:76px;max-height:76px;overflow:auto;} .more-timelines-day-columns .fc-timegrid-slot {height:24px;}';
        this.dayColumnsElement.append(style);
        this.dayColumnsElement.style.cssText = 'display:flex;overflow-x:auto;align-items:flex-start;';
        this.$calendar.after(this.dayColumnsElement);
        for (const user of users) this.createDayColumn(user);
        if (!users.length && this.sharedUsers.length) {
          const empty = document.createElement('p');
          empty.className = 'text-muted';
          empty.textContent = this.translate('All calendar people hidden', 'messages', 'Calendar');
          this.dayColumnsElement.append(empty);
        }
        this.syncColumnScroll();
        if (scrollTop !== undefined) this.dayColumnsElement.scrollTop = scrollTop;
        if (scrollLeft !== undefined) this.dayColumnsElement.scrollLeft = scrollLeft;
      }
      for (const {calendar, userId} of this.dayCalendars) {
        calendar.batchRendering(() => {
          calendar.gotoDate(this.calendar.getDate());
          calendar.removeAllEventSources();
          calendar.removeAllEvents();
          calendar.addEventSource(this.sharedEvents.filter(event => event.calendarUserIds.includes(userId) ||
            event.display === 'inverse-background').map(event => ({...event, color: Colors.entityColor(this, event.scope) || this.colorForUser(userId)})));
        });
      }
    }

    createDayColumn(user) {
      const column = document.createElement('section');
      column.style.cssText = 'flex:1 0 220px;min-width:220px;';
      const header = document.createElement('div');
      header.style.cssText = `position:sticky;top:0;z-index:5;background:var(--body-bg, #fff);height:44px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:10px;font-weight:600;text-align:center;border-top:3px solid ${this.colorForUser(user.id)};`;
      header.title = user.name;
      header.textContent = user.name;
      const body = document.createElement('div');
      column.append(header, body);
      this.dayColumnsElement.append(column);
      const options = Object.fromEntries(optionNames.map(name => [name, this.calendar.getOption(name)]));
      const select = this.calendar.getOption('select');
      const calendar = new FullCalendar.Calendar(body, {
        ...options, initialView: 'timeGridDay', initialDate: this.calendar.getDate(),
        headerToolbar: false, dayHeaders: false, slotEventOverlap: false,
        // A shared scroll container keeps every user's time slots aligned.
        height: 'auto', allDaySlot: true, dayMaxEvents: 2, droppable: true,
        select: info => {
          const original = this.options;
          this.options = {...original, userId: user.id, userName: user.name};
          try { select(info); } finally { this.options = original; }
          calendar.unselect();
        },
        eventAllow: (drop, event) => !!this.reassignmentDrag &&
          this.dayCalendars.some(item => item.calendar === this.reassignmentDrag.calendar) &&
          (!options.eventAllow || options.eventAllow(drop, event)),
        eventDragStart: info => this.startReassignmentDrag(info, calendar),
        eventDragStop: info => this.stopReassignmentDrag(info),
        eventLeave: info => {
          if (this.reassignmentDrag) this.reassignmentDrag.restoreSource = info.revert;
        },
        eventReceive: info => this.receiveReassignedEvent(info, user.id),
        eventContent: info => this.sharedEventContent(info),
        eventDidMount: info => this.registerEventElement(info, user.id),
        eventWillUnmount: info => this.unregisterEventElement(info),
        eventDrop: async info => { await options.eventDrop(info); this.actionRefresh(); },
        eventResize: async info => { await options.eventResize(info); this.actionRefresh(); },
      });
      this.dayCalendars.push({calendar, userId: user.id});
      calendar.render();
    }

    legendUserAt(jsEvent) {
      const point = jsEvent?.changedTouches?.[0] || jsEvent?.touches?.[0] || jsEvent;
      if (!point || !Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return null;
      for (const [id, {button}] of this.legendButtons || []) {
        const rect = button.getBoundingClientRect();
        if (rect.right > rect.left && rect.bottom > rect.top && point.clientX >= rect.left && point.clientX <= rect.right &&
            point.clientY >= rect.top && point.clientY <= rect.bottom) return id;
      }
      return null;
    }

    startReassignmentDrag(info, calendar) {
      this.eventTooltip.hide();
      this.finishReassignmentDrag();
      this.reassignmentDrag = {event: info.event, calendar};
      this.legendElement?.classList.toggle('mt-person-reassigning', true);
      for (const [id, {button}] of this.legendButtons || []) {
        button.title = this.translate('Drop to reassign', 'labels', 'Calendar') + ' · ' +
          (this.sharedUsers.find(user => user.id === id)?.name || '');
      }
      this.reassignmentPointerMove = event => {
        const target = this.legendUserAt(event);
        for (const [id, {button}] of this.legendButtons || []) {
          button.classList.toggle('mt-person-reassignment-target', id === target);
        }
      };
      document.addEventListener('pointermove', this.reassignmentPointerMove);
      document.addEventListener('touchmove', this.reassignmentPointerMove, {passive: true});
    }

    stopReassignmentDrag(info) {
      const drag = this.reassignmentDrag;
      const userId = this.legendUserAt(info.jsEvent);
      if (drag && userId) {
        drag.legendDrop = true;
        // The legend is outside FullCalendar's date grid; its own drag reverts naturally.
        void this.reassignEvent(info.event, userId);
      }
      // FullCalendar emits eventLeave/eventReceive immediately after eventDragStop.
      queueMicrotask(() => {
        if (this.reassignmentDrag === drag) this.finishReassignmentDrag();
      });
    }

    finishReassignmentDrag() {
      if (this.reassignmentPointerMove) {
        document.removeEventListener('pointermove', this.reassignmentPointerMove);
        document.removeEventListener('touchmove', this.reassignmentPointerMove);
        this.reassignmentPointerMove = null;
      }
      this.reassignmentDrag = null;
      this.legendElement?.classList.toggle('mt-person-reassigning', false);
      for (const {button} of this.legendButtons?.values() || []) {
        button.classList.toggle('mt-person-reassignment-target', false);
      }
      this.refreshLegendState();
    }

    async receiveReassignedEvent(info, userId) {
      const drag = this.reassignmentDrag;
      const receivingCalendar = this.dayCalendars.find(item => item.userId === userId)?.calendar;
      const revert = () => {
        if (this.sharedRemoved) return;
        const targetActive = this.dayCalendars.some(item => item.calendar === receivingCalendar);
        const sourceActive = this.dayCalendars.some(item => item.calendar === drag?.calendar);
        if (targetActive) info.revert();
        if (sourceActive) drag?.restoreSource?.();
        if (!targetActive || (drag && !sourceActive)) this.actionRefresh();
      };
      // Only accept events dragged from a column in this shared calendar.
      if (!drag || drag.legendDrop || !this.dayCalendars.some(item => item.calendar === drag.calendar) ||
          drag.event.id !== info.event.id || drag.event.allDay !== info.event.allDay) {
        revert();
        return;
      }
      return this.reassignEvent(info.event, userId, {moveTime: true, originalEvent: drag.event, revert});
    }

    movedEventDates(event, originalEvent) {
      const props = event.extendedProps;
      const attributes = {};
      const delta = event.start.getTime() - originalEvent.start.getTime();
      for (const name of ['dateStart', 'dateEnd']) {
        if (!props[name]) continue;
        const value = this.getDateTime().toMoment(props[name]).add(delta, 'milliseconds')
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

    async reassignEvent(event, userId, {moveTime = false, originalEvent = null, revert = () => {}} = {}) {
      const {scope, recordId} = event.extendedProps;
      const key = `${scope}-${recordId}`;
      const user = this.sharedUsers.find(item => item.id === userId);
      if (!user || !scope || !recordId || this.pendingReassignments.has(key)) {
        revert();
        return false;
      }
      this.pendingReassignments.add(key);
      try {
        const field = this.getMetadata().get(['entityDefs', scope, 'fields', 'assignedUser']);
        if (!field || field.readOnly || field.disabled || !this.getAcl().checkField(scope, 'assignedUser', 'edit')) {
          throw new Error('Assignment is not editable.');
        }
        const model = await this.getModelFactory().create(scope);
        model.id = recordId;
        await model.fetch();
        if (!this.getAcl().checkModel(model, 'edit')) throw new Error('Event is not editable.');
        const dates = moveTime ? this.movedEventDates(event, originalEvent) : {};
        for (const name of Object.keys(dates)) {
          const fieldName = name.endsWith('Date') ? name.slice(0, -4) : name;
          const dateField = this.getMetadata().get(['entityDefs', scope, 'fields', fieldName]);
          if (dateField?.readOnly || !this.getAcl().checkField(scope, fieldName, 'edit')) {
            throw new Error('Dates are not editable.');
          }
        }
        Espo.Ui.notify(this.translate('saving', 'messages'));
        this.options.onSave?.();
        // Do not send usersIds or other attendee relationships. Existing attendees stay as-is.
        await model.save({assignedUserId: userId, ...dates}, {patch: true});
        if (!this.sharedRemoved) {
          this.hiddenUserIds.delete(userId);
          this.getStorage().set('moreTimelines', this.personFilterKey(), [...this.hiddenUserIds]);
          this.actionRefresh();
          Espo.Ui.notify();
        }
        return true;
      } catch (error) {
        revert();
        if (!this.sharedRemoved) Espo.Ui.error(this.translate('Could not reassign event', 'messages', 'Calendar'));
        return false;
      } finally {
        this.pendingReassignments.delete(key);
      }
    }

    syncColumnScroll() {
      // The columns have natural height inside one vertical viewport.
      this.dayColumnsElement.style.maxHeight = `${this.getCalculatedHeight()}px`;
      this.dayColumnsElement.style.overflowY = 'auto';
      const hour = String(this.scrollHour).padStart(2, '0');
      const slot = this.dayColumnsElement.querySelector(`[data-time="${hour}:00:00"]`);
      if (slot) {
        this.dayColumnsElement.scrollTop = slot.getBoundingClientRect().top -
          this.dayColumnsElement.getBoundingClientRect().top - 120;
      }
    }

    addModel(model) {
      if (this.isSharedTimeGrid()) return this.actionRefresh();
      return super.addModel(model);
    }

    updateModel(model) {
      if (this.isSharedTimeGrid()) return this.actionRefresh();
      return super.updateModel(model);
    }

    removeModel(model) {
      if (this.isSharedTimeGrid()) return this.actionRefresh();
      return super.removeModel(model);
    }
  };
});
