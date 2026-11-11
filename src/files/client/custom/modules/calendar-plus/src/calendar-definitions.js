define('calendar-plus:calendar-definitions', [], () => {
  const normalizeMode = (mode) =>
    ({ basicDay: 'agendaDay', basicWeek: 'agendaWeek' })[mode] || mode;

  const entries = (value) =>
    Array.isArray(value)
      ? value.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
      : [];

  const list = (preferences) => [
    ...entries(preferences.get('calendarViewDataList')).map((item) => ({
      ...item,
      source: 'calendar',
      mode: normalizeMode(item.mode),
      routeMode: `view-${item.id}`,
    })),
    ...entries(preferences.get('calendarPlusList')).map((item) => ({
      ...item,
      source: 'timeline',
      mode: 'timeline',
      routeMode: `view-timeline-${item.id}`,
    })),
  ];

  const sharedTimeline = (preferences, user) => {
    const stored = preferences.get('calendarPlusSharedSelection');
    let selection;

    if (
      stored &&
      !Array.isArray(stored) &&
      Array.isArray(stored.teamIdList) &&
      Array.isArray(stored.userIdList)
    ) {
      selection = stored;
    } else {
      const legacy = preferences.get('sharedCalendarUserList');
      const users = Array.isArray(legacy)
        ? legacy.filter(
            (item) => item && typeof item.id === 'string' && typeof item.name === 'string',
          )
        : [];

      if (!users.length) {
        users.push({
          id: user.id,
          name: user.get('name')
        });
      }

      selection = {
        teamIdList: [],
        teamNames: {},
        userIdList: users.map((item) => item.id),
        userNames: Object.fromEntries(users.map((item) => [item.id, item.name])),
      };
    }

    return {
      ...selection,
      source: 'shared',
      name: 'Timeline',
      mode: 'timeline',
      routeMode: 'timeline',
    };
  };

  const membershipSelection = (item, includeInactive = false) => {
    if (item?.membershipMode !== 'static') {
      return {
        teamIdList: item?.teamIdList || [],
        userIdList: item?.userIdList || [],
        ...(includeInactive ? { includeInactiveUsers: true } : {}),
        ...(Object.keys(item?.teamColumns || {}).length ? { teamColumns: item.teamColumns } : {}),
      };
    }

    const users = Array.isArray(item.staticUserIdList) ? item.staticUserIdList : [];
    const inactive = new Set(includeInactive ? item.userIdList || [] : []);

    for (const teamId of item.teamIdList || []) {
      if (item.teamColumns?.[teamId]?.showInactiveUsers !== true) {
        continue;
      }

      for (const id of item.staticTeamUserIdLists?.[teamId] || []) inactive.add(id);
    }

    const inactiveUserIdList = users.filter((id) => inactive.has(id));

    return {
      teamIdList: [],
      userIdList: users,
      ...(inactiveUserIdList.length ? { inactiveUserIdList } : {}),
    };
  };

  const find = (preferences, routeMode) =>
    list(preferences).find((item) => item.routeMode === routeMode);

  const viewSettingsKey = (preferences, routeMode) => {
    const item = find(preferences, routeMode);

    return item ? `view:${item.id}` : routeMode;
  };

  const viewSettings = (preferences, routeMode) =>
    preferences?.get('calendarPlusViewSettings')?.[viewSettingsKey(preferences, routeMode)] || {};

  const normalizeTime = (value) => {
    if (typeof value !== 'string') {
      return null;
    }

    value = value.trim();

    if (!/^(?:\d{3,4}|\d{1,2}:\d{2})$/.test(value)) {
      return null;
    }

    const digits = value.replace(':', '').padStart(4, '0');
    const hour = Number(digits.slice(0, 2));
    const minute = Number(digits.slice(2));

    if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) {
      return null;
    }

    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  };

  const timeRange = (settings) => {
    const parse = (value) => {
      const time = normalizeTime(value);

      return time ? `${time}:00` : null;
    };

    const start = parse(settings.visibleTimeStart ?? '00:00');
    const end = parse(settings.visibleTimeEnd ?? '24:00');

    return start && end && start < end ? { start, end } : null;
  };

  const applyAppearance = (view) => {
    const element = view.el || view.$el?.get?.(0);

    if (!element?.dataset) {
      return;
    }

    const settings = viewSettings(view.getPreferences(), view.mode || 'timeline');

    element.classList.add('cp-calendar-view');
    element.dataset.eventTextSize = ['small', 'large'].includes(settings.eventTextSize)
      ? settings.eventTextSize
      : 'medium';
    element.dataset.dayBoundary = ['strong', 'black'].includes(settings.dayBoundary)
      ? settings.dayBoundary
      : 'subtle';
    element.dataset.timelineRowHeight = ['compact', 'spacious'].includes(settings.timelineRowHeight)
      ? settings.timelineRowHeight
      : 'comfortable';
  };

  const isSearchResult = (view, event) => {
    const props = event.extendedProps || event;

    return (
      !!view.searchResult &&
      props.scope === view.searchResult.scope &&
      (props.recordId || event['record-id'] || props.id) === view.searchResult.id
    );
  };

  const shouldFilterEvents = (view, events = []) => {
    const settings = viewSettings(view.getPreferences(), view.mode || 'timeline');
    const hasSharedMembership = !!view.isSharedTimeGrid?.() || !!view.getMembershipSelection?.();
    const userId = view.getUser?.()?.id;

    const canReadResponses =
      !!userId &&
      hasSharedMembership &&
      events.some((event) => {
        const props = event.extendedProps || event;

        return props.scope && (props.recordId || event['record-id']);
      });

    return (
      settings.showCanceledEvents === false ||
      settings.showCompletedEvents === false ||
      settings.showDeclinedEvents === false ||
      canReadResponses
    );
  };

  const matchesStatusSettings = (view, event, settings) => {
    if (event.type === 'background' || event.display === 'inverse-background') {
      return true;
    }

    if (isSearchResult(view, event)) {
      return true;
    }

    const props = event.extendedProps || event;
    const canceled = view.getEventTypeCanceledStatusList?.(props.scope) || [];
    const completed = view.getEventTypeCompletedStatusList?.(props.scope) || [];

    return !(
      (settings.showCanceledEvents === false && canceled.includes(props.status)) ||
      (settings.showCompletedEvents === false && completed.includes(props.status))
    );
  };

  const markDeclinedEvent = (view, event, props) => {
    props.isDeclined = true;
    event.className = Array.isArray(event.className)
      ? [...new Set([...event.className, 'cp-event-declined'])]
      : [...new Set(`${event.className || ''} cp-event-declined`.trim().split(/\s+/))].join(' ');
    view.styleDeclinedEvent?.(event);
  };

  const filterEvents = (view, events) => {
    const settings = viewSettings(view.getPreferences(), view.mode || 'timeline');
    const userId = view.getUser?.()?.id;
    const filtered = events.filter((event) => {
      if (!matchesStatusSettings(view, event, settings)) {
        return false;
      }
      if (!userId || event.type === 'background' || event.display === 'inverse-background') {
        return true;
      }

      const props = event.extendedProps || event;
      const declined = props.calendarPlusDetails?.usersColumns?.[userId]?.status === 'Declined';

      if (!declined) {
        return true;
      }
      if (settings.showDeclinedEvents === false && !isSearchResult(view, event)) {
        return false;
      }

      markDeclinedEvent(view, event, props);

      return true;
    });

    if (filtered.length === events.length) {
      return events;
    }

    return filtered;
  };

  const highlightSearchResult = (view) => {
    if (!view.searchResult) {
      return;
    }

    let focused = false;

    for (const [element, appearance] of view.eventAppearances) {
      const props = appearance.event.extendedProps;
      const match =
        props.scope === view.searchResult.scope && props.recordId === view.searchResult.id;

      element.classList.toggle('cp-search-match', match);

      if (match && !focused) {
        focused = true;
        element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
    }
  };

  const showInactiveUsers = (preferences, routeMode) =>
    preferences.get('calendarPlusViewSettings')?.[viewSettingsKey(preferences, routeMode)]
      ?.showInactiveUsers === true;

  return {
    list,
    normalizeMode,
    sharedTimeline,
    find,
    viewSettingsKey,
    showInactiveUsers,
    membershipSelection,
    viewSettings,
    timeRange,
    normalizeTime,
    applyAppearance,
    filterEvents,
    shouldFilterEvents,
    highlightSearchResult,
    isSearchResult,
  };
});
