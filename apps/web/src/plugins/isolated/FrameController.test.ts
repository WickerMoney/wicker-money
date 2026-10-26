import type { PluginManifest } from '@wickermoney/plugin-sdk'
import type { HostMessage, HostTheme } from '@wickermoney/plugin-sdk/isolated'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponseCache } from '../../api/responseCache.js'
import { FrameController, HEIGHT_LIMITS, type FrameEvents, type FrameState } from './FrameController.js'
import type { BrokerApi } from './brokerApi.js'

const manifest = {
  id: 'test.fixture', name: 'Fixture', version: '0.1.0', description: '', author: '', sdkVersion: 0,
  permissions: [], remoteEntry: '', requiredTables: [], contributes: { widgets: [], pages: [] },
} as unknown as PluginManifest

const api: BrokerApi = {
  mint: vi.fn(async () => ({ token: 't', expiresAt: new Date(Date.now() + 300_000).toISOString() })),
  send: vi.fn(async () => ({})),
}

/** A stand-in for the frame's window: records what the host posts to it. */
function fakeFrame() {
  const posted: Array<{ data: unknown; origin: string; ports: MessagePort[] }> = []
  const win = { postMessage: (data: unknown, origin: string, ports: MessagePort[] = []) => { posted.push({ data, origin, ports }) } }
  const iframe = { contentWindow: win, focus: vi.fn() } as unknown as HTMLIFrameElement
  return { win, iframe, posted }
}

const theme = (scheme: 'light' | 'dark', accent = '#123456'): HostTheme => ({ scheme, tokens: { '--wm-accent': accent } })

interface Setup {
  controller: FrameController
  states: FrameState[]
  heights: number[]
  events: FrameEvents
  frame: ReturnType<typeof fakeFrame>
  /** The frame's end of the channel, once connected. */
  port: MessagePort | null
  received: HostMessage[]
  hello(source?: unknown, data?: unknown): void
  currentTheme: { value: HostTheme }
}

function setup(kind: 'widget' | 'page' = 'widget', extra: { loadTimeoutMs?: number; path?: string } = {}): Setup {
  const frame = fakeFrame()
  const states: FrameState[] = []
  const heights: number[] = []
  const currentTheme = { value: theme('light') }
  const events: FrameEvents = {
    onState: (s) => states.push(s), onHeight: (h) => heights.push(h), onNavigate: vi.fn(), onFocusOut: vi.fn(), onModal: vi.fn(),
  }
  const controller = new FrameController({
    iframe: frame.iframe, manifest, userId: 'u1', email: 'u1@example.com', timezone: 'UTC', kind,
    ...(kind === 'widget' ? { size: 'md' as const } : {}),
    api, activeUserId: () => 'u1', cache: new ResponseCache(), events,
    readTheme: () => currentTheme.value, readLocale: () => ({ locale: 'en-US', timezone: 'UTC' }),
    ...extra,
  })
  const s: Setup = {
    controller, states, heights, events, frame, port: null, received: [], currentTheme,
    hello(source = frame.win, data = { type: 'wm.hello', protocols: [1] }) {
      window.dispatchEvent(new MessageEvent('message', { data, source: source as MessageEventSource }))
    },
  }
  return s
}

/** Connects the frame's side of the port the host transferred. */
function connect(s: Setup): MessagePort {
  s.hello()
  const sent = s.frame.posted.at(-1)!
  const port = sent.ports[0]!
  port.onmessage = (e) => { s.received.push(e.data as HostMessage) }
  s.port = port
  return port
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

beforeEach(() => { vi.mocked(api.send).mockClear() })
afterEach(() => { document.documentElement.removeAttribute('data-theme') })

describe('FrameController handshake', () => {
  it('replies to a hello from its own frame with a connect and a port', () => {
    const s = setup()
    s.hello()
    const [reply] = s.frame.posted
    expect(reply?.data).toEqual({ type: 'wm.connect', protocol: 1 })
    expect(reply?.origin).toBe('*')
    expect(reply?.ports).toHaveLength(1)
    s.controller.dispose()
  })

  it('ignores a hello from any other window', () => {
    const s = setup()
    s.hello({ postMessage: vi.fn() })
    s.hello(null)
    s.hello(window)
    expect(s.frame.posted).toEqual([])
    s.controller.dispose()
  })

  it('ignores messages that are not a hello', () => {
    const s = setup()
    s.hello(s.frame.win, { type: 'wm.hello', protocols: 'x' })
    s.hello(s.frame.win, { type: 'something' })
    s.hello(s.frame.win, 'hello')
    expect(s.frame.posted).toEqual([])
    s.controller.dispose()
  })

  it('refuses a protocol it does not speak and fails the frame', () => {
    const s = setup()
    s.hello(s.frame.win, { type: 'wm.hello', protocols: [7] })
    expect(s.frame.posted[0]?.data).toEqual({ type: 'wm.refuse', supported: [1] })
    expect(s.states.at(-1)).toMatchObject({ status: 'failed' })
    s.controller.dispose()
  })

  it('goes ready after ready/init, with the theme and locale in init', async () => {
    const s = setup()
    const port = connect(s)
    port.postMessage({ type: 'ready', protocol: 1 })
    await tick()
    expect(s.states.at(-1)).toEqual({ status: 'ready' })
    expect(s.received[0]).toMatchObject({
      type: 'init', pluginId: 'test.fixture', kind: 'widget', size: 'md',
      session: { userId: 'u1' }, theme: { scheme: 'light', tokens: { '--wm-accent': '#123456' } },
      locale: { locale: 'en-US', timezone: 'UTC' },
    })
    s.controller.dispose()
  })

  it('fails with a message when the frame never connects', () => {
    vi.useFakeTimers()
    const s = setup('widget', { loadTimeoutMs: 1000 })
    vi.advanceTimersByTime(1001)
    expect(s.states.at(-1)).toMatchObject({ status: 'failed' })
    vi.useRealTimers()
    s.controller.dispose()
  })

  describe('handshake clock and page visibility', () => {
    const setHidden = (hidden: boolean): void => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    afterEach(() => { setHidden(false); vi.useRealTimers() })

    it('does not run while the document is hidden and resumes with the time it had left', () => {
      vi.useFakeTimers()
      const s = setup('widget', { loadTimeoutMs: 1000 })
      vi.advanceTimersByTime(600)
      setHidden(true)
      vi.advanceTimersByTime(60_000)
      expect(s.states.at(-1)).toEqual({ status: 'loading' })
      setHidden(false)
      vi.advanceTimersByTime(399)
      expect(s.states.at(-1)).toEqual({ status: 'loading' })
      vi.advanceTimersByTime(2)
      expect(s.states.at(-1)).toMatchObject({ status: 'failed' })
      s.controller.dispose()
    })

    it('starts counting only when a frame created in a hidden tab becomes visible', () => {
      vi.useFakeTimers()
      setHidden(true)
      const s = setup('widget', { loadTimeoutMs: 1000 })
      vi.advanceTimersByTime(120_000)
      expect(s.states.at(-1)).toEqual({ status: 'loading' })
      setHidden(false)
      vi.advanceTimersByTime(1001)
      expect(s.states.at(-1)).toMatchObject({ status: 'failed' })
      s.controller.dispose()
    })

    it('stays quiet after the frame is ready, however the tab moves', async () => {
      vi.useFakeTimers()
      const s = setup('widget', { loadTimeoutMs: 1000 })
      const port = connect(s)
      port.postMessage({ type: 'ready', protocol: 1 })
      await vi.advanceTimersByTimeAsync(10)
      setHidden(true)
      setHidden(false)
      await vi.advanceTimersByTimeAsync(5000)
      expect(s.states.at(-1)).toEqual({ status: 'ready' })
      s.controller.dispose()
    })
  })

  it('logs a development hint that names the cause when the frame never connects', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    const s = setup('widget', { loadTimeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1001)
    expect(s.states.at(-1)).toMatchObject({ status: 'failed' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('WEB_DIST_DIR'))
    vi.useRealTimers()
    vi.unstubAllGlobals()
    warn.mockRestore()
    s.controller.dispose()
  })

  it('logs no hint when the frame connects in time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const s = setup('widget', { loadTimeoutMs: 40 })
    const port = connect(s)
    port.postMessage({ type: 'ready', protocol: 1 })
    await tick()
    await new Promise((resolve) => { setTimeout(resolve, 80) })
    expect(s.states.at(-1)).toEqual({ status: 'ready' })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
    s.controller.dispose()
  })

  it('stops listening after dispose', () => {
    const s = setup()
    s.controller.dispose()
    s.hello()
    expect(s.frame.posted).toEqual([])
  })
})

describe('sizing', () => {
  it('clamps a widget to its minimum and maximum', async () => {
    const s = setup('widget')
    const port = connect(s)
    port.postMessage({ type: 'ready', protocol: 1 })
    for (const h of [0, 40, 300.2, 5000]) port.postMessage({ type: 'resize', height: h })
    await tick()
    expect(s.heights).toEqual([96, 96, 301, 800])
    s.controller.dispose()
  })

  it('gives a page a taller range', async () => {
    const s = setup('page')
    const port = connect(s)
    port.postMessage({ type: 'ready', protocol: 1 })
    for (const h of [10, 1500, 90_000]) port.postMessage({ type: 'resize', height: h })
    await tick()
    expect(s.heights).toEqual([240, 1500, 20_000])
    expect(HEIGHT_LIMITS.page.max).toBe(20_000)
    s.controller.dispose()
  })

  describe('the path under a page', () => {
    const initOf = (s: Setup): { path?: string } => s.received.find((m) => m.type === 'init') as { path?: string }

    it('goes into init, and a change after the frame is ready is sent once as a route', async () => {
      const s = setup('page', { path: '/' })
      const port = connect(s)
      port.postMessage({ type: 'ready', protocol: 1 })
      await tick()
      expect(initOf(s).path).toBe('/')
      s.controller.setRoute('/2026/10')
      s.controller.setRoute('/2026/10')
      await tick()
      expect(s.received.filter((m) => m.type === 'route')).toEqual([{ type: 'route', path: '/2026/10' }])
      s.controller.dispose()
    })

    it('does not repeat the path the frame started with', async () => {
      const s = setup('page', { path: '/a' })
      const port = connect(s)
      port.postMessage({ type: 'ready', protocol: 1 })
      await tick()
      s.controller.setRoute('/a')
      await tick()
      expect(s.received.filter((m) => m.type === 'route')).toEqual([])
      s.controller.dispose()
    })

    it('puts the latest path in init when the address changed while the frame was starting', async () => {
      const s = setup('page', { path: '/a' })
      s.controller.setRoute('/b') // before the hello: nothing to send to yet
      const port = connect(s)
      port.postMessage({ type: 'ready', protocol: 1 })
      await tick()
      expect(initOf(s).path).toBe('/b')
      expect(s.received.filter((m) => m.type === 'route')).toEqual([])
      s.controller.dispose()
    })
  })

  it('refuses a nonsense height outright', async () => {
    const s = setup('widget')
    const port = connect(s)
    port.postMessage({ type: 'ready', protocol: 1 })
    port.postMessage({ type: 'resize', height: Number.NaN })
    port.postMessage({ type: 'resize', height: -5 })
    port.postMessage({ type: 'resize', height: '300' })
    await tick()
    expect(s.heights).toEqual([])
    s.controller.dispose()
  })

  it('passes size and range changes on as props', async () => {
    const s = setup('widget')
    const port = connect(s)
    port.postMessage({ type: 'ready', protocol: 1 })
    await tick()
    s.controller.setProps({ size: 'lg' })
    await tick()
    expect(s.received.at(-1)).toEqual({ type: 'props', size: 'lg' })
    s.controller.dispose()
  })
})

describe('theme', () => {
  it('sends a new theme when data-theme changes, and not when nothing changed', async () => {
    const s = setup()
    const port = connect(s)
    port.postMessage({ type: 'ready', protocol: 1 })
    await tick()
    s.currentTheme.value = theme('dark', '#abcdef')
    document.documentElement.setAttribute('data-theme', 'dark')
    await tick()
    expect(s.received.filter((m) => m.type === 'theme')).toEqual([{ type: 'theme', theme: theme('dark', '#abcdef') }])
    document.documentElement.setAttribute('data-theme', 'dark') // same value again
    await tick()
    expect(s.received.filter((m) => m.type === 'theme')).toHaveLength(1)
    s.controller.dispose()
  })

  it('sends nothing before the frame is ready', async () => {
    const s = setup()
    connect(s)
    s.currentTheme.value = theme('dark')
    document.documentElement.setAttribute('data-theme', 'dark')
    await tick()
    expect(s.received).toEqual([])
    s.controller.dispose()
  })
})

describe('focus and navigation', () => {
  it('reports focus leaving the frame and navigation requests', async () => {
    const s = setup()
    const port = connect(s)
    port.postMessage({ type: 'ready', protocol: 1 })
    port.postMessage({ type: 'focus-out', direction: 'previous' })
    port.postMessage({ type: 'navigate', path: '/p/test.fixture/page' })
    await tick()
    expect(s.events.onFocusOut).toHaveBeenCalledWith('previous')
    expect(s.events.onNavigate).toHaveBeenCalledWith('/p/test.fixture/page')
    s.controller.dispose()
  })

  it('focuses the iframe and tells the frame when focus comes in', async () => {
    const s = setup()
    const port = connect(s)
    port.postMessage({ type: 'ready', protocol: 1 })
    await tick()
    s.controller.focusIn('last')
    await tick()
    expect(s.frame.iframe.focus).toHaveBeenCalled()
    expect(s.received.at(-1)).toEqual({ type: 'focus-in', direction: 'last' })
    s.controller.dispose()
  })
})

describe('modal dialogs', () => {
  it('passes a page frame\'s modal open and close on', async () => {
    const s = setup('page')
    const port = connect(s)
    port.postMessage({ type: 'ready', protocol: 1 })
    port.postMessage({ type: 'modal', open: true })
    port.postMessage({ type: 'modal', open: false })
    await tick()
    // The first call is the hello's own "nothing is open" reset.
    expect(vi.mocked(s.events.onModal).mock.calls).toEqual([[false], [true], [false]])
    s.controller.dispose()
  })

  it('ignores a widget frame\'s modal message', async () => {
    const s = setup('widget')
    const port = connect(s)
    port.postMessage({ type: 'ready', protocol: 1 })
    port.postMessage({ type: 'modal', open: true })
    await tick()
    expect(vi.mocked(s.events.onModal).mock.calls.every(([open]) => open === false)).toBe(true)
    s.controller.dispose()
  })

  it('ends a lift when the frame says hello again or fails', async () => {
    const s = setup('page')
    const port = connect(s)
    port.postMessage({ type: 'ready', protocol: 1 })
    port.postMessage({ type: 'modal', open: true })
    await tick()
    vi.mocked(s.events.onModal).mockClear()
    s.hello()
    expect(vi.mocked(s.events.onModal).mock.calls).toEqual([[false]])
    vi.mocked(s.events.onModal).mockClear()
    s.hello(s.frame.win, { type: 'wm.hello', protocols: [7] })
    expect(vi.mocked(s.events.onModal).mock.calls.at(-1)).toEqual([false])
    s.controller.dispose()
  })

  it('sends the page layout to a ready frame, and nothing before it is', async () => {
    const s = setup('page')
    const port = connect(s)
    s.controller.setModalLayout({ lifted: true, x: 18, y: -40, width: 900 })
    port.postMessage({ type: 'ready', protocol: 1 })
    await tick()
    s.controller.setModalLayout({ lifted: true, x: 18, y: -40, width: 900 })
    await tick()
    expect(s.received.filter((m) => m.type === 'modal-layout')).toEqual([{ type: 'modal-layout', lifted: true, x: 18, y: -40, width: 900 }])
    s.controller.dispose()
  })
})
