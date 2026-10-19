import { MarkdownView, Menu, Notice } from 'obsidian';

import { DEFAULT_FONT_SIZE } from '@/constants';
import { updateDiagnosticEffect } from '@/editor/shared/extensions/Diagnostic';
import { getActiveRegion } from '@/editor/shared/utils/core';
import { t } from '@/i18n';
import { format } from '@/libs/format';
import type { Processor, ProcessorKind } from '@/libs/processor';
import type { Diagnostic, SVGResult } from '@/libs/worker';
import type ObsidianTypstMate from '@/main';
import { DiagnosticModal } from '../modals/diagnostic';

export default abstract class TypstElement extends HTMLElement {
  ndir!: string;
  npath?: string;
  kind!: ProcessorKind;
  source!: string;
  processor!: Processor;

  noDiag!: boolean;
  offset: number = 0;

  plugin!: ObsidianTypstMate;

  isErr = true;

  menu = new Menu().addItem((item) => {
    item.setTitle(t('contextMenu.copyAsScript')).onClick(() => {
      const { formatted } = format(this.plugin, this.source, this.kind, this.processor);
      navigator.clipboard.writeText(
        formatted.replaceAll(
          'fontsize',
          `${(this.plugin.app.vault.config.baseFontSize ?? DEFAULT_FONT_SIZE) / 1.25}pt`,
        ),
      );
      new Notice(t('notices.copiedToClipboard'));
    });
  });

  abstract render(): Promise<this>;

  /**
   * Diagnostics are mapped onto the active math/codeblock region, so only the
   * element that owns that region may publish them. Every other rendered
   * formula would otherwise queue an editor transaction and trigger another
   * lint pass while scrolling.
   */
  private isActiveRegion(): boolean {
    const view = this.plugin.app.workspace.getActiveFileView();
    if (!(view instanceof MarkdownView)) return false;

    const file = this.plugin.app.workspace.getActiveFile();
    if (this.npath && file && this.npath !== file.path) return false;

    const region = getActiveRegion(view.editor.cm);
    if (!region || region.kind !== this.kind) return false;

    return view.editor.cm.state.sliceDoc(region.from + region.skip, region.to) === this.source;
  }

  postProcess(result: SVGResult) {
    this.isErr = false;

    // ? キャンバスなどで呼ばれたとき用
    const view = this.plugin.app.workspace.getActiveFileView();
    if (view instanceof MarkdownView && this.isActiveRegion())
      setTimeout(() => {
        updateDiagnosticEffect(view.editor.cm, {
          diagnostics: result.diags,
          processor: this.processor,
          noDiag: this.noDiag,
          offset: this.offset,
        });
      }, 0);

    this.plugin.typstManager.beforeKind = this.kind;
  }

  format() {
    const { formatted, offset } = format(this.plugin, this.source, this.kind, this.processor);
    this.offset = offset;

    return formatted;
  }

  handleError(err: Diagnostic[]) {
    this.isErr = true;
    this.plugin.typstManager.beforeKind = this.kind;

    const view = this.plugin.app.workspace.getActiveFileView();
    if (view instanceof MarkdownView && this.isActiveRegion())
      setTimeout(() => {
        updateDiagnosticEffect(view.editor.cm, {
          diagnostics: err,
          processor: this.processor,
          noDiag: this.noDiag,
          offset: this.offset,
        });
      }, 0);

    if (this.plugin.settings.enableMathjaxFallback) {
      this.replaceChildren(
        this.plugin.originalTex2chtml(this.source, {
          display: this.kind !== 'inline',
        }),
      );
    } else {
      if (view instanceof MarkdownView) {
        const region = getActiveRegion(view.editor.cm);
        if (region) {
          this.innerHTML = this.innerHTML.replaceAll('--typst-base-color', '--text-faint');
          return;
        }
      }
      const diagEl = document.createElement('span');
      diagEl.className = 'typstmate-error';

      diagEl.textContent = `${err[0]?.message}${err[0]?.hints.length !== 0 ? ` ${t('common.hintsCount', { count: err[0]?.hints.length ?? 0 })}` : ''}`;

      if (err[0]?.hints.length !== 0)
        diagEl.addEventListener('click', () => new DiagnosticModal(this.plugin.app, err).open());

      this.replaceChildren(diagEl);
    }
  }

  connectedCallback() {
    this.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.menu.showAtPosition({ x: event.pageX, y: event.pageY });
    });
  }
}
