define('calendar-plus:calendar-visibility', ['calendar-plus:calendar-definitions'], (
  Definitions,
) => {
  const loadedUserIds = (calendar) => {
    if (calendar.isSharedTimeGrid?.()) return (calendar.sharedUsers || []).map((user) => user.id);

    if (Array.isArray(calendar.userList)) return calendar.userList.map((user) => user.id);

    return [calendar.options?.userId || calendar.getUser().id];
  };

  const relationshipIds = (attributes, field) =>
    Array.isArray(attributes[`${field}Ids`])
      ? [...attributes[`${field}Ids`]]
      : Object.keys(attributes[`${field}Names`] || {});

  const assignedUserIds = (calendar, scope, attributes) => {
    const fields = calendar.getMetadata().get(['entityDefs', scope, 'fields']) || {};

    return fields.assignedUsers?.type === 'linkMultiple'
      ? relationshipIds(attributes, 'assignedUsers')
      : [attributes.assignedUserId].filter(Boolean);
  };

  const eventUserIds = (calendar, scope, attributes, { forCreate = false } = {}) => {
    const assigned = assignedUserIds(calendar, scope, attributes);
    const attendees = relationshipIds(attributes, 'users');
    let members;

    if (['Meeting', 'Call'].includes(scope)) {
      members = attendees;

      // Predict the save hook only for new events, not persisted search records.
      if (forCreate && calendar.getConfig().get('eventAssignedUserIsAttendeeDisabled') !== true) {
        members.push(...assigned);
      }
    } else {
      members = assigned;

      const fields = calendar.getMetadata().get(['entityDefs', scope, 'fields']) || {};
      const links = calendar.getMetadata().get(['entityDefs', scope, 'links']) || {};

      if (scope !== 'Task' && (links.users?.entity === 'User' || fields.users?.entity === 'User')) {
        members.push(...attendees);
      }
    }

    return [...new Set(members.filter(Boolean))];
  };

  const includedUserIds = (calendar, scope, attributes, options) => {
    const loaded = new Set(loadedUserIds(calendar));

    return eventUserIds(calendar, scope, attributes, options).filter((id) => loaded.has(id));
  };

  const creationWarning = (calendar, scope, attributes) => {
    const options = { forCreate: true };
    const members = eventUserIds(calendar, scope, attributes, options);
    const assigned = assignedUserIds(calendar, scope, attributes);

    if (!members.length && !assigned.length) return null;

    let included = includedUserIds(calendar, scope, attributes, options);

    if (!included.length) return 'Created event users not in calendar';

    if (['Meeting', 'Call'].includes(scope)) {
      included = included.filter((id) => attributes.usersColumns?.[id]?.status !== 'Declined');

      if (!included.length) return 'Created event attendees declined';
    }

    if (calendar.hiddenUserIds && included.every((id) => calendar.hiddenUserIds.has(id))) {
      return 'Created event users hidden';
    }

    if (Array.isArray(calendar.enabledScopeList) && !calendar.enabledScopeList.includes(scope)) {
      return 'Created event type hidden';
    }

    const settings = Definitions.viewSettings(
      calendar.getPreferences(),
      calendar.mode || 'timeline',
    );
    const canceled = calendar.getMetadata().get(['scopes', scope, 'canceledStatusList']) || [];

    if (settings.showCanceledEvents === false && canceled.includes(attributes.status)) {
      return 'Created event status hidden';
    }

    const completed = calendar.getMetadata().get(['scopes', scope, 'completedStatusList']) || [];

    if (settings.showCompletedEvents === false && completed.includes(attributes.status)) {
      return 'Created event status hidden';
    }

    const currentUserId = calendar.getUser().id;

    if (
      settings.showDeclinedEvents === false &&
      attributes.usersColumns?.[currentUserId]?.status === 'Declined'
    ) {
      return 'Created event status hidden';
    }

    return null;
  };

  const renderWarning = (view, reason) => {
    if (!view.el) return;

    const container = view.el.querySelector('.modal-body') || view.el;
    let warning = container.querySelector('.cp-calendar-create-warning');

    if (!warning) {
      warning = document.createElement('div');
      warning.className = 'alert alert-warning cp-calendar-create-warning';
      warning.setAttribute('role', 'status');
      warning.setAttribute('aria-live', 'polite');
      container.prepend(warning);
    }

    warning.hidden = !reason;
    warning.classList.toggle('hidden', !reason);
    warning.textContent = reason ? view.translate(reason, 'messages', 'Calendar') : '';
  };

  return { creationWarning, loadedUserIds, eventUserIds, includedUserIds, renderWarning };
});
