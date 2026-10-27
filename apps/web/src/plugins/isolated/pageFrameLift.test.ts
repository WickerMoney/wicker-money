import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIFTED_ATTRIBUTE, PageFrameLift, SCROLL_LOCK_ATTRIBUTE, type LiftLayout } from './pageFrameLift.js'

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

/** A holder and an iframe whose boxes the test moves: the holder where the page sits, the iframe where it is. */
function rig() {
  const root = document.createElement('div')
  const iframe = document.createElement('iframe')
  root.append(iframe)
  document.body.append(root)
  const boxes = { root: rect(226, -504, 1036, 2922), iframe: rect(226, -504, 1036, 2922) }
  root.getBoundingClientRect = () => boxes.root
  iframe.getBoundingClientRect = () => boxes.iframe
  const sent: LiftLayout[] = []
  const lift = new PageFrameLift({ iframe, root, send: (l) => sent.push(l) })
  /** What the CSS does: the iframe becomes the visible part of main. */
  const applyCss = (): void => { boxes.iframe = rect(208, 0, 1072, 700) }
  return { root, iframe, boxes, sent, lift, applyCss }
}

const html = document.documentElement
afterEach(() => { document.body.replaceChildren(); html.removeAttribute(SCROLL_LOCK_ATTRIBUTE) })

describe('PageFrameLift', () => {
  it('lifts: marks the holder, keeps its height, locks the window, and says where the page sits', () => {
    const r = rig()
    // The layout read after the lift is the one the CSS gave.
    const original = r.root.setAttribute.bind(r.root)
    r.root.setAttribute = (name: string, value: string) => { original(name, value); if (name === LIFTED_ATTRIBUTE) r.applyCss() }
    r.lift.lift()
    expect(r.lift.lifted).toBe(true)
    expect(r.root.getAttribute(LIFTED_ATTRIBUTE)).toBe('true')
    expect(r.root.style.minHeight).toBe('2922px')
    expect(html.hasAttribute(SCROLL_LOCK_ATTRIBUTE)).toBe(true)
    // The page was 18 px in and 504 px above the window's top; the layer starts at the sidebar and the window's top.
    expect(r.sent).toEqual([{ lifted: true, x: 18, y: -504, width: 1036 }])
  })

  it('does not stack: a second lift only repeats the layout', () => {
    const r = rig()
    r.lift.lift()
    r.lift.lift()
    expect(r.sent).toHaveLength(2)
    r.lift.release()
    expect(html.hasAttribute(SCROLL_LOCK_ATTRIBUTE)).toBe(false)
  })

  it('releases: puts everything back and tells the frame', () => {
    const r = rig()
    r.lift.lift()
    r.lift.release()
    expect(r.lift.lifted).toBe(false)
    expect(r.root.hasAttribute(LIFTED_ATTRIBUTE)).toBe(false)
    expect(r.root.style.minHeight).toBe('')
    expect(html.hasAttribute(SCROLL_LOCK_ATTRIBUTE)).toBe(false)
    expect(r.sent.at(-1)).toEqual({ lifted: false, x: 0, y: 0, width: 0 })
  })

  it('release does nothing, and says nothing, when not lifted', () => {
    const r = rig()
    r.lift.release()
    expect(r.sent).toEqual([])
  })

  it('dispose puts everything back without a message (the frame is going away)', () => {
    const r = rig()
    r.lift.lift()
    const before = r.sent.length
    r.lift.dispose()
    expect(html.hasAttribute(SCROLL_LOCK_ATTRIBUTE)).toBe(false)
    expect(r.root.hasAttribute(LIFTED_ATTRIBUTE)).toBe(false)
    expect(r.sent).toHaveLength(before)
    r.lift.dispose()
  })

  it('tells the frame again when the window changes size while lifted, and stops listening after', () => {
    const r = rig()
    r.lift.lift()
    r.boxes.root = rect(12, 52, 366, 2000)
    r.boxes.iframe = rect(0, 52, 390, 792)
    window.dispatchEvent(new Event('resize'))
    expect(r.sent.at(-1)).toEqual({ lifted: true, x: 12, y: 0, width: 366 })
    r.lift.release()
    const n = r.sent.length
    window.dispatchEvent(new Event('resize'))
    expect(r.sent).toHaveLength(n)
  })

  it('reads the holder before it locks the window and changes the holder, not after', () => {
    const r = rig()
    const reads = vi.fn(() => r.boxes.root)
    r.root.getBoundingClientRect = reads
    r.lift.lift()
    // Once for where the page was; the later layout pushes use that reading.
    expect(reads).toHaveBeenCalledTimes(1)
  })
})
