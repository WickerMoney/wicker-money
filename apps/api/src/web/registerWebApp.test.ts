import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import helmet from '@fastify/helmet'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registerWebApp } from './registerWebApp.js'

const INDEX = '<!doctype html><title>Wicker Money</title><div id="root"></div>'

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

  it('lists configured plugin origins in the policy', async () => {
    const res = await (await appWith(['https://plugins.example.com'])).inject({ method: 'GET', url: '/' })
    expect(String(res.headers['content-security-policy'])).toContain("script-src 'self' https://plugins.example.com")
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
