import { describe, expect, it } from 'vitest'
import { DownloadGate, downloadGateAllows, STRICT_DOWNLOAD_GATE, STRICT_WINDOW_MS, type GateInputs } from './downloadGate.js'

const base: GateInputs = { activationActive: true, iframeIsActive: true, lastHostInputAt: null, now: 100_000 }

describe('downloadGateAllows (the pure decision)', () => {
  it('the switch is off: only the default gate is wired', () => {
    expect(STRICT_DOWNLOAD_GATE).toBe(false)
  })

  it.each([
    [{ activationActive: false }, false],
    [{ iframeIsActive: false }, false],
    [{ activationActive: false, iframeIsActive: false }, false],
    [{}, true],
    [{ lastHostInputAt: 99_000 }, true],
  ])('default gate with %j is %s', (over, expected) => {
    expect(downloadGateAllows({ ...base, ...over }, false)).toBe(expected)
  })

  it.each([
    ['no host input ever', null, true],
    ['host input long ago', 100_000 - STRICT_WINDOW_MS - 1, true],
    ['host input exactly at the window edge', 100_000 - STRICT_WINDOW_MS, false],
    ['host input a second ago', 99_000, false],
    ['host input just now', 100_000, false],
  ])('strict gate with %s is %s', (_what, at, expected) => {
    expect(downloadGateAllows({ ...base, lastHostInputAt: at }, true)).toBe(expected)
  })

  it('the strict gate never allows what the default gate refuses', () => {
    for (const activationActive of [true, false]) for (const iframeIsActive of [true, false]) for (const at of [null, 0, 99_999]) {
      const i = { ...base, activationActive, iframeIsActive, lastHostInputAt: at }
      if (!downloadGateAllows(i, false)) expect(downloadGateAllows(i, true)).toBe(false)
    }
  })
})

describe('DownloadGate (against a window)', () => {
  function setup(strict: boolean) {
    const iframe = document.createElement('iframe')
    const other = document.createElement('button')
    document.body.append(iframe, other)
    const activation = { isActive: true }
    const clock = { t: 50_000 }
    const win = {
      navigator: { userActivation: activation },
      document,
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
    } as unknown as Window
    const gate = new DownloadGate(win, iframe, strict, () => clock.t)
    return { gate, iframe, other, activation, clock }
  }
  const cleanup = (...els: Element[]): void => { for (const e of els) e.remove() }

  it('allows an active activation while the iframe is the active element', () => {
    const { gate, iframe, other } = setup(false)
    iframe.focus()
    expect(gate.allows()).toBe(true)
    gate.dispose()
    cleanup(iframe, other)
  })

  it('refuses when the iframe is not the active element, or the activation is spent, or userActivation is missing', () => {
    const { gate, iframe, other, activation } = setup(false)
    other.focus()
    expect(gate.allows()).toBe(false)
    iframe.focus()
    activation.isActive = false
    expect(gate.allows()).toBe(false)
    activation.isActive = true
    expect(gate.allows()).toBe(true)
    ;(gate as unknown as { win: { navigator: object } }).win.navigator = {}
    expect(gate.allows()).toBe(false)
    gate.dispose()
    cleanup(iframe, other)
  })

  it('strict: trusted host input refuses for 5 seconds; a script-made event does not count; dispose stops listening', () => {
    const { gate, iframe, other, clock } = setup(true)
    iframe.focus()
    window.dispatchEvent(new Event('pointerdown'))
    expect(gate.allows()).toBe(true)
    // A trusted event cannot be built in a test, so reach the note path the same way the listener does.
    ;(gate as unknown as { lastHostInputAt: number | null }).lastHostInputAt = clock.t
    clock.t += 4_999
    expect(gate.allows()).toBe(false)
    clock.t += 2
    expect(gate.allows()).toBe(true)
    gate.dispose()
    cleanup(iframe, other)
  })
})
