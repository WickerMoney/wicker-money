import { useEffect, useRef, useState } from 'react'
import type { DashboardRange, PluginContext, PluginManifest, WidgetSize } from '@wickermoney/plugin-sdk'
import type { FrameKind } from '@wickermoney/plugin-sdk/isolated'
import { Alert, Button, Spinner } from '@wickermoney/ui-kit'
import { activeUserId } from '../../api/client.js'
import { responseCache } from '../../api/responseCache.js'
import { hostBrokerApi, type BrokerApi } from './brokerApi.js'
import { focusAround } from './focusAround.js'
import { FrameController, HEIGHT_LIMITS, PLACEHOLDER_HEIGHT, type FrameState } from './FrameController.js'
import { frameUrl } from './frameUrl.js'
import { useNearViewport } from './useNearViewport.js'

/** Props for {@link IsolatedPluginFrame}. */
export interface IsolatedPluginFrameProps {
  /** The plugin this frame runs. */
  readonly manifest: PluginManifest
  /** The exposed module key to mount, for example `./TrendWidget`. */
  readonly module: string
  /** What the frame is called to assistive technology, with the plugin's name. */
  readonly title: string
  readonly kind: FrameKind
  /** The context the host built for this plugin; the frame gets its session and `navigate`, never its API client. */
  readonly ctx: PluginContext
  /** Widgets only. */
  readonly size?: WidgetSize
  /** Widgets only. */
  readonly range?: DashboardRange
  /** Pages only: the path under the page's route to render first. */
  readonly path?: string
  /** Replaceable in tests: the network side of the broker. */
  readonly api?: BrokerApi
  /** Replaceable in tests: how long to wait for the handshake. */
  readonly loadTimeoutMs?: number
  /**
   * Create the iframe only when the placeholder is near the viewport. Default: widgets yes, pages no
   * (a page frame is the page's content and is always at the top).
   */
  readonly lazy?: boolean
}

/**
 * Renders one plugin module inside a sandboxed iframe.
 *
 * `sandbox="allow-scripts"` and nothing else: no `allow-same-origin`, so the
 * frame's origin is opaque and it can read neither this page's cookies and
 * storage nor its DOM, and no top-navigation, popups or forms. The frame
 * document comes from the API with the same restrictions in its own CSP header,
 * so removing the attribute here would not lift them.
 *
 * The host owns the frame's width (the slot's grid decides it); the frame
 * reports its content height and the host clamps it. While the frame starts the
 * host shows a spinner; if it never connects, or the broker cuts it off, a
 * failure message with a retry takes its place, and neighbouring widgets are
 * untouched.
 *
 * A widget does not get an iframe until its placeholder is within
 * `FRAME_ROOT_MARGIN_PX` of the viewport (see {@link useNearViewport}); until then
 * the card holds a placeholder of the estimated height for its size
 * ({@link PLACEHOLDER_HEIGHT}), which the frame starts at too, so the card does not
 * jump when the frame is created. The handshake clock starts when the frame is created.
 */
export function IsolatedPluginFrame({
  manifest, module, title, kind, ctx, size, range, path, api = hostBrokerApi, loadTimeoutMs, lazy = kind === 'widget',
}: IsolatedPluginFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const started = useNearViewport(rootRef, { enabled: lazy })
  const controllerRef = useRef<FrameController | null>(null)
  const [state, setState] = useState<FrameState>({ status: 'loading' })
  /** Before the frame reports a height: the estimate for the widget's size, else the kind's minimum. */
  const startHeight = (size !== undefined && kind === 'widget') ? PLACEHOLDER_HEIGHT[size] : HEIGHT_LIMITS[kind].min
  const [height, setHeight] = useState<number>(startHeight)
  const [attempt, setAttempt] = useState(0)

  // Values the connection is built from but that must not rebuild it when they change.
  const live = useRef({ ctx, size, range, path })
  live.current = { ctx, size, range, path }

  const { userId, email, timezone } = ctx.session
  const label = `${manifest.name} · ${title}`

  useEffect(() => {
    const iframe = iframeRef.current
    if (!started || iframe === null) return undefined
    setState({ status: 'loading' })
    const { size: s, range: r, path: p } = live.current
    setHeight(s !== undefined && kind === 'widget' ? PLACEHOLDER_HEIGHT[s] : HEIGHT_LIMITS[kind].min)
    const controller = new FrameController({
      iframe, manifest, userId, email, timezone, kind, api,
      ...(s !== undefined ? { size: s } : {}),
      ...(r !== undefined ? { range: r } : {}),
      ...(p !== undefined ? { path: p } : {}),
      activeUserId, cache: responseCache,
      ...(loadTimeoutMs !== undefined ? { loadTimeoutMs } : {}),
      events: {
        onState: setState,
        onHeight: setHeight,
        onNavigate: (to) => { live.current.ctx.navigate(to) },
        onFocusOut: (direction) => { focusAround(iframe, direction === 'next' ? 'next' : 'previous') },
      },
    })
    controllerRef.current = controller
    // The listener exists before the frame can say hello: the source is set last.
    iframe.src = frameUrl({ pluginId: manifest.id, remoteEntry: manifest.remoteEntry, module, kind, integrity: manifest.integrity })
    return () => {
      controller.dispose()
      controllerRef.current = null
      iframe.removeAttribute('src')
    }
  }, [manifest, module, kind, userId, email, timezone, api, loadTimeoutMs, attempt, started])

  useEffect(() => { controllerRef.current?.setProps({ ...(size !== undefined ? { size } : {}), ...(range !== undefined ? { range } : {}) }) }, [size, range])
  useEffect(() => { if (path !== undefined) controllerRef.current?.setRoute(path) }, [path])

  if (!started) {
    // No iframe yet. Plain text, not a live region and not focusable: it announces nothing
    // on its own and Tab passes over it.
    return (
      <div ref={rootRef} className={`plugin-frame plugin-frame--${kind}`} data-status="waiting" style={{ minHeight: `${startHeight}px` }}>
        <div className="plugin-frame__status plugin-frame__status--waiting">{label} loads when you scroll to it.</div>
      </div>
    )
  }

  const failed = state.status === 'failed'
  return (
    <div ref={rootRef} className={`plugin-frame plugin-frame--${kind}`} data-status={state.status}>
      {state.status === 'loading' ? (
        <div className="plugin-frame__status"><Spinner label={`Loading ${label}`} /></div>
      ) : null}
      {failed ? (
        <div className="plugin-frame__status">
          <Alert>
            {label} could not be loaded. {state.reason}{' '}
            <Button onClick={() => { setAttempt((n) => n + 1) }}>Try again</Button>
          </Alert>
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        title={label}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        className="plugin-frame__frame"
        // Invisible until it has connected, but still laid out: a frame that is
        // `display: none` has no size to measure, so it would report none.
        // A failed frame takes no room; the message does.
        style={{
          height: failed ? 0 : `${height}px`,
          visibility: state.status === 'ready' ? 'visible' : 'hidden',
        }}
      />
    </div>
  )
}
