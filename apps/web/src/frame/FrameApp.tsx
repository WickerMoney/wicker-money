import { useEffect, useRef, useSyncExternalStore, type ComponentType } from 'react'
import type { FocusDirection, HostConnection, IsolatedState } from '@wickermoney/plugin-sdk/isolated'

/** Props for {@link FrameApp}. */
export interface FrameAppProps {
  readonly connection: HostConnection
  /** The plugin's component. */
  readonly Plugin: ComponentType<Record<string, unknown>>
}

/** How long to wait for the browser to move focus out of the frame by itself before asking the host to, in milliseconds. */
export const FOCUS_OUT_GRACE_MS = 60

const TABBABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

const tabbables = (root: ParentNode): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0)

/**
 * Renders the plugin inside the frame and wires it to the host.
 *
 * It gives the plugin the props the in-realm host would (`ctx`, and `size` and
 * `range` for a widget; for a page also `path`, the part of the address under the page), re-renders when the host pushes new ones, reports the
 * content height, and, when the browser does not itself carry Tab out of the frame at either
 * end, hands keyboard focus to the host so a keyboard user is never trapped in the frame.
 */
export function FrameApp({ connection, Plugin }: FrameAppProps) {
  const state: IsolatedState = useSyncExternalStore(
    (listener) => connection.subscribe(listener),
    () => connection.getState(),
  )
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (root === null) return undefined
    return connection.observeSize(root)
  }, [connection])

  // The host takes focus in from either side.
  useEffect(() => connection.subscribe((change) => {
    if (change.type !== 'focus-in') return
    const items = tabbables(rootRef.current ?? document)
    ;(change.direction === 'first' ? items[0] : items.at(-1))?.focus()
  }), [connection])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Tab') return
    const items = tabbables(rootRef.current ?? document)
    if (items.length === 0) return
    const from = document.activeElement
    const direction: FocusDirection | null = !event.shiftKey && from === items.at(-1) ? 'next'
      : event.shiftKey && from === items[0] ? 'previous' : null
    if (direction === null) return
    // The key is not cancelled: the browser carries focus out of the frame itself, to the next control in the
    // page, or at the end of the page to its own interface, exactly as it does for content in the page. Cancelling
    // it and asking the host to move focus (as this did first) traps a keyboard user when the frame is the last
    // thing on the page, which a page frame is: the host has no next control to give. Only when focus is still
    // here a moment later, the browser having declined to leave, does the host take it.
    window.setTimeout(() => {
      if (document.activeElement === from && document.hasFocus()) connection.focusOut(direction)
    }, FOCUS_OUT_GRACE_MS)
  }

  const props: Record<string, unknown> = { ctx: connection.ctx }
  if (state.kind === 'widget') {
    props['size'] = state.size
    if (state.range !== undefined) props['range'] = state.range
  } else if (state.path !== undefined) {
    // The path under the page's route. `PluginPageProps` does not declare it yet (a page reads it untyped).
    props['path'] = state.path
  }
  return (
    <div ref={rootRef} onKeyDown={onKeyDown}>
      <Plugin {...props} />
    </div>
  )
}
