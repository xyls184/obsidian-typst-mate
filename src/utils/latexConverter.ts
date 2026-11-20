/**
 * Utilities for detecting and converting LaTeX math formulas to Typst syntax.
 */

import SYMBOLS_BY_NAME from '../data/symbols.json';

/** Typst math identifiers which must never be split into LaTeX italic letters. */
const TYPST_MATH_NAMES = new Set<string>([
  // Functions and keywords that are not symbols but are valid in Typst math.
  ...`abs accent and arccos arccot arccsc arcosh arcsec arcsin arctan arg arsinh artanh attach bb
    binom block bold boxed cal cancel cases class comma context convolve det dif dim display dot
    else eq equation exp floor frac frak gcd gt hat hom if in inline integral italic ker lcm learn
    let lg limits ln lr lt macron mat max med mid min minus mod mono norm not op or overbrace
    overbracket overleftarrow overleftrightarrow overline overparen overrightarrow overshell place
    plus primes quad return root round sans scr script scripts sec serif set show sin sinh sqrt
    sscript st stretch sum sup sym tan tanh text thick thin tilde times tr underbrace
    underbracket underleftarrow underleftrightarrow underline underparen underrightarrow
    undershell union upright vec while wide without xor`.split(/\s+/),
  // All Typst symbol names (and their dotted prefixes), e.g. `alpha`, `plus.o`, `arrow.r`.
  ...Object.values(SYMBOLS_BY_NAME).flatMap(({ name }) => {
    if (!name) return [];
    const parts = name.split('.');
    return parts.map((_, i) => parts.slice(0, i + 1).join('.'));
  }),
]);

/**
 * Returns true if `name(...)` starting at `openParenIdx` uses Typst-specific
 * call syntax (named arguments like `color: red` or a trailing content block `[...]`).
 */
function isTypstCustomCall(code: string, openParenIdx: number): boolean {
  if (code[openParenIdx] !== '(') return false;
  let depth = 0;
  let closeParen = -1;

  for (let i = openParenIdx; i < code.length; i++) {
    const ch = code[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        closeParen = i;
        break;
      }
    }
  }

  if (closeParen === -1) return false;
  if (code[closeParen + 1] === '[') return true;
  const args = code.slice(openParenIdx + 1, closeParen);
  return /(?:^|,)\s*[A-Za-z_][A-Za-z0-9_-]*:\s/.test(args);
}

/**
 * Checks if math-mode text is LaTeX even though it has no backslash command,
 * e.g. `CF`, `mc^2`, or `AB(45)` — identifiers that Typst would read as an
 * unknown variable. Recognized Typst names (symbols and built-in functions),
 * dotted paths (`name.path`), and calls using Typst-specific syntax (named
 * arguments or trailing content blocks) are ignored so converted formulas
 * stay stable.
 */
function hasLatexMathWord(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed) return false;
  // Typst markers: code interpolation, text strings, raw code.
  if (/[#"`]/.test(trimmed)) return false;

  for (const match of trimmed.matchAll(/[A-Za-z][A-Za-z0-9]*/g)) {
    const word = match[0];
    if (word.length === 1) continue;
    const start = match.index;
    const end = start + word.length;
    const next = trimmed[end];
    const prev = trimmed[start - 1];
    // Dotted symbol/module paths (e.g. `plus.o`, `math.mat(...)`) belong to Typst.
    if (next === '.' || prev === '.') continue;
    if (TYPST_MATH_NAMES.has(word)) continue;
    // User-defined Typst calls with named args or trailing content blocks (e.g. `mark(x, color: red)`).
    if (next === '(' && isTypstCustomCall(trimmed, end)) return false;
    return true;
  }

  return false;
}

/** Whether a math region should be converted (LaTeX or LaTeX-looking). */
export function isLikelyLatexMath(code: string): boolean {
  return isLikelyLatex(code) || hasLatexMathWord(code);
}

/**
 * Checks if text contains any characters that could possibly begin a LaTeX formula.
 * Fast synchronous pre-check to bypass unneeded processing during paste.
 */
export function hasPossibleLatex(text: string): boolean {
  return text.includes('$') || text.includes('\\');
}

/**
 * Checks if a string contains LaTeX math commands, groupings, or environments.
 * Prevents false positives with normal text, currency, and already-Typst code.
 */
export function isLikelyLatex(code: string): boolean {
  if (!code || typeof code !== 'string') return false;
  const trimmed = code.trim();
  if (trimmed.length === 0) return false;

  // Pure number or currency like "$100" or "100" or "10.50"
  if (/^\$?\d+(?:,\d+)*(?:\.\d+)?$/.test(trimmed)) return false;

  // LaTeX macro commands: \frac, \sqrt, \alpha, \sum, \int, \mathbf, \text, \left, \right, etc.
  if (/\\[a-zA-Z]+/.test(trimmed)) return true;

  // LaTeX special escaped symbols: \{, \}, \,, \;, \!, \ , \\
  if (/\\([,;! ]|\{|\}|\\\\)/.test(trimmed)) return true;

  // LaTeX exponent / subscript groups with braces: ^{...} or _{...}
  if (/[\^_]\{[^}]*\}/.test(trimmed)) return true;

  // LaTeX environments: \begin{...}
  if (/\\begin\{[a-zA-Z*]+\}/.test(trimmed)) return true;

  // LaTeX display/inline delimiters inside string
  if (/\\\[[\s\S]*?\\\]/.test(trimmed) || /\\\([\s\S]*?\\\)/.test(trimmed)) return true;

  return false;
}

/**
 * Strips outer math delimiters ($...$, $$...$$, \[...\], \(...\)) if present.
 */
export function stripMathDelimiters(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length >= 4) {
    return trimmed.slice(2, -2).trim();
  }
  if (trimmed.startsWith('\\[') && trimmed.endsWith('\\]') && trimmed.length >= 4) {
    return trimmed.slice(2, -2).trim();
  }
  if (trimmed.startsWith('\\(') && trimmed.endsWith('\\)') && trimmed.length >= 4) {
    return trimmed.slice(2, -2).trim();
  }
  if (trimmed.startsWith('$') && trimmed.endsWith('$') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Checks if the entire text is a standalone raw LaTeX formula (WITHOUT $ delimiters).
 * For example, copying `\frac{1}{2}` or `\sum_{i=1}^n x_i` directly from Mathpix or a web page.
 */
export function isStandaloneLatex(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 50000) return false;

  // If text already has $ or $$, it should be handled by convertLatexInMarkdown, not here
  if (trimmed.includes('$')) return false;

  // Ignore Windows paths: "C:\path\to\file" or "D:\..."
  if (/^[a-zA-Z]:\\/.test(trimmed)) return false;
  // Ignore file extensions (.md, .txt, .exe, etc.)
  if (/\.(md|txt|exe|dll|ts|js|json|png|jpg|pdf)$/i.test(trimmed)) return false;

  // If wrapped in LaTeX delimiters: \[ ... \] or \( ... \) or \begin{...} ... \end{...}
  if (/^\\\[[\s\S]+\\\]$/.test(trimmed)) return true;
  if (/^\\\([\s\S]+\\\)$/.test(trimmed)) return true;
  if (/^\\begin\{([a-zA-Z*]+)\}[\s\S]+\\end\{\1\*?\}$/.test(trimmed)) return true;

  // Must begin with a backslash LaTeX command
  const startsWithLatexCommand =
    /^\\(frac|sqrt|sum|int|prod|lim|alpha|beta|gamma|delta|theta|lambda|pi|sigma|omega|partial|nabla|infty|times|cdot|pm|begin|mathbf|mathbb|mathcal|text)(?![a-zA-Z])/.test(
      trimmed,
    );

  if (startsWithLatexCommand) {
    const lines = trimmed.split('\n');
    return lines.length <= 15;
  }

  // Equation with math operators and backslash command inside, e.g. "x = \frac{a}{b}"
  if (
    /^[a-zA-Z0-9()\s]*=/.test(trimmed) &&
    /\\(frac|sqrt|sum|int|alpha|beta|gamma|pi|sigma|infty|times|cdot|pm|leq|geq|neq)(?![a-zA-Z])/.test(trimmed)
  ) {
    const lines = trimmed.split('\n');
    return lines.length <= 15;
  }

  return false;
}

type LatexTokenType = 'protected' | 'display' | 'bracket_disp' | 'env_disp' | 'paren_inline' | 'inline';

interface LatexToken {
  type: LatexTokenType;
  raw: string;
  inner?: string;
  index: number;
  length: number;
}

// Protected regions and math blocks in document order:
// 1. Fenced code blocks: ```...``` or ~~~...~~~
// 2. Inline code: `...`
// 3. HTML comments: <!--...-->
// 4. Display math: $$...$$
// 5. LaTeX display math: \[...\]
// 6. LaTeX environments: \begin{...}...\end{...}
// 7. LaTeX inline math: \(...\)
// 8. Markdown inline math: $...$
const LATEX_TOKEN_REGEX =
  /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`|<!--[\s\S]*?-->|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\begin\{(?<env>equation|align|gather|alignat|multline|displaymath|eqnarray)\*?\}[\s\S]+?\\end\{\k<env>\*?\}|\\\([\s\S]+?\\\)|\$(?!\s|\$)[^\n$]+?(?<!\s)\$(?!\d))/g;

function scanLatexTokens(text: string): LatexToken[] {
  const tokens: LatexToken[] = [];
  LATEX_TOKEN_REGEX.lastIndex = 0;

  for (let match = LATEX_TOKEN_REGEX.exec(text); match !== null; match = LATEX_TOKEN_REGEX.exec(text)) {
    const raw = match[0];
    const index = match.index;
    const length = raw.length;

    if (raw.startsWith('```') || raw.startsWith('~~~') || raw.startsWith('`') || raw.startsWith('<!--')) {
      tokens.push({ type: 'protected', raw, index, length });
    } else if (raw.startsWith('$$')) {
      tokens.push({ type: 'display', raw, inner: raw.slice(2, -2), index, length });
    } else if (raw.startsWith('\\[')) {
      tokens.push({ type: 'bracket_disp', raw, inner: raw.slice(2, -2), index, length });
    } else if (raw.startsWith('\\begin{')) {
      tokens.push({ type: 'env_disp', raw, inner: raw, index, length });
    } else if (raw.startsWith('\\(')) {
      tokens.push({ type: 'paren_inline', raw, inner: raw.slice(2, -2), index, length });
    } else if (raw.startsWith('$')) {
      tokens.push({ type: 'inline', raw, inner: raw.slice(1, -1), index, length });
    }
  }

  return tokens;
}

/**
 * Preserves leading and trailing whitespace (such as newlines around multi-line
 * `$$\n...\n$$` blocks) when replacing trimmed math content.
 */
export function preserveOuterWhitespace(original: string, replacement: string): string {
  const trimmed = replacement.trim();
  if (!trimmed) return replacement;
  const leading = original.match(/^\s*/)?.[0] ?? '';
  const trailing = original.match(/\s*$/)?.[0] ?? '';
  return `${leading}${trimmed}${trailing}`;
}

export interface LatexConversionEdit {
  from: number;
  to: number;
  insert: string;
}

/**
 * Finds every convertible LaTeX formula in `text` and returns the edits that
 * replace it with Typst math. Ranges in `exclude` (already converted math
 * regions) are skipped so the caller can merge both kinds of edits.
 */
export async function convertLatexEdits(
  text: string,
  convertEq: (latex: string) => Promise<string>,
  exclude: readonly { from: number; to: number }[] = [],
): Promise<LatexConversionEdit[]> {
  if (!text || (!text.includes('$') && !text.includes('\\'))) return [];

  const convertible = scanLatexTokens(text).filter((token) => {
    if (token.type === 'protected') return false;
    if (token.type === 'bracket_disp' || token.type === 'env_disp' || token.type === 'paren_inline') {
      return (token.inner ?? '').trim().length > 0;
    }
    if (!token.inner) return false;
    return isLikelyLatexMath(token.inner);
  });

  if (convertible.length === 0) return [];

  const conversions = await Promise.all(
    convertible.map(async (token) => {
      const source = token.inner!.trim();
      try {
        const converted = (await convertEq(source)).trim();
        return { token, source, converted };
      } catch (e) {
        console.error('[typst-mate] equation conversion failed:', e);
        return { token, source, converted: '' };
      }
    }),
  );

  const edits: LatexConversionEdit[] = [];
  for (const { token, source, converted } of conversions) {
    if (!converted || converted === source) continue;

    const from = token.index;
    const to = token.index + token.length;
    if (exclude.some((range) => from < range.to && range.from < to)) continue;

    const isDisplay = token.type === 'display' || token.type === 'bracket_disp' || token.type === 'env_disp';
    let insert: string;
    if (isDisplay) {
      if (token.raw.includes('\n')) {
        if (token.type === 'env_disp') {
          insert = `$$\n${converted}\n$$`;
        } else {
          const inner = token.inner ?? '';
          const hasOuterNewlines = /^\s*\r?\n/.test(inner) || /\r?\n\s*$/.test(inner);
          insert = hasOuterNewlines ? `$$${preserveOuterWhitespace(inner, converted)}$$` : `$$\n${converted}\n$$`;
        }
      } else {
        insert = `$$${converted}$$`;
      }
    } else {
      insert = `$${converted}$`;
    }
    edits.push({ from, to, insert });
  }

  return edits.sort((a, b) => a.from - b.from);
}

/**
 * Checks whether a standalone selection (without `$` delimiters) is math worth
 * converting. Plain prose must not match, so only an actual LaTeX formula or a
 * single bare word such as `CF` is accepted.
 */
export function isStandaloneLatexMath(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (isStandaloneLatex(trimmed)) return true;
  return /^[A-Za-z][A-Za-z0-9]*$/.test(trimmed) && hasLatexMathWord(trimmed);
}

/**
 * Parses markdown text, protects code blocks, inline code and comments,
 * finds all LaTeX math blocks ($$, $, \[, \(, \begin{...}),
 * and converts them using the provided converter function.
 */
export async function convertLatexInMarkdown(
  text: string,
  convertEq: (latex: string) => Promise<string>,
): Promise<{ text: string; count: number }> {
  const edits = await convertLatexEdits(text, convertEq);

  let result = text;
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i]!;
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  }

  return { text: result, count: edits.length };
}
