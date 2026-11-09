define('calendar-plus:views/scheduler/panel', ['crm:views/meeting/record/panels/scheduler'], (
  SchedulerPanel,
) => {
  return class extends SchedulerPanel {
    setup() {
      // The native panel reads schedulerView through scope, which newer bottom
      // panels do not populate automatically.
      this.scope = this.model.entityType || this.model.name;

      super.setup();
    }
  };
});
