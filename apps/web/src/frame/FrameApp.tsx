import { useEffect, useRef, useSyncExternalStore, type ComponentType } from 'react'
import type { HostConnection, IsolatedState } from '@wickermoney/plugin-sdk/isolated'

/** Props for {@link FrameApp}. */
export interface FrameAppProps {
  readonly connection: HostConnection
  /** The plugin's component. */
  readonly Plugin: ComponentType<Record<string, unknown>>
}

const TABBABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

const tabbables = (root: ParentNode): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0)

/**
 * Renders the plugin inside the frame and wires it to the host.
 *
 * It gives the plugin the props the in-realm host would (`ctx`, and `size` and
 * `range` for a widget), re-renders when the host pushes new ones, reports the
 * content height, and hands keyboard focus back to the host at either end so a
 * keyboard user is never trapped in the frame.
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
    if (!event.shiftKey && document.activeElement === items.at(-1)) {
      event.preventDefault()
      connection.focusOut('next')
    } else if (event.shiftKey && document.activeElement === items[0]) {
      event.preventDefault()
      connection.focusOut('previous')
    }
  }

  const props: Record<string, unknown> = { ctx: connection.ctx }
  if (state.kind === 'widget') {
    props['size'] = state.size
    if (state.range !== undefined) props['range'] = state.range
  }
  return (
    <div ref={rootRef} onKeyDown={onKeyDown}>
      <Plugin {...props} />
    </div>
  )
}
