import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { editorLivePreviewField } from 'obsidian';

import { RELAXED_INLINE_MATH } from '@/constants';
import { ctxToNDir } from '@/libs/typst';
import type ObsidianTypstMate from '@/main';
import { helperFacet } from '../../shared/extensions/Helper';
import { collectRegions } from './MarkdownCore';

interface Range {
  from: number;
  to: number;
}

class RelaxedInlineMathWidget extends WidgetType {
  constructor(
    private readonly plugin: ObsidianTypstMate,
    private readonly code: string,
    private readonly ndir: string,
    private readonly npath: string | undefined,
    private readonly from: number,
    private readonly view: EditorView,
  ) {
    super();
  }

  override eq(other: RelaxedInlineMathWidget): boolean {
    return other.code === this.code && other.from === this.from;
  }

  override toDOM(): HTMLElement {
    const container = document.createElement('span');
    container.className = 'typstmate-relaxed-inline-math';

    container.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.view.dispatch({ selection: { anchor: this.from + 1 } });
      this.view.focus();
    });

    this.plugin.typstManager.render(this.code, container, 'inline', this.ndir, this.npath);
    return container;
  }
}

function overlaps(ranges: Range[], from: number, to: number): boolean {
  return ranges.some((range) => range.from < to && from < range.to);
}

function collectExcludedRanges(view: EditorView): Range[] {
  const ranges = collectRegions(view, view.viewport.from, view.viewport.to).map((region) => {
    const padding = region.kind === 'display' ? 2 : region.kind === 'inline' ? 1 : 0;
    return { from: region.from - padding, to: region.to + padding };
  });

  syntaxTree(view.state).iterate({
    from: view.viewport.from,
    to: view.viewport.to,
    enter: (node) => {
      const name = node.name.toLowerCase();
      if (name.includes('code') || name.includes('comment') || name.includes('url'))
        ranges.push({ from: node.from, to: node.to });
    },
  });

  return ranges;
}

function hasDollar(view: EditorView): boolean {
  for (const { from, to } of view.visibleRanges) if (view.state.sliceDoc(from, to).includes('$')) return true;
  return false;
}

function buildDecorations(view: EditorView): DecorationSet {
  if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;
  // Avoid walking the syntax tree and scanning every line while scrolling
  // through notes that contain no dollar signs at all.
  if (!hasDollar(view)) return Decoration.none;

  const helper = view.state.facet(helperFacet);
  const file = helper.plugin.app.workspace.getActiveFile();
  const ndir = file?.parent ? ctxToNDir(file.path) : '/';
  const npath = file?.path;

  const excluded = collectExcludedRanges(view);
  const builder = new RangeSetBuilder<Decoration>();

  for (const visible of view.visibleRanges) {
    let position = visible.from;

    while (position <= visible.to) {
      const line = view.state.doc.lineAt(position);
      const end = Math.min(line.to, visible.to);
      const text = view.state.sliceDoc(line.from, end);

      RELAXED_INLINE_MATH.lastIndex = 0;
      for (let match = RELAXED_INLINE_MATH.exec(text); match; match = RELAXED_INLINE_MATH.exec(text)) {
        const code = match[1];
        if (code === undefined) continue;

        const from = line.from + match.index;
        const to = from + match[0].length;

        if (overlaps(excluded, from, to) || view.state.selection.ranges.some((s) => s.from <= to && from <= s.to))
          continue;

        builder.add(
          from,
          to,
          Decoration.replace({
            widget: new RelaxedInlineMathWidget(helper.plugin, code, ndir, npath, from, view),
          }),
        );
      }

      if (line.to >= visible.to) break;
      position = line.to + 1;
    }
  }

  return builder.finish();
}

class RelaxedInlineMathPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged)
      this.decorations = buildDecorations(update.view);
  }
}

export const relaxedInlineMathExtension = ViewPlugin.fromClass(RelaxedInlineMathPlugin, {
  decorations: (plugin) => plugin.decorations,
});
