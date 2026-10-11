import type { RegisterRoute, RouteContext, RouteMethod, RunAsPlugin } from '@wickermoney/plugin-sdk/server'
import { PluginRouteError } from '@wickermoney/plugin-sdk/server'
import { describe, expect, it } from 'vitest'
import { registerDebtPayoffRoutes } from './index.js'

const USER = 'user-1'
const ID = '00000000-0000-4000-8000-000000000001'

type Handler = (ctx: RouteContext) => Promise<unknown>

/** Registers the routes against a recorder, with a database that must never be reached. */
function register() {
  const routes = new Map<string, Handler>()
  const route: RegisterRoute = (method: RouteMethod, path, handler) => {
    routes.set(`${method} ${path}`, handler)
  }
  let opened = 0
  const runAsPlugin: RunAsPlugin = async () => {
    opened += 1
    throw new Error('The database must not be reached.')
  }
  registerDebtPayoffRoutes({ route, runAsPlugin })
  const call = (key: string, ctx: Partial<RouteContext>) =>
    routes.get(key)!({ userId: USER, body: undefined, params: {}, query: {}, ...ctx })
  return { routes, call, opened: () => opened }
}

async function refusal(work: Promise<unknown>): Promise<PluginRouteError> {
  try {
    await work
  } catch (error) {
    if (error instanceof PluginRouteError) return error
    throw error
  }
  throw new Error('Expected the request to be refused.')
}

describe('the routes', () => {
  it('are exactly these, with no PATCH (the SDK has none)', () => {
    expect([...register().routes.keys()].sort()).toEqual([
      'DELETE /debts/:id',
      'GET /account-suggestions',
      'GET /debts',
      'GET /debts/:id',
      'GET /plan',
      'GET /settings',
      'POST /debts',
      'PUT /debts/:id',
      'PUT /settings',
    ])
  })
})

describe('a request that is not valid', () => {
  it('is refused before the database is opened', async () => {
    const { call, opened } = register()
    const bad: Array<[string, Partial<RouteContext>]> = [
      ['POST /debts', { body: { name: 'x' } }],
      ['POST /debts', { body: null }],
      ['POST /debts', { body: [] }],
      ['PUT /debts/:id', { params: { id: ID }, body: {} }],
      ['PUT /debts/:id', { params: { id: 'nope' }, body: { name: 'x' } }],
      ['GET /debts/:id', { params: { id: 'nope' } }],
      ['DELETE /debts/:id', { params: {} }],
      ['PUT /settings', { body: { strategy: 'fast' } }],
      ['GET /plan', { query: { tz: 'Nowhere/Land' } }],
      ['GET /plan', { query: { extra: '-3' } }],
      ['GET /debts', { query: { includeArchived: 'maybe' } }],
    ]
    for (const [key, ctx] of bad) {
      const error = await refusal(call(key, ctx))
      expect(error.statusCode, key).toBe(400)
    }
    expect(opened()).toBe(0)
  })

  it('answers a body that is not an object with bad_body', async () => {
    const error = await refusal(register().call('POST /debts', { body: 'text' }))
    expect(error).toMatchObject({ statusCode: 400, code: 'bad_body' })
  })

  it('answers an invalid field with validation_failed and the field', async () => {
    const error = await refusal(
      register().call('POST /debts', { body: { name: 'Visa', balance: 12.5, apr: '24.99', minimumPayment: '35' } }),
    )
    expect(error).toMatchObject({ statusCode: 400, code: 'validation_failed', issues: [{ path: ['balance'] }] })
    expect(error.message.startsWith('balance: ')).toBe(true)
  })

  it('answers a malformed id with bad_id on the id', async () => {
    const error = await refusal(register().call('GET /debts/:id', { params: { id: '1' } }))
    expect(error).toMatchObject({ statusCode: 400, code: 'bad_id', issues: [{ path: ['id'] }] })
  })
})
