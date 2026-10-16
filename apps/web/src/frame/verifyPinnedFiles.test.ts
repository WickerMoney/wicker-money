import { afterEach, describe, expect, it } from 'vitest'
import { verifyPinnedFiles } from './verifyPinnedFiles.js'
import type { FrameParams } from './fragment.js'

const SRI = `sha384-${'A'.repeat(64)}`
const base = 'https://money.example.com/plugin-frame'
const remote = 'https://plugins.example.com/acme-report/remoteEntry.js'
const params = (extra: Partial<FrameParams> = {}): FrameParams => ({
  pluginId: 'acme.report', entry: remote, module: './W', kind: 'widget', ...extra,
})

/** jsdom does not fetch, so a test answers each link the way a browser would. */
function answer(outcome: (link: HTMLLinkElement) => 'load' | 'error' | 'never'): void {
  const observer = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof HTMLLinkElement) {
        const result = outcome(node)
        if (result !== 'never') queueMicrotask(() => node.dispatchEvent(new Event(result)))
      }
    }
  })
  observer.observe(document.head, { childList: true })
  cleanups.push(() => observer.disconnect())
}
const cleanups: Array<() => void> = []
afterEach(() => { for (const c of cleanups.splice(0)) c(); document.head.innerHTML = '' })

describe('verifyPinnedFiles', () => {
  it('adds one anonymous modulepreload per pinned file, with its value, resolved against the entry', async () => {
    const seen: HTMLLinkElement[] = []
    answer((link) => { seen.push(link.cloneNode() as HTMLLinkElement); return 'load' })
    await verifyPinnedFiles(params({ integrity: { 'remoteEntry.js': SRI, 'assets/chunk-1.js': SRI } }), base)
    expect(seen.map((l) => l.href).sort()).toEqual([
      'https://plugins.example.com/acme-report/assets/chunk-1.js',
      'https://plugins.example.com/acme-report/remoteEntry.js',
    ])
    for (const l of seen) {
      expect(l.rel).toBe('modulepreload')
      expect(l.getAttribute('crossorigin')).toBe('anonymous')
      expect(l.getAttribute('integrity')).toBe(SRI)
    }
  })

  it('removes the links afterwards', async () => {
    answer(() => 'load')
    await verifyPinnedFiles(params({ integrity: { 'remoteEntry.js': SRI } }), base)
    expect(document.head.querySelectorAll('link')).toHaveLength(0)
  })

  it('refuses, naming the file, when one file fails its check', async () => {
    answer((link) => (link.href.endsWith('chunk-1.js') ? 'error' : 'load'))
    await expect(verifyPinnedFiles(params({ integrity: { 'remoteEntry.js': SRI, 'assets/chunk-1.js': SRI } }), base))
      .rejects.toThrow(/'assets\/chunk-1\.js' did not match its integrity pin/)
    expect(document.head.querySelectorAll('link')).toHaveLength(0)
  })

  it('refuses a remote entry with no pin, and adds nothing', async () => {
    await expect(verifyPinnedFiles(params(), base)).rejects.toThrow(/no integrity pin/)
    await expect(verifyPinnedFiles(params({ integrity: {} }), base)).rejects.toThrow(/no integrity pin/)
    expect(document.head.querySelectorAll('link')).toHaveLength(0)
  })

  it('refuses a pin that does not list the entry file', async () => {
    await expect(verifyPinnedFiles(params({ integrity: { 'assets/chunk-1.js': SRI } }), base))
      .rejects.toThrow(/does not list its entry file 'remoteEntry\.js'/)
  })

  it('lets an entry the host serves itself load without a pin', async () => {
    await expect(verifyPinnedFiles(params({ entry: 'https://money.example.com/plugins/acme/remoteEntry.js' }), base)).resolves.toBeUndefined()
  })

  it('treats a different port or scheme as another origin', async () => {
    await expect(verifyPinnedFiles(params({ entry: 'https://money.example.com:8443/p/remoteEntry.js' }), base)).rejects.toThrow(/no integrity pin/)
    await expect(verifyPinnedFiles(params({ entry: 'http://money.example.com/p/remoteEntry.js' }), base)).rejects.toThrow(/no integrity pin/)
  })

  it('does not treat a key named like an object property as the entry', async () => {
    await expect(verifyPinnedFiles(params({ integrity: { 'assets/a.js': SRI } }), base)).rejects.toThrow(/entry file/)
  })
})
