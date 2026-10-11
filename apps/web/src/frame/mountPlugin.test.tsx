import { act } from '@testing-library/react'
import type { PluginContext } from '@wickermoney/plugin-sdk'
import type { HostChange, HostConnection, IsolatedState } from '@wickermoney/plugin-sdk/isolated'
import { describe, expect, it, vi } from 'vitest'
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

  it('re-renders when the host changes the size', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const { connection, push } = fakeConnection()
    const Plugin = ({ size }: Record<string, unknown>) => <p>size {String(size)}</p>
    await act(async () => { await mountPlugin(root, hash, base, { connect: async () => connection, load: async () => Plugin }) })
    await act(async () => { push({ type: 'props', size: 'lg' }, { size: 'lg' }) })
    expect(root.textContent).toContain('size lg')
  })

  it('passes focus out to the host at the last control, and in at the first', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const { connection, push } = fakeConnection()
    const Plugin = () => <div><button>one</button><button>two</button></div>
    await act(async () => { await mountPlugin(root, hash, base, { connect: async () => connection, load: async () => Plugin }) })
    for (const b of root.querySelectorAll('button')) b.getClientRects = () => [{}] as unknown as DOMRectList
    const [one, two] = root.querySelectorAll('button') as unknown as HTMLButtonElement[]
    await act(async () => { push({ type: 'focus-in', direction: 'last' }, {}) })
    expect(document.activeElement).toBe(two)
    two!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(connection.focusOut).toHaveBeenCalledWith('next')
    one!.focus()
    one!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(connection.focusOut).toHaveBeenCalledWith('previous')
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
