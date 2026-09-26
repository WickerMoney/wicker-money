import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from './testing/harness.js'

let h: Harness

/** One registered route: an HTTP method and its full URL pattern. */
interface RouteKey {
  readonly method: string
  readonly path: string
}

const asKey = (r: RouteKey): string => `${r.method} ${r.path}`

/**
 * Routes that are deliberately reachable without a token. Adding a route to
 * this list is a security decision; it must be reviewed as one.
 */
const PUBLIC_ROUTES: readonly string[] = [
  'GET /healthz',
  'GET /readyz',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/logout',
]

/**
 * Every route that must answer 401 without a valid bearer token. A new route
 * has to be added here (or to {@link PUBLIC_ROUTES}) on purpose; the
 * enumeration test fails until it is.
 */
const PROTECTED_ROUTES: readonly string[] = [
  'POST /api/v1/auth/change-password',
  'GET /api/v1/auth/me',

  'GET /api/v1/accounts',
  'POST /api/v1/accounts',
  'GET /api/v1/accounts/:id',
  'PATCH /api/v1/accounts/:id',
  'DELETE /api/v1/accounts/:id',
  'POST /api/v1/accounts/:id/archive',
  'GET /api/v1/accounts/:id/usage',
  'POST /api/v1/accounts/:id/delete-with-history',
  'POST /api/v1/accounts/:id/migrate',
  'POST /api/v1/accounts/:id/migrate/preview',
  'POST /api/v1/accounts/:id/initial-balance',
  'POST /api/v1/accounts/:id/initial-balance/preview',

  'GET /api/v1/categories',
  'POST /api/v1/categories',
  'GET /api/v1/categories/catalog',
  'POST /api/v1/categories/starter',
  'PATCH /api/v1/categories/:id',
  'DELETE /api/v1/categories/:id',
  'GET /api/v1/categories/:id/usage',

  'GET /api/v1/category-rules',
  'POST /api/v1/category-rules',
  'POST /api/v1/category-rules/preview',
  'DELETE /api/v1/category-rules/:id',

  'GET /api/v1/core/transactions/monthly-summary',
  'GET /api/v1/core/accounts/list',
  'GET /api/v1/core/accounts/summary',
  'GET /api/v1/core/categories/list',

  'GET /api/v1/onboarding',
  'POST /api/v1/onboarding/preview',
  'POST /api/v1/onboarding/complete',
  'POST /api/v1/onboarding/reset',

  'GET /api/v1/transactions',
  'POST /api/v1/transactions',
  'POST /api/v1/transactions/categorize',
  'POST /api/v1/transactions/transfer',
  'PATCH /api/v1/transactions/:id',
  'DELETE /api/v1/transactions/:id',
  'PUT /api/v1/transactions/:id/splits',
  'GET /api/v1/transactions/:id/splits',
  'DELETE /api/v1/transactions/:id/splits',

  'GET /api/v1/plugins',

  'GET /api/v1/p/wickermoney.import-csv/mappings',
  'POST /api/v1/p/wickermoney.import-csv/mappings',
  'POST /api/v1/p/wickermoney.import-csv/analyze',
  'POST /api/v1/p/wickermoney.import-csv/commit',
  'GET /api/v1/p/wickermoney.import-csv/batches',
  'POST /api/v1/p/wickermoney.import-csv/batches/:id/revert',

  'GET /api/v1/p/wickermoney.budgets/month',
  'POST /api/v1/p/wickermoney.budgets/month/adopt',
  'PUT /api/v1/p/wickermoney.budgets/line',
  'DELETE /api/v1/p/wickermoney.budgets/line',
  'GET /api/v1/p/wickermoney.budgets/at-risk',

  'GET /api/v1/settings/config',
  'GET /api/v1/settings/export',
]

/**
 * Reads the route tree Fastify prints and flattens it into method + full path.
 *
 * Each printed line is `<tree drawing><segment> (<METHODS>)`; the drawing's
 * width (four characters per level) gives the nesting, and a segment extends
 * its parent's path. `HEAD` is Fastify's automatic twin of every `GET`, so it
 * is dropped here and asserted separately.
 */
function enumerateRoutes(tree: string): RouteKey[] {
  const routes: RouteKey[] = []
  const parents: string[] = []
  for (const line of tree.split('\n')) {
    if (line.trim() === '') continue
    const match = /^((?:│ {3}| {4})*)(?:├── |└── )(\S+) \(([A-Z, ]+)\)$/.exec(line)
    if (match === null) throw new Error(`Unparseable route line: ${JSON.stringify(line)}`)
    const depth = (match[1] as string).length / 4
    const path = (parents[depth - 1] ?? '') + (match[2] as string)
    parents[depth] = path
    for (const method of (match[3] as string).split(', ')) {
      if (method !== 'HEAD') routes.push({ method, path })
    }
  }
  return routes
}

/** Replaces `:id` style parameters with a well-formed UUID so validation cannot answer before authentication. */
const concrete = (path: string): string =>
  path.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000')

beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

function registered(): RouteKey[] {
  return enumerateRoutes(h.app.printRoutes({ commonPrefix: false, includeHooks: false }))
}

describe('route classification', () => {
  it('enumerates the registered routes', () => {
    expect(registered().length).toBeGreaterThan(40)
  })

  it('has no route that is not explicitly classified as public or protected', () => {
    const known = new Set([...PUBLIC_ROUTES, ...PROTECTED_ROUTES])
    const unclassified = registered().map(asKey).filter((k) => !known.has(k))
    // A new route lands here until someone decides whether it needs a token.
    expect(unclassified).toEqual([])
  })

  it('has no stale entries for routes that no longer exist', () => {
    const live = new Set(registered().map(asKey))
    const stale = [...PUBLIC_ROUTES, ...PROTECTED_ROUTES].filter((k) => !live.has(k))
    expect(stale).toEqual([])
  })

  it('lists no route as both public and protected', () => {
    expect(PUBLIC_ROUTES.filter((k) => PROTECTED_ROUTES.includes(k))).toEqual([])
  })

  it('lists no route twice', () => {
    const all = [...PUBLIC_ROUTES, ...PROTECTED_ROUTES]
    expect(all.length).toBe(new Set(all).size)
  })
})

describe('authentication on every route', () => {
  it.each(PROTECTED_ROUTES)('%s answers 401 without a token', async (key) => {
    const [method, path] = key.split(' ') as [string, string]
    const res = await h.app.inject({
      method: method as 'GET',
      url: concrete(path),
      // A syntactically valid body, so an unauthenticated request cannot be rejected as malformed first.
      ...(method === 'GET' || method === 'DELETE' ? {} : { payload: {} }),
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ code: 'unauthorized' })
  })

  it.each(PROTECTED_ROUTES)('%s answers 401 for a malformed or forged token', async (key) => {
    const [method, path] = key.split(' ') as [string, string]
    for (const authorization of ['Bearer not-a-jwt', 'Basic abc', 'Bearer ']) {
      const res = await h.app.inject({
        method: method as 'GET',
        url: concrete(path),
        headers: { authorization },
        ...(method === 'GET' || method === 'DELETE' ? {} : { payload: {} }),
      })
      expect(res.statusCode, authorization).toBe(401)
    }
  })

  it('answers the automatic HEAD twin of each protected GET with 401 too', async () => {
    const gets = PROTECTED_ROUTES.filter((k) => k.startsWith('GET '))
    for (const key of gets) {
      const res = await h.app.inject({ method: 'HEAD', url: concrete(key.slice(4)) })
      expect(res.statusCode, key).toBe(401)
    }
  })

  it('serves the public health endpoints without a token', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200)
    expect((await h.app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(200)
  })

  it('does not demand a token on the public auth endpoints', async () => {
    for (const path of ['register', 'login', 'refresh', 'logout']) {
      const res = await h.app.inject({ method: 'POST', url: `/api/v1/auth/${path}`, payload: {} })
      // Rejected (if at all) for what they lack, such as a body, cookie or origin, never for a missing bearer token.
      expect(res.statusCode, `${path}: ${res.statusCode}`).toBeLessThan(500)
      expect(res.statusCode, path).not.toBe(404)
      expect(res.body, path).not.toMatch(/bearer|access token/i)
    }
  })

  it('answers an unknown path with 404, not a route', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/definitely-not-a-route' })
    expect(res.statusCode).toBe(404)
  })
})
