import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SDK_MAJOR_VERSION } from '@wickermoney/plugin-sdk'
import { createHarness, type Harness } from './testing/harness.js'
import { APP_VERSION, GIT_SHA } from './version.js'

let h: Harness

beforeAll(async () => {
  h = await createHarness()
})

afterAll(async () => {
  await h.close()
})

describe('app', () => {
  it('reports liveness and the running version', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', version: APP_VERSION, gitSha: GIT_SHA })
  })

  it('reports readiness with the SDK version it hosts', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/readyz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      status: 'ok',
      version: APP_VERSION,
      gitSha: GIT_SHA,
      sdkVersion: SDK_MAJOR_VERSION,
    })
  })

  it('404s an unknown route', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/nope' })
    expect(res.statusCode).toBe(404)
  })

  it('answers malformed JSON with a 400, not a 500', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{bad',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'bad_request' })
  })

  it('answers an oversized body with a 413', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(2 * 1024 * 1024) }),
    })
    expect(res.statusCode).toBe(413)
    expect(res.json()).toMatchObject({ code: 'payload_too_large' })
  })

  it('sends security headers', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/healthz' })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })
})

/**
 * With `WEB_DIST_DIR` set the API also serves the web app. The static handler
 * is a wildcard, so this is what proves it is registered after, and never in
 * front of, the real routes.
 */
describe('app serving the web app', () => {
  const INDEX = '<!doctype html><title>Wicker Money</title>'
  let dir: string
  let web: Harness

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'wickermoney-app-web-'))
    writeFileSync(join(dir, 'index.html'), INDEX)
    web = await createHarness({ WEB_DIST_DIR: dir })
  })

  afterAll(async () => {
    await web.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('serves the app shell, with its own policy, at the root and on a client-side route', async () => {
    for (const url of ['/', '/transactions']) {
      const res = await web.app.inject({ method: 'GET', url })
      expect(res.statusCode).toBe(200)
      expect(res.body).toBe(INDEX)
      expect(String(res.headers['content-security-policy'])).not.toContain('upgrade-insecure-requests')
    }
  })

  it('still answers the health and readiness probes itself', async () => {
    expect((await web.app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({
      status: 'ok',
      version: APP_VERSION,
      gitSha: GIT_SHA,
    })
    expect((await web.app.inject({ method: 'GET', url: '/readyz' })).json()).toEqual({
      status: 'ok',
      version: APP_VERSION,
      gitSha: GIT_SHA,
      sdkVersion: SDK_MAJOR_VERSION,
    })
  })

  it('still answers API routes, and an unauthenticated one with a 401 rather than the shell', async () => {
    const res = await web.app.inject({ method: 'GET', url: '/api/v1/accounts' })
    expect(res.statusCode).toBe(401)
    expect(res.headers['content-type']).toContain('application/json')
  })

  it('404s an unknown API route as JSON instead of returning the shell', async () => {
    const res = await web.app.inject({ method: 'GET', url: '/api/v1/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
  })

  it('leaves writes to the API untouched', async () => {
    const res = await web.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{bad',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'bad_request' })
  })
})
