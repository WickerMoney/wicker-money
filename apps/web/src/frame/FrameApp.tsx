import { useEffect, useRef, useSyncExternalStore, type ComponentType } from 'react'
import type { FocusDirection, HostConnection, IsolatedState } from '@wickermoney/plugin-sdk/isolated'
import { tabbables } from '../focus/tabbable.js'
import { startFormSubmit } from './formSubmit.js'
import { ModalLift } from './modalLift.js'

/** Props for {@link FrameApp}. */
export interface FrameAppProps {
  readonly connection: HostConnection
  /** The plugin's component. */
  readonly Plugin: ComponentType<Record<string, unknown>>
}

/**
 * Renders the plugin inside the frame and wires it to the host.
 *
 * It gives the plugin the props the in-realm host would (`ctx`, and `size` and
 * `range` for a widget; for a page also `path`, the part of the address under the page), re-renders when the host pushes new ones, reports the
 * content height, and hands keyboard focus to the host when Tab or Shift+Tab leaves the frame at either end, so a
 * keyboard user is never trapped in it and the order stays the order of the page.
 */
function modalOpen(): boolean {
  try { return document.querySelector('dialog:modal') !== null } catch { return false }
}

export function FrameApp({ connection, Plugin }: FrameAppProps) {
  const state: IsolatedState = useSyncExternalStore(
    (listener) => connection.subscribe(listener),
    () => connection.getState(),
  )
  const rootRef = useRef<HTMLDivElement>(null)

  // A widget reports its root's height. A page reports the whole document's: anything outside the root (a trailing
  // margin, the body's own) is part of what the page needs, and without it the last card sat 19 px nearer the window's
  // bottom than the same page in the app. The document element's height is its content's (it is `auto`), so it
  // shrinks as well as grows, unlike `scrollHeight`, which never reads less than the frame itself.
  const isPage = state.kind === 'page'
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return undefined
    return connection.observeSize(isPage ? document.documentElement : root)
  }, [connection, isPage])

  // The sandbox has no allow-forms, so the browser never submits a form; the runtime sends the submit event itself.
  useEffect(() => startFormSubmit(), [])

  // A modal dialog in a page asks the host to lift the frame over the window while it is open (ADR 0015). A widget
  // frame has nothing to lift: the host would ignore the message, so it is not sent.
  useEffect(() => (isPage ? new ModalLift(connection).start() : undefined), [connection, isPage])

  // The host takes focus in from either side.
  useEffect(() => connection.subscribe((change) => {
    if (change.type !== 'focus-in') return
    const items = tabbables(rootRef.current ?? document)
    ;(change.direction === 'first' ? items[0] : items.at(-1))?.focus()
  }), [connection])

  // Tab at the frame's last control (or Shift+Tab at its first) is taken here and handed to the host, which moves focus
  // to the control after (or before) the iframe, into the next frame's first (or last) control, or round to the other end
  // of the page. The browser's own step out of a frame is not relied on: at the end of a page it hands focus to the
  // browser's interface, and in a browser without one (the Chromium the checks run in) the focus that came back could
  // land in this frame's first control instead of the page's, and the host had to step in on a 60 ms timer to repair
  // it. The key is cancelled in the same task it is pressed in, so nothing waits and nothing is left to race.
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing) return
    // A modal dialog traps Tab itself; handing focus to the host from inside it would leak out of the trap.
    if (modalOpen()) return
    const items = tabbables(rootRef.current ?? document)
    const from = document.activeElement
    const direction: FocusDirection | null = !event.shiftKey && from === items.at(-1) ? 'next'
      : event.shiftKey && from === items[0] ? 'previous' : null
    if (direction === null) return
    event.preventDefault()
    connection.focusOut(direction)
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
