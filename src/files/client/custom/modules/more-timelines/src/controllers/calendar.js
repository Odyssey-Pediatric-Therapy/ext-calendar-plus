define('more-timelines:controllers/calendar', ['crm:controllers/calendar'], Controller => {
  return class extends Controller {
    actionIndex(options) {
      this.handleCheckAccess('');
      this.main('more-timelines:views/calendar/calendar-page', {
        date: options.date, mode: options.mode, userId: options.userId, userName: options.userName,
      });
    }
  };
});
