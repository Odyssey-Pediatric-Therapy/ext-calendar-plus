define('more-timelines:calendar-colors', [], () => {
  const assignUsers = (storage, users) => {
    const palette = ['#2563a6', '#b45309', '#a32973', '#087f83', '#47752b', '#7545aa',
      '#ad3939', '#71651b', '#365d73', '#92553c', '#5045a5', '#656b73'];
    const stored = storage.get('moreTimelines', 'userColors');
    const colors = stored && typeof stored === 'object' && !Array.isArray(stored) ? {...stored} : {};
    const used = new Set(Object.values(colors));
    for (const user of [...users].sort((a, b) => a.id.localeCompare(b.id))) {
      if (typeof colors[user.id] === 'string') continue;
      let index = 0;
      let color;
      do {
        color = palette[index] || `hsl(${Math.round(index * 137.508) % 360}, 58%, 36%)`;
        index++;
      } while (used.has(color));
      colors[user.id] = color;
      used.add(color);
    }
    storage.set('moreTimelines', 'userColors', colors);
    return colors;
  };
  const userColor = (colors, id) => {
    if (colors?.[id]) return colors[id];
    let hash = 0;
    for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
    return `hsl(${((hash % 360) + 360) % 360}, 58%, 36%)`;
  };
  const entityColor = (view, scope) => scope ?
    view.colors?.[scope] || view.getColorFromScopeName?.(scope) || '#558BBD' : null;
  const gradient = (person, entity) => `linear-gradient(135deg, ${person} 0%, ${person} 18%, ${entity} 34%, ${entity} 100%)`;
  return {assignUsers, userColor, entityColor, gradient};
});
