import type { DashboardRange, PluginManifest, WidgetSize } from '@wickermoney/plugin-sdk'
import {
  ISOLATED_PROTOCOL_VERSION, parseFrameHello,
  type FocusDirection, type FrameKind, type HostLocale, type HostTheme, type InitMessage,
} from '@wickermoney/plugin-sdk/isolated'
import type { ResponseCache } from '../../api/responseCache.js'
import { PluginBroker, type BrokerOptions } from './broker.js'
import type { BrokerApi } from './brokerApi.js'
import { diagnoseFrameTimeout } from './devFrameHint.js'
import { readHostLocale, readHostTheme } from './hostTheme.js'

/** The heights a frame may take, in CSS pixels, by kind. The frame asks; the host clamps. */
export const HEIGHT_LIMITS: Readonly<Record<FrameKind, { readonly min: number; readonly max: number }>> = {
  // A dashboard widget is a card in a grid: never a sliver, never taller than a screen or two.
  widget: { min: 96, max: 800 },
  // A page may scroll, so its ceiling is only there to stop a runaway report.
  page: { min: 240, max: 20_000 },
}

/**
 * The height a widget card holds before its frame has reported one, by the widget's size, in CSS
 * pixels. A placeholder that is 96 px tall while its widget will be 450 would pull everything
 * below it up into the margin and start frames that are really far away. These are estimates from the
 * bundled chart widgets (frames of 400 to 450 px at `lg`; `sm` is a small card), not limits: the
 * frame reports its real height and the host clamps that, as before.
 */
export const PLACEHOLDER_HEIGHT: Readonly<Record<WidgetSize, number>> = { sm: 160, md: 360, lg: 400, full: 400 }

/**
 * How long a frame has to complete the handshake before it counts as failed, in milliseconds.
 *
 * Only time the page is visible counts: the clock starts when the frame is created, stops while the
 * document is hidden and carries on from where it stopped. A background tab throttles the frame's
 * timers and rendering, so a frame that is slow there has not shown it is broken.
 */
export const DEFAULT_LOAD_TIMEOUT_MS = 15_000

/** Where a frame is in its life, as the component shows it. */
export type FrameState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready' }
  | { readonly status: 'failed'; readonly reason: string }

/** What the controller tells the component that owns the iframe. */
export interface FrameEvents {
  onState(state: FrameState): void
  /** The clamped height the iframe should take. */
  onHeight(height: number): void
  /** The frame asked to go to an in-app path. Already checked to be a plain path. */
  onNavigate(path: string): void
  /** Focus left the frame; the host should move it past the iframe. */
  onFocusOut(direction: FocusDirection): void
}

/** Everything a {@link FrameController} needs. */
export interface FrameControllerOptions {
  readonly iframe: HTMLIFrameElement
  readonly manifest: PluginManifest
  readonly userId: string
  /** The user's time zone, sent with the locale. */
  readonly timezone: string
  readonly email: string
  readonly kind: FrameKind
  readonly size?: WidgetSize
  readonly range?: DashboardRange
  /** Pages only: the path to render first. */
  readonly path?: string
  readonly api: BrokerApi
  readonly activeUserId: () => string | null
  readonly cache: Pick<ResponseCache, 'read' | 'forget' | 'clear'>
  readonly events: FrameEvents
  readonly limits?: BrokerOptions['limits']
  readonly loadTimeoutMs?: number
  /** Reads the host theme. Replaceable in tests. */
  readonly readTheme?: () => HostTheme
  readonly readLocale?: () => HostLocale
  /** The host window. Replaceable in tests. */
  readonly win?: Window
}

/**
 * Owns the connection between the host page and one plugin iframe.
 *
 * It does three jobs the broker cannot, because they involve windows rather
 * than a port:
 *
 * - **Who may connect.** The one `message` listener on the host window accepts a
 *   hello only when `event.source` is this iframe's own `contentWindow`. A
 *   sandboxed frame's origin is the string `"null"`, shared by every sandboxed
 *   frame, so the origin proves nothing; the window identity does.
 * - **The port.** It makes a `MessageChannel`, keeps one end for the broker and
 *   transfers the other to that window. After that nothing is authenticated by
 *   origin at all: holding the port is the credential.
 * - **What the host owns.** The frame reports a height and the host clamps it;
 *   the host pushes theme, locale and props when they change; the host takes
 *   focus when it leaves the frame.
 *
 * A frame that navigates itself says hello again and gets a fresh port. Call
 * {@link dispose} when the iframe goes away.
 */
export class FrameController {
  private readonly broker: PluginBroker
  private readonly win: Window
  private readonly readTheme: () => HostTheme
  private readonly readLocale: () => HostLocale
  /** The handshake timer; `undefined` while it is paused (document hidden) or finished. */
  private timer: ReturnType<typeof setTimeout> | undefined
  /** Visible milliseconds the handshake has left. */
  private remainingMs: number
  private timerStartedAt = 0
  private readonly cleanups: Array<() => void> = []
  private ready = false
  private failed = false
  private disposed = false
  private lastTheme = ''
  private lastLocale = ''

  constructor(private readonly options: FrameControllerOptions) {
    this.win = options.win ?? window
    this.readTheme = options.readTheme ?? (() => readHostTheme())
    this.readLocale = options.readLocale ?? (() => readHostLocale(options.timezone))
    this.broker = new PluginBroker({
      manifest: options.manifest,
      userId: options.userId,
      api: options.api,
      activeUserId: options.activeUserId,
      cache: options.cache,
      ...(options.limits ? { limits: options.limits } : {}),
      handlers: {
        onReady: () => { this.markReady() },
        onResize: (height) => { options.events.onHeight(this.clamp(height)) },
        onNavigate: (path) => { options.events.onNavigate(path) },
        onFocusOut: (direction) => { options.events.onFocusOut(direction) },
        onFatal: (reason) => { this.fail(reason) },
      },
    })

    const onMessage = (event: MessageEvent): void => { this.onWindowMessage(event) }
    this.win.addEventListener('message', onMessage)
    this.cleanups.push(() => { this.win.removeEventListener('message', onMessage) })

    this.remainingMs = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS
    this.watchVisibility()
    options.events.onState({ status: 'loading' })
    this.watchTheme()
    this.watchLocale()
  }

  /** Runs the handshake clock while the document is visible and holds it while it is hidden. */
  private watchVisibility(): void {
    const doc = this.win.document
    const sync = (): void => {
      if (this.disposed || this.failed || this.ready) return
      if (doc.visibilityState === 'hidden') {
        if (this.timer === undefined) return
        clearTimeout(this.timer)
        this.timer = undefined
        this.remainingMs = Math.max(0, this.remainingMs - (Date.now() - this.timerStartedAt))
      } else if (this.timer === undefined) {
        this.timerStartedAt = Date.now()
        this.timer = setTimeout(() => { this.onTimeout() }, this.remainingMs)
      }
    }
    doc.addEventListener('visibilitychange', sync)
    this.cleanups.push(() => { doc.removeEventListener('visibilitychange', sync) })
    sync()
  }

  private onTimeout(): void {
    this.timer = undefined
    // Dead code in a production build (Vite replaces `import.meta.env.DEV` with `false`).
    if (import.meta.env.DEV && !this.failed && !this.disposed) {
      void diagnoseFrameTimeout().then((hint) => { console.warn(`[wicker-money] ${hint}`) })
    }
    this.fail('The plugin did not start in time.')
  }

  /** The height limits for this frame's kind. */
  private clamp(height: number): number {
    const { min, max } = HEIGHT_LIMITS[this.options.kind]
    return Math.min(max, Math.max(min, Math.ceil(height)))
  }

  private onWindowMessage(event: MessageEvent): void {
    const target = this.options.iframe.contentWindow
    // Not from our iframe: not ours. Other frames, other tabs' windows and the
    // page itself all land here, and all are ignored without a reply.
    if (this.disposed || target === null || event.source !== target) return
    const hello = parseFrameHello(event.data)
    if (hello === null) return
    if (!hello.protocols.includes(ISOLATED_PROTOCOL_VERSION)) {
      target.postMessage({ type: 'wm.refuse', supported: [ISOLATED_PROTOCOL_VERSION] }, '*')
      this.fail('This plugin needs a different version of Wicker Money.')
      return
    }
    const channel = new MessageChannel()
    if (!this.broker.attach(channel.port1, () => this.makeInit())) {
      channel.port1.close()
      channel.port2.close()
      return
    }
    // The target origin is '*' because the frame's origin is opaque and cannot
    // be named. The target is the exact window checked above, so the port goes
    // nowhere else.
    target.postMessage({ type: 'wm.connect', protocol: ISOLATED_PROTOCOL_VERSION }, '*', [channel.port2])
  }

  private makeInit(): InitMessage {
    const { options } = this
    const theme = this.readTheme()
    const locale = this.readLocale()
    this.lastTheme = JSON.stringify(theme)
    this.lastLocale = JSON.stringify(locale)
    return {
      type: 'init',
      protocol: ISOLATED_PROTOCOL_VERSION,
      pluginId: options.manifest.id,
      kind: options.kind,
      session: { userId: options.userId, email: options.email, timezone: options.timezone },
      locale,
      theme,
      ...(options.size !== undefined ? { size: options.size } : {}),
      ...(options.range !== undefined ? { range: options.range } : {}),
      ...(options.path !== undefined ? { path: options.path } : {}),
    }
  }

  private markReady(): void {
    if (this.failed || this.disposed) return
    this.stopTimer()
    this.ready = true
    this.options.events.onState({ status: 'ready' })
  }

  private fail(reason: string): void {
    if (this.failed || this.disposed) return
    this.failed = true
    this.ready = false
    this.stopTimer()
    this.broker.dispose()
    this.options.events.onState({ status: 'failed', reason })
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Re-sends the theme when `data-theme`, the root's style or the OS preference changes. */
  private watchTheme(): void {
    const doc = this.win.document
    const push = (): void => {
      if (!this.ready) return
      const theme = this.readTheme()
      const text = JSON.stringify(theme)
      if (text === this.lastTheme) return
      this.lastTheme = text
      this.broker.send({ type: 'theme', theme })
    }
    const observer = new MutationObserver(push)
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    this.cleanups.push(() => { observer.disconnect() })
    const query = this.win.matchMedia?.('(prefers-color-scheme: dark)')
    query?.addEventListener('change', push)
    this.cleanups.push(() => { query?.removeEventListener('change', push) })
  }

  private watchLocale(): void {
    const push = (): void => {
      if (!this.ready) return
      const locale = this.readLocale()
      const text = JSON.stringify(locale)
      if (text === this.lastLocale) return
      this.lastLocale = text
      this.broker.send({ type: 'locale', locale })
    }
    this.win.addEventListener('languagechange', push)
    this.cleanups.push(() => { this.win.removeEventListener('languagechange', push) })
  }

  /** Tells the frame its size or the dashboard range changed. */
  setProps(props: { size?: WidgetSize; range?: DashboardRange }): void {
    if (!this.ready) return
    this.broker.send({
      type: 'props',
      ...(props.size !== undefined ? { size: props.size } : {}),
      ...(props.range !== undefined ? { range: props.range } : {}),
    })
  }

  /** Tells a page frame the path under its route changed. */
  setRoute(path: string): void {
    if (this.ready) this.broker.send({ type: 'route', path })
  }

  /** Moves keyboard focus into the frame: its `first` or `last` focusable element. */
  focusIn(direction: 'first' | 'last'): void {
    if (!this.ready) return
    this.options.iframe.focus()
    this.broker.send({ type: 'focus-in', direction })
  }

  /** Stops listening, cancels everything in flight and drops the token. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopTimer()
    for (const cleanup of this.cleanups) cleanup()
    this.broker.dispose()
  }
}
