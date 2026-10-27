import type { PluginManifest } from '@wickermoney/plugin-sdk'
import {
  parsePluginMessage,
  type FocusDirection, type HostMessage, type InitMessage, type PluginErrorPayload, type PluginMessage,
  type RequestMessage,
} from '@wickermoney/plugin-sdk/isolated'
import { ApiError } from '../../api/ApiError.js'
import { isAbortError } from '../../api/isAbortError.js'
import type { ResponseCache } from '../../api/responseCache.js'
import { refusalFor, type PathRefusal } from '../pluginPaths.js'
import type { BrokerApi } from './brokerApi.js'
import { RateLimiter } from './RateLimiter.js'

/** The message types a frame may send. Anything else is ignored, not punished: a newer plugin may send more. */
const KNOWN_TYPES: ReadonlySet<string> = new Set(['ready', 'request', 'cancel', 'navigate', 'resize', 'focus-out', 'modal', 'notify'])

/** Tunables for {@link PluginBroker}; each has a default chosen for a dashboard widget that reads aggregates. */
export interface BrokerLimits {
  /** Largest burst of messages a frame may send. */
  readonly burst: number
  /** Messages per second a frame may sustain. */
  readonly perSecond: number
  /** Most requests in flight at once. */
  readonly maxInFlight: number
  /** Largest serialised request body, in bytes. */
  readonly maxBodyBytes: number
  /** Strikes (malformed, oversize, over-limit or out-of-order messages) in one window that end the connection. */
  readonly maxStrikes: number
  /** Length of that window, in milliseconds. */
  readonly strikeWindowMs: number
  /** Hellos accepted per window before the frame is cut off. Re-handshaking must not reset the limits above. */
  readonly maxHandshakes: number
  /** A token is replaced this long before it expires, in milliseconds. */
  readonly refreshMarginMs: number
}

/** The defaults. A widget's first paint is a handful of requests; 40 in a burst is generous and 20 a second is not a flood. */
export const DEFAULT_BROKER_LIMITS: BrokerLimits = {
  burst: 40,
  perSecond: 20,
  maxInFlight: 12,
  maxBodyBytes: 256 * 1024,
  maxStrikes: 100,
  strikeWindowMs: 10_000,
  maxHandshakes: 10,
  refreshMarginMs: 30_000,
}

/** What the broker asks the component that owns the frame to do. */
export interface BrokerHandlers {
  /** The frame has the port and the host sent `init`. */
  onReady(): void
  /** The content height the frame reported, unclamped. */
  onResize(height: number): void
  /** The frame asked the shell to go to an in-app path. */
  onNavigate(path: string): void
  /** Focus left the frame past its last (`next`) or before its first (`previous`) element. */
  onFocusOut(direction: FocusDirection): void
  /** A modal dialog is open in the frame (`true`) or the last one closed. Opening is rate limited; closing never is. */
  onModal(open: boolean): void
  /** The connection was cut off for a reason a person should be told. The broker has already disposed itself. */
  onFatal(reason: string): void
}

/** Everything a {@link PluginBroker} needs. */
export interface BrokerOptions {
  /** The plugin this frame runs. Its grants are the only grants the frame has. */
  readonly manifest: PluginManifest
  /** The signed-in user the frame was created for. */
  readonly userId: string
  /** The network operations. */
  readonly api: BrokerApi
  /** Whose session the host is acting for right now; a mismatch with `userId` ends the connection. */
  readonly activeUserId: () => string | null
  /** The host's per-user read cache. */
  readonly cache: Pick<ResponseCache, 'read' | 'forget' | 'clear'>
  readonly handlers: BrokerHandlers
  readonly limits?: Partial<BrokerLimits>
  /** The clock in epoch milliseconds; replaceable in tests. */
  readonly now?: () => number
}

interface TokenState {
  readonly token: string
  readonly expiresAtMs: number
}

/** The error the frame sees when the broker refuses a request, by reason. */
const REFUSALS: Readonly<Record<PathRefusal, string>> = {
  not_plain: 'That path is not a plain API path.',
  outside_grants: 'This plugin may not request that path.',
  core_is_read_only: 'This plugin may only read core data.',
}

/** Whether a `cache` value asks for a guaranteed-fresh read. */
const wantsFresh = (mode: string | undefined): boolean => mode === 'no-store' || mode === 'reload'

/**
 * The only trusted code that talks for a sandboxed plugin.
 *
 * A frame has an opaque origin and no credentials; everything it can do to the
 * outside world is a message on one `MessagePort`, and this class decides what
 * happens to each. It holds the plugin token. It never sends a token, the
 * host's or its own, over the port.
 *
 * Every request goes through the same three steps, in this order, and the order
 * is the point:
 *
 * 1. **Grant check** against the manifest ({@link refusalFor}). A cache hit
 *    never reaches the server, so the server's default-deny cannot protect it;
 *    the check has to come first or the cache would answer for a plugin that
 *    has no grant.
 * 2. **The response cache**, the same per-user cache the in-page scoped client
 *    uses, under the same rules (see "Request sharing in the scoped client" in
 *    DEVELOPMENT.md). It is keyed by the user, so a frame built for one user
 *    cannot read or fill another's bucket, and it is emptied by any write.
 * 3. **The network**, with the plugin token as the only credential.
 *
 * The frame is hostile until proven otherwise: every message is validated, the
 * paths are checked for tricks, bodies and rates are bounded, and a frame that
 * keeps misbehaving is cut off. Messages from anything but the transferred
 * port never arrive here at all; deciding which window may open a port is the
 * frame controller's job.
 */
export class PluginBroker {
  private readonly limits: BrokerLimits
  private readonly now: () => number
  private readonly granted: ReadonlySet<string>
  private readonly limiter: RateLimiter
  private readonly navigations: RateLimiter
  /** Opening a modal lifts the frame over the window, so a frame may not do it in a loop. Closing is never limited. */
  private readonly modals: RateLimiter
  private readonly pending = new Map<number, AbortController>()
  private port: MessagePort | null = null
  private makeInit: (() => InitMessage) | null = null
  private ready = false
  private disposed = false
  private tokenState: TokenState | null = null
  private minting: Promise<TokenState> | null = null
  private epoch = 0
  private strikes = 0
  private strikeWindowStart: number
  private handshakes = 0
  private handshakeWindowStart: number

  constructor(private readonly options: BrokerOptions) {
    this.limits = { ...DEFAULT_BROKER_LIMITS, ...options.limits }
    this.now = options.now ?? (() => Date.now())
    this.granted = new Set(options.manifest.requiredTables.map((g) => g.table))
    this.limiter = new RateLimiter(this.limits.burst, this.limits.perSecond, this.now)
    this.navigations = new RateLimiter(3, 1, this.now)
    this.modals = new RateLimiter(4, 2, this.now)
    this.strikeWindowStart = this.now()
    this.handshakeWindowStart = this.now()
  }

  /** Whether a port is attached and the broker has not been disposed. */
  get connected(): boolean {
    return this.port !== null && !this.disposed
  }

  /**
   * Starts serving a port.
   *
   * Replaces any earlier port, whose requests are cancelled: a frame that
   * navigates itself and says hello again gets a fresh connection, but not a
   * fresh rate limit or strike count, so re-handshaking is not a way around them.
   *
   * @param port - The host's end of the channel whose other end was transferred to the frame.
   * @param makeInit - Builds the `init` message to answer `ready` with.
   * @returns `false` when the broker refused (disposed, or the frame is handshaking too often).
   */
  attach(port: MessagePort, makeInit: () => InitMessage): boolean {
    if (this.disposed) return false
    const t = this.now()
    if (t - this.handshakeWindowStart > this.limits.strikeWindowMs) {
      this.handshakeWindowStart = t
      this.handshakes = 0
    }
    this.handshakes += 1
    if (this.handshakes > this.limits.maxHandshakes) {
      this.fatal('The plugin restarted its connection too many times.')
      return false
    }
    this.closePort()
    this.port = port
    this.makeInit = makeInit
    this.ready = false
    port.onmessage = (event: MessageEvent) => { this.receive(port, event.data) }
    return true
  }

  /**
   * Sends a host message to the frame, for example a new theme.
   *
   * @param message - The message. Ignored when no frame is connected.
   */
  send(message: HostMessage): void {
    if (this.port === null || this.disposed) return
    try { this.port.postMessage(message) } catch { /* the frame is gone */ }
  }

  /** Cancels everything in flight, forgets the token and closes the port. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.epoch += 1
    this.closePort()
    this.tokenState = null
    this.minting = null
  }

  // ---------------------------------------------------------------------------

  private closePort(): void {
    for (const controller of this.pending.values()) controller.abort()
    this.pending.clear()
    if (this.port !== null) {
      this.port.onmessage = null
      this.port.close()
    }
    this.port = null
    this.ready = false
  }

  private fatal(reason: string): void {
    if (this.disposed) return
    this.dispose()
    this.options.handlers.onFatal(reason)
  }

  /** Counts one bad message; too many in a window ends the connection. */
  private strike(): void {
    const t = this.now()
    if (t - this.strikeWindowStart > this.limits.strikeWindowMs) {
      this.strikeWindowStart = t
      this.strikes = 0
    }
    this.strikes += 1
    if (this.strikes >= this.limits.maxStrikes) this.fatal('The plugin sent too many invalid or excessive messages.')
  }

  private receive(from: MessagePort, data: unknown): void {
    // A message from a port that has since been replaced is a stale frame.
    if (this.disposed || from !== this.port) return
    const message = parsePluginMessage(data)
    if (message === null) {
      const type = typeof data === 'object' && data !== null ? (data as { type?: unknown }).type : undefined
      if (typeof type === 'string' && KNOWN_TYPES.has(type)) this.strike()
      return
    }
    if (message.type === 'ready') {
      this.onReady()
      return
    }
    // Nothing but `ready` is meaningful before `init`.
    if (!this.ready) {
      this.strike()
      return
    }
    if (!this.limiter.tryTake()) {
      this.strike()
      if (message.type === 'request') this.reply(from, message.id, { ok: false, error: this.rateLimited() })
      return
    }
    this.dispatch(from, message)
  }

  private onReady(): void {
    if (this.ready || this.makeInit === null) {
      this.strike()
      return
    }
    this.ready = true
    this.send(this.makeInit())
    this.options.handlers.onReady()
  }

  private dispatch(from: MessagePort, message: Exclude<PluginMessage, { type: 'ready' }>): void {
    const { handlers } = this.options
    switch (message.type) {
      case 'request': this.onRequest(from, message); return
      case 'cancel': this.cancel(message.id); return
      case 'resize': handlers.onResize(message.height); return
      case 'navigate':
        if (this.navigations.tryTake()) handlers.onNavigate(message.path)
        else this.strike()
        return
      case 'focus-out': handlers.onFocusOut(message.direction); return
      case 'modal':
        if (!message.open || this.modals.tryTake()) handlers.onModal(message.open)
        else this.strike()
        return
      case 'notify':
        // Reserved: no host implements `notify` yet (ADR 0005, question 5).
        this.reply(from, message.id, {
          ok: false, error: { code: 'not_supported', message: 'This Wicker Money does not support notifications from plugins.' },
        })
        return
    }
  }

  private rateLimited(): PluginErrorPayload {
    return { code: 'request_failed', status: 429, message: 'This plugin is sending requests too fast.' }
  }

  private cancel(id: number): void {
    // Dropping the entry first means the settled promise finds nobody to answer.
    const controller = this.pending.get(id)
    this.pending.delete(id)
    controller?.abort()
  }

  private onRequest(from: MessagePort, request: RequestMessage): void {
    const { id, method, path } = request
    if (this.pending.has(id)) {
      this.strike()
      this.reply(from, id, { ok: false, error: { code: 'invalid_request', message: 'That request id is already in use.' } })
      return
    }
    if (this.pending.size >= this.limits.maxInFlight) {
      this.strike()
      this.reply(from, id, { ok: false, error: this.rateLimited() })
      return
    }

    // 1. Grants. Before the cache, always.
    const refusal = refusalFor(this.options.manifest.id, this.granted, method, path)
    if (refusal !== null) {
      this.reply(from, id, { ok: false, error: {
        code: refusal === 'not_plain' ? 'invalid_request' : 'grant_denied', message: REFUSALS[refusal],
      } })
      return
    }
    if (request.body !== undefined && this.bodyTooLarge(request.body)) {
      this.strike()
      this.reply(from, id, { ok: false, error: { code: 'invalid_request', message: 'The request body is too large.' } })
      return
    }

    const controller = new AbortController()
    this.pending.set(id, controller)
    this.run(request, controller.signal).then(
      (value) => { this.settle(from, id, controller, { ok: true, value }) },
      (error: unknown) => { this.settle(from, id, controller, { ok: false, error: this.payloadFor(error) }) },
    )
  }

  /** Whether a body serialises to more than the limit. A body that cannot be serialised counts as too large. */
  private bodyTooLarge(body: unknown): boolean {
    try {
      const text = JSON.stringify(body)
      return text !== undefined && new TextEncoder().encode(text).length > this.limits.maxBodyBytes
    } catch {
      return true
    }
  }

  private settle(
    from: MessagePort, id: number, controller: AbortController,
    result: { ok: true; value: unknown } | { ok: false; error: PluginErrorPayload },
  ): void {
    // A cancelled or replaced request has no one to answer.
    if (this.pending.get(id) !== controller) return
    this.pending.delete(id)
    this.reply(from, id, result)
  }

  private reply(
    to: MessagePort, id: number,
    result: { ok: true; value: unknown } | { ok: false; error: PluginErrorPayload },
  ): void {
    if (this.disposed || to !== this.port) return
    try { to.postMessage({ type: 'response', id, ...result }) } catch { /* the frame is gone */ }
  }

  private payloadFor(error: unknown): PluginErrorPayload {
    if (isAbortError(error)) return { code: 'aborted', message: 'The request was cancelled.' }
    if (error instanceof ApiError) {
      return {
        code: error.code, message: error.message, status: error.status,
        ...(error.issues.length > 0 ? { issues: error.issues.map((i) => ({ path: i.path, message: i.message })) } : {}),
      }
    }
    // Anything else is a failure to reach the server. Its text is not shown: it
    // is the host's own error, not something a plugin should read.
    return { code: 'network_error', message: 'Could not reach Wicker Money.' }
  }

  // 2 and 3: the cache, then the network.
  private async run(request: RequestMessage, signal: AbortSignal): Promise<unknown> {
    const { userId } = this.options
    // A frame built for one user must never act for another. The host's client
    // clears the shared cache when the user changes; this stops the frame from
    // asking at all.
    if (this.options.activeUserId() !== userId) {
      this.fatal('The signed-in user changed.')
      throw new DOMException('The signed-in user changed.', 'AbortError')
    }
    const { method, path, body } = request
    if (method !== 'GET') {
      // A write may change anything a remembered read reported: drop it all
      // before sending and again once it settles, as the host's client does.
      this.options.cache.clear()
      try {
        return await this.fetchWithToken(method, path, body, signal)
      } finally {
        this.options.cache.clear()
      }
    }
    const key = `GET ${path}`
    if (wantsFresh(request.cache)) {
      this.options.cache.forget(userId, key)
      return this.fetchWithToken('GET', path, undefined, signal)
    }
    // The shared request carries no caller's signal: it outlives any one caller.
    return this.options.cache.read(userId, key, () => this.fetchWithToken('GET', path, undefined, new AbortController().signal), signal)
  }

  private async fetchWithToken(
    method: RequestMessage['method'], path: string, body: unknown, signal: AbortSignal,
  ): Promise<unknown> {
    let state = await this.currentToken()
    // Cancelled or disposed while the token was being minted: do not send.
    if (signal.aborted || this.disposed) throw new DOMException('The request was cancelled.', 'AbortError')
    try {
      return await this.options.api.send({ method, path, body, token: state.token, signal })
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error
      // Rejected as expired or revoked. Mint once more and try once more; if the
      // session itself is over, the mint fails and says so.
      if (this.tokenState === state) this.tokenState = null
      state = await this.currentToken()
      if (signal.aborted || this.disposed) throw new DOMException('The request was cancelled.', 'AbortError')
      return this.options.api.send({ method, path, body, token: state.token, signal })
    }
  }

  /** A token with enough life left, minting one if needed. Concurrent callers share one mint. */
  private currentToken(): Promise<TokenState> {
    const held = this.tokenState
    if (held !== null && held.expiresAtMs - this.limits.refreshMarginMs > this.now()) return Promise.resolve(held)
    if (this.minting !== null) return this.minting
    const epoch = this.epoch
    const mint = this.options.api.mint(this.options.manifest.id).then((minted) => {
      const expiresAtMs = Date.parse(minted.expiresAt)
      if (typeof minted.token !== 'string' || minted.token === '' || Number.isNaN(expiresAtMs)) {
        throw new Error('The server sent an unusable plugin token.')
      }
      const state: TokenState = { token: minted.token, expiresAtMs }
      // Disposed while minting: the token must not outlive the broker.
      if (epoch === this.epoch) this.tokenState = state
      return state
    }).finally(() => {
      if (this.minting === mint) this.minting = null
    })
    this.minting = mint
    return mint
  }
}
