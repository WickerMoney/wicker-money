import { act } from '@testing-library/react'
import type { PluginContext } from '@wickermoney/plugin-sdk'
import type { HostChange, HostConnection, IsolatedState } from '@wickermoney/plugin-sdk/isolated'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountPlugin } from './mountPlugin.js'

const hash = '#id=acme.report&entry=%2Fp%2Fremote.js&module=.%2FWidget&kind=widget'
const base = 'https://money.example.com/plugin-frame'

function fakeConnection(state: Partial<IsolatedState> = {}) {
  let current: IsolatedState = {
    pluginId: 'acme.report', kind: 'widget', session: { userId: 'u', email: 'e', timezone: 'UTC' },
    locale: { locale: 'en-US', timezone: 'UTC' }, theme: { scheme: 'light', tokens: {} }, size: 'md', ...state,
  }
  const listeners = new Set<(c: HostChange) => void>()
  const connection = {
    ctx: { session: current.session } as unknown as PluginContext,
    getState: () => current,
    subscribe: (l: (c: HostChange) => void) => { listeners.add(l); return () => { listeners.delete(l) } },
    reportSize: vi.fn(), observeSize: vi.fn(() => () => {}), focusOut: vi.fn(), notify: vi.fn(), dispose: vi.fn(),
  } as unknown as HostConnection
  return {
    connection,
    push(change: HostChange, next: Partial<IsolatedState>) { current = { ...current, ...next }; listeners.forEach((l) => { l(change) }) },
  }
}

afterEach(() => { vi.restoreAllMocks() })

describe('mountPlugin', () => {
  it('renders the plugin with ctx, size and range from the host', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const { connection } = fakeConnection()
    const seen = vi.fn()
    const Plugin = (props: Record<string, unknown>) => { seen(props); return <p>hello plugin</p> }
    await act(async () => { await mountPlugin(root, hash, base, { connect: async () => connection, load: async () => Plugin }) })
    expect(root.textContent).toContain('hello plugin')
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ ctx: connection.ctx, size: 'md' }))
    expect(connection.observeSize).toHaveBeenCalled()
  })

  it('reports the height of the root for a widget and of the whole document for a page', async () => {
    const Plugin = () => <p>x</p>
    const widgetRoot = document.createElement('div')
    document.body.append(widgetRoot)
    const widget = fakeConnection()
    await act(async () => { await mountPlugin(widgetRoot, hash, base, { connect: async () => widget.connection, load: async () => Plugin }) })
    const widgetTarget = (widget.connection.observeSize as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Element
    expect(widgetTarget).not.toBe(document.documentElement)
    expect(widgetRoot.contains(widgetTarget)).toBe(true)

    const pageRoot = document.createElement('div')
    document.body.append(pageRoot)
    const page = fakeConnection({ kind: 'page', path: '/' })
    await act(async () => {
      await mountPlugin(pageRoot, hash.replace('kind=widget', 'kind=page'), base, { connect: async () => page.connection, load: async () => Plugin })
    })
    expect((page.connection.observeSize as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(document.documentElement)
    document.documentElement.removeAttribute('data-wm-frame')
  })

  it('marks the document with the frame kind, for the stylesheet', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const { connection } = fakeConnection({ kind: 'page', path: '/' })
    await act(async () => {
      await mountPlugin(root, hash.replace('kind=widget', 'kind=page'), base, { connect: async () => connection, load: async () => () => <p>x</p> })
    })
    expect(document.documentElement.getAttribute('data-wm-frame')).toBe('page')
    document.documentElement.removeAttribute('data-wm-frame')
  })

  it('gives a page the path under its route, and re-renders when the host changes it', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const { connection, push } = fakeConnection({ kind: 'page', path: '/' })
    delete (connection.getState() as { size?: string }).size
    const Plugin = (props: Record<string, unknown>) => <p>at {String(props['path'])} size {String(props['size'])}</p>
    await act(async () => {
      await mountPlugin(root, hash.replace('kind=widget', 'kind=page'), base, { connect: async () => connection, load: async () => Plugin })
    })
    expect(root.textContent).toContain('at / size undefined')
    await act(async () => { push({ type: 'route', path: '/2026' }, { path: '/2026' }) })
    expect(root.textContent).toContain('at /2026')
    document.documentElement.removeAttribute('data-wm-frame')
  })

  it('re-renders when the host changes the size', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const { connection, push } = fakeConnection()
    const Plugin = ({ size }: Record<string, unknown>) => <p>size {String(size)}</p>
    await act(async () => { await mountPlugin(root, hash, base, { connect: async () => connection, load: async () => Plugin }) })
    await act(async () => { push({ type: 'props', size: 'lg' }, { size: 'lg' }) })
    expect(root.textContent).toContain('size lg')
  })

  describe('focus at the ends of the frame', () => {
    async function mountTwoButtons() {
      const root = document.createElement('div')
      document.body.append(root)
      const { connection, push } = fakeConnection()
      const Plugin = () => <div><button>one</button><button>two</button></div>
      await act(async () => { await mountPlugin(root, hash, base, { connect: async () => connection, load: async () => Plugin }) })
      for (const b of root.querySelectorAll('button')) b.getClientRects = () => [{}] as unknown as DOMRectList
      const [one, two] = root.querySelectorAll('button') as unknown as HTMLButtonElement[]
      vi.spyOn(document, 'hasFocus').mockReturnValue(true)
      return { connection, push, one: one!, two: two! }
    }
    const tab = (el: HTMLElement, shiftKey = false): KeyboardEvent => {
      const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
      el.dispatchEvent(e)
      return e
    }

    it('takes focus in from the host at either end', async () => {
      const { push, one, two } = await mountTwoButtons()
      await act(async () => { push({ type: 'focus-in', direction: 'last' }, {}) })
      expect(document.activeElement).toBe(two)
      await act(async () => { push({ type: 'focus-in', direction: 'first' }, {}) })
      expect(document.activeElement).toBe(one)
    })

    it('takes Tab at the last control and Shift+Tab at the first, and hands them to the host in the same task', async () => {
      const { connection, one, two } = await mountTwoButtons()
      two.focus()
      const forward = tab(two)
      expect(forward.defaultPrevented).toBe(true)
      expect(connection.focusOut).toHaveBeenCalledTimes(1)
      expect(connection.focusOut).toHaveBeenLastCalledWith('next')
      one.focus()
      const backward = tab(one, true)
      expect(backward.defaultPrevented).toBe(true)
      expect(connection.focusOut).toHaveBeenCalledTimes(2)
      expect(connection.focusOut).toHaveBeenLastCalledWith('previous')
    })

    it('uses no timer for the hand-off', async () => {
      vi.useFakeTimers()
      try {
        const { connection, two } = await mountTwoButtons()
        two.focus()
        const pending = vi.getTimerCount()
        tab(two)
        // Asked before any time has passed, and the key left no timer behind to ask again.
        expect(connection.focusOut).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(pending)
        vi.advanceTimersByTime(1000)
        expect(connection.focusOut).toHaveBeenCalledTimes(1)
      } finally { vi.useRealTimers() }
    })

    it('leaves Tab between two controls inside the frame to the browser', async () => {
      const { connection, one, two } = await mountTwoButtons()
      one.focus()
      expect(tab(one).defaultPrevented).toBe(false)
      two.focus()
      expect(tab(two, true).defaultPrevented).toBe(false)
      expect(connection.focusOut).not.toHaveBeenCalled()
    })

    it('leaves Tab to the browser while a modal dialog is open, so its own trap holds', async () => {
      const { connection, one, two } = await mountTwoButtons()
      const real = document.querySelector.bind(document)
      vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => selector === 'dialog:modal' ? document.body : real(selector))
      two.focus()
      expect(tab(two).defaultPrevented).toBe(false)
      one.focus()
      expect(tab(one, true).defaultPrevented).toBe(false)
      expect(connection.focusOut).not.toHaveBeenCalled()
    })

    it('leaves other keys, modified Tab and Tab that something else already handled alone', async () => {
      const { connection, two } = await mountTwoButtons()
      two.focus()
      two.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      expect(tab(two, false).defaultPrevented).toBe(true) // the one that does count, to be sure the handler is live
      connection.focusOut = vi.fn()
      for (const init of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
        const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...init })
        two.dispatchEvent(e)
        expect(e.defaultPrevented).toBe(false)
      }
      const handled = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      two.addEventListener('keydown', (e) => { e.preventDefault() }, { once: true })
      two.dispatchEvent(handled)
      expect(connection.focusOut).not.toHaveBeenCalled()
    })

    it('counts an aria-disabled control as a tab stop and a disabled one as not', async () => {
      const root = document.createElement('div')
      document.body.append(root)
      const { connection } = fakeConnection()
      const Plugin = () => <div><button>one</button><button aria-disabled="true">busy</button><button disabled>off</button></div>
      await act(async () => { await mountPlugin(root, hash, base, { connect: async () => connection, load: async () => Plugin }) })
      for (const b of root.querySelectorAll('button')) b.getClientRects = () => [{}] as unknown as DOMRectList
      const [, busy] = root.querySelectorAll('button') as unknown as HTMLButtonElement[]
      busy!.focus()
      expect(tab(busy!).defaultPrevented).toBe(true) // the last control the keyboard can reach
      expect(connection.focusOut).toHaveBeenCalledWith('next')
    })
  })

  it('shows a bad fragment as text and never connects', async () => {
    const root = document.createElement('div')
    const connect = vi.fn()
    await mountPlugin(root, '#id=x', base, { connect })
    expect(root.querySelector('[role="alert"]')?.textContent).toMatch(/invalid|missing/)
    expect(connect).not.toHaveBeenCalled()
  })

  it('shows a failed load as text and disconnects', async () => {
    const root = document.createElement('div')
    const { connection } = fakeConnection()
    await mountPlugin(root, hash, base, { connect: async () => connection, load: async () => { throw new Error('boom <b>x</b>') } })
    const alert = root.querySelector('[role="alert"]')!
    expect(alert.textContent).toBe('boom <b>x</b>')
    expect(alert.querySelector('b')).toBeNull()
    const dispose = await mountPlugin(root, hash, base, { connect: async () => connection, load: async () => { throw new Error('x') } })
    dispose()
    expect(connection.dispose).toHaveBeenCalled()
  })

  it('shows a refused handshake', async () => {
    const root = document.createElement('div')
    await mountPlugin(root, hash, base, { connect: async () => { throw new Error('The host speaks protocol 2') } })
    expect(root.textContent).toContain('protocol 2')
  })
})
