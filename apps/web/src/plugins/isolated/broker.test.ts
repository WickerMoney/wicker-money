import type { PluginManifest } from '@wickermoney/plugin-sdk'
import type { HostMessage, InitMessage } from '@wickermoney/plugin-sdk/isolated'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/ApiError.js'
import { ResponseCache } from '../../api/responseCache.js'
import { PluginBroker, type BrokerHandlers, type BrokerOptions } from './broker.js'
import type { BrokerApi, BrokerRequest } from './brokerApi.js'

/** The host's end of a channel, driven by the test as if it were the frame. */
class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null
  readonly sent: HostMessage[] = []
  closed = false
  postMessage(message: unknown): void { this.sent.push(message as HostMessage) }
  close(): void { this.closed = true }
  /** What the frame sends. */
  frame(data: unknown): void { this.onmessage?.({ data } as MessageEvent) }
  responses(): Array<Extract<HostMessage, { type: 'response' }>> {
    return this.sent.filter((m): m is Extract<HostMessage, { type: 'response' }> => m.type === 'response')
  }
}

const asPort = (p: FakePort): MessagePort => p as unknown as MessagePort

const manifest = {
  id: 'test.fixture', name: 'Fixture', version: '0.1.0', description: '', author: '', sdkVersion: 0,
  permissions: [], remoteEntry: '', requiredTables: [{ table: 'transactions', access: 'read' }],
  contributes: { widgets: [], pages: [] },
} as unknown as PluginManifest

const init = (): InitMessage => ({
  type: 'init', protocol: 1, pluginId: 'test.fixture', kind: 'widget',
  session: { userId: 'u1', email: 'u1@example.com', timezone: 'UTC' },
  locale: { locale: 'en-US', timezone: 'UTC' },
  theme: { scheme: 'light', tokens: {} },
})

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

interface Rig {
  readonly broker: PluginBroker
  readonly port: FakePort
  readonly handlers: { [K in keyof BrokerHandlers]: ReturnType<typeof vi.fn> }
  readonly mint: ReturnType<typeof vi.fn>
  readonly send: ReturnType<typeof vi.fn>
  readonly cache: ResponseCache
  readonly clock: { t: number }
  user: string | null
}

function rig(opts: {
  send?: (r: BrokerRequest) => Promise<unknown>
  mintExpiresInMs?: number
  limits?: BrokerOptions['limits']
  handshake?: boolean
} = {}): Rig {
  const clock = { t: 1_000_000 }
  let minted = 0
  const mint = vi.fn(async () => {
    minted += 1
    return { token: `tok-${minted}`, expiresAt: new Date(clock.t + (opts.mintExpiresInMs ?? 300_000)).toISOString() }
  })
  const send = vi.fn(opts.send ?? (async () => ({ rows: [] })))
  const api: BrokerApi = { mint, send }
  const handlers = { onReady: vi.fn(), onResize: vi.fn(), onNavigate: vi.fn(), onFocusOut: vi.fn(), onModal: vi.fn(), onNotify: vi.fn(), onFatal: vi.fn() }
  const cache = new ResponseCache({ now: () => clock.t })
  const state = { user: 'u1' as string | null }
  const broker = new PluginBroker({
    manifest, userId: 'u1', api, activeUserId: () => state.user, cache, handlers,
    now: () => clock.t, ...(opts.limits ? { limits: opts.limits } : {}),
  })
  const port = new FakePort()
  broker.attach(asPort(port), init)
  if (opts.handshake !== false) port.frame({ type: 'ready', protocol: 1 })
  const r = {
    broker, port, handlers, mint, send, cache, clock,
    get user() { return state.user }, set user(v) { state.user = v },
  }
  return r as Rig
}

const get = (id: number, path: string, cache?: string) => ({ type: 'request', id, method: 'GET', path, ...(cache ? { cache } : {}) })

describe('handshake', () => {
  it('answers ready with init and tells the host', () => {
    const r = rig()
    expect(r.port.sent[0]).toEqual(init())
    expect(r.handlers.onReady).toHaveBeenCalledOnce()
  })

  it('ignores a second ready as a strike, not a second init', () => {
    const r = rig()
    r.port.frame({ type: 'ready', protocol: 1 })
    expect(r.port.sent.filter((m) => m.type === 'init')).toHaveLength(1)
  })

  it('answers nothing before ready', async () => {
    const r = rig({ handshake: false })
    r.port.frame(get(1, '/core/transactions'))
    await flush()
    expect(r.port.sent).toEqual([])
    expect(r.send).not.toHaveBeenCalled()
  })
})

describe('grants', () => {
  it('forwards a granted read with the plugin token and nothing else', async () => {
    const r = rig()
    r.port.frame(get(1, '/core/transactions/monthly-summary'))
    await flush()
    expect(r.mint).toHaveBeenCalledWith('test.fixture')
    expect(r.send).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/core/transactions/monthly-summary', token: 'tok-1' }))
    expect(r.port.responses()).toEqual([{ type: 'response', id: 1, ok: true, value: { rows: [] } }])
  })

  it('denies a table the manifest does not grant, without minting or calling out', async () => {
    const r = rig()
    r.port.frame(get(1, '/core/accounts/summary'))
    await flush()
    expect(r.port.responses()[0]).toMatchObject({ id: 1, ok: false, error: { code: 'grant_denied' } })
    expect(r.mint).not.toHaveBeenCalled()
    expect(r.send).not.toHaveBeenCalled()
  })

  it('denies a write to core and a path outside core and its own namespace', async () => {
    const r = rig()
    r.port.frame({ type: 'request', id: 1, method: 'POST', path: '/core/transactions', body: {} })
    r.port.frame(get(2, '/auth/me'))
    r.port.frame(get(3, '/p/other.plugin/data'))
    await flush()
    expect(r.port.responses().map((m) => m.ok === false && m.error.code)).toEqual(['grant_denied', 'grant_denied', 'grant_denied'])
    expect(r.send).not.toHaveBeenCalled()
  })

  it('refuses path tricks as invalid requests', async () => {
    const r = rig()
    r.port.frame(get(1, '/core/transactions/../accounts'))
    r.port.frame(get(2, '/core/transactions/%2e%2e/accounts'))
    await flush()
    expect(r.port.responses().map((m) => m.ok === false && m.error.code)).toEqual(['invalid_request', 'invalid_request'])
    expect(r.send).not.toHaveBeenCalled()
  })

  it('lets a plugin use its own namespace with any method', async () => {
    const r = rig()
    r.port.frame({ type: 'request', id: 1, method: 'PUT', path: '/p/test.fixture/state', body: { a: 1 } })
    await flush()
    expect(r.send).toHaveBeenCalledWith(expect.objectContaining({ method: 'PUT', path: '/p/test.fixture/state', body: { a: 1 } }))
  })

  it('checks the grant before the cache: a warm entry never answers an ungranted path', async () => {
    const r = rig()
    // Another caller (the host) filled the same key for the same user.
    await r.cache.read('u1', 'GET /core/accounts/summary', async () => ({ secret: true }))
    r.port.frame(get(1, '/core/accounts/summary'))
    await flush()
    expect(r.port.responses()[0]).toMatchObject({ ok: false, error: { code: 'grant_denied' } })
  })
})

describe('bad input', () => {
  it('ignores an unknown message type, including dialog, without a strike', async () => {
    const r = rig({ limits: { maxStrikes: 2 } })
    for (let i = 0; i < 10; i++) r.port.frame({ type: 'dialog', title: 'x' })
    r.port.frame('not an object')
    r.port.frame(null)
    expect(r.handlers.onFatal).not.toHaveBeenCalled()
    expect(r.port.sent).toHaveLength(1) // init only
  })

  it('drops a malformed known message and ends the connection after repeated ones', () => {
    const r = rig({ limits: { maxStrikes: 3 } })
    for (let i = 0; i < 3; i++) r.port.frame({ type: 'request', id: 'x' })
    expect(r.handlers.onFatal).toHaveBeenCalledOnce()
    expect(r.port.closed).toBe(true)
    expect(r.broker.connected).toBe(false)
  })

  it('answers an oversize body with invalid_request and never sends it', async () => {
    const r = rig({ limits: { maxBodyBytes: 100 } })
    r.port.frame({ type: 'request', id: 1, method: 'PUT', path: '/p/test.fixture/x', body: { s: 'x'.repeat(500) } })
    await flush()
    expect(r.port.responses()[0]).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
    expect(r.send).not.toHaveBeenCalled()
  })

  it('refuses a duplicate request id', async () => {
    let release: (v: unknown) => void = () => {}
    const r = rig({ send: () => new Promise((res) => { release = res }) })
    r.port.frame(get(1, '/core/transactions/a'))
    r.port.frame(get(1, '/core/transactions/b'))
    await flush()
    expect(r.port.responses()[0]).toMatchObject({ id: 1, ok: false, error: { code: 'invalid_request' } })
    release({})
  })

  it('rate limits a flood and ends the connection', async () => {
    const r = rig({ limits: { burst: 5, perSecond: 1, maxStrikes: 8 } })
    for (let i = 0; i < 30; i++) r.port.frame(get(i, `/core/transactions/${i}`))
    await flush()
    expect(r.send.mock.calls.length).toBeLessThanOrEqual(5)
    expect(r.handlers.onFatal).toHaveBeenCalled()
  })

  it('caps requests in flight', async () => {
    const r = rig({ send: () => new Promise(() => {}), limits: { maxInFlight: 2 } })
    for (let i = 0; i < 4; i++) r.port.frame(get(i, `/core/transactions/${i}`))
    await flush()
    expect(r.send).toHaveBeenCalledTimes(2)
    expect(r.port.responses().filter((m) => !m.ok)).toHaveLength(2)
  })
})

describe('host commands', () => {
  it('passes resize, navigate and focus-out to the handlers', () => {
    const r = rig()
    r.port.frame({ type: 'resize', height: 321 })
    r.port.frame({ type: 'navigate', path: '/budgets' })
    r.port.frame({ type: 'focus-out', direction: 'next' })
    expect(r.handlers.onResize).toHaveBeenCalledWith(321)
    expect(r.handlers.onNavigate).toHaveBeenCalledWith('/budgets')
    expect(r.handlers.onFocusOut).toHaveBeenCalledWith('next')
  })

  it('limits how fast a frame can navigate the app', () => {
    const r = rig()
    for (let i = 0; i < 10; i++) r.port.frame({ type: 'navigate', path: `/x${i}` })
    expect(r.handlers.onNavigate).toHaveBeenCalledTimes(3)
  })

  it('passes modal open and close to the handler', () => {
    const r = rig()
    r.port.frame({ type: 'modal', open: true })
    r.port.frame({ type: 'modal', open: false })
    expect(r.handlers.onModal.mock.calls).toEqual([[true], [false]])
  })

  it('limits how fast a frame can open a modal, and never limits closing one', () => {
    const r = rig()
    for (let i = 0; i < 12; i++) {
      r.port.frame({ type: 'modal', open: true })
      r.port.frame({ type: 'modal', open: false })
    }
    expect(r.handlers.onModal.mock.calls.filter(([open]) => open === true)).toHaveLength(4)
    // Every close got through, so a lift is always ended.
    expect(r.handlers.onModal.mock.calls.filter(([open]) => open === false)).toHaveLength(12)
    // The refused opens count as strikes; the connection survives a burst this size.
    expect(r.handlers.onFatal).not.toHaveBeenCalled()
  })

  it('treats a malformed modal message as a strike, not a command', () => {
    const r = rig()
    r.port.frame({ type: 'modal', open: 'yes' })
    r.port.frame({ type: 'modal' })
    expect(r.handlers.onModal).not.toHaveBeenCalled()
  })

  it('sends host messages to the frame', () => {
    const r = rig()
    r.broker.send({ type: 'focus-in', direction: 'first' })
    expect(r.port.sent.at(-1)).toEqual({ type: 'focus-in', direction: 'first' })
  })
})

describe('plugin token', () => {
  it('mints once and reuses the token while it has life left', async () => {
    const r = rig()
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    r.clock.t += 10_000
    r.port.frame(get(2, '/core/transactions/b'))
    await flush()
    expect(r.mint).toHaveBeenCalledOnce()
  })

  it('shares one mint between concurrent requests', async () => {
    const r = rig()
    for (let i = 0; i < 5; i++) r.port.frame(get(i, `/core/transactions/${i}`))
    await flush()
    expect(r.mint).toHaveBeenCalledOnce()
    expect(r.send).toHaveBeenCalledTimes(5)
  })

  it('refreshes inside the margin before expiry', async () => {
    const r = rig({ mintExpiresInMs: 60_000 })
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    r.clock.t += 45_000 // 15 s left, margin is 30 s
    r.port.frame(get(2, '/core/transactions/b'))
    await flush()
    expect(r.mint).toHaveBeenCalledTimes(2)
    expect(r.send.mock.calls[1]?.[0]).toMatchObject({ token: 'tok-2' })
  })

  it('re-mints once and retries once when the server says 401', async () => {
    let calls = 0
    const r = rig({
      send: async (req) => {
        calls += 1
        if (req.token === 'tok-1') throw new ApiError('expired', 401, 'unauthorized')
        return { ok: calls }
      },
    })
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    expect(r.mint).toHaveBeenCalledTimes(2)
    expect(r.port.responses()[0]).toMatchObject({ ok: true })
  })

  it('does not loop when the second attempt is also a 401', async () => {
    const r = rig({ send: async () => { throw new ApiError('no', 401, 'unauthorized') } })
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    expect(r.send).toHaveBeenCalledTimes(2)
    expect(r.port.responses()[0]).toMatchObject({ ok: false, error: { code: 'unauthorized', status: 401 } })
  })

  it('never puts a token on the port', async () => {
    const r = rig()
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    expect(JSON.stringify(r.port.sent)).not.toContain('tok-')
  })

  it('rejects an unusable token from the server', async () => {
    const r = rig()
    r.mint.mockResolvedValueOnce({ token: '', expiresAt: 'nonsense' })
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    expect(r.port.responses()[0]).toMatchObject({ ok: false, error: { code: 'network_error' } })
    expect(r.send).not.toHaveBeenCalled()
  })

  it('does not keep a token that finished minting after dispose', async () => {
    let finish: (v: { token: string; expiresAt: string }) => void = () => {}
    const r = rig()
    r.mint.mockImplementationOnce(() => new Promise((res) => { finish = res }))
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    r.broker.dispose()
    finish({ token: 'late', expiresAt: new Date(r.clock.t + 300_000).toISOString() })
    await flush()
    expect(r.send).not.toHaveBeenCalled()
  })
})

describe('errors', () => {
  it('maps an ApiError to its payload, with issues', async () => {
    const r = rig({
      send: async () => { throw new ApiError('bad', 400, 'validation_failed', [{ path: ['a', 0], message: 'nope' }]) },
    })
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    expect(r.port.responses()[0]).toMatchObject({
      ok: false, error: { code: 'validation_failed', status: 400, issues: [{ path: ['a', 0], message: 'nope' }] },
    })
  })

  it('hides the text of a network failure', async () => {
    const r = rig({ send: async () => { throw new TypeError('connect ECONNREFUSED 10.0.0.5:3000') } })
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    const res = r.port.responses()[0]
    expect(res).toMatchObject({ ok: false, error: { code: 'network_error' } })
    expect(JSON.stringify(res)).not.toContain('10.0.0.5')
  })

  it('aborts the network call on cancel and sends nothing back', async () => {
    let seen: AbortSignal | undefined
    const r = rig({ send: (req) => new Promise((_, rej) => {
      seen = req.signal
      req.signal.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))
    }) })
    r.port.frame({ type: 'request', id: 1, method: 'PUT', path: '/p/test.fixture/x', body: {} })
    await flush()
    r.port.frame({ type: 'cancel', id: 1 })
    await flush()
    expect(seen?.aborted).toBe(true)
    expect(r.port.responses()).toEqual([])
  })
})

describe('the shared cache', () => {
  it('answers a repeated read from the cache', async () => {
    const r = rig()
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    r.port.frame(get(2, '/core/transactions/a'))
    await flush()
    expect(r.send).toHaveBeenCalledOnce()
    expect(r.port.responses()).toHaveLength(2)
  })

  it('is shared with the host: a read the host made is a hit', async () => {
    const r = rig()
    await r.cache.read('u1', 'GET /core/transactions/a', async () => ({ rows: ['host'] }))
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    expect(r.send).not.toHaveBeenCalled()
    expect(r.port.responses()[0]).toMatchObject({ ok: true, value: { rows: ['host'] } })
  })

  it('is not read from another user\'s bucket', async () => {
    const r = rig()
    await r.cache.read('u2', 'GET /core/transactions/a', async () => ({ rows: ['other user'] }))
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    expect(r.send).toHaveBeenCalledOnce()
    expect(JSON.stringify(r.port.sent)).not.toContain('other user')
  })

  it('is bypassed on request by no-store, and refilled', async () => {
    const r = rig()
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    r.port.frame(get(2, '/core/transactions/a', 'no-store'))
    await flush()
    expect(r.send).toHaveBeenCalledTimes(2)
  })

  it('is emptied by a write', async () => {
    const r = rig()
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    r.port.frame({ type: 'request', id: 2, method: 'POST', path: '/p/test.fixture/x', body: {} })
    await flush()
    r.port.frame(get(3, '/core/transactions/a'))
    await flush()
    expect(r.send.mock.calls.filter(([q]) => (q as BrokerRequest).method === 'GET')).toHaveLength(2)
  })

  it('gives each caller its own copy', async () => {
    const r = rig({ send: async () => ({ rows: [1] }) })
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    const first = r.port.responses()[0]
    if (first?.ok) (first.value as { rows: number[] }).rows.push(2)
    r.port.frame(get(2, '/core/transactions/a'))
    await flush()
    expect(r.port.responses()[1]).toMatchObject({ ok: true, value: { rows: [1] } })
  })
})

describe('user change', () => {
  it('ends the connection and sends no request when the active user is not the frame\'s user', async () => {
    const r = rig()
    r.user = 'u2'
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    expect(r.send).not.toHaveBeenCalled()
    expect(r.mint).not.toHaveBeenCalled()
    expect(r.handlers.onFatal).toHaveBeenCalledOnce()
    expect(r.port.closed).toBe(true)
    expect(r.port.responses()).toEqual([])
  })

  it('treats a signed-out host the same way', async () => {
    const r = rig()
    r.user = null
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    expect(r.handlers.onFatal).toHaveBeenCalled()
  })

  it('drops the token and ignores everything after dispose', async () => {
    const r = rig()
    r.port.frame(get(1, '/core/transactions/a'))
    await flush()
    r.broker.dispose()
    r.port.onmessage?.({ data: get(2, '/core/transactions/b') } as MessageEvent)
    await flush()
    expect(r.send).toHaveBeenCalledOnce()
    expect(r.broker.connected).toBe(false)
    expect(r.broker.attach(asPort(new FakePort()), init)).toBe(false)
  })
})

describe('re-handshake', () => {
  it('replaces the port, cancels the old one\'s requests and ignores the old port afterwards', async () => {
    let seen: AbortSignal | undefined
    const r = rig({ send: (req) => new Promise((_, rej) => {
      seen = req.signal
      req.signal.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))
    }) })
    r.port.frame({ type: 'request', id: 1, method: 'PUT', path: '/p/test.fixture/x', body: {} })
    await flush()
    const next = new FakePort()
    expect(r.broker.attach(asPort(next), init)).toBe(true)
    await flush()
    expect(seen?.aborted).toBe(true)
    expect(r.port.closed).toBe(true)
    next.frame({ type: 'ready', protocol: 1 })
    expect(next.sent[0]).toEqual(init())
  })

  it('does not reset the rate limit', () => {
    const r = rig({ limits: { burst: 2, perSecond: 0.001, maxStrikes: 1000 } })
    r.port.frame({ type: 'resize', height: 1 })
    r.port.frame({ type: 'resize', height: 1 })
    const next = new FakePort()
    r.broker.attach(asPort(next), init)
    next.frame({ type: 'ready', protocol: 1 })
    next.frame({ type: 'resize', height: 1 })
    next.frame({ type: 'resize', height: 1 })
    expect(r.handlers.onResize).toHaveBeenCalledTimes(2)
  })

  it('cuts off a frame that keeps re-handshaking', () => {
    const r = rig({ limits: { maxHandshakes: 3 } })
    for (let i = 0; i < 4; i++) r.broker.attach(asPort(new FakePort()), init)
    expect(r.handlers.onFatal).toHaveBeenCalledOnce()
  })
})

describe('closing', () => {
  it('tells the frame, keeps serving request and cancel for the grace period, then ends the connection', async () => {
    const r = rig({ limits: { closingGraceMs: 40 } })
    r.broker.close()
    expect(r.port.sent.at(-1)).toEqual({ type: 'closing' })
    expect(r.port.closed).toBe(false)
    // The frame still alive gives its upload back through the plugin's own namespace.
    r.port.frame({ type: 'request', id: 1, method: 'POST', path: '/p/test.fixture/upload/abort', body: { uploadId: 'x' } })
    await flush()
    expect(r.port.responses()).toEqual([{ type: 'response', id: 1, ok: true, value: { rows: [] } }])
    await new Promise((resolve) => { setTimeout(resolve, 80) })
    expect(r.port.closed).toBe(true)
    r.port.frame(get(2, '/core/transactions'))
    await flush()
    expect(r.port.responses()).toHaveLength(1)
  })

  it('serves nothing but request and cancel while closing', () => {
    const r = rig({ limits: { closingGraceMs: 10_000 } })
    r.broker.close()
    r.port.frame({ type: 'navigate', path: '/accounts' })
    r.port.frame({ type: 'modal', open: true })
    r.port.frame({ type: 'resize', height: 300 })
    r.port.frame({ type: 'focus-out', direction: 'next' })
    r.port.frame({ type: 'notify', id: 9, level: 'info', message: 'late' })
    expect(r.handlers.onNavigate).not.toHaveBeenCalled()
    expect(r.handlers.onModal).not.toHaveBeenCalled()
    expect(r.handlers.onResize).not.toHaveBeenCalled()
    expect(r.handlers.onFocusOut).not.toHaveBeenCalled()
    expect(r.port.responses()).toEqual([])
    r.broker.dispose()
  })

  it('still checks grants while closing', async () => {
    const r = rig({ limits: { closingGraceMs: 10_000 } })
    r.broker.close()
    r.port.frame(get(1, '/core/accounts/summary'))
    await flush()
    expect(r.port.responses()[0]).toMatchObject({ id: 1, ok: false, error: { code: 'grant_denied' } })
    r.broker.dispose()
  })

  it('is disposed at once when no frame has connected, and is safe to call twice', () => {
    const r = rig({ handshake: false })
    r.broker.close()
    expect(r.port.closed).toBe(true)
    expect(r.port.sent).toEqual([])
    r.broker.close()
  })

  it('dispose ends it immediately', () => {
    const r = rig({ limits: { closingGraceMs: 10_000 } })
    r.broker.close()
    r.broker.dispose()
    expect(r.port.closed).toBe(true)
  })
})

describe('notify', () => {
  const withNotify = { ...manifest, permissions: ['notify'] } as unknown as PluginManifest
  /** A rig whose manifest declares `notify` (the default one declares nothing). */
  function notifyRig(limits?: BrokerOptions['limits']): Rig {
    const clock = { t: 1_000_000 }
    const handlers = { onReady: vi.fn(), onResize: vi.fn(), onNavigate: vi.fn(), onFocusOut: vi.fn(), onModal: vi.fn(), onNotify: vi.fn(), onFatal: vi.fn() }
    const api: BrokerApi = { mint: vi.fn(), send: vi.fn() }
    const cache = new ResponseCache({ now: () => clock.t })
    const broker = new PluginBroker({
      manifest: withNotify, userId: 'u1', api, activeUserId: () => 'u1', cache, handlers, now: () => clock.t,
      ...(limits ? { limits } : {}),
    })
    const port = new FakePort()
    broker.attach(asPort(port), init)
    port.frame({ type: 'ready', protocol: 1 })
    return { broker, port, handlers, mint: api.mint, send: api.send, cache, clock, user: 'u1' } as unknown as Rig
  }
  const note = (id: number, message: string, level = 'info') => ({ type: 'notify', id, level, message })

  it('shows an accepted notification once, cleaned, with its level, and answers ok', () => {
    const r = notifyRig()
    r.port.frame(note(1, '  Imported\n12 rows ', 'success'))
    expect(r.handlers.onNotify).toHaveBeenCalledOnce()
    expect(r.handlers.onNotify).toHaveBeenCalledWith('success', 'Imported 12 rows')
    expect(r.port.responses()).toEqual([{ type: 'response', id: 1, ok: true, value: null }])
  })

  it('refuses a plugin whose manifest does not declare notify, with grant_denied, and counts a strike', () => {
    const r = rig()
    r.port.frame(note(4, 'hi'))
    expect(r.handlers.onNotify).not.toHaveBeenCalled()
    expect(r.port.responses()[0]).toMatchObject({ id: 4, ok: false, error: { code: 'grant_denied' } })
  })

  it('a manifest that lists other permissions but not notify is still refused', () => {
    const r = notifyRig()
    const other = { ...manifest, permissions: ['network:outbound'] } as unknown as PluginManifest
    const broker = new PluginBroker({ manifest: other, userId: 'u1', api: { mint: vi.fn(), send: vi.fn() }, activeUserId: () => 'u1', cache: r.cache, handlers: r.handlers as unknown as BrokerHandlers })
    const port = new FakePort()
    broker.attach(asPort(port), init)
    port.frame({ type: 'ready', protocol: 1 })
    port.frame(note(1, 'hi'))
    expect(port.responses()[0]).toMatchObject({ ok: false, error: { code: 'grant_denied' } })
    expect(r.handlers.onNotify).not.toHaveBeenCalled()
  })

  it('refuses text over 200 characters, and text that is empty once cleaned, with invalid_request', () => {
    const r = notifyRig()
    r.port.frame(note(1, 'x'.repeat(201)))
    r.port.frame(note(2, '\n\t \u202e'))
    r.port.frame(note(3, 'x'.repeat(200)))
    expect(r.port.responses().map((m) => (m.ok ? 'ok' : m.error.code))).toEqual(['invalid_request', 'invalid_request', 'ok'])
    expect(r.handlers.onNotify).toHaveBeenCalledOnce()
  })

  it('drops a message the validator refuses (over 500, bad level) without calling the handler', () => {
    const r = notifyRig()
    r.port.frame(note(1, 'x'.repeat(501)))
    r.port.frame(note(2, 'hi', 'fatal'))
    r.port.frame({ type: 'notify', id: 3, level: 'info', message: 5 })
    r.port.frame({ type: 'notify', level: 'info', message: 'no id' })
    expect(r.handlers.onNotify).not.toHaveBeenCalled()
  })

  it('allows 3 in a burst and then a notification every 3.3 s; the rest are dropped with a 429 and a strike', () => {
    const r = notifyRig()
    for (let i = 1; i <= 6; i += 1) r.port.frame(note(i, `message ${i}`))
    expect(r.handlers.onNotify).toHaveBeenCalledTimes(3)
    const replies = r.port.responses()
    expect(replies.map((m) => (m.ok ? 'ok' : `${m.error.code} ${String(m.error.status)}`))).toEqual(['ok', 'ok', 'ok', 'request_failed 429', 'request_failed 429', 'request_failed 429'])
    r.clock.t += 3400
    r.port.frame(note(7, 'message 7'))
    expect(r.handlers.onNotify).toHaveBeenCalledTimes(4)
  })

  it('drops the same text again inside 30 s, then allows it', () => {
    const r = notifyRig()
    r.port.frame(note(1, 'Saved'))
    r.clock.t += 5000
    r.port.frame(note(2, 'Saved'))
    r.port.frame(note(3, 'Saved\n')) // the same text once cleaned
    expect(r.handlers.onNotify).toHaveBeenCalledTimes(1)
    expect(r.port.responses().map((m) => (m.ok ? 'ok' : String(m.error.status)))).toEqual(['ok', '429', '429'])
    r.clock.t += 31_000
    r.port.frame(note(4, 'Saved'))
    expect(r.handlers.onNotify).toHaveBeenCalledTimes(2)
  })

  it('a refused notification does not use up the burst', () => {
    const r = notifyRig()
    for (let i = 1; i <= 5; i += 1) r.port.frame(note(i, 'x'.repeat(300)))
    for (let i = 6; i <= 8; i += 1) r.port.frame(note(i, `fine ${i}`))
    expect(r.handlers.onNotify).toHaveBeenCalledTimes(3)
  })

  it('spam ends the connection by strikes, like any other abuse', () => {
    const r = notifyRig({ maxStrikes: 10, burst: 1000 })
    for (let i = 1; i <= 12; i += 1) r.port.frame(note(i, 'same text'))
    expect(r.handlers.onFatal).toHaveBeenCalledOnce()
    expect(r.handlers.onNotify).toHaveBeenCalledOnce()
  })

  it('answers a notify the general limiter drops, so the frame is not left waiting', () => {
    const r = notifyRig({ burst: 1, perSecond: 0.001 })
    r.port.frame(note(1, 'one'))
    r.port.frame(note(2, 'two'))
    expect(r.port.responses()[1]).toMatchObject({ id: 2, ok: false, error: { code: 'request_failed', status: 429 } })
  })
})

describe('download', () => {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]
  const buf = (bytes: readonly number[]): ArrayBuffer => new Uint8Array(bytes).buffer
  /** Built from a plain Uint8Array: jsdom's TextEncoder hands back a buffer from another realm, which the parser rightly refuses. */
  const text = (s: string): ArrayBuffer => new Uint8Array(Array.from(s, (ch) => ch.charCodeAt(0))).buffer
  const dl = (id: number, over: Record<string, unknown> = {}) =>
    ({ type: 'download', id, filename: 'share', mime: 'image/png', data: buf(PNG), ...over })

  /** A rig for `download`: bundled unless said otherwise, with a gesture unless said otherwise. */
  function dlRig(opts: { bundled?: boolean | undefined; gesture?: boolean; limits?: BrokerOptions['limits']; omitHandlers?: boolean } = {}) {
    const clock = { t: 1_000_000 }
    const gesture = { on: opts.gesture ?? true }
    const handlers = {
      onReady: vi.fn(), onResize: vi.fn(), onNavigate: vi.fn(), onFocusOut: vi.fn(), onModal: vi.fn(), onNotify: vi.fn(), onFatal: vi.fn(),
      canDownload: vi.fn(() => gesture.on), onDownload: vi.fn(),
    }
    const api: BrokerApi = { mint: vi.fn(), send: vi.fn() }
    const cache = new ResponseCache({ now: () => clock.t })
    const given: BrokerHandlers = opts.omitHandlers === true
      ? { onReady: handlers.onReady, onResize: handlers.onResize, onNavigate: handlers.onNavigate, onFocusOut: handlers.onFocusOut, onModal: handlers.onModal, onNotify: handlers.onNotify, onFatal: handlers.onFatal }
      : handlers
    const broker = new PluginBroker({
      manifest, userId: 'u1', api, activeUserId: () => 'u1', cache, handlers: given, now: () => clock.t,
      ...('bundled' in opts ? (opts.bundled === undefined ? {} : { bundled: opts.bundled }) : { bundled: true }),
      ...(opts.limits ? { limits: opts.limits } : {}),
    })
    const port = new FakePort()
    broker.attach(asPort(port), init)
    port.frame({ type: 'ready', protocol: 1 })
    return { broker, port, handlers, clock, gesture }
  }
  const err = (r: ReturnType<typeof dlRig>, index = 0) => (r.port.responses()[index] as { error?: { code: string } }).error?.code

  it('saves a checked file once, with the host name, and answers with that name', () => {
    const r = dlRig()
    r.port.frame(dl(1, { filename: 'My Share.jpg' }))
    expect(r.handlers.onDownload).toHaveBeenCalledOnce()
    const file = r.handlers.onDownload.mock.calls[0]![0] as { filename: string; mime: string; bytes: Uint8Array }
    expect(file).toMatchObject({ filename: 'My Share.png', mime: 'image/png' })
    expect(Array.from(file.bytes)).toEqual(PNG)
    expect(r.port.responses()).toEqual([{ type: 'response', id: 1, ok: true, value: { filename: 'My Share.png' } }])
  })

  it('pins the refusal of a plugin that is not bundled: grant_denied, nothing saved, a strike', () => {
    for (const bundled of [false, undefined]) {
      const r = dlRig({ bundled })
      r.port.frame(dl(1))
      expect(err(r)).toBe('grant_denied')
      expect(r.handlers.onDownload).not.toHaveBeenCalled()
      expect(r.handlers.canDownload).not.toHaveBeenCalled()
    }
  })

  it('a plugin that is not bundled is cut off by repeated attempts, like any other refused message', () => {
    const r = dlRig({ bundled: false, limits: { maxStrikes: 10, burst: 1000 } })
    for (let i = 1; i <= 12; i += 1) r.port.frame(dl(i))
    expect(r.handlers.onFatal).toHaveBeenCalledOnce()
    expect(r.handlers.onDownload).not.toHaveBeenCalled()
  })

  it('does not look at the gesture for a file that is refused on its own merits', () => {
    const r = dlRig({ gesture: true })
    r.port.frame(dl(1, { mime: 'text/html', data: text('<p>x</p>') }))
    expect(err(r)).toBe('file_type_not_allowed')
    expect(r.handlers.canDownload).not.toHaveBeenCalled()
  })

  it.each([
    ['file_type_not_allowed', { mime: 'image/svg+xml', data: text('<svg/>') }],
    ['file_type_not_allowed', { mime: 'toString', data: text('x') }],
    ['file_type_not_allowed', { mime: '__proto__', data: text('x') }],
    ['file_invalid', { mime: 'image/png', data: buf([1, 2, 3]) }],
    ['file_invalid', { mime: 'text/csv', data: text('<!DOCTYPE html><html></html>') }],
    ['file_invalid', { mime: 'application/json', data: text('{nope') }],
    ['file_invalid', { mime: 'text/plain', data: new ArrayBuffer(0) }],
    ['file_too_large', { mime: 'text/plain', data: new ArrayBuffer(5 * 1024 * 1024 + 1) }],
  ])('refuses with %s', (code, over) => {
    const r = dlRig()
    r.port.frame(dl(1, over))
    expect(err(r)).toBe(code)
    expect(r.handlers.onDownload).not.toHaveBeenCalled()
  })

  it('refuses without a gesture, and a missing canDownload handler counts as no gesture', () => {
    const a = dlRig({ gesture: false })
    a.port.frame(dl(1))
    expect(err(a)).toBe('gesture_required')
    expect(a.handlers.onDownload).not.toHaveBeenCalled()
    const b = dlRig({ omitHandlers: true })
    b.port.frame(dl(1))
    expect(err(b)).toBe('gesture_required')
  })

  it('allows one file per 5 seconds: a refused gesture does not spend the allowance, a saved file does', () => {
    const r = dlRig({ gesture: false })
    r.port.frame(dl(1))
    r.port.frame(dl(2))
    r.gesture.on = true
    r.port.frame(dl(3))
    expect(r.handlers.onDownload).toHaveBeenCalledOnce()
    r.port.frame(dl(4))
    expect(err(r, 3)).toBe('rate_limited')
    r.clock.t += 4_000
    r.port.frame(dl(5))
    expect(err(r, 4)).toBe('rate_limited')
    r.clock.t += 1_100
    r.port.frame(dl(6))
    expect(r.handlers.onDownload).toHaveBeenCalledTimes(2)
  })

  it('ignores a download after closing was sent, like the other non-request messages', () => {
    const r = dlRig()
    r.broker.close()
    r.port.frame(dl(1))
    expect(r.handlers.onDownload).not.toHaveBeenCalled()
    expect(r.port.responses()).toEqual([])
  })

  it('answers a download that the general limiter drops, so the frame is not left waiting', () => {
    const r = dlRig({ limits: { burst: 1, perSecond: 0.001 } })
    r.port.frame(dl(1))
    r.port.frame(dl(2))
    expect(r.port.responses()[1]).toMatchObject({ id: 2, ok: false, error: { code: 'request_failed', status: 429 } })
  })

  it('treats a malformed download as a strike, not a crash', () => {
    const r = dlRig()
    r.port.frame({ type: 'download', id: 1, filename: 'a', mime: 'text/plain', data: 'not a buffer' })
    r.port.frame({ type: 'download', filename: 'a', mime: 'text/plain', data: new ArrayBuffer(1) })
    expect(r.handlers.onDownload).not.toHaveBeenCalled()
    expect(r.port.responses()).toEqual([])
  })
})
