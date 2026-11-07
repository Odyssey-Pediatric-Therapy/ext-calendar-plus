define('calendar-plus:calendar-search', ['moment', 'calendar-plus:calendar-visibility'], (
  moment,
  Visibility,
) => {
  const optionalColumns = ['when', 'assignedUser', 'attendees', 'status'];

  const getOptions = (view) => {
    const stored = view.getPreferences?.().get('calendarPlusSearchSettings') || {};

    return {
      columns: Array.isArray(stored.columns)
        ? [...new Set(stored.columns.filter((column) => optionalColumns.includes(column)))]
        : ['when', 'status'],
      sortBy: stored.sortBy === 'title' ? 'title' : 'date',
      sortDirection: stored.sortDirection === 'asc' ? 'asc' : 'desc',
    };
  };

  const compareResults = (view, first, second) => {
    const options = getOptions(view);
    const date = (record) =>
      record.dateStartDate || record.dateStart || record.dateEndDate || record.dateEnd || '';
    const value = (record) => (options.sortBy === 'title' ? record.name || '' : date(record));
    const primary = value(first).localeCompare(value(second));

    return (
      primary * (options.sortDirection === 'asc' ? 1 : -1) ||
      (first.name || '').localeCompare(second.name || '') ||
      `${first.scope}:${first.id}`.localeCompare(`${second.scope}:${second.id}`)
    );
  };

  const statusStyle = (view, scope, status) => {
    const field = view.getMetadata().get(['entityDefs', scope, 'fields', 'status']) || {};
    let styles = field.style || {};

    if (!Object.keys(styles).length && typeof field.optionsReference === 'string') {
      const [entity, attribute] = field.optionsReference.split('.');
      styles = view.getMetadata().get(['entityDefs', entity, 'fields', attribute, 'style']) || {};
    }

    const style = styles[status];

    return typeof style === 'string' && /^[a-zA-Z0-9_-]+$/.test(style) ? style : 'default';
  };

  const resultAvailability = (view, record) => {
    if (!(record.dateStartDate || record.dateStart || record.dateEndDate || record.dateEnd)) {
      return { canShow: false, reason: 'Search result has no date', userIds: [] };
    }

    const userIds = Visibility.includedUserIds(view, record.scope, record);

    return {
      canShow: !!userIds.length,
      reason: userIds.length ? null : 'Search result user not loaded',
      userIds,
    };
  };

  const getPageSize = (view) => {
    const size = view.getConfig?.().get('recordsPerPage');

    return Number.isInteger(size) && size > 0 ? size : 20;
  };

  const availableScopes = (view) =>
    [...new Set(view.scopeList || view.enabledScopeList || [])].filter((scope) => {
      const fields = view.getMetadata().get(['entityDefs', scope, 'fields']) || {};

      return view.getAcl().checkScope(scope, 'read') && (fields.dateStart || fields.dateEnd);
    });

  const buildQuery = (view, scope, filters, offset = 0) => {
    const fields = view.getMetadata().get(['entityDefs', scope, 'fields']) || {};
    const links = view.getMetadata().get(['entityDefs', scope, 'links']) || {};
    const timeZone = view.getDateTime().getTimeZone();
    const from = moment.tz(filters.from, timeZone).startOf('day');
    const to = moment.tz(filters.to, timeZone).add(1, 'day').startOf('day');
    const where = [];
    const condition = (type, attribute, value) => ({
      type,
      attribute,
      ...(value === undefined ? {} : { value }),
    });
    const interval = (start, end, lower, upper) => ({
      type: 'and',
      value: [
        {
          type: 'or',
          value: [
            condition('lessThan', start, upper),
            { type: 'and', value: [condition('isNull', start), condition('lessThan', end, upper)] },
          ],
        },
        {
          type: 'or',
          value: [
            condition('greaterThanOrEquals', end, lower),
            {
              type: 'and',
              value: [condition('isNull', end), condition('greaterThanOrEquals', start, lower)],
            },
          ],
        },
      ],
    });
    const dateRanges = [];

    if (fields.dateStart && fields.dateEnd) {
      dateRanges.push(
        interval(
          'dateStart',
          'dateEnd',
          fields.dateStart.type === 'date'
            ? filters.from
            : from.clone().utc().format('YYYY-MM-DD HH:mm:ss'),
          fields.dateEnd.type === 'date'
            ? to.format('YYYY-MM-DD')
            : to.clone().utc().format('YYYY-MM-DD HH:mm:ss'),
        ),
      );
    } else {
      const field = fields.dateStart ? 'dateStart' : 'dateEnd';
      dateRanges.push({
        type: 'and',
        value: [
          condition(
            'greaterThanOrEquals',
            field,
            fields[field].type === 'date'
              ? filters.from
              : from.clone().utc().format('YYYY-MM-DD HH:mm:ss'),
          ),
          condition(
            'lessThan',
            field,
            fields[field].type === 'date'
              ? to.format('YYYY-MM-DD')
              : to.clone().utc().format('YYYY-MM-DD HH:mm:ss'),
          ),
        ],
      });
    }

    if (fields.dateStartDate && fields.dateEndDate) {
      dateRanges.push(
        interval('dateStartDate', 'dateEndDate', filters.from, to.format('YYYY-MM-DD')),
      );
    }

    where.push({ type: 'or', value: dateRanges });

    if (filters.title?.trim()) where.push(condition('contains', 'name', filters.title.trim()));

    if (filters.assignedUserId) {
      if (fields.assignedUser || links.assignedUser)
        where.push(condition('equals', 'assignedUserId', filters.assignedUserId));
      else if (fields.assignedUsers || links.assignedUsers)
        where.push(condition('linkedWith', 'assignedUsers', [filters.assignedUserId]));
      else return null;
    }

    for (const [filter, relationship] of [
      ['attendeeUserId', 'users'],
      ['attendeeContactId', 'contacts'],
      ['attendeeLeadId', 'leads'],
    ]) {
      if (!filters[filter]) continue;
      if (!fields[relationship] && !links[relationship]) return null;
      where.push(condition('linkedWith', relationship, [filters[filter]]));
    }

    if (filters.statusList?.length) {
      const statuses = filters.statusList.filter((status) =>
        fields.status?.options?.includes(status),
      );
      if (!statuses.length) return null;
      where.push(condition('in', 'status', statuses));
    }

    const select = [
      'id',
      'name',
      'dateStart',
      'dateEnd',
      'dateStartDate',
      'dateEndDate',
      'status',
    ].filter((name) => ['id', 'name'].includes(name) || fields[name]);

    if (fields.assignedUser || links.assignedUser)
      select.push('assignedUserId', 'assignedUserName');

    for (const relationship of ['assignedUsers', 'users', 'contacts', 'leads', 'collaborators']) {
      if (fields[relationship]) select.push(`${relationship}Ids`, `${relationship}Names`);
    }

    const options = getOptions(view);

    return {
      where,
      select: select.join(','),
      maxSize: getPageSize(view),
      offset,
      orderBy: options.sortBy === 'title' ? 'name' : fields.dateStart ? 'dateStart' : 'dateEnd',
      order: options.sortDirection,
    };
  };

  const searchPage = async (view, filters, offsets = {}) => {
    const permitted = availableScopes(view);
    const scopes = filters.scopeList?.length
      ? permitted.filter((scope) => filters.scopeList.includes(scope))
      : permitted;
    const results = [];
    const nextOffsets = {};
    const errors = [];
    let index = 0;

    const worker = async () => {
      while (index < scopes.length) {
        const scope = scopes[index++];
        if (offsets[scope] === null) continue;
        const offset = offsets[scope] || 0;
        const query = buildQuery(view, scope, filters, offset);
        if (!query) continue;

        try {
          const response = await Espo.Ajax.getRequest(scope, query);
          if (!Array.isArray(response.list)) throw new Error('Invalid search response');
          results.push(...response.list.map((record) => ({ ...record, scope })));
          nextOffsets[scope] =
            response.list.length === query.maxSize &&
            (response.total === -1 ||
              response.total == null ||
              offset + response.list.length < response.total)
              ? offset + response.list.length
              : null;
        } catch (error) {
          errors.push(scope);
          nextOffsets[scope] = null;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(4, scopes.length) }, worker));

    return { results, nextOffsets, errors };
  };

  return {
    availableScopes,
    buildQuery,
    searchPage,
    getPageSize,
    getOptions,
    compareResults,
    optionalColumns,
    statusStyle,
    resultAvailability,
  };
});
