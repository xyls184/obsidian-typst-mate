import type { Settings } from '@/data/settings';
import type ObsidianTypstMate from '@/main';

import { FULL_HEIGHT_INLINE_FORMAT, type Processor, type ProcessorKind } from './processor';
import { getNoteWidth } from './profile';

/**
 * Han, kana, Hangul, CJK punctuation and fullwidth forms. The math.text font
 * fallback is only needed when the source actually contains these; injecting
 * it into every formula makes Typst resolve a second font family for all text
 * runs and adds a measurable cost to each compile.
 */
const CJK = /[\u2E80-\u2FFF\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/;

/**
 * Applies the full-height inline-math override. Both the on-screen renderer
 * and the startup pre-compiler must agree on the resulting processor, otherwise
 * the cache is filled with SVGs that differ from what is displayed.
 */
export function getEffectiveProcessor(
  settings: Settings,
  kind: ProcessorKind,
  processor: Processor,
): Processor {
  if (
    kind === 'inline' &&
    settings.inlineFullHeight &&
    processor.format.includes('${CODE}$') &&
    !processor.format.includes('math.equation')
  )
    return { ...processor, format: FULL_HEIGHT_INLINE_FORMAT };

  return processor;
}

export function format(plugin: ObsidianTypstMate, source: string, kind: ProcessorKind, processor: Processor) {
  let formatted = processor.useReplaceAll
    ? processor.format.replaceAll('{CODE}', source)
    : processor.format.replace('{CODE}', source);
  formatted = `${plugin.typstManager.preamble}\n${formatted}${kind === 'inline' ? '#text(size:0pt)[TypstMate]' : ''}`;
  const cjkPreamble = CJK.test(source) ? plugin.typstManager.cjkPreamble : '';
  formatted = processor.noPreamble
    ? formatted
    : `${plugin.settings.preamble}\n${cjkPreamble ? `${cjkPreamble}\n` : ''}${formatted}`;

  let offset =
    -processor.format.indexOf('{CODE}') -
    (processor.noPreamble ? 0 : plugin.settings.preamble.length + 1) -
    (processor.noPreamble || !cjkPreamble ? 0 : cjkPreamble.length + 1) -
    plugin.typstManager.preamble.length -
    1;

  if (processor.fitToNoteWidth) {
    const width = getNoteWidth(plugin);
    formatted = `#let WIDTH = ${width}\n${formatted}`;
    offset -= 14 + width.length;
  }

  return { formatted, offset };
}
