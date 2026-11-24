import { describe, it, expect } from 'vitest';
import { changeTag, listItemsOf, mergeIntoList, appendToList, cleanCapturedHtml, renderSelection } from '../../src/services/htmlService.js';

const item = (html, tag) => ({ id: html, ...cleanCapturedHtml(html, tag) });

describe('turning content into lists', () => {
  it('a block of lines separated by <br> becomes one item per line', () => {
    expect(changeTag('<p>7.2 channels<br>95 watts per channel<br><b>8K</b> Ultra HD</p>', 'ul')).toBe(
      '<ul><li>7.2 channels</li><li>95 watts per channel</li><li><b>8K</b> Ultra HD</li></ul>',
    );
  });
  it('a container with paragraphs, divs and loose text becomes one item per part', () => {
    expect(changeTag('<div><p>A</p><div>B</div>Loose <i>text</i><br>C</div>', 'ol')).toBe('<ol><li>A</li><li>B</li><li>Loose <i>text</i></li><li>C</li></ol>');
  });
  it('nested wrappers are searched for items; nested lists inside items are kept', () => {
    expect(changeTag('<div><div><p>A</p><p>B</p></div></div>', 'ul')).toBe('<ul><li>A</li><li>B</li></ul>');
    expect(changeTag('<ul><li>A<ul><li>A1</li></ul></li></ul>', 'ol')).toBe('<ol><li>A<ul><li>A1</li></ul></li></ol>');
  });
  it('single elements become a single item', () => {
    expect(changeTag('<h3>Title</h3>', 'ul')).toBe('<ul><li>Title</li></ul>');
    expect(listItemsOf('<li>x</li>')).toEqual(['<li>x</li>']);
  });
  it('merges several selections in order', () => {
    const merged = mergeIntoList([item('<p>One</p>', 'p'), item('<div>Two<br>Three</div>', 'div'), item('<ul><li>Four</li></ul>', 'ul')], 'ol', 'm');
    expect(merged).toMatchObject({ id: 'm', sourceTag: 'ol', outputTag: 'keep', text: 'One Two Three Four' });
    expect(renderSelection(merged)).toBe('<ol><li>One</li><li>Two</li><li>Three</li><li>Four</li></ol>');
  });
  it('appends clicks to an existing list', () => {
    let list = appendToList('', '<p>First</p>', 'ul');
    expect(list).toBe('<ul><li>First</li></ul>');
    list = appendToList(list, '<span>Second</span>', 'ol');
    expect(list).toBe('<ul><li>First</li><li>Second</li></ul>');
  });
});
