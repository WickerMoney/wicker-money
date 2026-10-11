const TABBABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', 'iframe', '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Moves focus to the control after or before an element, in document order.
 *
 * A frame cannot hand focus to the page around it, so when keyboard focus
 * leaves the frame the host takes it from there. Without this a keyboard user
 * who tabs into a plugin frame could not tab out of it.
 *
 * @param from - The element to move away from, normally the frame.
 * @param direction - `next` for the control after it, `previous` for the one before.
 * @returns The element focused, or `null` when there is none in that direction.
 */
export function focusAround(from: HTMLElement, direction: 'next' | 'previous'): HTMLElement | null {
  const all = Array.from(from.ownerDocument.querySelectorAll<HTMLElement>(TABBABLE))
    .filter((el) => el === from || (!from.contains(el) && el.tabIndex >= 0 && el.getClientRects().length > 0))
  const index = all.indexOf(from)
  if (index === -1) return null
  const target = all[direction === 'next' ? index + 1 : index - 1]
  target?.focus()
  return target ?? null
}
