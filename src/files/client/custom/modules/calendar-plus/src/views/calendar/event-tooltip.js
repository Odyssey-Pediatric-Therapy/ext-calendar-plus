define('calendar-plus:views/calendar/event-tooltip', [], () => {
  let nextId = 0;
  return class {
    constructor(view) {
      this.view = view;
      this.bindings = new Map();
      this.cache = new Map();
    }

    attach(element) {
      if (this.bindings.has(element)) return;
      const handlers = {
        mouseenter: () => this.scheduleShow(element),
        mouseleave: () => this.scheduleHide(element),
        focus: () => this.scheduleShow(element),
        blur: () => this.scheduleHide(element),
        click: () => this.hide(),
        keydown: event => { if (event.key === 'Escape') this.hide(); },
      };
      for (const [name, handler] of Object.entries(handlers)) element.addEventListener(name, handler);
      if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '0');
      this.bindings.set(element, handlers);
    }

    detach(element) {
      if (this.pendingAnchor === element || this.active?.anchor === element) this.hide();
      for (const [name, handler] of Object.entries(this.bindings.get(element) || {})) {
        element.removeEventListener(name, handler);
      }
      this.bindings.delete(element);
    }

    refresh() {
      this.hide();
      this.cache.clear();
    }

    reset() {
      this.refresh();
      for (const element of this.bindings.keys()) this.detach(element);
    }

    enabled() {
      return this.view.getConfig().get('calendarPlusTooltipEnabled') !== false;
    }

    scheduleShow(anchor) {
      if (!this.enabled() || this.view.reassignmentDrag) { this.hide(); return; }
      this.hide();
      this.pendingAnchor = anchor;
      this.showTimer = setTimeout(() => { void this.show(anchor); }, 180);
    }

    scheduleHide(anchor) {
      if (this.pendingAnchor === anchor) {
        clearTimeout(this.showTimer);
        this.pendingAnchor = null;
      }
      if (this.active?.anchor === anchor) this.hideTimer = setTimeout(() => this.hide(), 120);
    }

    hide() {
      clearTimeout(this.showTimer);
      clearTimeout(this.hideTimer);
      this.pendingAnchor = null;
      if (!this.active) return;
      const {anchor, panel, id, onScroll} = this.active;
      const describedBy = (anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter(value => value && value !== id);
      if (describedBy.length) anchor.setAttribute('aria-describedby', describedBy.join(' '));
      else anchor.removeAttribute('aria-describedby');
      document.removeEventListener('scroll', onScroll, true);
      panel.remove();
      this.active = null;
    }

    async show(anchor) {
      this.hide();
      const appearance = this.view.eventAppearances.get(anchor);
      if (!this.enabled() || !appearance || this.view.sharedRemoved || this.view.removed || this.view.reassignmentDrag) return;
      const event = appearance.event;
      if (!event.extendedProps.scope || event.display === 'inverse-background') return;
      const panel = document.createElement('div');
      const id = `cp-calendar-event-tooltip-${++nextId}`;
      panel.id = id;
      panel.className = 'cp-calendar-event-tooltip';
      panel.setAttribute('role', 'tooltip');
      const session = {anchor, panel, id, event};
      session.onScroll = e => { if (!panel.contains(e.target)) this.hide(); };
      this.active = session;
      panel.addEventListener('mouseenter', () => clearTimeout(this.hideTimer));
      panel.addEventListener('mouseleave', () => this.hide());
      anchor.setAttribute('aria-describedby', [anchor.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
      document.body.append(panel);
      document.addEventListener('scroll', session.onScroll, true);
      this.render(session);
      const details = await this.loadDetails(event);
      if (this.active !== session) return;
      if (!this.enabled()) { this.hide(); return; }
      this.render(session, details);
    }

    async loadDetails(event) {
      const {scope, recordId} = event.extendedProps;
      if (!scope || !recordId) return null;
      const key = `${scope}:${recordId}`;
      if (!this.cache.has(key)) {
        const request = (async () => {
          try {
            const model = await this.view.getModelFactory().create(scope);
            model.id = recordId;
            await model.fetch();
            const fields = ['name', 'status', 'dateStart', 'dateEnd', 'dateStartDate', 'dateEndDate',
              'assignedUserName', 'assignedUsersNames', 'usersNames', 'contactsNames', 'leadsNames', 'location'];
            return Object.fromEntries(fields.map(name => [name, model.get(name)]));
          } catch (error) {
            // Calendar access can permit a summary without permission to read the full record.
            return null;
          }
        })();
        this.cache.set(key, request);
      }
      return this.cache.get(key);
    }

    detailsFor(event, details = null) {
      const view = this.view;
      const source = (view.sharedEvents || []).find(item => item.id === event.id) || {...event.extendedProps, title: event.title};
      const available = Object.fromEntries(Object.entries(details || {}).filter(([, value]) => value !== undefined));
      const data = {...source, ...available};
      const scope = data.scope || event.extendedProps.scope;
      const rows = [];
      const add = (label, value) => { if (value) rows.push({label, value}); };
      const names = map => map && typeof map === 'object' ? Object.values(map).filter(value => typeof value === 'string') : [];
      const dateTime = view.getDateTime();
      const start = data.dateStartDate ? dateTime.toDisplayDate(data.dateStartDate) : dateTime.toDisplay(data.dateStart);
      const end = data.dateEndDate ? dateTime.toDisplayDate(data.dateEndDate) : dateTime.toDisplay(data.dateEnd);
      add(view.translate('dateStart', 'fields', scope), start);
      add(view.translate('dateEnd', 'fields', scope), end);
      if ((data.dateStart && !data.dateStartDate) || (data.dateEnd && !data.dateEndDate)) {
        add(view.translate('Time Zone', 'labels', 'Calendar'), dateTime.getTimeZone?.());
      }
      const assigned = [...new Set([data.assignedUserName, ...names(data.assignedUsersNames)].filter(Boolean))];
      add(view.translate('assignedUser', 'fields', scope), assigned.join(', '));
      const attendeeFields = ['usersNames', 'contactsNames', 'leadsNames'];
      if (details && attendeeFields.some(name => details[name] !== undefined)) {
        const participants = [...new Set(attendeeFields.flatMap(name => names(details[name])))];
        const label = ['Meeting', 'Call'].includes(scope) ? view.translate('Attendees', 'labels', 'Calendar') :
          view.translate('users', 'fields', scope);
        add(label, participants.join(', ') || view.translate('None'));
      } else {
        const people = (source.calendarUserIds || []).map(id => (view.sharedUsers || view.userList || []).find(user => user.id === id)?.name).filter(Boolean);
        add(view.translate('Calendar users', 'labels', 'Calendar'), people.join(', '));
      }
      if (data.status) {
        add(view.translate('status', 'fields', scope), view.getLanguage?.()?.translateOption(data.status, 'status', scope) || data.status);
      }
      if (typeof data.location === 'string') add(view.translate('location', 'fields', scope), data.location);
      return {title: data.name || source.title || event.title, type: view.translate(scope, 'scopeNames'), rows};
    }

    render(session, details = null) {
      const {title, type, rows} = this.detailsFor(session.event, details);
      const heading = document.createElement('div');
      heading.className = 'cp-calendar-event-tooltip-title';
      heading.textContent = title;
      const entity = document.createElement('div');
      entity.className = 'text-muted small';
      entity.textContent = type;
      const list = document.createElement('dl');
      for (const row of rows) {
        const term = document.createElement('dt');
        term.textContent = row.label;
        const description = document.createElement('dd');
        description.textContent = row.value;
        list.append(term, description);
      }
      session.panel.replaceChildren(heading, entity, list);
      this.position(session);
    }

    position({panel, anchor}) {
      const margin = 12;
      const viewport = document.documentElement;
      const rect = anchor.getBoundingClientRect();
      const size = panel.getBoundingClientRect();
      const left = Math.min(rect.left, viewport.clientWidth - size.width - margin);
      const below = rect.bottom + 8;
      const top = below + size.height <= viewport.clientHeight - margin ? below : rect.top - size.height - 8;
      panel.style.left = `${Math.max(margin, left)}px`;
      panel.style.top = `${Math.max(margin, Math.min(top, viewport.clientHeight - size.height - margin))}px`;
    }
  };
});
