import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostChange } from '@wickermoney/plugin-sdk/isolated'
import { DEFAULT_MODAL_LIFT_TIMINGS, MODAL_ATTRIBUTE, ModalLift, quietShowModal, wrapTab, type ShowModalHost } from './modalLift.js'

/** The frame's end of the host connection, with the host's side scripted by the test. */
function rig() {
  const listeners = new Set<(c: HostChange) => void>()
  const modal = vi.fn()
  const connection = { modal, subscribe: (l: (c: HostChange) => void) => { listeners.add(l); return () => { listeners.delete(l) } } }
  const state = { open: false }
  const win = Object.assign(new EventTarget(), { innerWidth: 1072, innerHeight: 2922 }) as unknown as Window
  const lift = new ModalLift(connection, document, win, DEFAULT_MODAL_LIFT_TIMINGS, () => state.open)
  const stop = lift.start()
  const html = document.documentElement
  return {
    html, modal, stop, state,
    host: (c: HostChange) => { for (const l of [...listeners]) l(c) },
    /** A dialog opens or closes: the document changes, the observer runs. */
    async setOpen(open: boolean) { state.open = open; document.body.append(document.createElement('i')); await Promise.resolve(); await Promise.resolve() },
    /** The host lifts or puts back the frame: the viewport changes and `resize` fires. */
    viewport(w: number, h: number) { (win as unknown as { innerWidth: number }).innerWidth = w; (win as unknown as { innerHeight: number }).innerHeight = h; win.dispatchEvent(new Event('resize')) },
    attr: () => html.getAttribute(MODAL_ATTRIBUTE),
  }
}

const layout = (lifted = true): HostChange => ({ type: 'modal-layout', lifted, x: lifted ? 18 : 0, y: lifted ? -504 : 0, width: lifted ? 1036 : 0 })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); document.documentElement.removeAttribute(MODAL_ATTRIBUTE); document.documentElement.removeAttribute('style') })

describe('ModalLift', () => {
  it('asks the host and holds the dialog invisible until the lift has happened', async () => {
    const r = rig()
    await r.setOpen(true)
    expect(r.modal).toHaveBeenCalledWith(true)
    expect(r.attr()).toBe('pending')
    r.host(layout())
    // The host has sent the layout; the viewport has not changed yet, so the page is not shifted yet.
    expect(r.attr()).toBe('pending')
    expect(r.html.style.getPropertyValue('--wm-lift-y')).toBe('-504px')
    r.viewport(1072, 700)
    expect(r.attr()).toBe('lifted')
    r.stop()
  })

  it('shifts at once when the viewport had already changed when the layout arrived', async () => {
    const r = rig()
    await r.setOpen(true)
    r.viewport(1072, 700)
    expect(r.attr()).toBe('pending')
    r.host(layout())
    expect(r.attr()).toBe('lifted')
    r.stop()
  })

  it('applies the layout after a moment if the viewport never reports a change', async () => {
    const r = rig()
    await r.setOpen(true)
    r.host(layout())
    expect(r.attr()).toBe('pending')
    vi.advanceTimersByTime(DEFAULT_MODAL_LIFT_TIMINGS.settleMs + 1)
    expect(r.attr()).toBe('lifted')
    r.stop()
  })

  it('shows the dialog where the browser put it when the host does not answer', async () => {
    const r = rig()
    await r.setOpen(true)
    vi.advanceTimersByTime(DEFAULT_MODAL_LIFT_TIMINGS.answerMs + 1)
    expect(r.attr()).toBe('inplace')
    // A late answer still lifts.
    r.host(layout())
    r.viewport(1072, 700)
    expect(r.attr()).toBe('lifted')
    r.stop()
  })

  it('keeps the page shifted on close until the host has put the frame back', async () => {
    const r = rig()
    await r.setOpen(true)
    r.host(layout())
    r.viewport(1072, 700)
    await r.setOpen(false)
    expect(r.modal).toHaveBeenLastCalledWith(false)
    // Still shifted: the host has not put the frame back.
    expect(r.attr()).toBe('lifted')
    r.host(layout(false))
    expect(r.attr()).toBe('lifted')
    r.viewport(1072, 2922)
    expect(r.attr()).toBeNull()
    expect(r.html.style.getPropertyValue('--wm-lift-y')).toBe('')
    r.stop()
  })

  it('lets go after a while if the host never puts the frame back', async () => {
    const r = rig()
    await r.setOpen(true)
    r.host(layout())
    r.viewport(1072, 700)
    await r.setOpen(false)
    vi.advanceTimersByTime(DEFAULT_MODAL_LIFT_TIMINGS.settleMs * 4 + 1)
    expect(r.attr()).toBeNull()
    r.stop()
  })

  it('closes at once when it was never lifted', async () => {
    const r = rig()
    await r.setOpen(true)
    await r.setOpen(false)
    expect(r.attr()).toBeNull()
    expect(r.modal.mock.calls).toEqual([[true], [false]])
    r.stop()
  })

  it('ignores a layout for a dialog that has already closed', async () => {
    const r = rig()
    await r.setOpen(true)
    await r.setOpen(false)
    r.host(layout())
    expect(r.attr()).toBeNull()
    expect(r.html.style.getPropertyValue('--wm-lift-y')).toBe('')
    r.stop()
  })

  it('opens again while closing without taking the lifted viewport for the normal one', async () => {
    const r = rig()
    await r.setOpen(true)
    r.host(layout())
    r.viewport(1072, 700)
    await r.setOpen(false)
    await r.setOpen(true)
    // Still the lifted viewport, and the layout is still good.
    expect(r.attr()).toBe('lifted')
    r.stop()
  })

  it('puts everything back and ends the lift when it is stopped with a dialog open', async () => {
    const r = rig()
    await r.setOpen(true)
    r.host(layout())
    r.viewport(1072, 700)
    r.stop()
    expect(r.modal).toHaveBeenLastCalledWith(false)
    expect(r.attr()).toBeNull()
  })

  it('does nothing for a document with no modal dialog', async () => {
    const r = rig()
    document.body.append(document.createElement('div'))
    await Promise.resolve()
    expect(r.modal).not.toHaveBeenCalled()
    r.stop()
  })
})

describe('quietShowModal', () => {
  /** A dialog whose showModal records whether it was inert, as the browser's focus-and-scroll step would find it. */
  function dialog() {
    const el = document.createElement('dialog')
    el.innerHTML = '<button id="close">x</button><input id="field">'
    document.body.append(el)
    const proto: ShowModalHost = {}
    const seen: { inert: boolean | null } = { inert: null }
    const original = vi.fn(function (this: HTMLDialogElement) { seen.inert = this.inert })
    proto.showModal = original
    return { el, proto, seen, original }
  }

  it('runs the browser\'s showModal with the dialog inert, then focuses without scrolling', () => {
    const { el, proto, seen, original } = dialog()
    const restore = quietShowModal(proto)
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    proto.showModal!.call(el)
    expect(original).toHaveBeenCalledOnce()
    expect(seen.inert).toBe(true)
    expect(el.inert).toBeFalsy()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(focus.mock.instances[0]).toBe(document.getElementById('close'))
    focus.mockRestore()
    restore()
  })

  it('focuses an autofocus control first, and keeps a dialog that was already inert inert', () => {
    const { el, proto } = dialog()
    el.querySelector('#field')!.setAttribute('autofocus', '')
    el.inert = true
    const restore = quietShowModal(proto)
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    proto.showModal!.call(el)
    expect(focus.mock.instances[0]).toBe(document.getElementById('field'))
    expect(el.inert).toBe(true)
    focus.mockRestore()
    restore()
  })

  it('puts the original back, and does nothing where there is no showModal', () => {
    const { proto, original } = dialog()
    quietShowModal(proto)()
    expect(proto.showModal).toBe(original)
    expect(() => quietShowModal({})()).not.toThrow()
  })
})

describe('wrapTab', () => {
  const tab = (shiftKey = false): KeyboardEvent => new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true })
  function dialogWith(count: number): HTMLElement[] {
    const d = document.createElement('dialog')
    d.setAttribute('open', '')
    // jsdom has no :modal and no layout: both are stood in for.
    d.matches = ((sel: string) => sel === ':modal') as never
    const buttons = Array.from({ length: count }, () => document.createElement('button'))
    d.append(...buttons)
    document.body.append(d)
    for (const b of buttons) b.getClientRects = (() => [{}]) as never
    return buttons
  }
  it('wraps from the last control to the first, and from the first to the last', () => {
    const [a, b, c] = dialogWith(3) as [HTMLElement, HTMLElement, HTMLElement]
    c.focus()
    const forward = tab()
    expect(wrapTab(document, forward)).toBe(true)
    expect(forward.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(a)
    const backward = tab(true)
    expect(wrapTab(document, backward)).toBe(true)
    expect(document.activeElement).toBe(c)
    b.focus()
    expect(wrapTab(document, tab())).toBe(false)
  })
  it('brings focus in when it is outside the dialog, and ignores other keys and no dialog', () => {
    const [a] = dialogWith(2) as [HTMLElement]
    document.body.focus()
    expect(wrapTab(document, tab())).toBe(true)
    expect(document.activeElement).toBe(a)
    expect(wrapTab(document, new KeyboardEvent('keydown', { key: 'a' }))).toBe(false)
    document.body.replaceChildren()
    expect(wrapTab(document, tab())).toBe(false)
  })
})
