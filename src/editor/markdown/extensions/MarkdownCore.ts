import { syntaxTree } from '@codemirror/language';
import { type EditorView, type PluginValue, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { parse, parseCode, parseMath, reparse, SyntaxMode, type SyntaxNode } from '@typstmate/typst-syntax';

import type { EditorHelper } from '@/editor';
import { helperFacet } from '@/editor/shared/extensions/Helper';
import type { ParsedRegion } from '@/editor/shared/utils/core';
import { type ProcessorKind, RenderingEngine } from '@/libs/processor';
import { extarctCMMath } from '@/libs/typst';
import { getModeAndKindFromRegion } from '@/utils/typstSyntax';

interface Region {
  id: number;

  /** right after the delimiter */
  from: number;
  /** right before the delimiter */
  to: number;

  kind: ProcessorKind;

  lang?: string;
}

const INLINEMATH_BEGIN = 'formatting_formatting-math_formatting-math-begin_keyword_math';
const DISPLAYMATH_BEGIN = 'formatting_formatting-math_formatting-math-begin_keyword_math_math-block';
const MATH_END = 'formatting_formatting-math_formatting-math-end_keyword_math_math-';

const CODEBLOCK_BEGIN = 'HyperMD-codeblock_HyperMD-codeblock-begin_HyperMD-codeblock-begin-bg_HyperMD-codeblock-bg';
const CODEBLOCK_END = 'HyperMD-codeblock_HyperMD-codeblock-bg_HyperMD-codeblock-end_HyperMD-codeblock-end-bg';

function scanRegions(
  view: EditorView,
  from: number | undefined,
  to: number | undefined,
  onRegion: (region: Region) => boolean | undefined,
): void {
  const tree = syntaxTree(view.state);

  let id = 0;
  let mathStart: number | null = null; // 区切り文字は含まない
  let isDisplayMath = false;
  let codeblockLangEnd: number | null = null; // 区切り文字は含まない
  let codeblockLang = '';
  let stop = false;

  tree.iterate({
    from,
    to,
    enter: (node) => {
      if (stop) return false;

      switch (node.name) {
        case INLINEMATH_BEGIN:
          mathStart = node.to;
          isDisplayMath = false;
          break;
        case DISPLAYMATH_BEGIN:
          mathStart = node.to;
          isDisplayMath = true;
          break;
        case MATH_END: {
          if (mathStart === null) break;

          const innerFrom = mathStart;
          const innerTo = node.from;
          const kind = !isDisplayMath ? 'inline' : 'display';
          mathStart = null;

          if (innerFrom <= innerTo) {
            if (onRegion({ from: innerFrom, to: innerTo, kind, id }) === false) {
              stop = true;
              return false;
            }
            id++;
          }
          break;
        }
        case CODEBLOCK_BEGIN: {
          codeblockLangEnd = node.to;
          codeblockLang = view.state.sliceDoc(node.from + 3, codeblockLangEnd).trim();
          break;
        }
        case CODEBLOCK_END: {
          if (codeblockLangEnd === null) break;

          const codeblockStart = codeblockLangEnd - codeblockLang.length;
          const codeblockEnd = node.from - 1;
          const langEnd = codeblockLangEnd;
          codeblockLangEnd = null;

          if (langEnd < codeblockEnd) {
            if (
              onRegion({
                id,
                from: codeblockStart,
                to: codeblockEnd,
                kind: 'codeblock',
                lang: codeblockLang,
              }) === false
            ) {
              stop = true;
              return false;
            }
            id++;
          }
          break;
        }
      }

      return true;
    },
  });
}

export const collectRegions = (view: EditorView, from?: number, to?: number): Region[] => {
  const rawRegions: Region[] = [];
  scanRegions(view, from, to, (region) => {
    rawRegions.push(region);
    return true;
  });
  return rawRegions;
};

function findActiveRegion(view: EditorView, cursor: number): Region | null {
  const { from, to } = view.viewport;
  let result: Region | null = null;

  scanRegions(view, from, to, (region) => {
    if (region.kind === 'codeblock') {
      const langEnd = region.from + (region.lang?.length ?? 0);
      // ? the range of ... in  ```lang\n...\n```
      if (langEnd < cursor && cursor <= region.to) {
        result = region;
        return false;
      }
      if (cursor < langEnd) return false;
      return true;
    }

    if (region.from <= cursor && cursor <= region.to) {
      result = region;
      return false;
    }
    if (cursor < region.from) return false;
    return true;
  });

  return result;
}

export function parseRegion(
  view: EditorView,
  helper: EditorHelper,
  region: Region,
  skipParse = false,
): ParsedRegion | null {
  // ! region.from, region.to は必ずそのまま
  // Codeblcok
  if (region.kind === 'codeblock') {
    const beginLine = view.state.doc.lineAt(region.from - 1);
    const lang = beginLine.text.slice(3).trim();
    const skip = lang.length + 1;

    const processor = helper.plugin.settings.processor.codeblock?.processors.find((p) => p.id === lang);
    if (processor === undefined) return null;

    const mode = processor.syntaxMode ?? SyntaxMode.Markup;
    let tree: SyntaxNode | undefined;
    if (processor.renderingEngine === RenderingEngine.MathJax || processor.syntaxMode === null) tree = undefined;
    else if (!skipParse) {
      const text = view.state.sliceDoc(region.from + skip, region.to);
      tree = mode === SyntaxMode.Code ? parseCode(text) : mode === SyntaxMode.Math ? parseMath(text) : parse(text);
    }

    return {
      id: region.id,

      skip,
      skipEnd: 1,
      from: region.from,
      to: region.to,

      kind: region.kind,
      processor,

      mode,
      tree,
    };
  }

  // Inline / Display
  const isDisplay = region.kind === 'display';
  const content = view.state.sliceDoc(region.from, region.to);
  const { processor, eqStart, eqEnd } = extarctCMMath(helper.plugin.settings, content, isDisplay);

  if (region.to < region.from + eqStart) return null;

  const text = view.state.sliceDoc(region.from + eqStart, region.to - eqEnd);

  const mode = processor.syntaxMode ?? SyntaxMode.Math;
  let tree: SyntaxNode | undefined;
  if (processor.renderingEngine === RenderingEngine.MathJax || processor.syntaxMode === null) tree = undefined;
  else if (!skipParse) {
    tree = mode === SyntaxMode.Code ? parseCode(text) : mode === SyntaxMode.Math ? parseMath(text) : parse(text);
  }

  return {
    id: region.id,

    skip: eqStart,
    skipEnd: eqEnd,
    from: region.from,
    to: region.to - eqEnd,

    kind: region.kind,
    processor,

    mode,
    tree,
  };
}

export class MarkdownCorePluginValue implements PluginValue {
  activeRegion: ParsedRegion | null = null;
  prevCursor: number = 0;

  constructor(view: EditorView) {
    this.recompute(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged) {
      if (this.activeRegion) {
        const cursor = update.state.selection.main.head;
        const innerFromA = this.activeRegion.from + this.activeRegion.skip;
        const innerToA = this.activeRegion.to;
        const delimPattern = this.activeRegion.kind === 'codeblock' ? /[`~]/ : /\$/;

        let changesCount = 0;
        let lastChange: { fromA: number; toA: number; fromB: number; toB: number; inserted: string } | null = null;
        let touchedBoundaryOrDelim = false;

        update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
          changesCount++;
          const insertedText = inserted.toString();
          lastChange = { fromA, toA, fromB, toB, inserted: insertedText };

          if (fromA < innerFromA || toA > innerToA) {
            touchedBoundaryOrDelim = true;
            return;
          }

          const deletedText = update.startState.sliceDoc(fromA, toA);
          if (delimPattern.test(insertedText) || delimPattern.test(deletedText)) {
            touchedBoundaryOrDelim = true;
          }
        });

        if (touchedBoundaryOrDelim) {
          this.recompute(update.view);
          return;
        }

        const newFrom = update.changes.mapPos(this.activeRegion.from, -1);
        const rawTo = this.activeRegion.to + this.activeRegion.skipEnd;
        const newRawTo = update.changes.mapPos(Math.min(rawTo, update.changes.length), -1);

        if (newFrom <= cursor && cursor <= newRawTo) {
          const helper = update.view.state.facet(helperFacet);

          const newRegion = parseRegion(
            update.view,
            helper,
            {
              id: this.activeRegion.id,
              from: newFrom,
              to: newRawTo - this.activeRegion.skipEnd,
              kind: this.activeRegion.kind,
            },
            true,
          );

          if (newRegion) {
            let reparsed = false;
            if (this.activeRegion.tree && changesCount === 1 && lastChange) {
              const change = lastChange as { fromA: number; toA: number; inserted: string };
              const localStart = change.fromA - innerFromA;
              const localEnd = change.toA - innerFromA;
              const innerNewText = update.view.state.sliceDoc(newRegion.from + newRegion.skip, newRegion.to);
              try {
                newRegion.tree = reparse(
                  this.activeRegion.tree,
                  innerNewText,
                  { start: localStart, end: localEnd },
                  change.inserted.length,
                );
                reparsed = true;
              } catch (e) {
                console.error('TypstMate: Incremental reparse failed', e);
              }
            }

            if (
              !reparsed &&
              newRegion.processor?.renderingEngine !== RenderingEngine.MathJax &&
              newRegion.processor?.syntaxMode !== null
            ) {
              const mode = newRegion.mode;
              const innerText = update.view.state.sliceDoc(newRegion.from + newRegion.skip, newRegion.to);
              newRegion.tree =
                mode === SyntaxMode.Code
                  ? parseCode(innerText)
                  : mode === SyntaxMode.Math
                    ? parseMath(innerText)
                    : parse(innerText);
            }
          }

          this.activeRegion = newRegion;
          this.prevCursor = cursor;

          this.updateActiveKindAndMode(cursor);
          return;
        }
        this.recompute(update.view);
      } else {
        const cursor = update.state.selection.main.head;
        const cursorLineText = update.view.state.doc.lineAt(cursor).text;
        let hasDelimiter = /[$`~\\]/.test(cursorLineText);

        if (!hasDelimiter) {
          update.changes.iterChanges((fromA, toA, fB, tB, inserted) => {
            if (hasDelimiter) return;
            const text = inserted.toString();
            const deleted = update.startState.sliceDoc(fromA, toA);
            const textNext = update.view.state.sliceDoc(tB, tB + 1);
            const currentLine = update.view.state.doc.lineAt(fB).text;
            if (
              /[$`~\\]/.test(text) ||
              /[$`~\\]/.test(deleted) ||
              /[$`~\\]/.test(textNext) ||
              (currentLine.startsWith('```') && text === '\n')
            ) {
              hasDelimiter = true;
            }
          });
        }
        if (hasDelimiter) this.recompute(update.view);
      }
    } else if (update.selectionSet) {
      const cursor = update.state.selection.main.head;
      if (cursor === this.prevCursor) return;
      this.prevCursor = cursor;

      if (
        this.activeRegion &&
        this.activeRegion.from + this.activeRegion.skip <= cursor &&
        cursor <= this.activeRegion.to
      ) {
        const { kind, mode } = getModeAndKindFromRegion(this.activeRegion, cursor);
        this.activeRegion.activeKind = kind;
        this.activeRegion.activeMode = mode;
        return;
      }
      this.recompute(update.view);
    }
  }

  recompute(view: EditorView) {
    const helper = view.state.facet(helperFacet);

    const cursor = view.state.selection.main.head;
    const region = findActiveRegion(view, cursor);
    if (!region) {
      helper.hideAllPopup();
      this.activeRegion = null;
      return;
    }
    this.activeRegion = parseRegion(view, helper, region);

    this.updateActiveKindAndMode(cursor);
  }

  updateActiveKindAndMode(cursor: number): boolean {
    if (!this.activeRegion) return false;
    const { mode, kind } = getModeAndKindFromRegion(this.activeRegion, cursor);
    this.activeRegion.activeMode = mode;
    this.activeRegion.activeKind = kind;
    return true;
  }
}

export const markdownCore = ViewPlugin.fromClass(MarkdownCorePluginValue);
