import { afterEach, describe, expect, it } from 'vitest'
import { focusAround } from './focusAround.js'

afterEach(() => { document.body.innerHTML = '' })

function page(): { before: HTMLElement; frame: HTMLElement; after: HTMLElement } {
  document.body.innerHTML = '<button id="a">a</button><iframe id="f" title="t"></iframe><button id="b">b</button><button id="c" disabled>c</button>'
  const get = (id: string): HTMLElement => document.getElementById(id)!
  // jsdom does no layout, so nothing "has a box" unless told.
  for (const el of document.querySelectorAll<HTMLElement>('button,iframe')) el.getClientRects = () => [{}] as unknown as DOMRectList
  return { before: get('a'), frame: get('f'), after: get('b') }
}

describe('focusAround', () => {
  it('focuses the control after the frame', () => {
    const { frame, after } = page()
    expect(focusAround(frame, 'next')).toBe(after)
    expect(document.activeElement).toBe(after)
  })

  it('focuses the control before the frame', () => {
    const { frame, before } = page()
    expect(focusAround(frame, 'previous')).toBe(before)
  })

  it('returns null at the end of the page and skips disabled controls', () => {
    const { frame, after } = page()
    expect(focusAround(after, 'next')).toBeNull()
    expect(focusAround(frame, 'next')).toBe(after)
  })
})
