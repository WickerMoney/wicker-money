import { useEffect, useRef, type RefObject } from 'react'

const TABBABLE =
  'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]'

function tabbablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) =>
      el.tabIndex >= 0 &&
      !el.hasAttribute('disabled') &&
      el.closest('[inert], [hidden]') === null &&
      el.getAttribute('type') !== 'hidden',
  )
}

/** Options for {@link useFocusTrap}. */
export interface FocusTrapOptions {
  /**
   * Put focus back on whatever had it when the trap turned on, once it turns
   * off. Default `true`. Turn it off when the caller returns focus somewhere
   * more specific itself.
   */
  readonly restoreFocus?: boolean
}

/**
 * Keeps Tab and Shift+Tab inside a container while it is `active`.
 *
 * Tab from the last tabbable element wraps to the first and Shift+Tab from the
 * first wraps to the last; if focus is somewhere outside the container (or on
 * the container itself) the next Tab pulls it in. It does not move focus on
 * activation (the caller knows what should be focused first) and does not
 * handle Escape. Elements that are disabled, `inert`, hidden or `tabindex="-1"`
 * are skipped. For a hand-rolled modal that is not a native `<dialog>`.
 *
 * @param ref - The container to trap focus in; must be attached when `active` is true.
 * @param active - Whether the trap is on.
 * @param options - See {@link FocusTrapOptions}.
 */
export function useFocusTrap<T extends HTMLElement>(
  ref: RefObject<T | null>,
  active: boolean,
  { restoreFocus = true }: FocusTrapOptions = {},
): void {
  const restore = useRef(restoreFocus)
  restore.current = restoreFocus

  useEffect(() => {
    if (!active) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const onKey = (e: KeyboardEvent) => {
      const root = ref.current
      if (e.key !== 'Tab' || root === null) return
      const items = tabbablesIn(root)
      if (items.length === 0) { e.preventDefault(); root.focus(); return }
      const first = items[0]!
      const last = items[items.length - 1]!
      const current = document.activeElement
      const inside = current instanceof Node && root.contains(current) && current !== root
      if (e.shiftKey && (!inside || current === first)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (!inside || current === last)) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (restore.current && opener?.isConnected === true) opener.focus()
    }
  }, [ref, active])
}
