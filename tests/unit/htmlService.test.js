import { describe, it, expect } from 'vitest';
import {
  sanitizeHtml, cleanCapturedHtml, changeTag, applyHtmlEdit, rootTag, renderSelection, combineSelections, moveItem, htmlToText, formatHtmlSource,
} from '../../src/services/htmlService.js';

describe('sanitisation', () => {
  it('removes scripts, event handlers, styles, classes and data attributes', () => {
    const out = sanitizeHtml(
      '<div class="x" style="color:red" data-track="1" onclick="steal()"><p id="a" onmouseover="x()">Hi <b>there</b></p><script>alert(1)</script><style>p{}</style></div>',
    );
    expect(out).toBe('<p>Hi <b>there</b></p>');
    expect(out).not.toMatch(/script|onclick|onmouseover|style|class|data-/);
  });

  it('blocks javascript: links but keeps normal links', () => {
    const out = sanitizeHtml('<p><a href="javascript:alert(1)">bad</a> <a href="https://x.test/a" target="_blank" rel="nofollow">good</a></p>');
    expect(out).toContain('<a href="https://x.test/a">good</a>');
    expect(out).not.toContain('javascript');
  });

  it('removes iframes, forms, buttons and embedded widgets including their text', () => {
    const out = sanitizeHtml('<p>Keep</p><iframe src="https://evil"></iframe><form><button>Buy now</button><input></form><svg><text>x</text></svg>');
    expect(out).toBe('<p>Keep</p>');
  });

  it('unwraps span and div wrappers and drops empty elements', () => {
    const out = sanitizeHtml('<div><div><span>Text <span><em>here</em></span></span></div><p> </p><div></div></div>');
    expect(out).toBe('<p>Text <em>here</em></p>');
  });

  it('keeps headings, lists, bold/italic and tables', () => {
    const html = '<h2>T</h2><ul><li><strong>A</strong></li><li><i>B</i></li></ul><ol><li>1</li></ol><table><tbody><tr><td>x</td></tr></tbody></table>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('removes images that are not http(s)', () => {
    expect(sanitizeHtml('<p>a<img src="data:image/gif;base64,AAA"><img src="https://x.test/i.jpg" alt="i"></p>')).toBe('<p>a<img src="https://x.test/i.jpg" alt="i"></p>');
  });
});

describe('captured element cleaning', () => {
  it('keeps a semantic root tag', () => {
    const c = cleanCapturedHtml('<h2 class="title" style="x">Product <span class="hl">Features</span></h2>', 'h2');
    expect(c.html).toBe('<h2>Product Features</h2>');
    expect(c.sourceTag).toBe('h2');
    expect(c.outputTag).toBe('keep');
    expect(c.text).toBe('Product Features');
  });

  it('div with inline content defaults to <p>, div with blocks defaults to unwrap', () => {
    const a = cleanCapturedHtml('<div class="intro">Great <b>TV</b></div>', 'div');
    expect(a.outputTag).toBe('p');
    expect(renderSelection(a)).toBe('<p>Great <b>TV</b></p>');
    const b = cleanCapturedHtml('<div class="desc"><p>One</p><p>Two</p></div>', 'div');
    expect(b.outputTag).toBe('unwrap');
    expect(renderSelection(b)).toBe('<p>One</p><p>Two</p>');
  });

  it('keeps nested lists intact', () => {
    const c = cleanCapturedHtml('<ul class="specs"><li>A<ul><li>A1</li></ul></li><li><span>B</span></li></ul>', 'ul');
    expect(c.html).toBe('<ul><li>A<ul><li>A1</li></ul></li><li>B</li></ul>');
  });

  it('handles non-allowed root tags', () => {
    const c = cleanCapturedHtml('<custom-el>Hello</custom-el>', 'custom-el');
    expect(c.html).toBe('Hello');
    expect(renderSelection(c)).toBe('<p>Hello</p>');
  });
});

describe('no added <div> wrappers', () => {
  it('captured fragment of list items is stored and output without a wrapper', () => {
    const c = cleanCapturedHtml('<li>7.2 channels</li><li>8K Ultra HD</li>', 'ul');
    expect(c.html).toBe('<li>7.2 channels</li><li>8K Ultra HD</li>');
    expect(renderSelection(c)).toBe('<li>7.2 channels</li><li>8K Ultra HD</li>');
    expect(renderSelection({ ...c, outputTag: 'ul' })).toBe('<ul><li>7.2 channels</li><li>8K Ultra HD</li></ul>');
  });
  it('editing a selection keeps exactly the edited HTML', () => {
    const item = { id: 'x', ...cleanCapturedHtml('<ul class="f"><li>A</li></ul>', 'ul') };
    const edited = applyHtmlEdit(item, '<li>7.2 channels</li><li>95 watts per channel</li><li>Powered by HEOS™</li>');
    expect(renderSelection(edited)).toBe('<li>7.2 channels</li><li>95 watts per channel</li><li>Powered by HEOS™</li>');
    expect(rootTag(edited.html)).toBe(null);
    const edited2 = applyHtmlEdit(item, '<ul><li>A</li><li onclick="x()">B</li></ul>');
    expect(renderSelection(edited2)).toBe('<ul><li>A</li><li>B</li></ul>');
    expect(rootTag(edited2.html)).toBe('ul');
  });
  it('legacy items with a fragment and keep tag render without a div', () => {
    expect(changeTag('<li>a</li><li>b</li>', 'keep')).toBe('<li>a</li><li>b</li>');
    expect(changeTag('<p>a</p><p>b</p>', 'unwrap')).toBe('<p>a</p><p>b</p>');
  });
});

describe('changeTag', () => {
  it('H1 → H3 and H2 → H3 keep inline formatting', () => {
    expect(changeTag('<h1>Big <em>title</em></h1>', 'h3')).toBe('<h3>Big <em>title</em></h3>');
    expect(changeTag('<h2><a href="https://x.test/">Link</a> text</h2>', 'h3')).toBe('<h3><a href="https://x.test/">Link</a> text</h3>');
  });
  it('DIV → P and SPAN → P', () => {
    expect(changeTag('<div>Intro <strong>bold</strong></div>', 'p')).toBe('<p>Intro <strong>bold</strong></p>');
    expect(changeTag('<span>Short</span>', 'p')).toBe('<p>Short</p>');
  });
  it('DIV containing paragraphs → P uses line breaks instead of nesting blocks', () => {
    expect(changeTag('<div><p>One <b>x</b></p><p>Two</p></div>', 'p')).toBe('<p>One <b>x</b><br>Two</p>');
  });
  it('converts between list types and from paragraphs to a list', () => {
    expect(changeTag('<ul><li>a</li><li>b</li></ul>', 'ol')).toBe('<ol><li>a</li><li>b</li></ol>');
    expect(changeTag('<div><p>a</p><p>b</p></div>', 'ul')).toBe('<ul><li>a</li><li>b</li></ul>');
  });
  it('unwrap and keep', () => {
    expect(changeTag('<div><p>a</p></div>', 'unwrap')).toBe('<p>a</p>');
    expect(changeTag('<h2>a</h2>', 'keep')).toBe('<h2>a</h2>');
  });
});

describe('combining and ordering', () => {
  const items = [
    { id: '1', ...cleanCapturedHtml('<h2>Product Features</h2>', 'h2'), outputTag: 'h3' },
    { id: '2', ...cleanCapturedHtml('<div>Product introduction</div>', 'div') },
    { id: '3', ...cleanCapturedHtml('<h2>Technical Specifications</h2>', 'h2'), outputTag: 'h3' },
    { id: '4', ...cleanCapturedHtml('<ul><li>Spec 1</li><li>Spec 2</li></ul>', 'ul') },
  ];
  it('combines in order with the separator', () => {
    expect(combineSelections(items, '\n')).toBe(
      '<h3>Product Features</h3>\n<p>Product introduction</p>\n<h3>Technical Specifications</h3>\n<ul><li>Spec 1</li><li>Spec 2</li></ul>',
    );
  });
  it('reorders', () => {
    const moved = moveItem(items, 3, 0);
    expect(moved.map((i) => i.id)).toEqual(['4', '1', '2', '3']);
    expect(combineSelections(moved, '').startsWith('<ul>')).toBe(true);
    expect(moveItem(items, 0, 9)).toEqual(items);
  });
  it('text conversion and source formatting', () => {
    expect(htmlToText('<h3>A</h3><p>B<br>C</p>')).toBe('A B C');
    expect(formatHtmlSource('<ul><li>a</li></ul><p>x</p>')).toBe('<ul>\n  <li>a</li>\n</ul>\n<p>x</p>');
  });
});
