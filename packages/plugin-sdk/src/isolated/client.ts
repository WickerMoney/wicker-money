import type { PluginApi, PluginContext, PluginSession } from '../runtime.js'
import type { DashboardRange } from '../range.js'
import type { WidgetSize } from '../manifest/WidgetSize.js'
import { formatDateIn, formatMoneyIn } from './format.js'
import { PluginApiError } from './PluginApiError.js'
import { applyHostTheme } from './theme.js'
import type { ThemeTarget } from './theme.js'
import { ISOLATED_PROTOCOL_VERSION } from './protocol.js'
import type {
  FocusDirection,
  FocusInMessage,
  FrameKind,
  HostLocale,
  HostTheme,
  InitMessage,
  LocaleMessage,
  NotifyMessage,
  PluginMessage,
  PluginRequestCache,
  PluginRequestMethod,
  PropsMessage,
  RouteMessage,
  ThemeMessage,
} from './protocol.js'
import { MAX_PATH_LENGTH, parseHostMessage, parseHostReply } from './validate.js'

/** What the host currently says about this frame. A new object on every change, so it suits `useSyncExternalStore`. */
export interface IsolatedState {
  readonly pluginId: string
  readonly kind: FrameKind
  readonly session: PluginSession
  readonly locale: HostLocale
  readonly theme: HostTheme
  /** Widgets only. */
  readonly size?: WidgetSize
  /** Widgets only, and only when the dashboard has a range. */
  readonly range?: DashboardRange
  /** Pages only: the current path under the page's route. */
  readonly path?: string
}

/** A change the host pushed after `init`. `state` already reflects it by the time listeners run. */
export type HostChange = ThemeMessage | LocaleMessage | PropsMessage | RouteMessage | FocusInMessage

/** The live link between a plugin frame and the host. */
export interface HostConnection {
  /** The context to hand a plugin component: the same shape the in-realm host provides. */
  readonly ctx: PluginContext
  /** The latest state. */
  getState(): IsolatedState
  /**
   * Listens for changes the host pushes (theme, locale, props, route, focus-in).
   *
   * @returns A function that removes the listener.
   */
  subscribe(listener: (change: HostChange) => void): () => void
  /** Reports the content height in CSS pixels. Rounded up; repeats of the same height are not sent. */
  reportSize(height: number): void
  /**
   * Reports the height of `element` now and whenever it changes.
   *
   * Also re-reads the height every {@link SIZE_POLL_MS} ms. Chromium does not run a cross-origin frame's
   * rendering updates while it is off screen, so a `ResizeObserver` alone never fires there and the frame
   * would keep the host's minimum height until scrolled into view. Repeats of a height are not sent, so
   * the poll costs one layout read per tick and no messages.
   *
   * @param element - The element whose height is the frame's content height, usually the app root.
   * @param observer - A `ResizeObserver` constructor; defaults to the global one.
   * @returns A function that stops observing. `dispose()` stops it too.
   */
  observeSize(element: ObservedElement, observer?: ResizeObserverCtor): () => void
  /** Tells the host that focus left the frame, past its last (`next`) or before its first (`previous`) focusable element. */
  focusOut(direction: FocusDirection): void
  /**
   * Sends a notification request. No host implements `notify` yet, so this
   * rejects with code `not_supported` today.
   */
  notify(level: NotifyMessage['level'], message: string): Promise<void>
  /** Closes the port and rejects every call still waiting with code `disconnected`. */
  dispose(): void
}

/** How often `observeSize` re-reads the height, in milliseconds. */
export const SIZE_POLL_MS = 250

/** The part of an element `observeSize` reads. */
export interface ObservedElement {
  getBoundingClientRect(): { readonly height: number }
}
/** A `ResizeObserver` constructor, as far as `observeSize` uses it. */
export type ResizeObserverCtor = new (callback: () => void) => {
  observe(target: ObservedElement): void
  disconnect(): void
}

/** Options for {@link connectOverPort} and {@link connectToHost}. */
export interface ConnectOptions {
  /** Where to write the theme. `null` turns automatic theming off. Defaults to `document.documentElement` when there is a `document`. */
  readonly themeRoot?: ThemeTarget | null
  /** How long to wait for the host, in milliseconds, before rejecting. Defaults to 10 000. */
  readonly timeoutMs?: number
}

/** The slice of `window` the handshake uses. Narrow so a test can supply a stand-in. */
export interface HandshakeWindow {
  readonly parent: { postMessage(message: unknown, targetOrigin: string): void }
  addEventListener(type: 'message', listener: (event: HandshakeEvent) => void): void
  removeEventListener(type: 'message', listener: (event: HandshakeEvent) => void): void
}
/** The slice of a window `MessageEvent` the handshake reads. */
export interface HandshakeEvent {
  readonly source: unknown
  readonly data: unknown
  readonly ports: readonly MessagePort[]
}

const DEFAULT_TIMEOUT_MS = 10_000
const SUPPORTED_PROTOCOLS: readonly number[] = [ISOLATED_PROTOCOL_VERSION]

function timeoutError(what: string): PluginApiError {
  return new PluginApiError({ code: 'disconnected', message: `The host did not ${what} in time.` })
}

/**
 * Connects a plugin frame to its host. Call it once, at the start of the frame.
 *
 * The frame says hello to `window.parent`; the host replies with the protocol
 * version to use and a `MessagePort`; everything after that travels on the
 * port. The reply is accepted only from `window.parent` and only with a port,
 * so another window cannot answer in the host's place.
 *
 * @param options - Theme and timeout options.
 * @param win - The window to use. Defaults to the global `window`.
 * @returns The connection, once the host has sent `init`.
 * @throws {PluginApiError} With code `disconnected` on timeout, or `invalid_request` when the host speaks no protocol version this SDK does.
 */
export function connectToHost(options: ConnectOptions = {}, win?: HandshakeWindow): Promise<HostConnection> {
  const w = win ?? (globalThis as { window?: HandshakeWindow }).window
  if (w === undefined) return Promise.reject(new TypeError('connectToHost must run inside a browser frame'))
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise<HostConnection>((resolve, reject) => {
    const finish = (): void => {
      clearTimeout(timer)
      w.removeEventListener('message', onMessage)
    }
    const timer = setTimeout(() => {
      finish()
      reject(timeoutError('answer the handshake'))
    }, timeoutMs)

    function onMessage(event: HandshakeEvent): void {
      if (event.source !== w!.parent) return
      const reply = parseHostReply(event.data)
      if (reply === null) return
      finish()
      if (reply.type === 'wm.refuse') {
        reject(new PluginApiError({
          code: 'invalid_request',
          message: `The host speaks protocol ${reply.supported.join(', ')}; this plugin speaks ${SUPPORTED_PROTOCOLS.join(', ')}.`,
        }))
        return
      }
      const port = event.ports[0]
      if (port === undefined || !SUPPORTED_PROTOCOLS.includes(reply.protocol)) {
        reject(new PluginApiError({ code: 'invalid_request', message: 'The host sent an unusable connection.' }))
        return
      }
      connectOverPort(port, reply.protocol, options).then(resolve, reject)
    }

    w.addEventListener('message', onMessage)
    // The target origin is '*' because a sandboxed frame cannot know its parent's origin.
    // The hello holds nothing secret; the host's answer is the part that is authenticated.
    w.parent.postMessage({ type: 'wm.hello', protocols: SUPPORTED_PROTOCOLS }, '*')
  })
}

/**
 * The second half of {@link connectToHost}: says `ready` on a port the host
 * gave, waits for `init`, and builds the connection. Public so a test harness
 * can connect over a `MessageChannel` without a window.
 *
 * @param port - The port from the host.
 * @param protocol - The protocol version the host chose.
 * @param options - Theme and timeout options.
 * @returns The connection, once the host has sent `init`.
 */
export function connectOverPort(
  port: MessagePort, protocol: number, options: ConnectOptions = {},
): Promise<HostConnection> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise<HostConnection>((resolve, reject) => {
    const timer = setTimeout(() => {
      port.close()
      reject(timeoutError('send init'))
    }, timeoutMs)

    const onFirst = (event: MessageEvent): void => {
      const msg = parseHostMessage(event.data)
      if (msg === null || msg.type !== 'init') return
      clearTimeout(timer)
      port.removeEventListener('message', onFirst)
      if (msg.protocol !== protocol) {
        port.close()
        reject(new PluginApiError({ code: 'invalid_request', message: 'The host changed protocol version mid-handshake.' }))
        return
      }
      resolve(buildConnection(port, msg, options))
    }
    port.addEventListener('message', onFirst)
    port.start()
    port.postMessage({ type: 'ready', protocol } satisfies PluginMessage)
  })
}

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
  readonly cleanup: () => void
}

function buildConnection(port: MessagePort, init: InitMessage, options: ConnectOptions): HostConnection {
  let state: IsolatedState = {
    pluginId: init.pluginId,
    kind: init.kind,
    session: { ...init.session },
    locale: init.locale,
    theme: init.theme,
    ...(init.size !== undefined ? { size: init.size } : {}),
    ...(init.range !== undefined ? { range: init.range } : {}),
    ...(init.path !== undefined ? { path: init.path } : {}),
  }
  const listeners = new Set<(change: HostChange) => void>()
  const pending = new Map<number, Pending>()
  let nextId = 1
  let lastHeight = -1
  let closed = false
  /** Stop functions of the `observeSize` calls still running, so `dispose` can end them. */
  const sizeObservers = new Set<() => void>()

  const themeRoot = options.themeRoot === undefined
    ? (typeof document === 'undefined' ? null : document.documentElement)
    : options.themeRoot
  const paint = (theme: HostTheme): void => { if (themeRoot !== null) applyHostTheme(theme, themeRoot) }
  paint(state.theme)

  const post = (message: PluginMessage): void => { if (!closed) port.postMessage(message) }

  const call = <T,>(
    message: (id: number) => PluginMessage, signal?: AbortSignal | null,
  ): Promise<T> => {
    if (closed) return Promise.reject(new PluginApiError({ code: 'disconnected', message: 'The connection to the host is closed.' }))
    if (signal?.aborted === true) return Promise.reject(new PluginApiError({ code: 'aborted', message: 'The request was aborted.' }))
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        pending.delete(id)
        post({ type: 'cancel', id })
        reject(new PluginApiError({ code: 'aborted', message: 'The request was aborted.' }))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        cleanup: () => signal?.removeEventListener('abort', onAbort),
      })
      post(message(id))
    })
  }

  const request = <T,>(
    method: PluginRequestMethod, path: string, body: unknown, requestInit?: RequestInit,
  ): Promise<T> => {
    const bad = (message: string): Promise<T> =>
      Promise.reject(new PluginApiError({ code: 'invalid_request', message }))
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.length > MAX_PATH_LENGTH) {
      return bad(`Request path must start with a single '/' and be at most ${MAX_PATH_LENGTH} characters.`)
    }
    if (path.startsWith('/api/')) {
      return bad(`Plugin '${state.pluginId}' requested '${path}'. Paths are relative to the API root — drop the '/api/v1' prefix.`)
    }
    // Only `signal` and `cache` mean anything across the channel. Anything else would be
    // silently dropped, which hides a contract difference, so refuse it.
    const { signal, cache, ...rest } = requestInit ?? {}
    const unsupported = Object.entries(rest).filter(([, v]) => v !== undefined).map(([k]) => k)
    if (unsupported.length > 0) {
      return bad(`RequestInit option(s) not supported in an isolated plugin: ${unsupported.join(', ')}. Only 'signal' and 'cache' are.`)
    }
    if (cache !== undefined && cache !== 'default' && cache !== 'no-store' && cache !== 'reload') {
      return bad(`RequestInit cache '${cache}' is not supported in an isolated plugin.`)
    }
    let cloned: unknown
    try {
      // Same normalisation as the in-realm client, which sends JSON.
      cloned = body === undefined ? undefined : JSON.parse(JSON.stringify(body))
    } catch {
      return bad('The request body is not JSON-serialisable.')
    }
    return call<T>((id) => ({
      type: 'request', id, method, path,
      ...(cloned !== undefined ? { body: cloned } : {}),
      ...(cache !== undefined ? { cache: cache as PluginRequestCache } : {}),
    }), signal)
  }

  const api: PluginApi = {
    get: (path, init) => request('GET', path, undefined, init),
    post: (path, body, init) => request('POST', path, body, init),
    put: (path, body, init) => request('PUT', path, body, init),
    del: (path, init) => request('DELETE', path, undefined, init),
  }

  const ctx: PluginContext = {
    get session() { return state.session },
    api,
    navigate: (path) => { post({ type: 'navigate', path }) },
    formatMoney: (value, currency) => formatMoneyIn(state.locale.locale, value, currency),
    formatDate: (value) => formatDateIn(state.locale.locale, value),
  }

  const emit = (change: HostChange): void => { for (const l of [...listeners]) l(change) }

  port.addEventListener('message', (event: MessageEvent) => {
    const msg = parseHostMessage(event.data)
    if (msg === null) return // unknown or malformed: ignored, so a newer host can add messages
    switch (msg.type) {
      case 'response': {
        const entry = pending.get(msg.id)
        if (entry === undefined) return // answered after an abort
        pending.delete(msg.id)
        entry.cleanup()
        if (msg.ok) entry.resolve(msg.value)
        else entry.reject(new PluginApiError(msg.error))
        return
      }
      case 'theme':
        state = { ...state, theme: msg.theme }
        paint(msg.theme)
        return emit(msg)
      case 'locale':
        state = { ...state, locale: msg.locale, session: { ...state.session, timezone: msg.locale.timezone } }
        return emit(msg)
      case 'props':
        state = {
          ...state,
          ...(msg.size !== undefined ? { size: msg.size } : {}),
          ...(msg.range !== undefined ? { range: msg.range } : {}),
        }
        return emit(msg)
      case 'route':
        state = { ...state, path: msg.path }
        return emit(msg)
      case 'focus-in':
        return emit(msg)
      case 'init':
        return // a second init is ignored; the first one defines the frame
    }
  })

  return {
    ctx,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    reportSize(height) {
      if (!Number.isFinite(height) || height < 0) return
      const rounded = Math.ceil(height)
      if (rounded === lastHeight) return
      lastHeight = rounded
      post({ type: 'resize', height: rounded })
    },
    observeSize(element, observer) {
      const Ctor = observer ?? (globalThis as { ResizeObserver?: ResizeObserverCtor }).ResizeObserver
      const report = (): void => { this.reportSize(element.getBoundingClientRect().height) }
      if (closed) return () => undefined
      const ro = Ctor === undefined ? undefined : new Ctor(report)
      ro?.observe(element)
      report()
      const timer = setInterval(report, SIZE_POLL_MS)
      const stop = (): void => { clearInterval(timer); ro?.disconnect(); sizeObservers.delete(stop) }
      sizeObservers.add(stop)
      return stop
    },
    focusOut: (direction) => { post({ type: 'focus-out', direction }) },
    notify: (level, message) =>
      call<void>((id) => ({ type: 'notify', id, level, message })).then(() => undefined),
    dispose() {
      if (closed) return
      closed = true
      for (const stop of [...sizeObservers]) stop()
      port.close()
      for (const [, entry] of pending) {
        entry.cleanup()
        entry.reject(new PluginApiError({ code: 'disconnected', message: 'The connection to the host was closed.' }))
      }
      pending.clear()
      listeners.clear()
    },
  }
}
