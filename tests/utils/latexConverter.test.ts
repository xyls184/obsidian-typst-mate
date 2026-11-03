import { describe, expect, it } from 'bun:test';
import {
  convertLatexInMarkdown,
  hasPossibleLatex,
  isLikelyLatex,
  isLikelyLatexMath,
  isStandaloneLatex,
  isStandaloneLatexMath,
  stripMathDelimiters,
} from '../../src/utils/latexConverter';

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
    });
  });
});
