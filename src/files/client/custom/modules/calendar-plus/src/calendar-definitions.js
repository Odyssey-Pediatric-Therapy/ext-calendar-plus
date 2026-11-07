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
  const showInactiveUsers = (preferences, routeMode) =>
    preferences.get('calendarPlusViewSettings')?.[viewSettingsKey(preferences, routeMode)]?.showInactiveUsers === true;
  return {list, normalizeMode, sharedTimeline, find, viewSettingsKey, showInactiveUsers, membershipSelection, viewSettings, timeRange};
});
