import { afterEach, describe, expect, it, vi } from 'vitest'
import { focusAround, registerFrameFocus } from './focusAround.js'

afterEach(() => { document.body.innerHTML = '' })

function html(markup: string): void {
  document.body.innerHTML = markup
  // jsdom does no layout, so nothing "has a box" unless told.
  for (const el of document.querySelectorAll<HTMLElement>('*')) el.getClientRects = () => [{}] as unknown as DOMRectList
}
const get = (id: string): HTMLElement => document.getElementById(id)!

describe('focusAround', () => {
  it('focuses the control after the frame, and the one before it', () => {
    html('<button id="a">a</button><iframe id="f" title="t"></iframe><button id="b">b</button><button id="c" disabled>c</button>')
    expect(focusAround(get('f'), 'next')).toBe(get('b'))
    expect(document.activeElement).toBe(get('b'))
    expect(focusAround(get('f'), 'previous')).toBe(get('a'))
    expect(document.activeElement).toBe(get('a'))
  })

  it('skips disabled, inert, hidden and tabindex=-1 controls, and counts aria-disabled ones', () => {
    html(`<iframe id="f" title="t"></iframe><button id="x" disabled>x</button><div inert><button id="y">y</button></div>
      <button id="z" tabindex="-1">z</button><button id="v" style="visibility:hidden">v</button><button id="w" aria-disabled="true">w</button>`)
    get('v').style.visibility = 'hidden'
    expect(focusAround(get('f'), 'next')).toBe(get('w'))
  })

  it('goes round to the first control when the frame is last, so the end of a page is not a trap', () => {
    html('<a id="skip" href="#main">skip</a><button id="a">a</button><main id="main" tabindex="-1"><iframe id="f" title="t"></iframe></main>')
    expect(focusAround(get('f'), 'next')).toBe(get('skip'))
    expect(document.activeElement).toBe(get('skip'))
  })

  it('goes round to the last control when the frame is first', () => {
    html('<iframe id="f" title="t"></iframe><button id="a">a</button><button id="b">b</button>')
    expect(focusAround(get('f'), 'previous')).toBe(get('b'))
  })

  it('returns null when the frame is all there is', () => {
    html('<iframe id="f" title="t"></iframe>')
    expect(focusAround(get('f'), 'next')).toBeNull()
    expect(focusAround(get('f'), 'previous')).toBeNull()
  })

  it('hands focus into the next frame\'s own controls rather than onto its iframe element', () => {
    html('<iframe id="f1" title="1"></iframe><iframe id="f2" title="2"></iframe><button id="b">b</button>')
    const focusIn = vi.fn(() => true)
    registerFrameFocus(get('f2') as HTMLIFrameElement, { focusIn })
    expect(focusAround(get('f1'), 'next')).toBe(get('f2'))
    expect(focusIn).toHaveBeenCalledWith('first')
    expect(document.activeElement).not.toBe(get('f2'))
    expect(focusAround(get('f2'), 'previous')).toBe(get('f1')) // not registered: the element itself
  })

  it('goes into the previous frame\'s last control when moving backwards', () => {
    html('<iframe id="f1" title="1"></iframe><iframe id="f2" title="2"></iframe>')
    const focusIn = vi.fn(() => true)
    registerFrameFocus(get('f1') as HTMLIFrameElement, { focusIn })
    expect(focusAround(get('f2'), 'previous')).toBe(get('f1'))
    expect(focusIn).toHaveBeenCalledWith('last')
  })

  it('passes over a frame that cannot take focus yet', () => {
    html('<iframe id="f1" title="1"></iframe><iframe id="f2" title="2"></iframe><button id="b">b</button>')
    registerFrameFocus(get('f2') as HTMLIFrameElement, { focusIn: () => false })
    expect(focusAround(get('f1'), 'next')).toBe(get('b'))
  })

  it('stops handing focus to a frame once it is unregistered', () => {
    html('<iframe id="f1" title="1"></iframe><iframe id="f2" title="2"></iframe>')
    const focusIn = vi.fn(() => true)
    const off = registerFrameFocus(get('f2') as HTMLIFrameElement, { focusIn })
    off()
    expect(focusAround(get('f1'), 'next')).toBe(get('f2'))
    expect(focusIn).not.toHaveBeenCalled()
  })

  it('treats only the checked radio of a group as a stop', () => {
    html('<iframe id="f" title="t"></iframe><input id="r1" type="radio" name="g"><input id="r2" type="radio" name="g" checked><button id="b">b</button>')
    expect(focusAround(get('f'), 'next')).toBe(get('r2'))
  })
})
