import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import helmet from '@fastify/helmet'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildFrameContentSecurityPolicy } from './buildFrameContentSecurityPolicy.js'
import { registerWebApp } from './registerWebApp.js'

const INDEX = '<!doctype html><title>Wicker Money</title><div id="root"></div>'
const FRAME = '<!doctype html><title>Plugin</title><div id="root"></div>'

let sandbox: string
let root: string
const apps: FastifyInstance[] = []

/**
 * A Fastify instance wired as `buildApp` wires it: Helmet globally, an API
 * route or two, and the web app registered last.
 */
async function appWith(pluginOrigins: readonly string[] = []): Promise<FastifyInstance> {
  const app = Fastify()
  await app.register(helmet, { global: true })
  app.get('/healthz', () => ({ status: 'ok' }))
  app.get('/api/v1/ping', () => ({ pong: true }))
  registerWebApp(app, { root, pluginOrigins })
  await app.ready()
  apps.push(app)
  return app
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'wickermoney-web-'))
  root = join(sandbox, 'dist')
  mkdirSync(join(root, 'assets'), { recursive: true })
  mkdirSync(join(root, 'plugins', 'demo'), { recursive: true })
  writeFileSync(join(root, 'index.html'), INDEX)
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'export const shell = 1')
  writeFileSync(join(root, 'plugins', 'demo', 'remoteEntry.js'), 'export const remote = 1')
  writeFileSync(join(root, 'plugin-frame.html'), FRAME)
  writeFileSync(join(root, '.env'), 'AUTH_SECRET=do-not-serve')
  // Outside the served directory: must stay unreachable however the path is spelled.
  writeFileSync(join(sandbox, 'secret.txt'), 'outside the web root')
})

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()))
  rmSync(sandbox, { recursive: true, force: true })
})

describe('the app shell', () => {
  it('is served at the root with a policy that does not upgrade requests', async () => {
    const res = await (await appWith()).inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toBe(INDEX)
    expect(res.headers['cache-control']).toBe('no-cache')
    const csp = String(res.headers['content-security-policy'])
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    // Helmet's default would otherwise win, and it breaks plain-HTTP installs.
    expect(csp).not.toContain('upgrade-insecure-requests')
  })

  it('is served for a deep link a browser reloads', async () => {
    const res = await (await appWith()).inject({ method: 'GET', url: '/transactions/3f1c?tab=splits' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe(INDEX)
    expect(res.headers['content-security-policy']).toBeDefined()
  })

  it('answers HEAD for a client-side route', async () => {
    const res = await (await appWith()).inject({ method: 'HEAD', url: '/budgets' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('')
  })

  it('does not list a configured plugin origin: remote plugins run only in the frame', async () => {
    const res = await (await appWith(['https://plugins.example.com'])).inject({ method: 'GET', url: '/' })
    const csp = String(res.headers['content-security-policy'])
    expect(csp).toContain("script-src 'self';")
    expect(csp).toContain("connect-src 'self';")
    expect(csp).not.toContain('plugins.example.com')
  })
})

describe('X-Frame-Options outside the plugin frame', () => {
  // Only `/plugin-frame` opts out. Everything else keeps Helmet's header, so a
  // browser that ignores CSP still refuses to frame the app or the API.
  it.each([
    ['the app document', '/'],
    ['a client-side route', '/transactions/3f1c?tab=splits'],
    ['an API response', '/api/v1/ping'],
    ['a health check', '/healthz'],
    ['a missing API route', '/api/v1/nope'],
    ['a hashed asset', '/assets/index-abc123.js'],
  ])('is still sent with %s', async (_what, url) => {
    const res = await (await appWith()).inject({ method: 'GET', url })
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
  })

  it('is still sent with the app document when the frame route has been requested before it', async () => {
    const app = await appWith()
    expect((await app.inject({ method: 'GET', url: '/plugin-frame' })).headers['x-frame-options']).toBeUndefined()
    expect((await app.inject({ method: 'GET', url: '/' })).headers['x-frame-options']).toBe('SAMEORIGIN')
  })
})

describe('caching', () => {
  it('lets the browser keep hashed host assets forever', async () => {
    const res = await (await appWith()).inject({ method: 'GET', url: '/assets/index-abc123.js' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('javascript')
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it('revalidates a plugin remote entry, which is not hashed', async () => {
    const res = await (await appWith()).inject({ method: 'GET', url: '/plugins/demo/remoteEntry.js' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-cache')
  })
})

describe('what is not the app shell', () => {
  it('returns a JSON 404, not HTML, for a missing file', async () => {
    const res = await (await appWith()).inject({ method: 'GET', url: '/assets/index-gone.js' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.json()).toEqual({
      message: 'Route GET:/assets/index-gone.js not found',
      error: 'Not Found',
      statusCode: 404,
    })
  })

  it('returns a JSON 404 for an unknown API route rather than the shell', async () => {
    const res = await (await appWith()).inject({ method: 'GET', url: '/api/v1/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ statusCode: 404, error: 'Not Found' })
  })

  it('does not answer a write to a client-side route', async () => {
    const res = await (await appWith()).inject({ method: 'POST', url: '/transactions', payload: {} })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
  })

  it('leaves registered API and health routes alone', async () => {
    const app = await appWith()
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ status: 'ok' })
    expect((await app.inject({ method: 'GET', url: '/api/v1/ping' })).json()).toEqual({ pong: true })
  })

  it('does not serve dotfiles from the build directory', async () => {
    const res = await (await appWith()).inject({ method: 'GET', url: '/.env' })
    expect(res.statusCode).toBe(404)
    expect(res.body).not.toContain('do-not-serve')
  })

  it.each(['/../secret.txt', '/%2e%2e/secret.txt', '/assets/../../secret.txt', '/%2e%2e%2fsecret.txt'])(
    'does not serve a file outside the build directory (%s)',
    async (url) => {
      const res = await (await appWith()).inject({ method: 'GET', url })
      expect(res.body).not.toContain('outside the web root')
    },
  )
})

describe('startup', () => {
  it('refuses a directory with no index.html instead of serving a broken UI', () => {
    const empty = mkdtempSync(join(sandbox, 'empty-'))
    expect(() => registerWebApp(Fastify(), { root: empty, pluginOrigins: [] })).toThrow(/has no index\.html/)
  })

  it('refuses a plugin origin that could add a policy directive', () => {
    expect(() =>
      registerWebApp(Fastify(), { root, pluginOrigins: ['https://a.example.com; script-src *'] }),
    ).toThrow(/cannot go in a Content-Security-Policy/)
  })
})

describe('the sandboxed plugin frame document', () => {
  const get = async (url: string, headers: Record<string, string> = {}, origins: readonly string[] = []) =>
    (await appWith(origins)).inject({ method: 'GET', url, headers })

  it('is served at its own path with a sandbox policy and not the app policy', async () => {
    const res = await get('/plugin-frame', { host: 'money.example.com' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe(FRAME)
    expect(res.headers['content-type']).toContain('text/html')
    const csp = String(res.headers['content-security-policy'])
    expect(csp).toContain('sandbox allow-scripts')
    expect(csp).not.toContain('allow-same-origin')
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("frame-ancestors 'self'")
    expect(csp).toContain("script-src 'self' http://money.example.com;")
    expect(res.headers['cache-control']).toBe('no-cache')
    expect(res.headers['vary']).toContain('Host')
  })

  // This replaces "may be framed by our own pages, which Helmet permits with its
  // default", which asserted `X-Frame-Options: SAMEORIGIN` on the frame. Framing
  // is governed by `frame-ancestors 'self'` in the frame's policy, and a browser
  // that understands it ignores `X-Frame-Options` (Firefox logs a console message
  // for each framed widget when both are sent). So the contract is now: no
  // `X-Frame-Options` here, `frame-ancestors 'self'` still there, and nothing
  // else of the policy changed.
  it('is framed by our own pages through frame-ancestors, and sends no X-Frame-Options', async () => {
    const res = await get('/plugin-frame', { host: 'money.example.com' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-frame-options']).toBeUndefined()
    expect(String(res.headers['content-security-policy'])).toContain("frame-ancestors 'self'")
  })

  it('keeps the whole sandbox policy exactly as the builder produces it', async () => {
    const res = await get('/plugin-frame', { host: 'money.example.com' }, ['https://plugins.example.com'])
    expect(res.headers['content-security-policy']).toBe(
      buildFrameContentSecurityPolicy('http://money.example.com', ['https://plugins.example.com']),
    )
    expect(res.headers['content-security-policy']).toBe(
      [
        'sandbox allow-scripts',
        "default-src 'none'",
        "script-src 'self' http://money.example.com https://plugins.example.com",
        "style-src 'unsafe-inline' 'self' http://money.example.com https://plugins.example.com",
        "connect-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'self'",
      ].join('; '),
    )
  })

  it('drops only X-Frame-Options: the other Helmet headers are still sent with the frame', async () => {
    const res = await get('/plugin-frame')
    const other = await (await appWith()).inject({ method: 'GET', url: '/api/v1/ping' })
    const withoutFrameguard = (headers: Record<string, unknown>): string[] =>
      Object.keys(headers).filter((h) => h !== 'x-frame-options' && h.startsWith('x-')).sort()
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['referrer-policy']).toBe(other.headers['referrer-policy'])
    expect(res.headers['cross-origin-opener-policy']).toBe(other.headers['cross-origin-opener-policy'])
    expect(res.headers['cross-origin-resource-policy']).toBe(other.headers['cross-origin-resource-policy'])
    expect(res.headers['strict-transport-security']).toBe(other.headers['strict-transport-security'])
    expect(withoutFrameguard(res.headers)).toEqual(withoutFrameguard(other.headers))
  })

  it('lists the operator plugin origins, and only for the frame', async () => {
    const res = await get('/plugin-frame', { host: 'money.example.com' }, ['https://plugins.example.com'])
    const csp = String(res.headers['content-security-policy'])
    expect(csp).toContain("script-src 'self' http://money.example.com https://plugins.example.com;")
    expect(csp).toContain("connect-src 'none'")
  })

  it('is not served under the name of the file, so it cannot get the app policy', async () => {
    const res = await get('/plugin-frame.html')
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ error: 'Not Found' })
  })

  it('answers 404 when the build has no frame, instead of the app shell', async () => {
    rmSync(join(root, 'plugin-frame.html'))
    try {
      const res = await get('/plugin-frame')
      expect(res.statusCode).toBe(404)
      expect(res.body).not.toContain('Wicker Money')
    } finally {
      writeFileSync(join(root, 'plugin-frame.html'), FRAME)
    }
  })
})

describe('reading build output from a sandboxed frame', () => {
  const get = async (url: string) => (await appWith()).inject({ method: 'GET', url })

  it('lets any origin read the hashed assets and plugin remotes, which are public', async () => {
    expect((await get('/assets/index-abc123.js')).headers['access-control-allow-origin']).toBe('*')
    expect((await get('/plugins/demo/remoteEntry.js')).headers['access-control-allow-origin']).toBe('*')
  })

  it('does not extend that to the app shell or the API', async () => {
    expect((await get('/')).headers['access-control-allow-origin']).toBeUndefined()
    expect((await get('/api/v1/ping')).headers['access-control-allow-origin']).toBeUndefined()
    expect((await get('/healthz')).headers['access-control-allow-origin']).toBeUndefined()
  })

  it('answers no preflight for the API', async () => {
    const res = await (await appWith()).inject({
      method: 'OPTIONS', url: '/api/v1/ping',
      headers: { origin: 'null', 'access-control-request-method': 'GET' },
    })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
