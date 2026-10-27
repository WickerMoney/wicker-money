import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOAST_CLEARANCE_PROPERTY, useToastClearance } from './useToastClearance.js'
import { useRef } from 'react'

/** A ResizeObserver that lets the test say when the observed element changed size. */
let resizeCallbacks: Array<() => void> = []
class FakeResizeObserver {
  private readonly callback: () => void
  constructor(callback: () => void) { this.callback = callback }
  observe(): void { resizeCallbacks.push(this.callback) }
  disconnect(): void { resizeCallbacks = resizeCallbacks.filter((c) => c !== this.callback) }
  unobserve(): void {}
}

/** Like the table: a spinner first, the element holding the rows once `ready`. */
function Host({ ready = true }: { ready?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useToastClearance(ref, ready)
  return ready ? <div ref={ref} data-testid="host" /> : <p>Loading</p>
}

/** A page with <main>, where the banner is added as its first child. */
function mount() {
  const main = document.createElement('main')
  document.body.appendChild(main)
  const view = render(<Host />, { container: main.appendChild(document.createElement('div')) })
  const banner = (height: number): HTMLElement => {
    const el = document.createElement('div')
    el.setAttribute('role', 'group')
    el.setAttribute('aria-label', 'Notifications')
    el.getBoundingClientRect = () => ({ height }) as DOMRect
    return el
  }
  const clear = (): string => view.getByTestId('host').style.getPropertyValue(TOAST_CLEARANCE_PROPERTY)
  return { main, view, banner, clear }
}

beforeEach(() => { vi.stubGlobal('ResizeObserver', FakeResizeObserver) })
afterEach(() => { vi.unstubAllGlobals(); resizeCallbacks = []; document.body.innerHTML = '' })

describe('useToastClearance', () => {
  it('starts following once the rows replace the spinner', async () => {
    const main = document.createElement('main')
    document.body.appendChild(main)
    const view = render(<Host ready={false} />, { container: main.appendChild(document.createElement('div')) })
    const banner = document.createElement('div')
    banner.setAttribute('role', 'group')
    banner.setAttribute('aria-label', 'Notifications')
    banner.getBoundingClientRect = () => ({ height: 80 }) as DOMRect
    main.prepend(banner)

    view.rerender(<Host ready />)

    expect(view.getByTestId('host').style.getPropertyValue(TOAST_CLEARANCE_PROPERTY)).toBe('80px')
  })

  it('is 0px while no toast shows', () => {
    const { clear } = mount()
    expect(clear()).toBe('0px')
  })

  it('follows the banner as it appears, grows and goes', async () => {
    const { main, banner, clear } = mount()
    const el = banner(61.2)
    await act(async () => { main.prepend(el); await Promise.resolve() })
    expect(clear()).toBe('62px')

    el.getBoundingClientRect = () => ({ height: 161 }) as DOMRect
    act(() => { resizeCallbacks.forEach((c) => { c() }) })
    expect(clear()).toBe('161px')

    await act(async () => { el.remove(); await Promise.resolve() })
    expect(clear()).toBe('0px')
  })

  it('leaves the property off the element when the rows go away', () => {
    const { view, clear } = mount()
    const host = view.getByTestId('host')
    expect(clear()).toBe('0px')
    view.unmount()
    expect(host.style.getPropertyValue(TOAST_CLEARANCE_PROPERTY)).toBe('')
  })
})
