import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as kit from './index.js'
import { ToastProvider, ToastViewport, useToast, type ToastApi } from './index.js'

let api: ToastApi
function Capture() {
  const t = useToast()
  useEffect(() => { api = t }, [t])
  return null
}

function setup(routeKey?: string, extra?: React.ReactNode) {
  const ui = (key?: string) => (
    <ToastProvider routeKey={key}>
      <main><ToastViewport /><Capture />{extra}</main>
    </ToastProvider>
  )
  const r = render(ui(routeKey))
  return { ...r, route: (key: string) => { r.rerender(ui(key)) } }
}

const frame = async (ms = 20) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const announcer = () => screen.getByRole('status')
const stack = () => screen.queryByRole('group', { name: 'Notifications' })
const texts = () => Array.from(stack()?.querySelectorAll('.wm-toast__text') ?? []).map((e) => e.textContent)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] })
})
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

const show = async (...args: Parameters<ToastApi['show']>) => {
  let id = ''
  act(() => { id = api.show(...args) })
  await frame()
  return id
}

describe('announcer', () => {
  it('is mounted before any toast, empty, and carries the live-region attributes', () => {
    setup()
    const a = announcer()
    expect(a.getAttribute('aria-live')).toBe('polite')
    expect(a.getAttribute('aria-atomic')).toBe('true')
    expect(a.textContent).toBe('')
    expect(stack()).toBeNull()
  })

  it('announces a toast once, then empties after about 1.5 s', async () => {
    setup()
    await show('Saved.', { kind: 'success' })
    expect(announcer().textContent).toBe('Saved.')
    expect(texts()).toEqual(['Saved.'])
    await frame(1600)
    expect(announcer().textContent).toBe('')
    expect(texts()).toEqual(['Saved.'])
  })

  it('prefixes warnings and errors in the announcement and shows the word to readers of the stack', async () => {
    setup()
    await show('Disk low.', { kind: 'warning' })
    expect(announcer().textContent).toBe('Warning: Disk low.')
    await show('Failed.', { kind: 'error' })
    expect(announcer().textContent).toBe('Error: Failed.')
    expect(texts()).toContain('Error: Failed.')
  })

  it('coalesces a burst in one frame into one update, in order', async () => {
    setup()
    act(() => { api.show('One'); api.show('Two') })
    await frame()
    expect(announcer().textContent).toBe('One. Two')
    expect(announcer().children).toHaveLength(1)
  })

  it('announces identical text twice by replacing the node', async () => {
    setup()
    await show('Same')
    const first = announcer().firstChild
    await frame(1600)
    await show('Same')
    expect(announcer().textContent).toBe('Same')
    expect(announcer().firstChild).not.toBe(first)
  })

  it('does not announce again when an unrelated toast arrives', async () => {
    setup()
    await show('A')
    await show('B')
    expect(announcer().textContent).toBe('B')
  })
})

describe('focus', () => {
  it('does not move focus, even from inside an input', async () => {
    setup(undefined, <input aria-label="Name" />)
    const input = screen.getByLabelText('Name')
    input.focus()
    await show('Done', { kind: 'success' })
    await show('Oops', { kind: 'error' })
    expect(document.activeElement).toBe(input)
  })
})

describe('keyboard', () => {
  it('the close button is a tab stop; Escape on a toast closes it and gives focus back', async () => {
    setup(undefined, <input aria-label="Name" />)
    const input = screen.getByLabelText('Name')
    input.focus()
    await show('Deleted.', { kind: 'success' })
    const close = screen.getByRole('button', { name: 'Dismiss notification' })
    expect(close.tabIndex).toBe(0)
    expect(close.getAttribute('aria-describedby')).not.toBeNull()
    act(() => { close.focus() })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(stack()).toBeNull()
    expect(document.activeElement).toBe(input)
  })

  it('Escape elsewhere does nothing', async () => {
    setup(undefined, <input aria-label="Name" />)
    await show('Stay')
    screen.getByLabelText('Name').focus()
    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(texts()).toEqual(['Stay'])
  })

  it('the close button dismisses', async () => {
    setup()
    await show('Bye')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(stack()).toBeNull()
  })
})

describe('no timeout', () => {
  it('keeps every kind after 24 hours', async () => {
    setup()
    await show('a', { kind: 'success' })
    await show('b', { kind: 'info' })
    await show('c', { kind: 'warning' })
    await frame(24 * 3600 * 1000)
    expect(texts().sort()).toEqual(['Warning: c', 'a', 'b'])
  })

  it('a route change clears success, info and warning and keeps errors', async () => {
    const { route } = setup('/a')
    await show('a', { kind: 'success' })
    await show('b', { kind: 'warning' })
    await show('boom', { kind: 'error' })
    route('/b')
    await frame()
    expect(texts()).toEqual(['Error: boom'])
  })
})

describe('stack and queue', () => {
  it('shows three, queues the rest without evicting, and promotes (and announces) on dismiss', async () => {
    setup()
    const ids = []
    for (const n of ['1', '2', '3', '4']) ids.push(await show(n))
    expect(texts()).toEqual(['3', '2', '1'])
    expect(announcer().textContent).toBe('3')
    act(() => { api.dismiss(ids[0]!) })
    await frame()
    expect(texts()).toEqual(['4', '3', '2'])
    expect(announcer().textContent).toBe('4')
  })

  it('lets an error jump the queue', async () => {
    setup()
    const ids = []
    for (const n of ['1', '2', '3', 'q1', 'q2']) ids.push(await show(n))
    await show('bad', { kind: 'error' })
    act(() => { api.dismiss(ids[0]!) })
    await frame()
    expect(texts()[0]).toBe('Error: bad')
  })

  it('replaces a toast with the same key in place and announces again', async () => {
    setup()
    const a = await show('Deleted 1', { key: 'del' })
    await show('other')
    const b = await show('Deleted 2', { key: 'del' })
    expect(b).toBe(a)
    expect(texts().sort()).toEqual(['Deleted 2', 'other'])
    expect(announcer().textContent).toBe('Deleted 2')
  })

  it('offers Dismiss all from two toasts, and not before', async () => {
    setup()
    await show('one')
    expect(screen.queryByRole('button', { name: 'Dismiss all' })).toBeNull()
    await show('two')
    act(() => { screen.getByRole('button', { name: 'Dismiss all' }).click() })
    await frame()
    expect(stack()).toBeNull()
  })

  it('shows two on a phone width', async () => {
    const original = window.matchMedia
    window.matchMedia = ((q: string) => ({
      matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
    try {
      setup()
      for (const n of ['1', '2', '3']) await show(n)
      expect(texts()).toEqual(['2', '1'])
    } finally { window.matchMedia = original }
  })
})

describe('reduced motion', () => {
  it('the stylesheet turns the entry fade off under prefers-reduced-motion', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(`${process.cwd()}/src/components.css`, 'utf8')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.wm-toast \{ animation: none; \} \}/)
    expect(css).toMatch(/animation: wm-toast-in 150ms/)
  })
})

describe('unmount', () => {
  it('leaves no timers or frames behind and ignores show() afterwards', async () => {
    const { unmount } = setup()
    await show('x')
    act(() => { api.show('pending') })
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(() => { api.show('late') }).not.toThrow()
    await frame(100)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('modal guard', () => {
  it('holds delivery while a modal is open and delivers when it closes', async () => {
    setup()
    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    document.body.append(modal)
    act(() => { api.show('After the dialog') })
    await frame(500)
    expect(stack()).toBeNull()
    expect(announcer().textContent).toBe('')
    modal.remove()
    await frame()
    expect(texts()).toEqual(['After the dialog'])
    expect(announcer().textContent).toBe('After the dialog')
  })

  it('delivers anyway after two seconds', async () => {
    setup()
    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    document.body.append(modal)
    act(() => { api.show('Late') })
    await frame(2100)
    expect(texts()).toEqual(['Late'])
  })
})

describe('provider', () => {
  it('useToast throws outside a provider and says why', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Capture />)).toThrow(/ADR 0009.*ctx\.notify/s)
    spy.mockRestore()
  })

  it('the viewport renders nothing outside a provider', () => {
    const { container } = render(<ToastViewport />)
    expect(container.innerHTML).toBe('')
  })
})

describe('exports', () => {
  it('exposes exactly the toast surface from the root', () => {
    for (const name of ['ToastProvider', 'ToastViewport', 'useToast']) expect(typeof (kit as Record<string, unknown>)[name]).toBe('function')
    expect(Object.keys(kit).filter((k) => /toast/i.test(k)).sort()).toEqual(['ToastProvider', 'ToastViewport', 'useToast'])
  })
})
