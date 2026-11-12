import { isTabbable, tabbables } from '../../focus/tabbable.js'

/** What the host can ask of a frame it knows about when focus is handed to it. */
export interface FrameFocusTarget {
  /** Puts focus on the frame's first or last control. `false` when the frame is not connected yet and cannot take it. */
  focusIn(direction: 'first' | 'last'): boolean
}

const frames = new WeakMap<HTMLIFrameElement, FrameFocusTarget>()

/**
 * Lets {@link focusAround} hand focus into this iframe's content instead of onto the iframe element.
 *
 * Focusing an iframe element puts focus on the frame itself, not on a control in it, which is an extra Tab stop; the
 * frame's own first control is what the next Tab would have reached. Returns the function that withdraws it.
 */
export function registerFrameFocus(iframe: HTMLIFrameElement, target: FrameFocusTarget): () => void {
  frames.set(iframe, target)
  return () => { if (frames.get(iframe) === target) frames.delete(iframe) }
}

/**
 * Hands keyboard focus to the control after or before an element, in document order.
 *
 * A frame cannot hand focus to the page around it, so when Tab leaves the frame at either end the host takes it from
 * there. The target is the next tab stop outside `from`; when that is another plugin frame, focus goes into that frame's
 * first (or last) control, and a frame that is not connected yet (its iframe is hidden and cannot be tabbed to) is passed
 * over. When nothing is left in that direction, focus goes round to the other end of the page (the first tab stop after
 * the end, as the browser does when it has no interface of its own to give the key to), so a keyboard user is never
 * stuck at the end of a page whose last thing is a frame.
 *
 * @param from - The element to move away from, normally the frame's iframe.
 * @param direction - `next` for the control after it, `previous` for the one before.
 * @returns The element focused (an iframe when focus went into its content), or `null` when the page has nothing else to focus.
 */
export function focusAround(from: HTMLElement, direction: 'next' | 'previous'): HTMLElement | null {
  const all = tabbables(from.ownerDocument).filter((el) => el === from || !from.contains(el))
  const at = all.indexOf(from)
  const order = all
  // `from` itself is not a tab stop (hidden, inert): begin at the edge it would have been next to.
  const start = at === -1 ? (direction === 'next' ? -1 : order.length) : at
  const step = direction === 'next' ? 1 : -1
  for (let n = 1; n <= order.length; n++) {
    // Past either end the search carries on from the other, so the page is a ring with `from` as the one gap.
    const el = order[((start + step * n) % order.length + order.length) % order.length]
    if (el === undefined || el === from) continue
    if (el instanceof HTMLIFrameElement) {
      const frame = frames.get(el)
      if (frame === undefined) { el.focus(); return el }
      if (frame.focusIn(direction === 'next' ? 'first' : 'last')) return el
      continue
    }
    if (!isTabbable(el)) continue
    el.focus()
    return el
  }
  return null
}
