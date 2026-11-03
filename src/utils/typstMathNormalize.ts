/**
 * Normalisation for LaTeX → Typst math output.
 *
 * `tylax` renders upright text runs as function calls (`upright(A B C)`,
 * `#text[abc]`) and splits every italic word into single letters
 * (`out` → `o u t`). Inside a Typst math expression a bare multi-letter
 * run is an identifier and fails with "unknown variable", so upright text
 * has to become a quoted string and italic words have to stay spaced.
 *
 * This module rewrites the converter output to match that convention:
 *
 *   upright(A B C)            → "ABC"
 *   upright(bold(T r))        → bold("Tr")
 *   #text[abc def]            → "abc def"
 *   bold(#text[abc])          → bold("abc")
 *
 * Only the shapes produced by the converter are touched; anything else is
 * left untouched.
 */

/**
 * Matches text the converter split into single characters (`A B C`, `T r`).
 * Contiguous words stay untouched so symbol names such as `upright(alpha)`
 * are not turned into literal text.
 */
const SPLIT_LETTER_RUN = /^[A-Za-z0-9](?: +[A-Za-z0-9])*$/;

/** Counts backslashes immediately before `index`. */
function backslashRun(input: string, index: number): number {
  let count = 0;
  for (let i = index - 1; i >= 0 && input[i] === '\\'; i--) count++;
  return count;
}

/** Finds the index of the bracket closing the one opened at `open`. */
function findClosing(input: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = open; i < input.length; i++) {
    const ch = input[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Whether `index` sits inside a double-quoted Typst string. */
function inQuotedString(input: string, index: number): boolean {
  let inString = false;
  for (let i = 0; i < index; i++) {
    const ch = input[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '"') inString = !inString;
  }
  return inString;
}

/**
 * Finds `name(` calls at identifier boundaries and rewrites them through
 * `transform`. Returning `null` keeps the original call.
 */
function replaceCall(input: string, name: string, transform: (inner: string) => string | null): string {
  let out = '';
  let copied = 0;
  let from = 0;

  while (true) {
    const idx = input.indexOf(name, from);
    if (idx === -1) break;
    from = idx + name.length;

    const prev = input[idx - 1];
    if (prev !== undefined && /[A-Za-z0-9_.]/.test(prev)) continue;
    if (inQuotedString(input, idx)) continue;

    let cursor = idx + name.length;
    while (input[cursor] === ' ') cursor++;
    if (input[cursor] !== '(') continue;
    if (backslashRun(input, idx) % 2 === 1) continue;

    const close = findClosing(input, cursor, '(', ')');
    if (close === -1) continue;

    const inner = input.slice(cursor + 1, close);
    const replacement = transform(inner);
    if (replacement === null) continue;

    out += input.slice(copied, idx) + replacement;
    copied = close + 1;
    from = close + 1;
  }

  return copied === 0 ? input : out + input.slice(copied);
}

function quote(content: string): string {
  return `"${content.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isQuoted(content: string): boolean {
  if (content.length < 2 || !content.startsWith('"') || !content.endsWith('"')) return false;
  for (let i = 1; i < content.length - 1; i++) {
    if (content[i] === '\\') i++;
    else if (content[i] === '"') return false;
  }
  return true;
}

function isPlainRun(content: string): boolean {
  return SPLIT_LETTER_RUN.test(content);
}

/** `A B C` → `ABC`; spaces only separate the split letters of one word. */
function joinRun(content: string): string {
  return content.replace(/ +/g, '');
}

/** Returns `inner` if the whole string is exactly `bold(...)`, else null. */
function matchCall(input: string, name: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith(`${name}(`)) return null;
  const close = findClosing(trimmed, name.length, '(', ')');
  if (close !== trimmed.length - 1) return null;
  return trimmed.slice(name.length + 1, close);
}

/** `#text[abc]` → `"abc"` (Typst markup text inside math). */
function replaceTextMarkup(input: string): string {
  const token = '#text[';
  let out = '';
  let copied = 0;
  let from = 0;

  while (true) {
    const idx = input.indexOf(token, from);
    if (idx === -1) break;
    from = idx + token.length;
    if (inQuotedString(input, idx)) continue;

    const open = idx + '#text'.length;
    const close = findClosing(input, open, '[', ']');
    if (close === -1) continue;

    out += `${input.slice(copied, idx)}${quote(input.slice(open + 1, close))}`;
    copied = close + 1;
    from = close + 1;
  }

  return copied === 0 ? input : out + input.slice(copied);
}

/** `upright(...)` → quoted upright text, keeping a `bold(...)` wrapper. */
function replaceUpright(input: string): string {
  return replaceCall(input, 'upright', (rawInner) => {
    const inner = rawInner.trim();

    // `upright("abc")` is already upright text.
    if (isQuoted(inner)) return inner;

    const boldInner = matchCall(inner, 'bold');
    if (boldInner !== null) {
      const content = boldInner.trim();
      if (isQuoted(content)) return `bold(${content})`;
      if (isPlainRun(content)) return `bold(${quote(joinRun(content))})`;
      return `upright(${rawInner})`;
    }

    if (isPlainRun(inner)) return quote(joinRun(inner));

    return null;
  });
}

/**
 * Rewrites Typst math output so upright text is quoted and italic words
 * stay split into single letters.
 */
export function normalizeTypstMath(input: string): string {
  if (!input) return input;
  let out = replaceTextMarkup(input);
  out = replaceUpright(out);
  // `bold(#text[abc])` is handled because the text markup is already quoted.
  return out;
}

interface CommandReplace {
  /** Command name without the leading backslash. */
  command: string;
  /** Builds the replacement from the raw argument. */
  replace: (argument: string) => string;
}

const COMMAND_REPLACEMENTS: CommandReplace[] = [
  // Bold upright text: keep the bold weight but typeset it as text, so the
  // result is `bold("abc")` instead of markup (`*a b c*`).
  { command: 'textbf', replace: (arg) => `\\boldsymbol{\\text{${arg}}}` },
  { command: 'textrm', replace: (arg) => `\\text{${arg}}` },
  { command: 'textup', replace: (arg) => `\\text{${arg}}` },
  { command: 'textnormal', replace: (arg) => `\\text{${arg}}` },
  // `\textsf{ABC}` converts to a bare word (`ABC`), which Typst rejects.
  { command: 'textsf', replace: (arg) => `\\mathsf{${arg}}` },
  // Typst has no `mathnormal`; the argument is already math italic.
  { command: 'mathnormal', replace: (arg) => arg },
];

/** Rewrites LaTeX upright-text commands before conversion. */
export function preprocessLatexMath(latex: string): string {
  if (!latex.includes('\\')) return latex;

  let out = latex;
  for (const { command, replace } of COMMAND_REPLACEMENTS) {
    const token = `\\${command}{`;
    let from = 0;

    while (true) {
      const idx = out.indexOf(token, from);
      if (idx === -1) break;

      // Skip an escaped command such as `\\textbf`.
      if (backslashRun(out, idx) % 2 === 1) {
        from = idx + token.length;
        continue;
      }

      const close = findClosing(out, idx + token.length - 1, '{', '}');
      if (close === -1) break;

      out = out.slice(0, idx) + replace(out.slice(idx + token.length, close)) + out.slice(close + 1);
      from = idx + 1;
    }
  }

  return out;
}
