define('calendar-plus:views/calendar/fields/users', ['crm:views/calendar/fields/users'], Users => {
  return class extends Users {
    getSelectPrimaryFilterName() {
      return this.model.get('showInactiveUsers') === true ? 'internal' : super.getSelectPrimaryFilterName();
    }
  };
});
