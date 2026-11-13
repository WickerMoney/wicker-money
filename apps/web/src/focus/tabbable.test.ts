import { afterEach, describe, expect, it } from 'vitest'
import { isTabbable, tabbables } from './tabbable.js'

afterEach(() => { document.body.innerHTML = '' })

function html(markup: string): void {
  document.body.innerHTML = markup
  // jsdom does no layout, so nothing "has a box" unless told.
  for (const el of document.querySelectorAll<HTMLElement>('*')) el.getClientRects = () => [{}] as unknown as DOMRectList
}
const ids = (): string[] => tabbables(document).map((e) => e.id)

describe('tabbables', () => {
  it('lists links, buttons, fields, summaries, iframes and tabindex=0 in document order', () => {
    html(`<a id="a" href="#">a</a><button id="b">b</button><input id="c"><select id="d"></select><textarea id="e"></textarea>
      <details><summary id="f">f</summary></details><iframe id="g" title="g"></iframe><svg id="i" tabindex="0"></svg>`)
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'i'])
  })

  it('leaves out disabled controls, hidden inputs, tabindex=-1, inert subtrees, links without href and hidden elements', () => {
    html(`<button id="a" disabled>a</button><input id="b" type="hidden"><div id="c" tabindex="-1"></div><div inert><button id="d">d</button></div>
      <a id="e">e</a><button id="f" style="visibility:hidden">f</button><button id="g">g</button>`)
    expect(ids()).toEqual(['g'])
  })

  it('keeps an aria-disabled control, which is focusable on purpose', () => {
    html('<button id="a" aria-disabled="true">a</button><input id="b" type="checkbox" aria-disabled="true">')
    expect(ids()).toEqual(['a', 'b'])
  })

  it('leaves out an element that has no box', () => {
    html('<button id="a">a</button>')
    document.getElementById('a')!.getClientRects = () => [] as unknown as DOMRectList
    expect(ids()).toEqual([])
  })

  it('counts only the checked radio of a group, or all of an unchecked group', () => {
    html('<input id="a" type="radio" name="g"><input id="b" type="radio" name="g" checked><input id="c" type="radio" name="h"><input id="d" type="radio" name="h">')
    expect(ids()).toEqual(['b', 'c', 'd'])
  })

  it('isTabbable answers for one element', () => {
    html('<button id="a">a</button><button id="b" tabindex="-1">b</button>')
    expect(isTabbable(document.getElementById('a')!)).toBe(true)
    expect(isTabbable(document.getElementById('b')!)).toBe(false)
  })
})
