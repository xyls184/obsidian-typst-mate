/**
 * Normalisation for LaTeX → Typst math output.
 *
 * `tylax` renders upright text runs as function calls (`upright(A B C)`,
 * `#text[abc]`), emits `#box(...)[$ ... $]` for `\boxed{...}`, splits
 * every italic word into single letters (`out` → `o u t`), and splits
 * multi-digit numbers and decimals (`30` → `3 0`, `3.14` → `3 . 1 4`).
 * Inside a Typst math expression a bare multi-letter run is an identifier
 * and fails with "unknown variable", and literal `$ ... $` inside `#box`
 * breaks Obsidian's `$...$` delimiter parser.
 *
 * This module rewrites the converter output to match Obsidian / Typst conventions:
 *
 *   #box(...)[$ ... $]        → boxed(...)
 *   upright(A B C)            → "ABC"
 *   upright(bold(T r))        → bold("Tr")
 *   #text[abc def]            → "abc def"
 *   bold(#text[abc])          → bold("abc")
 *   3 0 / 3 . 1 4             → 30 / 3.14
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

/** Finds the index of the quote closing the double-quoted string at `openQuote`. */
function findClosingQuote(input: string, openQuote: number): number {
  for (let i = openQuote + 1; i < input.length; i++) {
    if (input[i] === '\\') {
      i++;
      continue;
    }
    if (input[i] === '"') return i;
  }
  return -1;
}

/** Finds the index of the bracket closing the one opened at `open`. */
function findClosing(input: string, open: number, openCh: string, closeCh: string, respectQuotes = true): number {
  let depth = 0;
  for (let i = open; i < input.length; i++) {
    const ch = input[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '"' && respectQuotes && openCh !== '"') {
      const qEnd = findClosingQuote(input, i);
      if (qEnd !== -1) {
        i = qEnd;
        continue;
      }
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Returns true if `input` contains any unescaped `$` outside Typst strings and comments. */
function hasUnescapedDollar(input: string): boolean {
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '"') {
      const qEnd = findClosingQuote(input, i);
      if (qEnd !== -1) {
        i = qEnd;
        continue;
      }
    }
    if (ch === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2);
      if (end !== -1) {
        i = end + 1;
        continue;
      }
    }
    if (ch === '/' && input[i + 1] === '/') {
      const end = input.indexOf('\n', i + 2);
      if (end === -1) return false;
      i = end;
      continue;
    }
    if (ch === '$') return true;
  }
  return false;
}

/**
 * Unwraps outer `#math.equation(...)[$ ... $]` or `$ ... $` emitted by `tylax`
 * for environments like `align*` and `gather` so Obsidian's `$$...$$` wrapper
 * does not break on inner `$` delimiters.
 */
function unwrapEquationWrapper(input: string): string {
  const originalTrimmed = input.trim();
  let current = originalTrimmed;

  const prefix = '#math.equation(';
  if (current.startsWith(prefix)) {
    const closeParen = findClosing(current, prefix.length - 1, '(', ')');
    if (closeParen !== -1) {
      let cursor = closeParen + 1;
      while (current[cursor] === ' ') cursor++;
      if (current[cursor] === '[') {
        const closeBracket = findClosing(current, cursor, '[', ']');
        if (closeBracket === current.length - 1) {
          current = current.slice(cursor + 1, closeBracket).trim();
        }
      }
    }
  }

  if (
    current.length >= 2 &&
    current.startsWith('$') &&
    !current.startsWith('$$') &&
    current.endsWith('$') &&
    !current.endsWith('$$') &&
    backslashRun(current, current.length - 1) % 2 === 0
  ) {
    const inner = current.slice(1, -1);
    if (!hasUnescapedDollar(inner)) {
      return inner.trim();
    }
  }

  return current === originalTrimmed ? input : current;
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

/** `#box(stroke: ..., ...)[$ inner $]` → `boxed(inner)` to avoid inner `$` breaking math delimiters. */
function replaceBoxedMarkup(input: string): string {
  const token = '#box(';
  let out = '';
  let copied = 0;
  let from = 0;

  while (true) {
    const idx = input.indexOf(token, from);
    if (idx === -1) break;
    from = idx + token.length;
    if (inQuotedString(input, idx) || backslashRun(input, idx) % 2 === 1) continue;

    const closeParen = findClosing(input, idx + '#box'.length, '(', ')');
    if (closeParen === -1) continue;

    // Preserve `#box(fill: ...)[...]` generated by `\colorbox` / `\fcolorbox`.
    const args = input.slice(idx + token.length, closeParen);
    if (/\bfill\s*:/.test(args)) continue;

    let cursor = closeParen + 1;
    while (input[cursor] === ' ') cursor++;
    if (input[cursor] !== '[') continue;

    const closeBracket = findClosing(input, cursor, '[', ']');
    if (closeBracket === -1) continue;

    const body = input.slice(cursor + 1, closeBracket).trim();
    if (!body.startsWith('$') || !body.endsWith('$') || body.length < 2) continue;

    const inner = body.slice(1, -1).trim();
    out += `${input.slice(copied, idx)}boxed(${replaceBoxedMarkup(inner)})`;
    copied = closeBracket + 1;
    from = closeBracket + 1;
  }

  return copied === 0 ? input : out + input.slice(copied);
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

function endsWithSlashDenominator(out: string): boolean {
  let j = out.length - 1;
  while (j >= 0 && isDigit(out[j])) j--;
  return j >= 0 && out[j] === '/';
}

/** Rejoins multi-digit numbers and decimals split by `tylax` (`3 0` → `30`, `3 . 1 4` → `3.14`). */
function joinSplitNumbers(input: string): string {
  let out = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (ch === '"') {
      out += ch;
      i++;
      while (i < input.length) {
        const q = input[i]!;
        out += q;
        if (q === '\\' && i + 1 < input.length) {
          i++;
          out += input[i]!;
        } else if (q === '"') {
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2);
      const sliceEnd = end === -1 ? input.length : end + 2;
      out += input.slice(i, sliceEnd);
      i = sliceEnd - 1;
      continue;
    }

    if (ch === '/' && input[i + 1] === '/') {
      const end = input.indexOf('\n', i + 2);
      const sliceEnd = end === -1 ? input.length : end + 1;
      out += input.slice(i, sliceEnd);
      i = sliceEnd - 1;
      continue;
    }

    if (ch === ' ' && isDigit(out[out.length - 1]) && !endsWithSlashDenominator(out)) {
      if (isDigit(input[i + 1])) continue;
      if (input[i + 1] === '.' && input[i + 2] === ' ' && isDigit(input[i + 3])) {
        out += '.';
        i += 2;
        continue;
      }
    }

    out += ch;
  }

  return out;
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
 * Escapes `%` as `\%` in Typst math so Markdown parsers (e.g. Obsidian) do not
 * interpret `%` or `%%` as comments, while leaving quoted strings, Typst
 * comments, and `#call(...)` code arguments (such as `20%`) untouched.
 */
function escapeMathPercent(input: string): string {
  if (!input.includes('%')) return input;

  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (ch === '\\') {
      if (i + 1 < input.length) {
        out += ch + input[i + 1]!;
        i++;
      } else {
        out += ch;
      }
      continue;
    }

    if (ch === '"') {
      const qEnd = findClosingQuote(input, i);
      if (qEnd !== -1) {
        out += input.slice(i, qEnd + 1);
        i = qEnd;
        continue;
      }
    }

    if (ch === '/' && input[i + 1] === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < input.length && depth > 0) {
        if (input[j] === '/' && input[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (input[j] === '*' && input[j + 1] === '/') {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      if (depth === 0) {
        out += input.slice(i, j);
        i = j - 1;
        continue;
      }
    }

    if (ch === '/' && input[i + 1] === '/') {
      const nl = input.indexOf('\n', i + 2);
      const end = nl === -1 ? input.length : nl;
      out += input.slice(i, end);
      i = end - 1;
      continue;
    }

    if (ch === '#') {
      const tail = input.slice(i + 1);
      const identMatch = tail.match(/^[A-Za-z_][A-Za-z0-9_.-]*/);
      if (identMatch) {
        let cursor = i + 1 + identMatch[0].length;
        while (input[cursor] === ' ') cursor++;
        if (input[cursor] === '(') {
          const closeParen = findClosing(input, cursor, '(', ')');
          if (closeParen !== -1) {
            out += input.slice(i, closeParen + 1);
            i = closeParen;
            continue;
          }
        }
      }
    }

    if (ch === '%') {
      out += '\\%';
      continue;
    }

    out += ch;
  }

  return out;
}

/**
 * Rewrites Typst math output so boxed formulas use `boxed(...)`, upright text
 * is quoted, and split numbers are rejoined while italic words stay spaced.
 */
export function normalizeTypstMath(input: string): string {
  if (!input) return input;
  let out = unwrapEquationWrapper(input);
  out = replaceBoxedMarkup(out);
  out = replaceTextMarkup(out);
  out = replaceUpright(out);
  out = joinSplitNumbers(out);
  out = escapeMathPercent(out);
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

      const close = findClosing(out, idx + token.length - 1, '{', '}', false);
      if (close === -1) break;

      out = out.slice(0, idx) + replace(out.slice(idx + token.length, close)) + out.slice(close + 1);
      from = idx + 1;
    }
  }

  return out;
}
