/**
 * What a keyboard can Tab to, worked out in script.
 *
 * The browser has no API for "the next control after this one", so the two places that must hand keyboard focus across a
 * frame boundary (the frame runtime, at its last and first control, and the host, past the iframe) both ask this. It is an
 * approximation of the browser's own list, close enough for the controls the app and its bundled plugins draw: links,
 * buttons, inputs, selects, text areas, summaries, editable regions and anything with a non-negative `tabindex`.
 *
 * A control that is `aria-disabled` is still here: it is focusable, which is the point of using it instead of `disabled`.
 */
const CANDIDATES = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', 'summary', 'iframe', '[contenteditable]:not([contenteditable="false"])', '[tabindex]',
].join(',')

/** Whether the element can be reached with Tab right now. */
export function isTabbable(el: HTMLElement): boolean {
  if (el.tabIndex < 0) return false
  if (el.closest('[inert]') !== null) return false
  if (el.getClientRects().length === 0) return false
  if (el.ownerDocument.defaultView?.getComputedStyle(el).visibility === 'hidden') return false
  // Only the checked radio of a group is a tab stop (all of them when none is checked).
  if (el instanceof HTMLInputElement && el.type === 'radio' && !el.checked && el.name !== '') {
    const group = Array.from(el.ownerDocument.getElementsByName(el.name))
      .filter((r): r is HTMLInputElement => r instanceof HTMLInputElement && r.type === 'radio' && r.form === el.form)
    if (group.some((r) => r.checked)) return false
  }
  return true
}

/** Every tab stop under `root`, in document order. An element with a positive `tabindex` is treated as order zero. */
export function tabbables(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CANDIDATES)).filter(isTabbable)
}
