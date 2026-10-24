import { describe, expect, it, vi } from 'vitest'
import { diagnoseFrameTimeout } from './devFrameHint.js'

/** A `fetch` that answers every request with one canned response. */
const answering = (status: number, headers: Record<string, string> = {}): typeof fetch =>
  vi.fn(async () => new Response(null, { status, headers }))

describe('diagnoseFrameTimeout', () => {
  it('asks for the frame document with a HEAD request that skips the cache', async () => {
    const request = answering(200, { 'content-security-policy': "sandbox allow-scripts; default-src 'none'" })
    await diagnoseFrameTimeout(request)
    expect(request).toHaveBeenCalledWith('/plugin-frame', { method: 'HEAD', cache: 'no-store' })
  })

  it('says the API has no built frame when it answers 404', async () => {
    const hint = await diagnoseFrameTimeout(answering(404))
    expect(hint).toContain('answered 404')
    expect(hint).toContain('WEB_DIST_DIR')
    expect(hint).toContain('pnpm --filter @wickermoney/web build')
  })

  it('points at the API when the proxy reports an error', async () => {
    const hint = await diagnoseFrameTimeout(answering(500))
    expect(hint).toContain('answered 500')
    expect(hint).toContain(':8080')
  })

  it('says something else is answering when the document has no policy', async () => {
    const hint = await diagnoseFrameTimeout(answering(200, { 'content-type': 'text/html' }))
    expect(hint).toContain('without the frame')
    expect(hint).toContain('proxy')
  })

  it('looks at blocked requests when the document is the API\'s', async () => {
    const hint = await diagnoseFrameTimeout(answering(200, { 'content-security-policy': "default-src 'none'" }))
    expect(hint).toContain('served by the API')
    expect(hint).toContain('CORS')
  })

  it('reports an unreachable dev server instead of throwing', async () => {
    const hint = await diagnoseFrameTimeout(vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(hint).toContain('did not answer /plugin-frame')
    expect(hint).toContain('Failed to fetch')
  })

  it('always points at the documentation', async () => {
    for (const status of [200, 404, 500]) {
      expect(await diagnoseFrameTimeout(answering(status))).toContain('Isolated plugin frames')
    }
  })
})
