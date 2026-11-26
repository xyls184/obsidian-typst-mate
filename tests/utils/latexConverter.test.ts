import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  convertLatexInMarkdown,
  hasConvertibleLatex,
  hasPossibleLatex,
  isLikelyLatex,
  isLikelyLatexMath,
  isStandaloneLatex,
  isStandaloneLatexMath,
  preserveOuterWhitespace,
  stripMathDelimiters,
} from '../../src/utils/latexConverter';
import { normalizeTypstMath, preprocessLatexMath } from '../../src/utils/typstMathNormalize';

describe('latexConverter', () => {
  describe('hasPossibleLatex', () => {
    it('returns false for plain text', () => {
      expect(hasPossibleLatex('Hello world without math')).toBe(false);
    });

    it('returns true when dollar sign is present', () => {
      expect(hasPossibleLatex('Price is $10')).toBe(true);
    });

    it('returns true when backslash is present', () => {
      expect(hasPossibleLatex('Formula: \\alpha')).toBe(true);
    });
  });

  describe('isLikelyLatex', () => {
    it('identifies LaTeX commands', () => {
      expect(isLikelyLatex('\\frac{a}{b}')).toBe(true);
      expect(isLikelyLatex('\\sqrt{x}')).toBe(true);
      expect(isLikelyLatex('\\sum_{i=1}^n x_i')).toBe(true);
      expect(isLikelyLatex('\\alpha + \\beta')).toBe(true);
      expect(isLikelyLatex('\\mathbf{v}')).toBe(true);
    });

    it('identifies LaTeX subscript and superscript groups', () => {
      expect(isLikelyLatex('x_{i+1}')).toBe(true);
      expect(isLikelyLatex('e^{-x}')).toBe(true);
    });

    it('identifies LaTeX environments', () => {
      expect(isLikelyLatex('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}')).toBe(true);
    });

    it('rejects pure currency and numbers', () => {
      expect(isLikelyLatex('$100')).toBe(false);
      expect(isLikelyLatex('100.50')).toBe(false);
      expect(isLikelyLatex('$10,000')).toBe(false);
    });

    it('rejects already Typst syntax or plain words without LaTeX markers', () => {
      expect(isLikelyLatex('alpha + beta')).toBe(false);
      expect(isLikelyLatex('sqrt(x)')).toBe(false);
      expect(isLikelyLatex('mat(1, 2; 3, 4)')).toBe(false);
      expect(isLikelyLatex('10 to ')).toBe(false);
      expect(isLikelyLatex('hello world')).toBe(false);
    });
  });

  describe('stripMathDelimiters', () => {
    it('strips $$ delimiters', () => {
      expect(stripMathDelimiters('$$ \\frac{1}{2} $$')).toBe('\\frac{1}{2}');
    });

    it('strips $ delimiters', () => {
      expect(stripMathDelimiters('$ \\alpha $')).toBe('\\alpha');
    });

    it('strips \\[ \\] delimiters', () => {
      expect(stripMathDelimiters('\\[ \\sqrt{x} \\]')).toBe('\\sqrt{x}');
    });

    it('strips \\( \\) delimiters', () => {
      expect(stripMathDelimiters('\\( x + y \\)')).toBe('x + y');
    });
  });

  describe('isStandaloneLatex', () => {
    it('returns true for standalone math equations', () => {
      expect(isStandaloneLatex('\\frac{1}{2}')).toBe(true);
      expect(isStandaloneLatex('\\sum_{i=1}^n x_i')).toBe(true);
      expect(isStandaloneLatex('\\[ \\frac{a}{b} \\]')).toBe(true);
      expect(isStandaloneLatex('\\begin{equation} x = 1 \\end{equation}')).toBe(true);
    });

    it('returns false for Windows paths', () => {
      expect(isStandaloneLatex('C:\\Users\\Bob\\note.md')).toBe(false);
      expect(isStandaloneLatex('D:\\test\\script.exe')).toBe(false);
    });

    it('returns false for regular text', () => {
      expect(isStandaloneLatex('This is just normal text.')).toBe(false);
      expect(isStandaloneLatex('$100 and $200')).toBe(false);
    });
  });

  describe('convertLatexInMarkdown', () => {
    const mockConverter = async (latex: string) => {
      if (latex === '\\frac{a}{b}') return 'a/b';
      if (latex === '\\sum_{i=1}^n x_i') return 'sum_(i = 1)^(n) x_(i)';
      if (latex === '\\sqrt{x}') return 'sqrt(x)';
      if (latex === '\\alpha + \\beta') return 'alpha + beta';
      return `typst(${latex})`;
    };

    it('converts inline and display LaTeX in markdown', async () => {
      const input = 'Formula 1: $\\frac{a}{b}$ and formula 2: $$\\sum_{i=1}^n x_i$$.';
      const result = await convertLatexInMarkdown(input, mockConverter);
      expect(result.count).toBe(2);
      expect(result.text).toBe('Formula 1: $a/b$ and formula 2: $$sum_(i = 1)^(n) x_(i)$$.');
    });

    it('converts LaTeX bracket and paren formats', async () => {
      const input = 'Display: \\[ \\sqrt{x} \\] and inline: \\( \\alpha + \\beta \\)';
      const result = await convertLatexInMarkdown(input, mockConverter);
      expect(result.count).toBe(2);
      expect(result.text).toBe('Display: $$sqrt(x)$$ and inline: $alpha + beta$');
    });

    it('preserves code blocks and inline code', async () => {
      const input = 'Code: ```python\nx = "$not_math$"\n``` and inline `$HOME/bin`.';
      const result = await convertLatexInMarkdown(input, mockConverter);
      expect(result.count).toBe(0);
      expect(result.text).toBe(input);
    });

    it('preserves currency and dollar signs without math', async () => {
      const input = 'Prices are $10.00 and $20.00, range: $10-$20.';
      const result = await convertLatexInMarkdown(input, mockConverter);
      expect(result.count).toBe(0);
      expect(result.text).toBe(input);
    });

    it('preserves already-Typst formulas', async () => {
      const input = 'Already Typst: $alpha + beta$ and $sqrt(x)$.';
      const result = await convertLatexInMarkdown(input, mockConverter);
      expect(result.count).toBe(0);
      expect(result.text).toBe(input);
    });

    it('converts bare LaTeX words that Typst would reject', async () => {
      const input = 'Flags: $CF$, $OF$, $mc^2$, and $x in RR$.';
      const result = await convertLatexInMarkdown(input, mockConverter);
      expect(result.text).toBe('Flags: $typst(CF)$, $typst(OF)$, $typst(mc^2)$, and $x in RR$.');
      expect(result.count).toBe(3);
    });

    it('preserves multiline display math formatting across delimiters and environments', async () => {
      const input = [
        '$$\n\\sum_{i=1}^n x_i\n$$',
        '\\[\n\\sqrt{x}\n\\]',
        '\\begin{equation}\n\\sqrt{x}\n\\end{equation}',
      ].join('\n');
      const result = await convertLatexInMarkdown(input, mockConverter);
      expect(result.count).toBe(3);
      expect(result.text).toBe(
        [
          '$$\nsum_(i = 1)^(n) x_(i)\n$$',
          '$$\nsqrt(x)\n$$',
          '$$\ntypst(\\begin{equation}\n\\sqrt{x}\n\\end{equation})\n$$',
        ].join('\n'),
      );
    });

    it('converts multi-letter juxtaposed terms before parentheses inside Markdown tables', async () => {
      const tableConverter = async (latex: string) => {
        if (latex === 'AB(45)') return 'A B (45)';
        if (latex === 'ABC(85)') return 'A B C (85)';
        return `typst(${latex})`;
      };
      const input = '| **第 1 次** | $A(10)$ 与 $B(35)$ | $AB(45)$ | $ABC(85)$ |';
      const result = await convertLatexInMarkdown(input, tableConverter);
      expect(result.count).toBe(2);
      expect(result.text).toBe('| **第 1 次** | $A(10)$ 与 $B(35)$ | $A B (45)$ | $A B C (85)$ |');
    });
  });

  describe('preserveOuterWhitespace', () => {
    it('keeps leading and trailing newlines and indentation around replaced math', () => {
      expect(preserveOuterWhitespace('\n  \\frac{a}{b}\n', 'a/b')).toBe('\n  a/b\n');
    });
  });

  describe('isStandaloneLatexMath', () => {
    it('accepts formulas and bare math words', () => {
      expect(isStandaloneLatexMath('\\frac{a}{b}')).toBe(true);
      expect(isStandaloneLatexMath('CF')).toBe(true);
    });

    it('rejects prose and valid Typst names', () => {
      expect(isStandaloneLatexMath('Hello world')).toBe(false);
      expect(isStandaloneLatexMath('alpha')).toBe(false);
      expect(isStandaloneLatexMath('E = mc^2')).toBe(false);
    });
  });

  describe('isLikelyLatexMath', () => {
    it('accepts LaTeX commands and bare letter runs', () => {
      expect(isLikelyLatexMath('\\frac{a}{b}')).toBe(true);
      expect(isLikelyLatexMath('CF')).toBe(true);
      expect(isLikelyLatexMath('Sub')).toBe(true);
      expect(isLikelyLatexMath('mc^2')).toBe(true);
      expect(isLikelyLatexMath('{CF}')).toBe(true);
      expect(isLikelyLatexMath('AB(45)')).toBe(true);
      expect(isLikelyLatexMath('ABC(85)')).toBe(true);
      expect(isLikelyLatexMath('ABCDEF(395)')).toBe(true);
      expect(isLikelyLatexMath('dp(i, j)')).toBe(true);
      expect(isLikelyLatexMath('AB1(45)')).toBe(true);
    });

    it('keeps valid Typst math untouched', () => {
      expect(isLikelyLatexMath('alpha + beta')).toBe(false);
      expect(isLikelyLatexMath('x in RR')).toBe(false);
      expect(isLikelyLatexMath('mat(1, 2; 3, 4)')).toBe(false);
      expect(isLikelyLatexMath('plus.o')).toBe(false);
      expect(isLikelyLatexMath('cal(O)')).toBe(false);
      expect(isLikelyLatexMath('log n')).toBe(false);
      expect(isLikelyLatexMath('C F')).toBe(false);
      expect(isLikelyLatexMath('#text[abc]')).toBe(false);
      expect(isLikelyLatexMath('"abc"')).toBe(false);
      expect(isLikelyLatexMath('0 <= i <= n,wide - i <= j <= i .')).toBe(false);
      expect(isLikelyLatexMath('boxed(i^(2) + 1)')).toBe(false);
      expect(isLikelyLatexMath('A(10)')).toBe(false);
      expect(isLikelyLatexMath('A B (45)')).toBe(false);
      expect(isLikelyLatexMath('A B(45)')).toBe(false);
      expect(isLikelyLatexMath('vec(1, 2)')).toBe(false);
      expect(isLikelyLatexMath('bar(x) + ceil(y)')).toBe(false);
      expect(isLikelyLatexMath('overshell(x) + undershell(y)')).toBe(false);
      expect(isLikelyLatexMath('dot.double(x)')).toBe(false);
      expect(isLikelyLatexMath('mark(x, color: red)')).toBe(false);
      expect(isLikelyLatexMath('annot(pos: top)[label]')).toBe(false);
    });
  });

  describe('hasConvertibleLatex', () => {
    it('returns true only when markdown contains convertible math', () => {
      expect(hasConvertibleLatex('Plain text')).toBe(false);
      expect(hasConvertibleLatex('Price is $10 and $20')).toBe(false);
      expect(hasConvertibleLatex('Already Typst: $alpha + beta$')).toBe(false);
      expect(hasConvertibleLatex('Formula: $\\frac{a}{b}$')).toBe(true);
      expect(hasConvertibleLatex('Display: $$\\sum_{i=1}^n x_i$$')).toBe(true);
      expect(hasConvertibleLatex('Inline paren: \\(x + y\\)')).toBe(true);
    });
  });

  describe('paste test note regression', () => {
    it('converts all 5 LaTeX formulas in 粘贴测试.md while keeping valid Typst inline math', async () => {
      const input = [
        '1\u00a0\u200b\u00a000000000\u00a0\u200b\u00a010000000000000000000000',
        '- 符号位 $S=1$，表示负数',
        '- 阶码 $E=0$',
        '- 尾数 $M\\ne 0$',
        '',
        '因此这是 **非规格化数**。',
        '非规格化数的值为：',
        '$$(-1)^S\\times 0.M\\times 2^{-126}$$',
        '尾数部分：',
        '$$0.10000000000000000000000_2=0.5=\\frac{1}{2}$$',
        '所以数值为：',
        '$$-\\frac{1}{2}\\times 2^{-126}=-2^{-127}$$',
        '即：',
        '$$-2^{-127}$$',
      ].join('\n');

      const result = await convertLatexInMarkdown(input, async (latex) => `converted(${latex})`);
      expect(result.count).toBe(5);
      expect(result.text).toContain('- 符号位 $S=1$，表示负数');
      expect(result.text).toContain('- 阶码 $E=0$');
      expect(result.text).toContain('- 尾数 $converted(M\\ne 0)$');
      expect(result.text).toContain('$$converted((-1)^S\\times 0.M\\times 2^{-126})$$');
      expect(result.text).toContain('$$converted(0.10000000000000000000000_2=0.5=\\frac{1}{2})$$');
      expect(result.text).toContain('$$converted(-\\frac{1}{2}\\times 2^{-126}=-2^{-127})$$');
      expect(result.text).toContain('$$converted(-2^{-127})$$');
    });
  });

  describe('Typst preservation and idempotence regression', () => {
    it('keeps converted and user-edited Huffman multiline Typst formulas untouched', async () => {
      const convertedHuffman =
        'L_("Huffman") & = sum_(i = 1)^(8) p_(i) dot l_(i) \\ & =(0.19 + 0.32 + 0.21) times 2 +(0.07 + 0.06 + 0.10) times 4 +(0.02 + 0.03) times 5 \\ & = 0.72 times 2 + 0.23 times 4 + 0.05 times 5 \\ & = 1.44 + 0.92 + 0.25 \\ & = 2.61 "(bit)"';
      const simplifiedHuffman =
        'L_("Huffman") & = sum_(i = 1)^(8) p_(i) dot l_(i) \\ & =(0.19 + 0.32 + 0.21) times 2 +(0.07 + 0.06 + 0.10) times 4 +(0.02 + 0.03) times 5 \\ & = 2.61 "(bit)"';

      expect(isLikelyLatexMath(convertedHuffman)).toBe(false);
      expect(isLikelyLatexMath(simplifiedHuffman)).toBe(false);

      const note = `$$${convertedHuffman}$$\n\n$$${simplifiedHuffman}$$`;
      const result = await convertLatexInMarkdown(note, async (latex) => `reconverted(${latex})`);
      expect(result.count).toBe(0);
      expect(result.text).toBe(note);
    });

    it('preserves Typst line breaks, escaped punctuation in Typst calls, comments, strings, and unicode escapes', () => {
      expect(isLikelyLatexMath('a = 1 \\ b = 2')).toBe(false);
      expect(isLikelyLatexMath('cases(1\\, & x >= 0, - 1\\, & x < 0)')).toBe(false);
      expect(isLikelyLatexMath('mat(a\\; b, c; d, e)')).toBe(false);
      expect(isLikelyLatexMath('/* \\color{red} -> red */ x')).toBe(false);
      expect(isLikelyLatexMath('x + y // \\frac{a}{b}')).toBe(false);
      expect(isLikelyLatexMath('"C:\\\\path"')).toBe(false);
      expect(isLikelyLatexMath('"a \\"b\\""')).toBe(false);
      expect(isLikelyLatexMath('\\u{1F600}')).toBe(false);
    });

    it('still detects LaTeX double-backslash line breaks and standalone LaTeX escapes', () => {
      expect(isLikelyLatexMath('a=1\\\\b=2')).toBe(true);
      expect(isLikelyLatexMath('a = 1 \\\\ b = 2')).toBe(true);
      expect(isLikelyLatexMath('\\{ 1, 2, 3 \\}')).toBe(true);
      expect(isLikelyLatexMath('a \\, b')).toBe(true);
      expect(isLikelyLatexMath('\\"a + \\frac{1}{2} + \\"o')).toBe(true);
    });

    it('produces idempotent Typst without outer $ delimiters across real tylax WASM conversions', async () => {
      const wasmPath = path.resolve(__dirname, '../../typst.wasm');
      const gluePath = path.resolve(__dirname, '../../pkg/typst_wasm.js');
      if (!fs.existsSync(wasmPath) || !fs.existsSync(gluePath)) return;

      const { default: init, Typst } = await import('../../pkg/typst_wasm.js');
      const wasm = fs.readFileSync(wasmPath);
      await init({ module_or_path: wasm });
      const typst = new Typst(
        '/',
        () => {
          throw 12;
        },
        16,
        0,
      );
      const convert = (latex: string) => normalizeTypstMath(typst.latexeq_to_typm(preprocessLatexMath(latex)));

      const samples = [
        String.raw`\begin{aligned} L_{\text{Huffman}} &= \sum_{i=1}^{8} p_i \cdot l_i \\ &= (0.19 + 0.32 + 0.21) \times 2 + (0.07 + 0.06 + 0.10) \times 4 + (0.02 + 0.03) \times 5 \\ &= 0.72 \times 2 + 0.23 \times 4 + 0.05 \times 5 \\ &= 1.44 + 0.92 + 0.25 \\ &= 2.61\text{ (bit)} \end{aligned}`,
        String.raw`\begin{align*} a &= b + c \\ d &= e + f \end{align*}`,
        String.raw`\begin{align} a &= 1 \\ b &= 2 \end{align}`,
        String.raw`\begin{gather} x = 1 \\ y = 2 \end{gather}`,
        String.raw`\begin{gather*} x = 1 \\ y = 2 \end{gather*}`,
        String.raw`\begin{equation} x = 1 \end{equation}`,
        String.raw`\begin{split} a &= 1 \\ &= 2 \end{split}`,
        String.raw`f(x) = \begin{cases} 1, & x \ge 0 \\ -1, & x < 0 \end{cases}`,
        String.raw`\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}`,
        String.raw`\sum_{\substack{i=1 \\ j=1}}^{n} a_{ij}`,
        String.raw`\color{red}{x} + \textcolor{blue}{y}`,
        String.raw`\text{C:\path}`,
        String.raw`\boxed{a + b}`,
        String.raw`\{ 1, 2, 3 \}`,
        String.raw`a \, b \; c \! d \ e`,
        String.raw`a = 1 \\ b = 2`,
        String.raw`\frac{50\%}{100\%}`,
        String.raw`\boxed{50\%}`,
        String.raw`\begin{aligned} a &= 50\% \\ b &= 25\% \end{aligned}`,
      ];

      for (const latex of samples) {
        const converted = convert(latex);
        expect(isLikelyLatexMath(converted)).toBe(false);
        // Ensure no unescaped `$` outside quotes remains in the normalized formula.
        const withoutQuotedStrings = converted.replace(/"(?:\\.|[^"\\])*"/g, '');
        expect(withoutQuotedStrings).not.toMatch(/(?<!\\)\$/);
      }

      const percentSamples = [
        String.raw`\frac{50\%}{100\%}`,
        String.raw`\boxed{50\%}`,
        String.raw`\begin{aligned} a &= 50\% \\ b &= 25\% \end{aligned}`,
      ];
      for (const latex of percentSamples) {
        const converted = convert(latex);
        const withoutQuotedStrings = converted.replace(/"(?:\\.|[^"\\])*"/g, '');
        expect(withoutQuotedStrings).not.toMatch(/(?<!\\)%/);
        const svgResult = typst.svg(`$ ${converted} $`, '/', 'inline', 'test');
        expect(svgResult.diags ?? []).toEqual([]);
      }
    });
  });
});
