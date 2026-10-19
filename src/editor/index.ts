import { ensureSyntaxTree } from '@codemirror/language';
import { Prec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { MarkdownView, Notice } from 'obsidian';

import { t } from '@/i18n';
import { RenderingEngine } from '@/libs/processor';
import { ctxToNDir } from '@/libs/typst';
import type ObsidianTypstMate from '@/main';
import { buildExtension as buildSharedExtensions } from './markdown/build';
import { collectRegions, parseRegion } from './markdown/extensions/MarkdownCore';
import { getActiveRegion } from './shared/utils/core';

import './shared/css';

export class EditorHelper {
  plugin: ObsidianTypstMate;
  supportedCodeBlockLangs: Set<string>;

  constructor(plugin: ObsidianTypstMate) {
    this.plugin = plugin;

    this.supportedCodeBlockLangs = new Set(
      (this.plugin.settings.processor.codeblock?.processors ?? []).map((p) => p.id),
    );

    // 拡張機能をセット
    this.plugin.registerEditorExtension([Prec.high([...buildSharedExtensions(this)])]);
  }

  /* utils
   */
  hideAllPopup() {
    // TODO
  }

  /**
   * Compiles every inline/display formula in the active note into the SVG
   * cache, one at a time. The worker stays responsive because each iteration
   * awaits the previous compile; interactive renders queued in between run
   * before the next precompile request.
   */
  async precompileActiveNote() {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return;

    const cm = view.editor?.cm;
    if (!cm) return;

    const docLength = cm.state.doc.length;
    ensureSyntaxTree(cm.state, docLength, 5000);

    const cache = this.plugin.app.metadataCache.getCache(view.file.path);
    if (cache) this.plugin.typstManager.syncFileCache(cache);

    const ndir = ctxToNDir(view.file.path);
    const regions = collectRegions(cm, 0, docLength);

    for (const region of regions) {
      if (this.plugin.app.workspace.getActiveViewOfType(MarkdownView) !== view) return;

      const parsed = parseRegion(cm, this, region, true);
      if (!parsed?.processor || parsed.processor.renderingEngine === RenderingEngine.MathJax) continue;
      if (parsed.kind === 'codeblock') continue;

      const source = cm.state.sliceDoc(parsed.from + parsed.skip, parsed.to);
      try {
        const result = this.plugin.typstManager.precompile(source, parsed.kind, parsed.processor, ndir);
        if (result instanceof Promise) await result;
      } catch {
        // Diagnostics are shown by the normal render path; precompiling is
        // best-effort only.
      }
    }
  }

  triggerRippleEffect(view: EditorView, pos: number) {
    const coords = view.coordsAtPos(pos);
    if (!coords) return;

    const ripple = document.createElement('div');
    ripple.className = 'typstmate-jump-ripple';
    ripple.style.left = `${coords.left}px`;
    ripple.style.top = `${coords.top}px`;
    document.body.appendChild(ripple);

    setTimeout(() => {
      ripple.remove();
    }, 900);
  }

  /* Editor Commands
   * Obsidian LaTeX Suite からの輸入
   */

  boxCurrentEquation(view: EditorView) {
    const region = getActiveRegion(view);
    if (!region) return new Notice(t('notices.noActiveRegion'));

    const content = view.state.sliceDoc(region.from + region.skip, region.to);

    view.dispatch({
      changes: {
        from: region.from + region.skip,
        to: region.to,
        insert: `${region.kind === 'display' ? ' ' : ''}boxed(${content})`,
      },
      selection: {
        anchor: region.from + region.skip + `boxed(${content})`.length,
      },
    });
  }

  selectCurrentEquation(view: EditorView) {
    const region = getActiveRegion(view);
    if (!region) return new Notice(t('notices.noActiveRegion'));

    view.dispatch({
      selection: { anchor: region.from + region.skip, head: region.to },
    });
  }
}
