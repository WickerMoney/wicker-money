import { act, fireEvent, render, screen } from '@testing-library/react'
import type { PluginContext, PluginManifest } from '@wickermoney/plugin-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrokerApi } from './brokerApi.js'
import { IsolatedPluginFrame } from './IsolatedPluginFrame.js'
import { LAYOUT_SETTLED_AT_MS, SETTLE_MS } from './useNearViewport.js'

const manifest = {
  id: 'test.fixture', name: 'Fixture', version: '0.1.0', description: '', author: '',
  sdkVersion: 0, permissions: [], remoteEntry: '/plugins/test.fixture/remoteEntry.js', requiredTables: [],
  contributes: { widgets: [], pages: [] },
} as unknown as PluginManifest

const navigate = vi.fn()
const ctx = {
  session: { userId: 'u1', email: 'u1@example.com', timezone: 'UTC' }, navigate,
} as unknown as PluginContext

const api: BrokerApi = { mint: vi.fn(), send: vi.fn() }

afterEach(() => { vi.restoreAllMocks(); navigate.mockClear() })

/** Drives the iframe as the plugin would, with jsdom's window standing in for the frame. */
function frameOf(container: HTMLElement) {
  const iframe = container.querySelector('iframe')!
  const win = iframe.contentWindow!
  const posted: Array<{ data: unknown; ports: MessagePort[] }> = []
  vi.spyOn(win, 'postMessage').mockImplementation(((data: unknown, _o: string, ports?: MessagePort[]) => {
    posted.push({ data, ports: ports ?? [] })
  }) as never)
  return {
    iframe, posted,
    async connect(): Promise<MessagePort> {
      await act(async () => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'wm.hello', protocols: [1] }, source: win }))
      })
      const port = posted.at(-1)!.ports[0]!
      await act(async () => { port.postMessage({ type: 'ready', protocol: 1 }); await new Promise((r) => setTimeout(r, 5)) })
      return port
    },
  }
}

const mount = (extra: Partial<React.ComponentProps<typeof IsolatedPluginFrame>> = {}) => render(
  <IsolatedPluginFrame manifest={manifest} module="./Widget" title="Spending" kind="widget" ctx={ctx} size="md" api={api} {...extra} />,
)

describe('IsolatedPluginFrame', () => {
  it('renders a titled iframe that is sandboxed to scripts only', () => {
    const { container } = mount()
    const iframe = container.querySelector('iframe')!
    expect(iframe.title).toBe('Fixture · Spending')
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe.getAttribute('src')).toBe(
      '/plugin-frame#id=test.fixture&entry=%2Fplugins%2Ftest.fixture%2FremoteEntry.js&module=.%2FWidget&kind=widget',
    )
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('shows a loading status until the frame connects', async () => {
    const { container } = mount()
    expect(screen.getByRole('status').textContent).toContain('Loading Fixture · Spending')
    expect(container.querySelector('iframe')!.style.visibility).toBe('hidden')
    await frameOf(container).connect()
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.querySelector('iframe')!.style.visibility).toBe('visible')
  })

  it('takes the height the frame reports, clamped to the widget range', async () => {
    const { container } = mount()
    const f = frameOf(container)
    const port = await f.connect()
    expect(f.iframe.style.height).toBe('360px') // the estimate for "md" until the frame reports
    await act(async () => { port.postMessage({ type: 'resize', height: 400 }); await new Promise((r) => setTimeout(r, 5)) })
    expect(f.iframe.style.height).toBe('400px')
    await act(async () => { port.postMessage({ type: 'resize', height: 9999 }); await new Promise((r) => setTimeout(r, 5)) })
    expect(f.iframe.style.height).toBe('800px')
  })

  it('shows a failure with a retry when the frame never answers, and retries', async () => {
    vi.useFakeTimers()
    const { container } = mount({ loadTimeoutMs: 500 })
    await act(async () => { vi.advanceTimersByTime(600) })
    vi.useRealTimers()
    expect(screen.getByRole('alert').textContent).toContain('could not be loaded')
    expect(container.querySelector('iframe')!.style.height).toBe('0px')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('navigates the app when the frame asks to', async () => {
    const { container } = mount({ kind: 'page', module: './Page' })
    const port = await frameOf(container).connect()
    await act(async () => { port.postMessage({ type: 'navigate', path: '/transactions' }); await new Promise((r) => setTimeout(r, 5)) })
    expect(navigate).toHaveBeenCalledWith('/transactions')
  })

  it('moves focus past the iframe when focus leaves the frame', async () => {
    const { container } = render(
      <>
        <button>before</button>
        <IsolatedPluginFrame manifest={manifest} module="./Widget" title="Spending" kind="widget" ctx={ctx} api={api} />
        <button>after</button>
      </>,
    )
    for (const el of container.querySelectorAll<HTMLElement>('button,iframe')) el.getClientRects = () => [{}] as unknown as DOMRectList
    const port = await frameOf(container).connect()
    await act(async () => { port.postMessage({ type: 'focus-out', direction: 'next' }); await new Promise((r) => setTimeout(r, 5)) })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'after' }))
    await act(async () => { port.postMessage({ type: 'focus-out', direction: 'previous' }); await new Promise((r) => setTimeout(r, 5)) })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'before' }))
  })

  it('tears the connection down on unmount', async () => {
    const { container, unmount } = mount()
    const f = frameOf(container)
    await f.connect()
    unmount()
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'wm.hello', protocols: [1] }, source: f.iframe.contentWindow }))
    })
    expect(f.posted).toHaveLength(1) // the connect from before; nothing after unmount
  })
})

describe('IsolatedPluginFrame, lazy start', () => {
  type Observed = { cb: IntersectionObserverCallback; el: Element | null; options: IntersectionObserverInit | undefined; disconnected: boolean }
  let observers: Observed[] = []

  function stubObserver(): void {
    observers = []
    vi.stubGlobal('IntersectionObserver', class {
      private readonly rec: Observed
      constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) { this.rec = { cb, el: null, options, disconnected: false }; observers.push(this.rec) }
      observe(el: Element): void { this.rec.el = el }
      disconnect(): void { this.rec.disconnected = true }
      unobserve(): void { /* unused */ }
    })
  }
  /** Lays the placeholder out at `top`; the default test environment measures everything as zero. */
  function placeAt(top: number): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0, y: top, top, bottom: top + 96, left: 0, right: 300, width: 300, height: 96, toJSON: () => ({}),
    }))
  }
  afterEach(() => { vi.unstubAllGlobals() })

  it('creates no iframe for a placeholder far below the viewport, and reserves its height', () => {
    stubObserver(); placeAt(window.innerHeight + 5000)
    const { container } = mount()
    expect(container.querySelector('iframe')).toBeNull()
    const root = container.querySelector<HTMLElement>('.plugin-frame')!
    expect(root.dataset['status']).toBe('waiting')
    expect(root.style.minHeight).toBe('360px')
    expect(root.textContent).toContain('Fixture · Spending loads when you scroll to it.')
    // Not a live region, and nothing a keyboard can land on.
    expect(screen.queryByRole('status')).toBeNull()
    expect(root.querySelector('[tabindex],button,a,input')).toBeNull()
    expect(observers[0]!.options?.rootMargin).toBe('600px 0px')
  })

  it('creates the iframe when the observer reports it near, once, and keeps it', () => {
    vi.useFakeTimers()
    stubObserver(); placeAt(window.innerHeight + 5000)
    const { container } = mount()
    placeAt(100) // scrolled into view
    act(() => { observers[0]!.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); vi.advanceTimersByTime(SETTLE_MS + 1) })
    expect(container.querySelector('iframe')).not.toBeNull()
    expect(container.querySelector('iframe')!.getAttribute('src')).toContain('/plugin-frame#')
    expect(observers[0]!.disconnected).toBe(true)
    // Scrolling away again does not destroy it: there is no observer left to say so.
    expect(observers).toHaveLength(1)
    vi.useRealTimers()
  })

  it('ignores an observer report that says the placeholder is not near', () => {
    stubObserver(); placeAt(window.innerHeight + 5000)
    const { container } = mount()
    act(() => { observers[0]!.cb([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver) })
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('creates the iframe for a placeholder in view once it has stayed there for the settle time', () => {
    vi.useFakeTimers()
    stubObserver(); placeAt(100)
    const { container } = mount()
    expect(container.querySelector('iframe')).toBeNull()
    act(() => { vi.advanceTimersByTime(SETTLE_MS + 1) })
    vi.useRealTimers()
    expect(container.querySelector('iframe')).not.toBeNull()
  })

  it('starts a placeholder inside the margin only after it has stayed there for the settle time', () => {
    vi.useFakeTimers()
    stubObserver(); placeAt(window.innerHeight + 500)
    const { container } = mount()
    expect(container.querySelector('iframe')).toBeNull()
    act(() => { observers[0]!.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver) })
    act(() => { vi.advanceTimersByTime(LAYOUT_SETTLED_AT_MS - 1) })
    expect(container.querySelector('iframe')).toBeNull()
    act(() => { vi.advanceTimersByTime(2) })
    vi.useRealTimers()
    expect(container.querySelector('iframe')).not.toBeNull()
  })

  it('switches to the short wait when a placeholder inside the margin is scrolled into view', () => {
    vi.useFakeTimers()
    stubObserver(); placeAt(window.innerHeight + 500)
    const { container } = mount()
    act(() => { vi.advanceTimersByTime(100) })
    placeAt(100)
    act(() => { observers[0]!.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); vi.advanceTimersByTime(SETTLE_MS + 1) })
    vi.useRealTimers()
    expect(container.querySelector('iframe')).not.toBeNull()
  })

  it('does not start a placeholder that was pushed out of the margin while it settled', () => {
    vi.useFakeTimers()
    stubObserver(); placeAt(window.innerHeight + 500)
    const { container } = mount()
    act(() => { observers[0]!.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver) })
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(() => ({
      x: 0, y: 5000, top: 5000, bottom: 5096, left: 0, right: 300, width: 300, height: 96, toJSON: () => ({}),
    }))
    act(() => { vi.advanceTimersByTime(LAYOUT_SETTLED_AT_MS + 10) })
    vi.useRealTimers()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('falls back to creating the iframe at once without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined); placeAt(window.innerHeight + 5000)
    expect(mount().container.querySelector('iframe')).not.toBeNull()
  })

  it('never makes a page frame lazy', () => {
    stubObserver(); placeAt(window.innerHeight + 5000)
    expect(mount({ kind: 'page', module: './Page' }).container.querySelector('iframe')).not.toBeNull()
  })

  it('does not start the handshake clock before the frame exists', async () => {
    vi.useFakeTimers()
    stubObserver(); placeAt(window.innerHeight + 5000)
    const { container } = mount({ loadTimeoutMs: 500 })
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(screen.queryByRole('alert')).toBeNull()
    placeAt(100) // scrolled into view
    act(() => { observers[0]!.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver) })
    await act(async () => { vi.advanceTimersByTime(SETTLE_MS + 1) })
    expect(container.querySelector('iframe')).not.toBeNull()
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(200) })
    vi.useRealTimers()
    expect(screen.getByRole('alert').textContent).toContain('could not be loaded')
    expect(container.querySelector('iframe')).not.toBeNull()
  })
})
