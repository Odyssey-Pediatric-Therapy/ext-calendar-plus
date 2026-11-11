define('calendar-plus:views/calendar/event-tooltip', ['calendar-plus:calendar-definitions'], (
  Definitions,
) => {
  let nextId = 0;

  return class {
    constructor(view) {
      this.view = view;
      this.bindings = new Map();
    }

    attach(element) {
      if (this.bindings.has(element)) {
        return;
      }

      const handlers = {
        mouseenter: (event) => {
          if (!event?.sourceCapabilities?.firesTouchEvents) {
            this.scheduleShow(element);
          }
        },

        mouseleave: () => this.scheduleHide(element),

        focus: () => {
          if (element.matches?.(':focus-visible')) {
            this.scheduleShow(element);
          }
        },

        blur: () => this.scheduleHide(element),

        pointerdown: () => this.hide(),

        click: () => this.hide(),

        keydown: (event) => {
          if (event.key === 'Escape') {
            this.hide();
          }
        },
      };

      for (const [name, handler] of Object.entries(handlers))
        element.addEventListener(name, handler);

      if (!element.hasAttribute('tabindex')) {
        element.setAttribute('tabindex', '0');
      }

      this.bindings.set(element, handlers);
    }

    detach(element) {
      if (this.pendingAnchor === element || this.active?.anchor === element) {
        this.hide();
      }

      for (const [name, handler] of Object.entries(this.bindings.get(element) || {})) {
        element.removeEventListener(name, handler);
      }

      this.bindings.delete(element);
    }

    refresh() {
      this.hide();
    }

    reset() {
      this.refresh();

      for (const element of this.bindings.keys()) this.detach(element);
    }

    enabled() {
      return (
        // Touch browsers synthesize hover/focus when a tapped event regains focus.
        (typeof window === 'undefined' ||
          !window.matchMedia ||
          window.matchMedia('(hover: hover) and (pointer: fine)').matches) &&
        this.view.getConfig().get('calendarPlusTooltipEnabled') !== false &&
        (!Definitions ||
          Definitions.viewSettings(this.view.getPreferences?.(), this.view.mode || 'timeline')
            .showTooltips !== false)
      );
    }

    showDelay() {
      const seconds = this.view.getConfig().get('calendarPlusTooltipDelay');

      return (Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 60) : 1) * 1000;
    }

    scheduleShow(anchor) {
      if (!this.enabled() || this.view.personDropDrag) {
        this.hide();

        return;
      }

      this.hide();
      this.pendingAnchor = anchor;
      this.showTimer = setTimeout(() => {
        void this.show(anchor);
      }, this.showDelay());
    }

    scheduleHide(anchor) {
      if (this.pendingAnchor === anchor) {
        clearTimeout(this.showTimer);
        this.pendingAnchor = null;
      }

      if (this.active?.anchor === anchor) {
        this.hideTimer = setTimeout(() => this.hide(), 120);
      }
    }

    hide() {
      clearTimeout(this.showTimer);
      clearTimeout(this.hideTimer);
      this.pendingAnchor = null;

      if (!this.active) {
        return;
      }

      const { anchor, panel, id, onScroll } = this.active;
      const describedBy = (anchor.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((value) => value && value !== id);

      if (describedBy.length) {
        anchor.setAttribute('aria-describedby', describedBy.join(' '));
      }
      else {
        anchor.removeAttribute('aria-describedby');
      }

      document.removeEventListener('scroll', onScroll, true);
      panel.remove();
      this.active = null;
    }

    async show(anchor) {
      this.hide();

      const appearance = this.view.eventAppearances.get(anchor);

      if (
        !this.enabled() ||
        !appearance ||
        this.view.sharedRemoved ||
        this.view.removed ||
        this.view.personDropDrag
      ) {
        return;
      }

      const event = appearance.event;

      if (!event.extendedProps.scope || event.display === 'inverse-background') {
        return;
      }

      const panel = document.createElement('div');
      const id = `cp-calendar-event-tooltip-${++nextId}`;

      panel.id = id;
      panel.className = 'cp-calendar-event-tooltip';
      panel.setAttribute('role', 'tooltip');

      const session = { anchor, panel, id, event };

      session.onScroll = (e) => {
        if (!panel.contains(e.target)) {
          this.hide();
        }
      };
      this.active = session;
      panel.addEventListener('mouseenter', () => clearTimeout(this.hideTimer));
      panel.addEventListener('mouseleave', () => this.hide());
      anchor.setAttribute(
        'aria-describedby',
        [anchor.getAttribute('aria-describedby'), id].filter(Boolean).join(' '),
      );
      document.body.append(panel);
      document.addEventListener('scroll', session.onScroll, true);
      this.render(session);

      const details = await this.loadDetails(event);

      if (this.active !== session) {
        return;
      }

      if (!this.enabled()) {
        this.hide();

        return;
      }

      this.render(session, details);
    }

    async loadDetails(event) {
      const props = event.extendedProps || event;
      const source = this.view.sharedEventsById?.get(event.id);

      // Details belong to this calendar response. Hovering never fetches a record.
      if (source) {
        return source.calendarPlusDetails || null;
      }

      return props.calendarPlusDetails || null;
    }

    attendanceStatus(rawStatus, supportsStatus) {
      if (!supportsStatus) {
        return null;
      }

      if (['Accepted', 'Declined', 'Tentative'].includes(rawStatus)) {
        return rawStatus;
      }

      return 'None';
    }

    attendanceIndicator(status) {
      if (status === 'Accepted') {
        return '✓';
      }

      if (status === 'Declined') {
        return '✕';
      }

      return status ? '?' : null;
    }

    attendeesFor(scope, details) {
      const participants = [];

      for (const field of ['users', 'contacts', 'leads']) {
        const columns = details[`${field}Columns`] || {};
        const supportsStatus =
          ['Meeting', 'Call'].includes(scope) ||
          !!this.view
            .getMetadata?.()
            .get(['entityDefs', scope, 'fields', field, 'columns', 'status']) ||
          Object.values(columns).some(
            (value) => value && typeof value === 'object' && 'status' in value,
          );

        for (const [id, name] of Object.entries(details[`${field}Names`] || {})) {
          if (typeof name !== 'string') {
            continue;
          }

          const rawStatus = columns[id]?.status;
          const status = this.attendanceStatus(rawStatus, supportsStatus);
          const indicator = this.attendanceIndicator(status);
          const statusLabel = status
            ? this.view.translate(status === 'None' ? 'No answer' : status, 'labels', 'Calendar')
            : null;

          participants.push({ name, status, indicator, statusLabel });
        }
      }

      return participants;
    }

    detailsFor(event, details = null) {
      const view = this.view;
      const source = (view.sharedEvents || []).find((item) => item.id === event.id) || {
        ...event.extendedProps,
        title: event.title,
      };
      const available = Object.fromEntries(
        Object.entries(details || {}).filter(([, value]) => value !== undefined),
      );
      const data = { ...source, ...available };
      const scope = data.scope || event.extendedProps.scope;
      const settings =
        Definitions?.viewSettings(view.getPreferences?.(), view.mode || 'timeline') || {};
      const rows = [];

      const add = (label, value, extra = {}) => {
        if (value) {
          rows.push({label, value, ...extra});
        }
      };

      const names = (map) =>
        map && typeof map === 'object'
          ? Object.values(map).filter((value) => typeof value === 'string')
          : [];

      const dateTime = view.getDateTime();
      const start = data.dateStartDate
        ? dateTime.toDisplayDate(data.dateStartDate)
        : dateTime.toDisplay(data.dateStart);
      const end = data.dateEndDate
        ? dateTime.toDisplayDate(data.dateEndDate)
        : dateTime.toDisplay(data.dateEnd);

      add(view.translate('dateStart', 'fields', scope), start);
      add(view.translate('dateEnd', 'fields', scope), end);

      if ((data.dateStart && !data.dateStartDate) || (data.dateEnd && !data.dateEndDate)) {
        add(view.translate('Time Zone', 'labels', 'Calendar'), dateTime.getTimeZone?.());
      }

      const assigned = [
        ...new Set([data.assignedUserName, ...names(data.assignedUsersNames)].filter(Boolean)),
      ];

      if (settings.tooltipAssignee !== false) {
        add(view.translate('assignedUser', 'fields', scope), assigned.join(', '));
      }

      const attendeeFields = ['usersNames', 'contactsNames', 'leadsNames'];

      if (settings.tooltipAttendees !== false) {
        if (scope === 'Task') {
          const collaborators = names(data.collaboratorsNames);

          add(view.translate('collaborators', 'fields', scope), collaborators.join(', '));
        } else if (details && attendeeFields.some((name) => details[name] !== undefined)) {
          const participants = this.attendeesFor(scope, details);

          if (participants.length) {
            let label = view.translate('users', 'fields', scope);

            if (['Meeting', 'Call'].includes(scope)) {
              label = view.translate('Attendees', 'labels', 'Calendar');
            }

            const value = participants
              .map((person) => [person.name, person.indicator].filter(Boolean).join(' '))
              .join(', ');
            const extra = {};

            if (participants.some((person) => person.indicator)) {
              extra.participants = participants;
            }

            add(label, value, extra);
          }
        }
      }

      if (settings.tooltipStatus !== false && data.status) {
        add(
          view.translate('status', 'fields', scope),
          view.getLanguage?.()?.translateOption(data.status, 'status', scope) || data.status,
          { kind: 'status' },
        );
      }

      if (settings.tooltipLocation !== false && typeof data.location === 'string') {
        add(view.translate('location', 'fields', scope), data.location);
      }

      return {
        title: data.name || source.title || event.title,
        type: view.translate(scope, 'scopeNames'),
        rows,
      };
    }

    render(session, details = null) {
      const { title, type, rows } = this.detailsFor(session.event, details);
      const heading = document.createElement('div');

      heading.className = 'cp-calendar-event-tooltip-title';
      heading.textContent = title;

      const entity = document.createElement('div');

      entity.className = 'cp-calendar-event-tooltip-type';
      entity.textContent = type;

      const list = document.createElement('dl');

      list.className = 'cp-calendar-event-tooltip-details';

      for (const row of rows) {
        list.append(...this.renderDetailRow(row));
      }

      session.panel.replaceChildren(heading, entity, list);
      this.position(session);
    }

    renderDetailRow(row) {
      const term = document.createElement('dt');

      term.textContent = row.label;

      const description = document.createElement('dd');

      if (row.participants?.length) {
        term.className = 'cp-calendar-event-attendee-label';
        description.className = 'cp-calendar-event-attendees';

        for (const person of row.participants) {
          const attendee = this.renderAttendee(person);

          description.append(attendee);
        }
      } else {
        if (row.kind === 'status') {
          description.className = 'cp-calendar-event-status';
        }

        description.textContent = row.value;
      }

      return [term, description];
    }

    renderAttendee(person) {
      const attendee = document.createElement('span');

      attendee.className = 'cp-calendar-event-attendee';

      const name = document.createElement('span');

      name.textContent = person.name;
      attendee.append(name);

      if (person.indicator) {
        const indicator = document.createElement('span');

        indicator.className = `cp-calendar-attendance-status cp-calendar-attendance-${person.status.toLowerCase()}`;
        indicator.textContent = person.indicator;
        indicator.title = person.statusLabel;
        indicator.setAttribute('aria-label', person.statusLabel);
        attendee.append(indicator);
      }

      return attendee;
    }

    horizontalBounds(anchor) {
      const bounds = { left: 0, right: document.documentElement.clientWidth };
      let calendar = anchor.closest?.('.vis-panel.vis-center');

      if (!calendar) {
        calendar = anchor.closest?.('.calendar-plus-day-columns');
      }

      if (!calendar) {
        calendar = this.view.el || this.view.$el?.get?.(0);
      }

      if (calendar) {
        const rect = calendar.getBoundingClientRect();

        bounds.left = Math.max(bounds.left, rect.left);
        bounds.right = Math.min(bounds.right, rect.right);
      }

      return bounds;
    }

    position({ panel, anchor }) {
      const margin = 12;
      const viewport = document.documentElement;
      const bounds = this.horizontalBounds(anchor);
      const rect = anchor.getBoundingClientRect();

      panel.style.maxWidth = `${Math.max(0, bounds.right - bounds.left - margin * 2)}px`;

      const size = panel.getBoundingClientRect();
      const visibleLeft = Math.max(rect.left, bounds.left);
      const left = Math.max(
        bounds.left + margin,
        Math.min(visibleLeft, bounds.right - size.width - margin),
      );
      let top = rect.bottom + 8;

      if (top + size.height > viewport.clientHeight - margin) {
        top = rect.top - size.height - 8;
      }

      panel.style.left = `${left}px`;
      panel.style.top = `${Math.max(margin, Math.min(top, viewport.clientHeight - size.height - margin))}px`;
    }
  };
});
