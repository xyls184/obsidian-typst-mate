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
