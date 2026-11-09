define('calendar-plus:views/calendar/modals/edit', [
  'crm:views/calendar/modals/edit',
  'calendar-plus:calendar-visibility',
], (CalendarEdit, Visibility) => {
  return class extends CalendarEdit {
    createRecordView(model, callback) {
      if (this.visibilityModel && this.visibilityChanged) {
        this.stopListening(this.visibilityModel, 'change', this.visibilityChanged);
      }

      for (const field of this.visibilityFields || []) {
        this.stopListening(field, 'change', this.visibilityFieldChanged);
      }

      this.visibilityFields = new Set();
      this.visibilityModel = model;
      this.visibilityChanged = () => this.updateVisibilityWarning();
      this.visibilityFieldChanged = () => this.scheduleVisibilityWarning();
      this.listenTo(model, 'change', this.visibilityChanged);

      return super.createRecordView(model, (view) => {
        this.listenTo(view, 'after:render', () => {
          this.bindVisibilityFields(view);
          this.updateVisibilityWarning();
        });
        callback?.(view);
      });
    }

    afterRender() {
      super.afterRender();

      if (this.hasView?.('edit') !== false) this.bindVisibilityFields(this.getRecordView());

      this.updateVisibilityWarning();
    }

    bindVisibilityFields(record) {
      for (const field of record?.getFieldViewList?.() || []) {
        if (this.visibilityFields.has(field)) continue;

        this.visibilityFields.add(field);
        this.listenTo(field, 'change', this.visibilityFieldChanged);
      }
    }

    scheduleVisibilityWarning() {
      if (this.visibilityUpdateQueued) return;

      this.visibilityUpdateQueued = true;

      const model = this.visibilityModel;

      // Field widgets may update silently or return to a value already held by the model.
      // Wait for their handlers to finish, then read the actual form values.
      queueMicrotask(() => {
        this.visibilityUpdateQueued = false;

        if (this.visibilityModel !== model || this.isRemoved?.()) return;

        const record = this.hasView?.('edit') === false ? null : this.getRecordView();
        const attributes = model.getClonedAttributes();

        if (record?.model === model) Object.assign(attributes, record.fetch());

        this.updateVisibilityWarning(attributes);
      });
    }

    warningFor(attributes) {
      const calendar = this.options.calendarView;
      const model = this.visibilityModel;

      if (!calendar || !model || !model.isNew()) return null;

      return Visibility.creationWarning(
        calendar,
        model.entityType || this.scope,
        attributes || model.getClonedAttributes(),
      );
    }

    updateVisibilityWarning(attributes) {
      const reason = this.warningFor(attributes);

      Visibility.renderWarning(this, reason);

      return reason;
    }

    handleRecordViewOptions(options) {
      super.handleRecordViewOptions?.(options);
      options.calendarPlusVisibilityWarningHandled = true;
    }

    async actionSave(options) {
      const record = this.getRecordView();
      const model = record.model;
      const wasNew = model.isNew();
      const attributes = { ...model.getClonedAttributes(), ...record.fetch() };
      const reason = this.updateVisibilityWarning(attributes);

      await super.actionSave(options);

      // Keep the warning visible after the create dialog closes, only if creation succeeded.
      if (wasNew && !model.isNew() && reason) {
        Espo.Ui.notify(
          this.translate(`${reason} after save`, 'messages', 'Calendar'),
          'warning',
          8000,
        );
      }
    }
  };
});
