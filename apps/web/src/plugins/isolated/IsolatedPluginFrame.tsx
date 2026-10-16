import { useEffect, useRef, useState } from 'react'
import type { DashboardRange, PluginContext, PluginManifest, WidgetSize } from '@wickermoney/plugin-sdk'
import type { FrameKind } from '@wickermoney/plugin-sdk/isolated'
import { Alert, Button, Spinner } from '@wickermoney/ui-kit'
import { activeUserId } from '../../api/client.js'
import { responseCache } from '../../api/responseCache.js'
import { hostBrokerApi, type BrokerApi } from './brokerApi.js'
import { focusAround } from './focusAround.js'
import { FrameController, HEIGHT_LIMITS, type FrameState } from './FrameController.js'
import { frameUrl } from './frameUrl.js'

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
 */
export function IsolatedPluginFrame({
  manifest, module, title, kind, ctx, size, range, path, api = hostBrokerApi, loadTimeoutMs,
}: IsolatedPluginFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const controllerRef = useRef<FrameController | null>(null)
  const [state, setState] = useState<FrameState>({ status: 'loading' })
  const [height, setHeight] = useState<number>(HEIGHT_LIMITS[kind].min)
  const [attempt, setAttempt] = useState(0)

  // Values the connection is built from but that must not rebuild it when they change.
  const live = useRef({ ctx, size, range, path })
  live.current = { ctx, size, range, path }

  const { userId, email, timezone } = ctx.session
  const label = `${manifest.name} · ${title}`

  useEffect(() => {
    const iframe = iframeRef.current
    if (iframe === null) return undefined
    setState({ status: 'loading' })
    setHeight(HEIGHT_LIMITS[kind].min)
    const { size: s, range: r, path: p } = live.current
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
  }, [manifest, module, kind, userId, email, timezone, api, loadTimeoutMs, attempt])

  useEffect(() => { controllerRef.current?.setProps({ ...(size !== undefined ? { size } : {}), ...(range !== undefined ? { range } : {}) }) }, [size, range])
  useEffect(() => { if (path !== undefined) controllerRef.current?.setRoute(path) }, [path])

  const failed = state.status === 'failed'
  return (
    <div className={`plugin-frame plugin-frame--${kind}`} data-status={state.status}>
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
