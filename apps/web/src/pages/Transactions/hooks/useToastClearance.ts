import { useEffect, type RefObject } from 'react'

/** The custom property {@link useToastClearance} sets: the banner's height in px, `0px` when there is none. */
export const TOAST_CLEARANCE_PROPERTY = '--txn-toast-clear'

/**
 * Keeps `host`'s `--txn-toast-clear` equal to the height of the toast banner
 * while it shows (and `0px` while it does not).
 *
 * The banner is sticky at the top of the page (ADR 0009), so a control that
 * the browser scrolls into view from below, with Shift+Tab, can land behind it.
 * `scroll-margin-top` fixes that, but the banner's height depends on how many
 * toasts there are and how long their words are, so a fixed number is either
 * too small for a full stack or wastes a third of a phone screen when there is
 * none. The banner is the first child of `<main>` (ui-kit `ToastViewport`), so
 * it is looked for there and followed as it comes and goes and changes size.
 *
 * It writes the property straight to the element, so a toast does not
 * re-render the rows.
 *
 * @param host - The element that holds the rows; the property is set on it.
 * @param mounted - `true` once `host` is in the page. The effect runs again when it changes, because a table that
 *   shows a spinner first has no element to set the property on at the first render.
 */
export function useToastClearance(host: RefObject<HTMLElement | null>, mounted: boolean): void {
  useEffect(() => {
    const element = host.current
    if (!mounted || element === null) return undefined
    const main = element.closest('main')
    if (main === null) return undefined
    const set = (px: number) => { element.style.setProperty(TOAST_CLEARANCE_PROPERTY, `${Math.ceil(px)}px`) }
    let resize: ResizeObserver | undefined
    const follow = () => {
      resize?.disconnect()
      const banner = main.querySelector(':scope > [role="group"][aria-label="Notifications"]')
      if (banner === null) { set(0); return }
      set(banner.getBoundingClientRect().height)
      if (typeof ResizeObserver === 'undefined') return
      resize = new ResizeObserver(() => { set(banner.getBoundingClientRect().height) })
      resize.observe(banner)
    }
    // The banner is added and removed as a child of <main>; its size changes are the resize observer's.
    const children = new MutationObserver(follow)
    children.observe(main, { childList: true })
    follow()
    return () => {
      children.disconnect()
      resize?.disconnect()
      element.style.removeProperty(TOAST_CLEARANCE_PROPERTY)
    }
  }, [host, mounted])
}
