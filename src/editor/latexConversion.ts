import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { type Editor, MarkdownView, Notice } from 'obsidian';

import { t } from '@/i18n';
import { RenderingEngine } from '@/libs/processor';
import { extarctCMMath } from '@/libs/typst';
import type ObsidianTypstMate from '@/main';
import {
  convertLatexEdits,
  convertLatexInMarkdown,
  hasConvertibleLatex,
  hasPossibleLatex,
  isLikelyLatexMath,
  isStandaloneLatex,
  isStandaloneLatexMath,
  type LatexConversionEdit,
  preserveOuterWhitespace,
  stripMathDelimiters,
} from '@/utils/latexConverter';
import { collectRegions } from './markdown/extensions/MarkdownCore';
import { getInnerRegionAt } from './shared/utils/core';

interface PendingRegionConversion {
  innerFrom: number;
  innerTo: number;
  innerContent: string;
  source: string;
  outerFrom: number;
  outerTo: number;
}

/**
 * Collects non-overlapping Typst replacement edits for all LaTeX formulas in
 * `[from, to]`. Math regions already parsed by CodeMirror are converted in
 * place; remaining LaTeX delimiters (`\[...\]`, `\(...\)`, environments, or
 * structures skipped by the markdown parser) are handled via `convertLatexEdits`.
 */
export async function collectRangeConversionEdits(
  plugin: ObsidianTypstMate,
  cm: EditorView,
  from: number,
  to: number,
): Promise<LatexConversionEdit[]> {
  ensureSyntaxTree(cm.state, to, 1000);

  const regions = collectRegions(cm, from, to).filter((r) => r.kind !== 'codeblock' && r.from >= from && r.to <= to);

  const excludeInRange: { from: number; to: number }[] = [];
  const pendingRegions: PendingRegionConversion[] = [];

  for (const region of regions) {
    const isDisplay = region.kind === 'display';
    const rawContent = cm.state.sliceDoc(region.from, region.to);
    const { processor, eqStart, eqEnd } = extarctCMMath(plugin.settings, rawContent, isDisplay);

    const delimLen = isDisplay ? 2 : 1;
    const outerFrom = Math.max(0, region.from - delimLen - from);
    const outerTo = Math.min(to - from, region.to + delimLen - from);

    if (processor.renderingEngine === RenderingEngine.MathJax) {
      excludeInRange.push({ from: outerFrom, to: outerTo });
      continue;
    }

    const innerFrom = region.from + eqStart;
    const innerTo = region.to - eqEnd;
    if (innerFrom > innerTo) continue;

    const innerContent = cm.state.sliceDoc(innerFrom, innerTo);
    const source = innerContent.trim();
    if (!source || !isLikelyLatexMath(source)) continue;

    pendingRegions.push({ innerFrom, innerTo, innerContent, source, outerFrom, outerTo });
  }

  const regionResults = await Promise.all(
    pendingRegions.map(async (item) => {
      try {
        const typst = (await plugin.typst.latexeq_to_typm(item.source)).trim();
        return { item, typst };
      } catch (err) {
        console.error('[typst-mate] latex conversion error:', err);
        return { item, typst: '' };
      }
    }),
  );

  const regionChanges: LatexConversionEdit[] = [];
  for (const { item, typst } of regionResults) {
    if (!typst || typst === item.source) continue;
    regionChanges.push({
      from: item.innerFrom,
      to: item.innerTo,
      insert: preserveOuterWhitespace(item.innerContent, typst),
    });
    excludeInRange.push({ from: item.outerFrom, to: item.outerTo });
  }

  // Formulas written with LaTeX delimiters (\[...\], \(...\), environments)
  // or in structures skipped by `collectRegions` are converted in place so
  // the cursor and scroll position stay intact.
  const rangeText = cm.state.sliceDoc(from, to);
  let fallbackChanges: LatexConversionEdit[] = [];
  try {
    const edits = await convertLatexEdits(rangeText, (latex) => plugin.typst.latexeq_to_typm(latex), excludeInRange);
    fallbackChanges = edits.map((edit) => ({
      from: edit.from + from,
      to: edit.to + from,
      insert: edit.insert,
    }));
  } catch (err) {
    console.error('[typst-mate] latex conversion error:', err);
  }

  const merged = [...regionChanges, ...fallbackChanges].sort((a, b) => a.from - b.from || a.to - b.to);
  const nonOverlapping: LatexConversionEdit[] = [];
  let lastTo = -1;
  for (const edit of merged) {
    if (edit.from < lastTo) continue;
    nonOverlapping.push(edit);
    lastTo = edit.to;
  }
  return nonOverlapping;
}

/**
 * Converts LaTeX formulas in the active selection, inside the current math
 * region (if the cursor is strictly inside its delimiters), or across the
 * entire note.
 */
export async function convertActiveLatexToTypst(plugin: ObsidianTypstMate, editor?: Editor): Promise<void> {
  let targetEditor = editor;
  if (!targetEditor) {
    const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      new Notice(t('notices.noActiveView'));
      return;
    }
    targetEditor = activeView.editor;
  }

  const cm = targetEditor.cm as EditorView | undefined;
  if (!cm) {
    new Notice(t('notices.noActiveView'));
    return;
  }

  const selection = cm.state.selection.main;

  // Case 1: Non-empty selection
  if (!selection.empty) {
    const changes = await collectRangeConversionEdits(plugin, cm, selection.from, selection.to);
    if (changes.length > 0) {
      cm.dispatch({ changes });
      new Notice(t('notices.latexConvertedCount', { count: changes.length }));
      return;
    }

    // If selection is a standalone LaTeX formula without delimiters
    const selectedText = cm.state.sliceDoc(selection.from, selection.to);
    if (isStandaloneLatexMath(selectedText)) {
      try {
        const converted = await plugin.typst.latexeq_to_typm(selectedText.trim());
        if (converted) {
          targetEditor.replaceSelection(converted);
          new Notice(t('notices.latexConverted'));
          return;
        }
      } catch (err) {
        console.error('[typst-mate] latex conversion error:', err);
      }
    }

    new Notice(t('notices.noLatexFound'));
    return;
  }

  // Case 2: Cursor strictly inside a math block
  const innerRegion = getInnerRegionAt(cm, selection.head);
  if (
    innerRegion &&
    (innerRegion.kind === 'inline' || innerRegion.kind === 'display') &&
    innerRegion.processor?.renderingEngine !== RenderingEngine.MathJax
  ) {
    const content = cm.state.sliceDoc(innerRegion.from + innerRegion.skip, innerRegion.to);
    const source = content.trim();
    if (source.length > 0 && isLikelyLatexMath(source)) {
      try {
        const converted = (await plugin.typst.latexeq_to_typm(source)).trim();
        if (converted && converted !== source) {
          cm.dispatch({
            changes: {
              from: innerRegion.from + innerRegion.skip,
              to: innerRegion.to,
              insert: preserveOuterWhitespace(content, converted),
            },
          });
          new Notice(t('notices.latexConverted'));
          return;
        }
      } catch (err) {
        console.error('[typst-mate] latex conversion error:', err);
      }
    }
  }

  // Case 3: Convert all LaTeX formulas in the entire note
  const changes = await collectRangeConversionEdits(plugin, cm, 0, cm.state.doc.length);
  if (changes.length > 0) {
    cm.dispatch({ changes });
    new Notice(t('notices.latexConvertedCount', { count: changes.length }));
    return;
  }

  new Notice(t('notices.noLatexFound'));
}

/**
 * Handles `editor-paste` when `autoConvertLatexOnPaste` is enabled.
 * `evt.preventDefault()` is always invoked synchronously before any `await`
 * so the browser never performs a duplicate default paste.
 */
export async function handleLatexPaste(plugin: ObsidianTypstMate, evt: ClipboardEvent, editor: Editor): Promise<void> {
  if (!plugin.settings.autoConvertLatexOnPaste) return;
  if (evt.clipboardData?.files?.length) return;

  const text = evt.clipboardData?.getData('text/plain');
  if (!text || !hasPossibleLatex(text)) return;

  const cm = editor.cm as EditorView | undefined;
  if (!cm) return;

  const innerRegion = getInnerRegionAt(cm, cm.state.selection.main.head);
  const insideMath = innerRegion && (innerRegion.kind === 'inline' || innerRegion.kind === 'display');

  if (insideMath) {
    if (innerRegion.processor?.renderingEngine === RenderingEngine.MathJax) return;
    const stripped = stripMathDelimiters(text);
    if (!isLikelyLatexMath(stripped)) return;

    evt.preventDefault();
    try {
      const converted = await plugin.typst.latexeq_to_typm(stripped);
      editor.replaceSelection(converted || stripped);
    } catch (err) {
      console.error('[typst-mate] paste conversion error:', err);
      editor.replaceSelection(text);
    }
    return;
  }

  if (hasConvertibleLatex(text)) {
    evt.preventDefault();
    try {
      const { text: converted, count } = await convertLatexInMarkdown(text, (latex) =>
        plugin.typst.latexeq_to_typm(latex),
      );
      editor.replaceSelection(count > 0 ? converted : text);
    } catch (err) {
      console.error('[typst-mate] paste conversion error:', err);
      editor.replaceSelection(text);
    }
    return;
  }

  if (isStandaloneLatex(text)) {
    evt.preventDefault();
    try {
      const stripped = stripMathDelimiters(text);
      const converted = await plugin.typst.latexeq_to_typm(stripped);
      const isDisplay = text.includes('\n') || /\\begin\{/.test(text) || /^\\\[/.test(text.trim());
      const isMultiline = text.includes('\n') || /\\begin\{/.test(text);
      const result = isDisplay
        ? isMultiline
          ? `$$\n${converted.trim()}\n$$`
          : `$$ ${converted} $$`
        : `$ ${converted} $`;
      editor.replaceSelection(result);
    } catch (err) {
      console.error('[typst-mate] paste conversion error:', err);
      editor.replaceSelection(text);
    }
  }
}
