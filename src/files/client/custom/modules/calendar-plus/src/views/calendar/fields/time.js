define('calendar-plus:views/calendar/fields/time', [
  'views/fields/varchar',
  'calendar-plus:calendar-definitions',
], (Varchar, Definitions) => {
  return class extends Varchar {
    fetch() {
      const data = super.fetch();
      const time = Definitions.normalizeTime(data[this.name]);

      if (time) {
        data[this.name] = time;
        this.$element?.val(time);
      }

      return data;
    }
  };
});
