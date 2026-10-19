import { describe, expect, it } from 'bun:test';
import {
  convertLatexInMarkdown,
  hasPossibleLatex,
  isLikelyLatex,
  isStandaloneLatex,
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
      expect(result.text).toBe('Formula 1: $ a/b $ and formula 2: $$ sum_(i = 1)^(n) x_(i) $$.');
    });

    it('converts LaTeX bracket and paren formats', async () => {
      const input = 'Display: \\[ \\sqrt{x} \\] and inline: \\( \\alpha + \\beta \\)';
      const result = await convertLatexInMarkdown(input, mockConverter);
      expect(result.count).toBe(2);
      expect(result.text).toBe('Display: $$ sqrt(x) $$ and inline: $ alpha + beta $');
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
  });
});
