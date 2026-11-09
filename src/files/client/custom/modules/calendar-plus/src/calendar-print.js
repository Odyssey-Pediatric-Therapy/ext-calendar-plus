define('calendar-plus:calendar-print', [], () => {
  const MAX_CAPTURE_DIMENSION = 16384;
  const MAX_CAPTURE_PIXELS = 16000000;
  const CAPTURE_HEADING_ALLOWANCE = 120;
  const PDF_PAGE_MARGIN = 24;
  const PREVIEW_URL_LIFETIME = 120000;
  let libraryPromise;

  const loadLibraries = () => {
    if (!libraryPromise) {
      libraryPromise = Promise.all([
        Espo.loader.requirePromise('lib!calendar-plus-pdf-lib'),
        Espo.loader.requirePromise('lib!calendar-plus-html2canvas'),
      ]).catch((error) => {
        libraryPromise = null;

        throw error;
      });
    }

    return libraryPromise;
  };

  return class {
    constructor(view, name) {
      this.view = view;
      this.name = name;
    }

    title() {
      const view = this.view;
      const root = view.el || view.$el?.get(0);
      let period = root?.querySelector('.date-title h4 span')?.textContent?.trim();

      if (!period && view.timeline) {
        const range = view.timeline.getWindow();
        const format = new Intl.DateTimeFormat(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });

        period = `${format.format(range.start)} – ${format.format(range.end)}`;
      }

      return [this.name, period].filter(Boolean).join(' — ') || 'Calendar';
    }

    prepareClone(doc, root, title) {
      // Work exclusively on html2canvas's clone; leave the live calendar and scroll positions alone.
      root.style.height = 'auto';
      root.style.minHeight = '0';
      root
        .querySelectorAll('.calendar-plus-header, .cp-calendar-event-tooltip')
        .forEach((element) => {
          element.style.display = 'none';
        });
      root.querySelectorAll('.cp-person-legend').forEach((legend) => {
        legend.classList.remove('cp-person-legend-compact', 'open');
      });
      root
        .querySelectorAll(
          '.cp-person-legend-toggle, .cp-person-legend-items > .btn-text, .cp-person-toggle[aria-pressed="false"]',
        )
        .forEach((element) => {
          element.style.display = 'none';
        });
      root.querySelectorAll('.cp-person-legend-items').forEach((items) => {
        items.style.cssText =
          'display:flex;flex-wrap:wrap;position:static;gap:8px;width:auto;max-height:none;overflow:visible;';
      });

      const style = doc.createElement('style');

      style.textContent =
        '.cp-person-event-dimmed {opacity:1 !important;} .cp-person-event-highlighted {outline:none !important;}';

      const heading = doc.createElement('div');

      heading.style.cssText = 'font-size:18px;font-weight:600;line-height:1.4;padding:4px 0 12px;';
      heading.textContent = title;
      root.prepend(style, heading);
    }

    async capture(root, html2canvas, title) {
      await document.fonts?.ready;

      const bounds = root.getBoundingClientRect();
      // Bound canvas dimensions and memory use on phones as well as large desktop displays.
      const width = Math.max(bounds.width, 1);
      const height = Math.max(bounds.height + CAPTURE_HEADING_ALLOWANCE, 1);
      const scale = Math.min(
        2,
        MAX_CAPTURE_DIMENSION / width,
        MAX_CAPTURE_DIMENSION / height,
        Math.sqrt(MAX_CAPTURE_PIXELS / (width * height)),
      );

      return html2canvas(root, {
        scale,
        backgroundColor: '#ffffff',
        logging: false,
        allowTaint: false,
        useCORS: false,

        onclone: (doc, clone) => this.prepareClone(doc, clone, title),
      });
    }

    async createPdf(canvas, PDFLib, title) {
      const pdf = await PDFLib.PDFDocument.create();

      pdf.setTitle(title);
      pdf.setCreator('Calendar Plus');

      const image = await pdf.embedPng(canvas.toDataURL('image/png'));
      const portrait = PDFLib.PageSizes.A4;
      const size = canvas.width > canvas.height ? [portrait[1], portrait[0]] : [...portrait];
      const page = pdf.addPage(size);
      const margin = PDF_PAGE_MARGIN;
      const scale = Math.min(
        (size[0] - margin * 2) / image.width,
        (size[1] - margin * 2) / image.height,
      );
      const width = image.width * scale;
      const height = image.height * scale;

      page.drawImage(image, { x: (size[0] - width) / 2, y: (size[1] - height) / 2, width, height });

      return pdf.save();
    }

    preparePreview(preview) {
      preview.opener = null;
      preview.document.title = this.view.translate('Print calendar', 'labels', 'Calendar');
      preview.document.body.textContent = this.view.translate(
        'Preparing calendar PDF',
        'messages',
        'Calendar',
      );
    }

    downloadPdf(url, title) {
      const link = document.createElement('a');

      link.href = url;
      link.download = `${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 150)}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
    }

    async run() {
      if (this.busy) return;

      const root = this.view.el || this.view.$el?.get(0);

      if (!root?.isConnected) return;

      this.busy = true;

      const action = root.querySelector('[data-action="printCalendar"]');

      action?.setAttribute('aria-disabled', 'true');

      let preview;
      let url;

      try {
        preview = window.open('about:blank', '_blank');

        if (preview) {
          this.preparePreview(preview);
        }

        const [PDFLib, html2canvas] = await loadLibraries();

        if (preview?.closed || !root.isConnected) {
          if (preview && !preview.closed) preview.close();

          return;
        }

        const title = this.title();
        const canvas = await this.capture(root, html2canvas, title);
        const bytes = await this.createPdf(canvas, PDFLib, title);

        if (preview?.closed) return;

        url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));

        if (preview) {
          preview.location.replace(url);
        } else {
          // A browser may block new tabs; downloading still lets the user print the PDF.
          this.downloadPdf(url, title);
        }
      } catch (error) {
        if (preview && !preview.closed) preview.close();

        Espo.Ui.error(this.view.translate('Could not print calendar', 'messages', 'Calendar'));
      } finally {
        if (url) setTimeout(() => URL.revokeObjectURL(url), PREVIEW_URL_LIFETIME);

        action?.removeAttribute('aria-disabled');
        this.busy = false;
      }
    }
  };
});
