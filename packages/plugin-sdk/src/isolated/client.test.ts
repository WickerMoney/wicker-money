import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectOverPort, connectToHost } from './client.js'
import type { HandshakeEvent, HandshakeWindow, HostConnection } from './client.js'
import { PluginApiError } from './PluginApiError.js'
import { applyHostTheme } from './theme.js'
import { formatDateIn, formatMoneyIn } from './format.js'
import type { HostMessage, PluginMessage } from './protocol.js'
import { parsePluginMessage } from './validate.js'

const theme = { scheme: 'light', tokens: { '--surface': '#fff', '--ink': '#111' } } as const
const init = {
  type: 'init', protocol: 1, pluginId: 'wickermoney.insights', kind: 'widget',
  session: { userId: 'u1', email: 'a@b.test', timezone: 'Europe/London' },
  locale: { locale: 'en-GB', timezone: 'Europe/London' }, theme, size: 'md',
} as const

/** A fake root element that records what the theme helper writes. */
function fakeRoot() {
  const props = new Map<string, string>()
  const attrs = new Map<string, string>()
  return {
    props, attrs,
    setAttribute: (n: string, v: string) => { attrs.set(n, v) },
    style: { setProperty: (n: string, v: string) => { props.set(n, v) }, removeProperty: (n: string) => { props.delete(n) } },
  }
}

const ports: MessagePort[] = []
afterEach(() => { for (const p of ports.splice(0)) p.close() })

/** A frame wired to a scripted host. `host` receives validated frame messages and the raw port to answer on. */
async function connect(onMessage: (msg: PluginMessage, reply: (m: HostMessage | object) => void) => void = () => {}) {
  const { port1: hostPort, port2: framePort } = new MessageChannel()
  ports.push(hostPort, framePort)
  const seen: PluginMessage[] = []
  const reply = (m: HostMessage | object): void => hostPort.postMessage(m)
  hostPort.addEventListener('message', (e: MessageEvent) => {
    const msg = parsePluginMessage(e.data)
    if (msg === null) return
    if (msg.type === 'ready') { reply(init); return }
    seen.push(msg)
    onMessage(msg, reply)
  })
  hostPort.start()
  const root = fakeRoot()
  const conn = await connectOverPort(framePort, 1, { themeRoot: root })
  return { conn, seen, reply, root }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 5))

describe('connectOverPort', () => {
  it('sends ready, waits for init, and applies the theme', async () => {
    const { conn, root } = await connect()
    expect(conn.getState()).toMatchObject({ pluginId: 'wickermoney.insights', kind: 'widget', size: 'md' })
    expect(root.attrs.get('data-theme')).toBe('light')
    expect(root.props.get('--surface')).toBe('#fff')
    expect(conn.ctx.session).toEqual(init.session)
  })

  it('rejects when the host never sends init', async () => {
    const { port2 } = new MessageChannel()
    ports.push(port2)
    await expect(connectOverPort(port2, 1, { timeoutMs: 20, themeRoot: null })).rejects.toMatchObject({ code: 'disconnected' })
  })
})

describe('ctx.api over the port', () => {
  it('sends a request and resolves with the value', async () => {
    const { conn, seen } = await connect((m, reply) => {
      if (m.type === 'request') reply({ type: 'response', id: m.id, ok: true, value: { rows: [1, 2] } })
    })
    await expect(conn.ctx.api.get('/core/transactions?x=1')).resolves.toEqual({ rows: [1, 2] })
    expect(seen[0]).toEqual({ type: 'request', id: 1, method: 'GET', path: '/core/transactions?x=1' })
  })

  it.each([
    ['post', 'POST'], ['put', 'PUT'],
  ] as const)('%s sends a JSON body', async (fn, method) => {
    const { conn, seen } = await connect((m, reply) => {
      if (m.type === 'request') reply({ type: 'response', id: m.id, ok: true, value: null })
    })
    await conn.ctx.api[fn]('/p/x/y', { amount: '1.2000', at: new Date(0) })
    expect(seen[0]).toMatchObject({ method, path: '/p/x/y', body: { amount: '1.2000', at: '1970-01-01T00:00:00.000Z' } })
  })

  it('del sends DELETE with no body', async () => {
    const { conn, seen } = await connect((m, reply) => {
      if (m.type === 'request') reply({ type: 'response', id: m.id, ok: true, value: null })
    })
    await conn.ctx.api.del('/p/x/y/1')
    expect(seen[0]).toEqual({ type: 'request', id: 1, method: 'DELETE', path: '/p/x/y/1' })
  })

  it('passes the cache mode through', async () => {
    const { conn, seen } = await connect((m, reply) => {
      if (m.type === 'request') reply({ type: 'response', id: m.id, ok: true, value: 1 })
    })
    await conn.ctx.api.get('/core/accounts', { cache: 'no-store' })
    expect(seen[0]).toMatchObject({ cache: 'no-store' })
  })

  it('matches concurrent responses to their requests', async () => {
    const held: ((v: unknown) => void)[] = []
    const { conn } = await connect((m, reply) => {
      if (m.type === 'request') held.push((value) => reply({ type: 'response', id: m.id, ok: true, value }))
    })
    const a = conn.ctx.api.get<string>('/a')
    const b = conn.ctx.api.get<string>('/b')
    await tick()
    held[1]?.('for b')
    held[0]?.('for a')
    await expect(Promise.all([a, b])).resolves.toEqual(['for a', 'for b'])
  })

  it('rejects with a PluginApiError carrying status, code and issues', async () => {
    const error = { code: 'validation_failed', message: 'Fix it', status: 400, issues: [{ path: ['name'], message: 'Required' }] }
    const { conn } = await connect((m, reply) => {
      if (m.type === 'request') reply({ type: 'response', id: m.id, ok: false, error })
    })
    const err = await conn.ctx.api.post('/p/x/y', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PluginApiError)
    expect(err).toMatchObject({ name: 'PluginApiError', message: 'Fix it', status: 400, code: 'validation_failed', issues: error.issues })
  })

  it('gives status 0 and no issues when the failure had no HTTP response', async () => {
    const { conn } = await connect((m, reply) => {
      if (m.type === 'request') reply({ type: 'response', id: m.id, ok: false, error: { code: 'grant_denied', message: 'No grant for accounts.' } })
    })
    await expect(conn.ctx.api.get('/core/accounts')).rejects.toMatchObject({ status: 0, code: 'grant_denied', issues: [] })
  })

  it('aborts: rejects as AbortError and tells the host to cancel', async () => {
    const { conn, seen } = await connect()
    const ctl = new AbortController()
    const p = conn.ctx.api.get('/core/transactions', { signal: ctl.signal })
    await tick()
    ctl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError', code: 'aborted' })
    await tick()
    expect(seen.map((m) => m.type)).toEqual(['request', 'cancel'])
  })

  it('rejects at once for a signal already aborted, sending nothing', async () => {
    const { conn, seen } = await connect()
    const ctl = new AbortController()
    ctl.abort()
    await expect(conn.ctx.api.get('/a', { signal: ctl.signal })).rejects.toMatchObject({ code: 'aborted' })
    await tick()
    expect(seen).toEqual([])
  })

  it('ignores a late answer to an aborted request', async () => {
    let answer: (() => void) | undefined
    const { conn } = await connect((m, reply) => {
      if (m.type === 'request') answer = () => reply({ type: 'response', id: m.id, ok: true, value: 1 })
    })
    const ctl = new AbortController()
    const p = conn.ctx.api.get('/a', { signal: ctl.signal })
    await tick()
    ctl.abort()
    await p.catch(() => undefined)
    expect(() => answer?.()).not.toThrow()
    await tick()
  })

  it.each([
    ['a path without a leading slash', 'core/accounts'],
    ['a protocol-relative path', '//evil.test/x'],
    ['the /api prefix', '/api/v1/core/accounts'],
  ])('refuses %s before sending', async (_n, path) => {
    const { conn, seen } = await connect()
    await expect(conn.ctx.api.get(path)).rejects.toMatchObject({ code: 'invalid_request' })
    await tick()
    expect(seen).toEqual([])
  })

  it('refuses RequestInit options that cannot cross the channel', async () => {
    const { conn, seen } = await connect()
    await expect(conn.ctx.api.get('/a', { headers: { 'x-wickermoney-plugin': 'other' } }))
      .rejects.toMatchObject({ code: 'invalid_request', message: expect.stringContaining('headers') })
    await expect(conn.ctx.api.get('/a', { credentials: 'include' })).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(conn.ctx.api.get('/a', { cache: 'force-cache' })).rejects.toMatchObject({ code: 'invalid_request' })
    await tick()
    expect(seen).toEqual([])
  })

  it('refuses a body that is not JSON-serialisable', async () => {
    const { conn } = await connect()
    await expect(conn.ctx.api.post('/a', { n: 1n })).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('rejects pending calls with disconnected on dispose, and refuses new ones', async () => {
    const { conn } = await connect()
    const p = conn.ctx.api.get('/a')
    await tick()
    conn.dispose()
    await expect(p).rejects.toMatchObject({ code: 'disconnected' })
    await expect(conn.ctx.api.get('/b')).rejects.toMatchObject({ code: 'disconnected' })
  })
})

describe('host to frame updates', () => {
  it('applies a new theme, removing tokens it no longer defines', async () => {
    const { conn, reply, root } = await connect()
    reply({ type: 'theme', theme: { scheme: 'dark', tokens: { '--surface': '#000' } } })
    await tick()
    expect(root.attrs.get('data-theme')).toBe('dark')
    expect(root.props.get('--surface')).toBe('#000')
    expect(root.props.has('--ink')).toBe(false)
    expect(conn.getState().theme.scheme).toBe('dark')
  })

  it('updates locale (formatting and session time zone) and notifies listeners', async () => {
    const { conn, reply } = await connect()
    const seen: string[] = []
    conn.subscribe((c) => seen.push(c.type))
    reply({ type: 'locale', locale: { locale: 'de-DE', timezone: 'Europe/Berlin' } })
    await tick()
    expect(conn.ctx.formatMoney('1234.5600', 'EUR')).toBe(formatMoneyIn('de-DE', '1234.5600', 'EUR'))
    expect(conn.ctx.session.timezone).toBe('Europe/Berlin')
    expect(seen).toEqual(['locale'])
  })

  it('updates size and range, keeping what did not change', async () => {
    const { conn, reply } = await connect()
    const range = { key: '3m', label: '3 months', months: 3, from: '2026-08-01', to: '2026-11-01' }
    reply({ type: 'props', range })
    reply({ type: 'props', size: 'lg' })
    await tick()
    expect(conn.getState()).toMatchObject({ size: 'lg', range })
  })

  it('hands back a new state object on each change and stops notifying after unsubscribe', async () => {
    const { conn, reply } = await connect()
    const first = conn.getState()
    const listener = vi.fn()
    const off = conn.subscribe(listener)
    reply({ type: 'route', path: '/a' })
    await tick()
    expect(conn.getState()).not.toBe(first)
    expect(conn.getState().path).toBe('/a')
    off()
    reply({ type: 'route', path: '/b' })
    await tick()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('delivers focus-in, and ignores unknown and malformed messages', async () => {
    const { conn, reply } = await connect()
    const seen: unknown[] = []
    conn.subscribe((c) => seen.push(c))
    reply({ type: 'confetti' })
    reply({ type: 'theme', theme: { scheme: 'dark', tokens: { bad: 'x' } } })
    reply({ type: 'focus-in', direction: 'first' })
    await tick()
    expect(seen).toEqual([{ type: 'focus-in', direction: 'first' }])
  })
})

describe('frame to host helpers', () => {
  it('navigate, focusOut and notify send their messages', async () => {
    const { conn, seen } = await connect((m, reply) => {
      if (m.type === 'notify') reply({ type: 'response', id: m.id, ok: false, error: { code: 'not_supported', message: 'No notify yet.' } })
    })
    conn.ctx.navigate('/transactions')
    conn.focusOut('previous')
    await expect(conn.notify('info', 'Saved')).rejects.toMatchObject({ code: 'not_supported' })
    expect(seen).toEqual([
      { type: 'navigate', path: '/transactions' },
      { type: 'focus-out', direction: 'previous' },
      { type: 'notify', id: 1, level: 'info', message: 'Saved' },
    ])
  })

  it('reportSize rounds up and skips repeats and bad values', async () => {
    const { conn, seen } = await connect()
    conn.reportSize(120.2)
    conn.reportSize(121)
    conn.reportSize(121)
    conn.reportSize(NaN)
    conn.reportSize(-5)
    await tick()
    expect(seen).toEqual([{ type: 'resize', height: 121 }])
  })

  it('observeSize reports now and on each observer callback until stopped', async () => {
    const { conn, seen } = await connect()
    let height = 100
    let fire: () => void = () => {}
    let disconnected = false
    class FakeObserver {
      constructor(cb: () => void) { fire = cb }
      observe(): void {}
      disconnect(): void { disconnected = true }
    }
    const stop = conn.observeSize({ getBoundingClientRect: () => ({ height }) }, FakeObserver)
    height = 180
    fire()
    stop()
    await tick()
    expect(seen).toEqual([{ type: 'resize', height: 100 }, { type: 'resize', height: 180 }])
    expect(disconnected).toBe(true)
  })

  it('observeSize keeps polling without a ResizeObserver, and stops when disposed', async () => {
    vi.useFakeTimers()
    try {
      const { conn, seen } = await connect()
      let height = 100
      const stop = conn.observeSize({ getBoundingClientRect: () => ({ height }) })
      height = 240
      await vi.advanceTimersByTimeAsync(250)
      await vi.advanceTimersByTimeAsync(250)
      stop()
      height = 400
      await vi.advanceTimersByTimeAsync(1000)
      expect(seen).toEqual([{ type: 'resize', height: 100 }, { type: 'resize', height: 240 }])
    } finally { vi.useRealTimers() }
  })

  it('dispose stops observeSize: the poll timer and the ResizeObserver are released', async () => {
    vi.useFakeTimers()
    try {
      const { conn } = await connect()
      let disconnected = false
      class FakeObserver {
        constructor(_cb: () => void) {}
        observe(): void {}
        disconnect(): void { disconnected = true }
      }
      let reads = 0
      conn.observeSize({ getBoundingClientRect: () => { reads++; return { height: 100 } } }, FakeObserver)
      await vi.advanceTimersByTimeAsync(250)
      const before = reads
      conn.dispose()
      await vi.advanceTimersByTimeAsync(2000)
      expect(reads).toBe(before)
      expect(disconnected).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
      // A late call does not start a timer on a closed connection.
      conn.observeSize({ getBoundingClientRect: () => ({ height: 100 }) })()
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})

describe('connectToHost (window handshake)', () => {
  /** A stand-in window whose parent answers hello however the test says. */
  function fakeWindow() {
    let listener: ((e: HandshakeEvent) => void) | undefined
    const parent = { postMessage: vi.fn<(m: unknown, o: string) => void>() }
    const win: HandshakeWindow = {
      parent,
      addEventListener: (_t, l) => { listener = l },
      removeEventListener: () => { listener = undefined },
    }
    return { win, parent, deliver: (e: HandshakeEvent) => listener?.(e), attached: () => listener !== undefined }
  }

  it('says hello to the parent, then connects over the port the parent sends', async () => {
    const { win, parent, deliver } = fakeWindow()
    const { port1: hostPort, port2: framePort } = new MessageChannel()
    ports.push(hostPort, framePort)
    hostPort.addEventListener('message', (e: MessageEvent) => {
      if (parsePluginMessage(e.data)?.type === 'ready') hostPort.postMessage(init)
    })
    hostPort.start()

    const connecting = connectToHost({ themeRoot: null }, win)
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'wm.hello', protocols: [1] }, '*')
    deliver({ source: parent, data: { type: 'wm.connect', protocol: 1 }, ports: [framePort] })
    const conn: HostConnection = await connecting
    expect(conn.getState().pluginId).toBe('wickermoney.insights')
  })

  it('ignores a connect from any window but the parent', async () => {
    const { win, parent, deliver, attached } = fakeWindow()
    const { port2: framePort } = new MessageChannel()
    ports.push(framePort)
    const connecting = connectToHost({ timeoutMs: 30, themeRoot: null }, win)
    deliver({ source: {}, data: { type: 'wm.connect', protocol: 1 }, ports: [framePort] })
    expect(attached()).toBe(true)
    await expect(connecting).rejects.toMatchObject({ code: 'disconnected' })
    expect(parent.postMessage).toHaveBeenCalledTimes(1)
  })

  it('rejects a connect that carries no port, and a protocol it does not speak', async () => {
    const a = fakeWindow()
    const noPort = connectToHost({ themeRoot: null }, a.win)
    a.deliver({ source: a.parent, data: { type: 'wm.connect', protocol: 1 }, ports: [] })
    await expect(noPort).rejects.toMatchObject({ code: 'invalid_request' })

    const b = fakeWindow()
    const { port2 } = new MessageChannel()
    ports.push(port2)
    const wrong = connectToHost({ themeRoot: null }, b.win)
    b.deliver({ source: b.parent, data: { type: 'wm.connect', protocol: 99 }, ports: [port2] })
    await expect(wrong).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('rejects on refuse, naming the versions', async () => {
    const { win, parent, deliver } = fakeWindow()
    const connecting = connectToHost({ themeRoot: null }, win)
    deliver({ source: parent, data: { type: 'wm.refuse', supported: [2, 3] }, ports: [] })
    await expect(connecting).rejects.toMatchObject({ code: 'invalid_request', message: expect.stringContaining('2, 3') })
  })

  it('times out when the host never answers', async () => {
    const { win } = fakeWindow()
    await expect(connectToHost({ timeoutMs: 10, themeRoot: null }, win)).rejects.toMatchObject({ code: 'disconnected' })
  })
})

describe('applyHostTheme', () => {
  it('needs a root outside a browser', () => {
    expect(() => applyHostTheme(theme)).toThrow(TypeError)
  })
})

describe('formatters', () => {
  it('formatMoneyIn is exact beyond the precision of a number', () => {
    expect(formatMoneyIn('en-US', '9007199254740993.1250', 'USD')).toBe('$9,007,199,254,740,993.13')
    expect(formatMoneyIn('en-US', '-0.0040', 'USD')).toBe('$0.00')
    expect(formatMoneyIn('en-US', '-12.5', 'USD')).toBe('-$12.50')
  })

  it('formatMoneyIn follows the locale', () => {
    expect(formatMoneyIn('de-DE', '1234.5', 'EUR')).toBe(new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(1234.5))
  })

  it('formatDateIn shows a calendar date as that day in any locale', () => {
    expect(formatDateIn('en-US', '2026-10-01')).toBe('10/1/2026')
    expect(formatDateIn('en-GB', '2026-10-01')).toBe('01/10/2026')
  })
})
