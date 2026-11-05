define('more-timelines:calendar-definitions', [], () => {
  const normalizeMode = mode => ({basicDay: 'agendaDay', basicWeek: 'agendaWeek'}[mode] || mode);
  const entries = value => Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string') : [];
  const list = preferences => [
    ...entries(preferences.get('calendarViewDataList')).map(item => ({...item,
      source: 'calendar', mode: normalizeMode(item.mode), routeMode: `view-${item.id}`})),
    ...entries(preferences.get('moreTimelinesList')).map(item => ({...item,
      source: 'timeline', mode: 'timeline', routeMode: `view-timeline-${item.id}`})),
  ];
  const sharedTimeline = (preferences, user) => {
    const stored = preferences.get('moreTimelinesSharedSelection');
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
  return {list, normalizeMode, sharedTimeline, find: (preferences, routeMode) => list(preferences).find(item => item.routeMode === routeMode)};
});
