define('calendar-plus:handlers/quick-create-warning', [
  'calendar-plus:active-calendar',
  'calendar-plus:calendar-visibility',
], (ActiveCalendar, Visibility) => {
  return class {
    constructor(view) {
      this.view = view;
      this.fields = new Set();
    }

    process() {
      const view = this.view;

      if (view.options.calendarPlusVisibilityWarningHandled || !view.model.isNew()) return;

      if ((view.options.type || view.type) !== 'editSmall') return;

      const calendar = ActiveCalendar.find();

      if (!calendar || !calendar.scopeList.includes(view.model.entityType)) return;

      this.calendar = calendar;

      view.listenTo(view.model, 'change', () => this.update());
      view.on('after:render', () => {
        this.bindFields();
        this.update();
      });
      view.on('before:save', () => {
        this.savingNew = view.model.isNew();
        this.saveReason = this.update(this.formAttributes());
      });
      view.on('after:save', () => {
        if (!this.savingNew) return;

        this.savingNew = false;

        const reason = this.saveReason;

        // The native Quick Add modal announces success after the record save resolves.
        // Show our notice afterward so it is not replaced by that announcement.
        setTimeout(() => {
          if (ActiveCalendar.find() !== calendar) return;

          calendar.actionRefresh();

          if (reason)
            Espo.Ui.notify(
              view.translate(`${reason} after save`, 'messages', 'Calendar'),
              'warning',
              8000,
            );
        }, 0);
      });
    }

    formAttributes() {
      return { ...this.view.model.getClonedAttributes(), ...this.view.fetch() };
    }

    bindFields() {
      for (const field of this.view.getFieldViewList()) {
        if (this.fields.has(field)) continue;

        this.fields.add(field);
        this.view.listenTo(field, 'change', () => this.scheduleUpdate());
      }
    }

    scheduleUpdate() {
      if (this.updateQueued) return;

      this.updateQueued = true;
      queueMicrotask(() => {
        this.updateQueued = false;

        if (!this.view.isRemoved()) this.update(this.formAttributes());
      });
    }

    update(attributes) {
      const view = this.view;
      const reason =
        view.model.isNew() && ActiveCalendar.find() === this.calendar
          ? Visibility.creationWarning(
              this.calendar,
              view.model.entityType,
              attributes || view.model.getClonedAttributes(),
            )
          : null;

      Visibility.renderWarning(view, reason);

      return reason;
    }
  };
});
