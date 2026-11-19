import { describe, expect, it } from 'bun:test';
import { normalizeTypstMath, preprocessLatexMath } from '../../src/utils/typstMathNormalize';

describe('normalizeTypstMath', () => {
  it('quotes upright text runs', () => {
    expect(normalizeTypstMath('upright(A B C)')).toBe('"ABC"');
    expect(normalizeTypstMath('x_(upright(m a x))')).toBe('x_("max")');
    expect(normalizeTypstMath('upright(kg) dot upright(m)')).toBe('upright(kg) dot "m"');
  });

  it('keeps the bold weight and quotes its content', () => {
    expect(normalizeTypstMath('upright(bold(T r))')).toBe('bold("Tr")');
    expect(normalizeTypstMath('hat(upright(bold(y)))')).toBe('hat(bold("y"))');
    expect(normalizeTypstMath('upright(bold(alpha))')).toBe('upright(bold(alpha))');
  });

  it('converts Typst text markup to strings', () => {
    expect(normalizeTypstMath('#text[abc def]')).toBe('"abc def"');
    expect(normalizeTypstMath('V_(#text[out])')).toBe('V_("out")');
    expect(normalizeTypstMath('bold(#text[abc])')).toBe('bold("abc")');
    expect(normalizeTypstMath('cases(x & x > 0, 0 & #text[otherwise])')).toBe('cases(x & x > 0, 0 & "otherwise")');
  });

  it('escapes special characters inside quoted text', () => {
    expect(normalizeTypstMath('#text[a"b]')).toBe('"a\\"b"');
  });

  it('leaves other math untouched', () => {
    expect(normalizeTypstMath('C_(o u t) plus.o S u b')).toBe('C_(o u t) plus.o S u b');
    expect(normalizeTypstMath('upright(alpha)')).toBe('upright(alpha)');
    expect(normalizeTypstMath('upright(a + b)')).toBe('upright(a + b)');
    expect(normalizeTypstMath('cal(O)')).toBe('cal(O)');
  });

  it('keeps the circled operator names produced by the converter', () => {
    expect(normalizeTypstMath('plus.o')).toBe('plus.o');
    expect(normalizeTypstMath('plus.o.big')).toBe('plus.o.big');
    expect(normalizeTypstMath('minus.o')).toBe('minus.o');
  });

  it('converts #box(...)[$ ... $] markup into boxed(...) and normalizes inner math', () => {
    expect(normalizeTypstMath('#box(stroke: 0.5pt, inset: 2pt, baseline: 20%)[$ i^(2)+ 1 $]')).toBe('boxed(i^(2)+ 1)');
    expect(
      normalizeTypstMath(
        '#box(stroke: 0.5pt, inset: 2pt, baseline: 20%)[$ upright(a d d r) (a_(i,j))= i^(2)+ i + j $]',
      ),
    ).toBe('boxed("addr" (a_(i,j))= i^(2)+ i + j)');
    expect(
      normalizeTypstMath(
        '#box(stroke: 0.5pt, inset: 2pt, baseline: 20%)[$ x + #box(stroke: 0.5pt, inset: 2pt, baseline: 20%)[$ 1 0 $] $]',
      ),
    ).toBe('boxed(x + boxed(10))');
  });

  it('preserves colorbox fill boxes while still normalizing inner numbers', () => {
    expect(normalizeTypstMath('#box(fill: yellow, inset: 2pt)[a + b]')).toBe('#box(fill: yellow, inset: 2pt)[a + b]');
    expect(normalizeTypstMath('#box(fill: yellow, stroke: red, inset: 2pt)[1 0 + 2 0]')).toBe(
      '#box(fill: yellow, stroke: red, inset: 2pt)[10 + 20]',
    );
  });

  it('rejoins multi-digit numbers and decimals split by tylax', () => {
    expect(normalizeTypstMath('5^(2)+ 5 + 0 = 3 0 .')).toBe('5^(2)+ 5 + 0 = 30 .');
    expect(normalizeTypstMath('1 0 0 + 2 0 0 = 3 0 0')).toBe('100 + 200 = 300');
    expect(normalizeTypstMath('1 0^(- 5) + 3 . 1 4 times 1 0^(2 3)')).toBe('10^(- 5) + 3.14 times 10^(23)');
    expect(normalizeTypstMath('frac(1 0, 2 0) = 0 . 5')).toBe('frac(10, 20) = 0.5');
    expect(normalizeTypstMath('1,0 0 0 + 2,5 0 0 = 3,5 0 0')).toBe('1,000 + 2,500 = 3,500');
    expect(normalizeTypstMath('a_(1 0,2 0) + mat(1 0, 2 0; 3 0, 4 0)')).toBe('a_(10,20) + mat(10, 20; 30, 40)');
  });

  it('does not join numbers across slash fractions, strings, comments, or closing parens', () => {
    expect(normalizeTypstMath('1/2 3')).toBe('1/2 3');
    expect(normalizeTypstMath('1/2 + 3 0')).toBe('1/2 + 30');
    expect(normalizeTypstMath('"第 1 0 行" + 2 0')).toBe('"第 1 0 行" + 20');
    expect(normalizeTypstMath('/* 1 0 . 5 */ 2 0')).toBe('/* 1 0 . 5 */ 20');
    expect(normalizeTypstMath('x_(1)0')).toBe('x_(1)0');
  });
});

describe('preprocessLatexMath', () => {
  it('rewrites upright text commands before conversion', () => {
    expect(preprocessLatexMath('\\textbf{ABC}')).toBe('\\boldsymbol{\\text{ABC}}');
    expect(preprocessLatexMath('\\textrm{ABC}')).toBe('\\text{ABC}');
    expect(preprocessLatexMath('\\textnormal{a b}')).toBe('\\text{a b}');
  });

  it('leaves other commands and escaped commands alone', () => {
    expect(preprocessLatexMath('\\mathbf{ABC}')).toBe('\\mathbf{ABC}');
    expect(preprocessLatexMath('\\mathrm{d}x')).toBe('\\mathrm{d}x');
    expect(preprocessLatexMath('\\\\textbf{ABC}')).toBe('\\\\textbf{ABC}');
  });

  it('rewrites commands whose Typst output would be invalid', () => {
    expect(preprocessLatexMath('\\textsf{ABC}')).toBe('\\mathsf{ABC}');
    expect(preprocessLatexMath('\\mathnormal{ABC}')).toBe('ABC');
  });

  it('keeps arguments containing nested braces intact', () => {
    expect(preprocessLatexMath('\\textbf{a{x}b}')).toBe('\\boldsymbol{\\text{a{x}b}}');
  });
});
