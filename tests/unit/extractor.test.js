import { describe, it, expect } from 'vitest';
import { parseSrcset, bestImageUrl, extractElement, extractImage } from '../../src/content/extractor.js';

describe('content extractor', () => {
  it('parses srcset with w and x descriptors', () => {
    expect(parseSrcset('a.jpg 300w, b.jpg 800w')).toEqual([{ url: 'a.jpg', size: 300 }, { url: 'b.jpg', size: 800 }]);
    expect(parseSrcset('a.jpg 1x,b.jpg 2x').map((x) => x.url)).toEqual(['a.jpg', 'b.jpg']);
    expect(parseSrcset('https://cdn.test/w_400,h_300/a.jpg 400w').map((x) => x.url)).toEqual(['https://cdn.test/w_400,h_300/a.jpg']);
  });

  it('prefers the largest srcset/data-srcset image over placeholders and data-src', () => {
    document.body.innerHTML = `
      <img id="a" src="data:image/gif;base64,R0lGOD" data-src="/img/mid.jpg" data-srcset="/img/s.jpg 300w, /img/l.jpg 1200w" alt="Alt A">
      <img id="b" src="/img/placeholder.png" data-src="/img/real.jpg">
      <img id="c" src="/img/plain.jpg" title="T">`;
    expect(bestImageUrl(document.getElementById('a'))).toBe('http://localhost:3000/img/l.jpg');
    expect(bestImageUrl(document.getElementById('b'))).toBe('http://localhost:3000/img/real.jpg');
    expect(extractImage(document.getElementById('c'))).toEqual({ url: 'http://localhost:3000/img/plain.jpg', pageUrl: location.href });
  });

  it('uses a linked full-size image when a thumbnail links to it', () => {
    document.body.innerHTML = '<a href="/img/full.jpg"><img id="t" src="/img/thumb.jpg"></a>';
    expect(extractImage(document.getElementById('t')).url).toBe('http://localhost:3000/img/full.jpg');
  });

  it('makes links absolute, removes junk and hidden empty elements', () => {
    document.body.innerHTML = `
      <div id="d"><p>Read <a href="/more">more</a> <a href="javascript:x()">js</a></p>
      <button>Add to cart</button><script>x()</script><span class="sr-only">screen reader</span>
      <span style="display:none"></span><img src="/i.jpg" width="1" height="1"></div>`;
    const r = extractElement(document.getElementById('d'));
    expect(r.html).toContain('href="http://localhost:3000/more"');
    expect(r.html).not.toMatch(/button|script|sr-only|javascript|width="1"/);
    expect(r.sourceTag).toBe('div');
  });
});
