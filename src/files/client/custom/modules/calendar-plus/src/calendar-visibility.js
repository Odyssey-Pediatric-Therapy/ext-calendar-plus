define('calendar-plus:calendar-visibility', ['calendar-plus:calendar-definitions'], (
  Definitions,
) => {
  const loadedUserIds = (calendar) => {
    if (calendar.isSharedTimeGrid?.()) return (calendar.sharedUsers || []).map((user) => user.id);
    if (Array.isArray(calendar.userList)) return calendar.userList.map((user) => user.id);

    return [calendar.options?.userId || calendar.getUser().id];
  };

  const creationWarning = (calendar, scope, attributes) => {
    const fields = calendar.getMetadata().get(['entityDefs', scope, 'fields']) || {};
    const links = calendar.getMetadata().get(['entityDefs', scope, 'links']) || {};
    const ids = (field) =>
      Array.isArray(attributes[`${field}Ids`])
        ? attributes[`${field}Ids`]
        : Object.keys(attributes[`${field}Names`] || {});
    const assigned =
      fields.assignedUsers?.type === 'linkMultiple'
        ? ids('assignedUsers')
        : [attributes.assignedUserId].filter(Boolean);
    let members;

    if (['Meeting', 'Call'].includes(scope)) {
      members = ids('users');

      // Espo adds assigned users to attendees on save unless this option is disabled.
      if (calendar.getConfig().get('eventAssignedUserIsAttendeeDisabled') !== true) {
        members.push(...assigned);
      }
    } else {
      members = [...assigned];

      if (scope !== 'Task' && (links.users?.entity === 'User' || fields.users?.entity === 'User')) {
        members.push(...ids('users'));
      }
    }

    if (!members.length && !assigned.length) return null;
    const loaded = new Set(loadedUserIds(calendar));
    let included = [...new Set(members.filter((id) => loaded.has(id)))];

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

  return { creationWarning, loadedUserIds, renderWarning };
});
