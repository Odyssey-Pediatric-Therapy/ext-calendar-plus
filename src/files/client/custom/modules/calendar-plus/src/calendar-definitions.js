define('calendar-plus:calendar-definitions', [], () => {
  const normalizeMode = mode => ({basicDay: 'agendaDay', basicWeek: 'agendaWeek'}[mode] || mode);
  const entries = value => Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string') : [];
  const list = preferences => [
    ...entries(preferences.get('calendarViewDataList')).map(item => ({...item,
      source: 'calendar', mode: normalizeMode(item.mode), routeMode: `view-${item.id}`})),
    ...entries(preferences.get('calendarPlusList')).map(item => ({...item,
      source: 'timeline', mode: 'timeline', routeMode: `view-timeline-${item.id}`})),
  ];
  const sharedTimeline = (preferences, user) => {
    const stored = preferences.get('calendarPlusSharedSelection');
    let selection;
    if (stored && !Array.isArray(stored) && Array.isArray(stored.teamIdList) && Array.isArray(stored.userIdList)) {
      selection = stored;
    } else {
      const legacy = preferences.get('sharedCalendarUserList');
      const users = Array.isArray(legacy) ? legacy.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string') : [];
      if (!users.length) users.push({id: user.id, name: user.get('name')});
      selection = {teamIdList: [], teamNames: {}, userIdList: users.map(item => item.id),
        userNames: Object.fromEntries(users.map(item => [item.id, item.name]))};
    }
    return {...selection, source: 'shared', name: 'Timeline', mode: 'timeline', routeMode: 'timeline'};
  };
  const membershipSelection = item => item?.membershipMode === 'static' ?
    {teamIdList: [], userIdList: Array.isArray(item.staticUserIdList) ? item.staticUserIdList : []} :
    {teamIdList: item?.teamIdList || [], userIdList: item?.userIdList || []};
  const find = (preferences, routeMode) => list(preferences).find(item => item.routeMode === routeMode);
  const viewSettingsKey = (preferences, routeMode) => {
    const item = find(preferences, routeMode);
    return item ? `view:${item.id}` : routeMode;
  };
  const viewSettings = (preferences, routeMode) =>
    preferences?.get('calendarPlusViewSettings')?.[viewSettingsKey(preferences, routeMode)] || {};
  const timeRange = settings => {
    const parse = value => {
      if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):?[0-5]\d$|^24:?00$/.test(value)) return null;
      const digits = value.replace(':', '');
      return `${digits.slice(0, 2)}:${digits.slice(2)}:00`;
    };
    const start = parse(settings.visibleTimeStart ?? '00:00');
    const end = parse(settings.visibleTimeEnd ?? '24:00');
    return start && end && start < end ? {start, end} : null;
  };

  const applyAppearance = (view) => {
    const element = view.el || view.$el?.get?.(0);

    if (!element?.dataset) return;

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

  const shouldFilterEvents = (view, events = []) => {
    const settings = viewSettings(view.getPreferences(), view.mode || 'timeline');

    const canReadResponses =
      !!view.getUser?.()?.id &&
      events.some((event) => {
        const props = event.extendedProps || event;

        return props.scope && (props.recordId || event['record-id']);
      });

    return (
      settings.showCanceledEvents === false ||
      settings.showDeclinedEvents === false ||
      canReadResponses
    );
  };

  const filterEvents = async (view, events) => {
    const settings = viewSettings(view.getPreferences(), view.mode || 'timeline');

    if (settings.showCanceledEvents === false) {
      events = events.filter((event) => {
        if (event.type === 'background' || event.display === 'inverse-background') return true;

        const props = event.extendedProps || event;
        const statuses = view.getEventTypeCanceledStatusList?.(props.scope) || [];

        return !statuses.includes(props.status);
      });
    }

    const userId = view.getUser?.()?.id;

    if (!userId) return events;

    const keep = events.map(() => true);
    let index = 0;

    const worker = async () => {
      while (index < events.length) {
        const position = index++;
        const event = events[position];
        const props = event.extendedProps || event;
        const scope = props.scope;

        if (!scope || event.type === 'background' || event.display === 'inverse-background')
          continue;

        const hasResponses =
          ['Meeting', 'Call'].includes(scope) ||
          view.getMetadata?.().get(['entityDefs', scope, 'fields', 'users', 'columns', 'status']);

        if (!hasResponses) continue;

        const recordId = props.recordId || event['record-id'];

        if (!recordId) continue;
        // Reuse permission-checked tooltip details and cache; limit concurrent requests.

        const details = await view.eventTooltip.loadDetails({ extendedProps: { scope, recordId } });
        const declined = details?.usersColumns?.[userId]?.status === 'Declined';
        keep[position] = !declined || settings.showDeclinedEvents !== false;

        if (declined && keep[position]) {
          props.isDeclined = true;
          event.className = Array.isArray(event.className)
            ? [...new Set([...event.className, 'cp-event-declined'])]
            : [...new Set(`${event.className || ''} cp-event-declined`.trim().split(/\s+/))].join(
                ' ',
              );
          view.styleDeclinedEvent?.(event);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(4, events.length) }, worker));

    return keep.every(Boolean) ? events : events.filter((_, position) => keep[position]);
  };

  const showInactiveUsers = (preferences, routeMode) =>
    preferences.get('calendarPlusViewSettings')?.[viewSettingsKey(preferences, routeMode)]?.showInactiveUsers === true;
  return {list, normalizeMode, sharedTimeline, find, viewSettingsKey, showInactiveUsers, membershipSelection, viewSettings, timeRange, applyAppearance, filterEvents, shouldFilterEvents};
});
