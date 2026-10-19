/**
 * Utilities for detecting and converting LaTeX math formulas to Typst syntax.
 */

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
  if (/[\^_]\{[^\}]*\}/.test(trimmed)) return true;

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
    /^[a-zA-Z0-9\(\)\s]*=/.test(trimmed) &&
    /\\(frac|sqrt|sum|int|alpha|beta|gamma|pi|sigma|infty|times|cdot|pm|leq|geq|neq)(?![a-zA-Z])/.test(
      trimmed,
    )
  ) {
    const lines = trimmed.split('\n');
    return lines.length <= 15;
  }

  return false;
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
  if (!text || (!text.includes('$') && !text.includes('\\'))) {
    return { text, count: 0 };
  }

  // Token regex matching protected regions and math blocks in order:
  // 1. Fenced code blocks: ```...``` or ~~~...~~~
  // 2. Inline code: `...`
  // 3. HTML comments: <!--...-->
  // 4. Display math: $$...$$
  // 5. LaTeX display math: \[...\]
  // 6. LaTeX environments: \begin{...}...\end{...}
  // 7. LaTeX inline math: \(...\)
  // 8. Markdown inline math: $...$
  const TOKEN_REGEX =
    /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`|<!--[\s\S]*?-->|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\begin\{(?:equation|align|gather|alignat|multline)\*?\}[\s\S]+?\\end\{\1\*?\}|\\\([\s\S]+?\\\)|\$(?!\s|\$)[^\n$]+?(?<!\s)\$(?!\d))/g;

  interface TokenMatch {
    type: 'protected' | 'display' | 'bracket_disp' | 'env_disp' | 'paren_inline' | 'inline';
    raw: string;
    inner?: string;
    index: number;
    length: number;
  }

  const tokens: TokenMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = TOKEN_REGEX.exec(text)) !== null) {
    const raw = m[0];
    const index = m.index;
    const length = raw.length;

    if (raw.startsWith('```') || raw.startsWith('~~~') || raw.startsWith('`') || raw.startsWith('<!--')) {
      tokens.push({ type: 'protected', raw, index, length });
    } else if (raw.startsWith('$$')) {
      const inner = raw.slice(2, -2);
      tokens.push({ type: 'display', raw, inner, index, length });
    } else if (raw.startsWith('\\[')) {
      const inner = raw.slice(2, -2);
      tokens.push({ type: 'bracket_disp', raw, inner, index, length });
    } else if (raw.startsWith('\\begin{')) {
      tokens.push({ type: 'env_disp', raw, inner: raw, index, length });
    } else if (raw.startsWith('\\(')) {
      const inner = raw.slice(2, -2);
      tokens.push({ type: 'paren_inline', raw, inner, index, length });
    } else if (raw.startsWith('$')) {
      const inner = raw.slice(1, -1);
      tokens.push({ type: 'inline', raw, inner, index, length });
    }
  }

  // Filter convertible tokens
  const convertibleTokens = tokens.filter((t) => {
    if (t.type === 'protected') return false;
    if (t.type === 'bracket_disp' || t.type === 'env_disp' || t.type === 'paren_inline') return true;
    if (!t.inner) return false;
    return isLikelyLatex(t.inner);
  });

  if (convertibleTokens.length === 0) {
    return { text, count: 0 };
  }

  // Convert all math equations concurrently
  const conversions = await Promise.all(
    convertibleTokens.map(async (tok) => {
      try {
        const converted = await convertEq(tok.inner!.trim());
        return { tok, converted: converted.trim() };
      } catch (e) {
        console.error('[typst-mate] equation conversion failed:', e);
        return { tok, converted: null };
      }
    }),
  );

  // Replace tokens from right to left (descending order of index)
  let result = text;
  let count = 0;
  conversions.sort((a, b) => b.tok.index - a.tok.index);

  for (const { tok, converted } of conversions) {
    if (!converted) continue;

    let replacement: string;
    switch (tok.type) {
      case 'display':
      case 'bracket_disp':
      case 'env_disp':
        replacement = `$$ ${converted} $$`;
        break;
      case 'paren_inline':
      case 'inline':
        replacement = `$ ${converted} $`;
        break;
      default:
        continue;
    }

    result = result.slice(0, tok.index) + replacement + result.slice(tok.index + tok.length);
    count++;
  }

  return { text: result, count };
}
