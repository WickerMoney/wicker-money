import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { PluginContext, PluginManifest } from '@wickermoney/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'
import type { BrokerApi } from './brokerApi.js'
import { IsolatedPluginFrame } from './IsolatedPluginFrame.js'

/**
 * ADR 0005, constraint 7 and the P5 exit criterion: the sandbox attribute on a
 * plugin frame is exactly `allow-scripts`, and `allow-same-origin` never
 * appears together with `allow-scripts` on a frame document served from the
 * app's own origin (that pair lets the frame remove its own sandbox).
 *
 * The browser suite checks the same thing on the live DOM and on the frame
 * document's own CSP header. This file is the fast guard that runs with
 * `pnpm test`.
 */

const manifest = {
  id: 'test.fixture', name: 'Fixture', version: '0.1.0', description: '', author: '',
  sdkVersion: 0, permissions: [], remoteEntry: '/plugins/test.fixture/remoteEntry.js', requiredTables: [],
  contributes: { widgets: [], pages: [] },
} as unknown as PluginManifest
const ctx = { session: { userId: 'u1', email: 'u1@example.com', timezone: 'UTC' }, navigate: vi.fn() } as unknown as PluginContext
const api: BrokerApi = { mint: vi.fn(), send: vi.fn() }

/** Every sandbox token the platform defines. The only one a plugin frame may carry is `allow-scripts`. */
const ALL_SANDBOX_TOKENS = [
  'allow-downloads', 'allow-forms', 'allow-modals', 'allow-orientation-lock', 'allow-pointer-lock', 'allow-popups',
  'allow-popups-to-escape-sandbox', 'allow-presentation', 'allow-same-origin', 'allow-scripts',
  'allow-storage-access-by-user-activation', 'allow-top-navigation', 'allow-top-navigation-by-user-activation',
  'allow-top-navigation-to-custom-protocols',
]

function expectLocked(iframe: HTMLIFrameElement): void {
  expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
  // jsdom has no DOMTokenList for `sandbox`; the attribute string is what the browser parses.
  expect((iframe.getAttribute('sandbox') ?? '').split(/\s+/).filter(Boolean)).toEqual(['allow-scripts'])
  const tokens = (iframe.getAttribute('sandbox') ?? '').split(/\s+/)
  for (const token of ALL_SANDBOX_TOKENS.filter((t) => t !== 'allow-scripts')) expect(tokens.includes(token), token).toBe(false)
  // No permissions delegated to the frame (camera, microphone, geolocation, clipboard, payment, fullscreen ...).
  expect(iframe.hasAttribute('allow')).toBe(false)
  expect(iframe.hasAttribute('allowfullscreen')).toBe(false)
  expect(iframe.hasAttribute('srcdoc')).toBe(false)
  expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer')
  // The frame document is the app's own, loaded by path, never an absolute URL to somewhere else.
  const src = iframe.getAttribute('src')
  expect(src === null || src.startsWith('/plugin-frame#')).toBe(true)
}

describe('the plugin frame\'s sandbox attribute', () => {
  it.each(['widget', 'page'] as const)('is exactly allow-scripts for a %s frame, as rendered and after a failure and retry', async (kind) => {
    const { container } = render(
      <IsolatedPluginFrame manifest={manifest} module="./Widget" title="Spending" kind={kind} ctx={ctx} api={api} loadTimeoutMs={20} />,
    )
    expectLocked(container.querySelector('iframe')!)
    // Let the handshake time out so the failed state renders, then retry: the iframe is rebuilt, not trusted to be the same.
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    expectLocked(container.querySelector('iframe')!)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expectLocked(container.querySelector('iframe')!)
  })

  it('cannot be changed by the plugin\'s manifest: no field of it reaches the attribute', () => {
    const hostile = { ...manifest, sandbox: 'allow-scripts allow-same-origin', allow: 'camera *', remoteEntry: manifest.remoteEntry } as unknown as PluginManifest
    const { container } = render(<IsolatedPluginFrame manifest={hostile} module="./Widget" title="x" kind="widget" ctx={ctx} api={api} />)
    expectLocked(container.querySelector('iframe')!)
  })
})

describe('no frame in the app\'s source carries another sandbox set', () => {
  const root = join(process.cwd(), 'src') // vitest runs from apps/web

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return sources(path)
      return /\.(tsx?|html)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
    })
  }

  const code = (file: string): string =>
    readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  /** Every place the source assigns a sandbox value: a JSX attribute, `.sandbox =`, or `setAttribute('sandbox', ...)`. */
  const ASSIGNMENT = /(?:\bsandbox\s*=\s*\{?\s*|setAttribute\(\s*['"]sandbox['"]\s*,\s*)(['"`])([^'"`]*)\1/g

  it('assigns the sandbox attribute in exactly one place, and to allow-scripts', () => {
    const found: Array<{ file: string; value: string }> = []
    for (const file of sources(root)) {
      for (const match of code(file).matchAll(ASSIGNMENT)) found.push({ file: relative(root, file), value: match[2] ?? '' })
    }
    expect(found).toEqual([{ file: 'plugins/isolated/IsolatedPluginFrame.tsx', value: 'allow-scripts' }])
  })

  it('never builds a sandbox value from a variable or concatenation (the assignment above would not see it)', () => {
    const dynamic: string[] = []
    for (const file of sources(root)) {
      const text = code(file)
      if (/\.sandbox\s*(?:\+=|=)(?!=)/.test(text) || /sandbox\s*=\s*\{(?!\s*['"`])/.test(text) || /\.sandbox\.add\(/.test(text)) dynamic.push(relative(root, file))
    }
    expect(dynamic).toEqual([])
  })

  it('does not mention allow-same-origin in executable code (comments that say never to use it are fine)', () => {
    const offenders: string[] = []
    for (const file of sources(root)) {
      if (code(file).includes('allow-same-origin')) offenders.push(relative(root, file))
    }
    expect(offenders).toEqual([])
  })
})
