define('calendar-plus:active-calendar', [], () => {
  const calendars = new Set();

  const register = (calendar) => {
    if (calendars.has(calendar)) return;
    calendars.add(calendar);
    calendar.on('remove', () => calendars.delete(calendar));
  };

  const find = () => {
    for (const calendar of [...calendars].reverse()) {
      const element = calendar.el || calendar.$el?.get?.(0);
      if (calendar.removed || calendar.sharedRemoved || calendar.isRemoved?.()) continue;
      if (!element?.isConnected || !element.closest('#main')) continue;
      if (!element.querySelector('.calendar-plus-header') || !element.getClientRects().length)
        continue;

      return calendar;
    }

    return null;
  };

  return { register, find };
});
