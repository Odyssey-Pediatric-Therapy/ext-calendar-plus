define('calendar-plus:calendar-availability', [], () => {
  const STEP = 5 * 60 * 1000;

  class UnavailableError extends Error {}

  const timestamp = (value) =>
    typeof value === 'string' ? Date.parse(value.replace(' ', 'T') + 'Z') : NaN;

  const roundUp = (value) => Math.ceil(value / STEP) * STEP;

  function findSlot(data, userIds, from, until, duration) {
    if (!userIds.length || ![from, until, duration].every(Number.isFinite) || duration <= 0) {
      throw new UnavailableError('Invalid availability request.');
    }

    const blocked = [];

    for (const userId of userIds) {
      if (!data || !Object.hasOwn(data, userId) || !Array.isArray(data[userId])) {
        throw new UnavailableError('Availability is missing for a selected user.');
      }

      for (const range of data[userId]) {
        if (!range.isBusyRange && !range.isNonWorkingRange) continue;

        const start = timestamp(range.dateStart);
        const end = timestamp(range.dateEnd);

        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
          throw new UnavailableError('Invalid availability range.');
        }

        blocked.push([start, end]);
      }
    }

    blocked.sort((first, second) => first[0] - second[0]);

    let candidate = roundUp(from);

    for (const [start, end] of blocked) {
      if (end <= candidate) continue;
      if (candidate + duration <= start) break;

      candidate = roundUp(end);
    }

    return candidate + duration <= until ? candidate : null;
  }

  return { findSlot, roundUp, UnavailableError };
});
