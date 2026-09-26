import { describe, expect, it } from 'vitest'
import { isSpaRoute } from './isSpaRoute.js'

describe('isSpaRoute', () => {
  it.each([
    ['GET', '/'],
    ['GET', '/transactions'],
    ['GET', '/transactions/3f1c?tab=splits'],
    ['GET', '/budgets/2026-09'],
    ['HEAD', '/accounts'],
  ])('serves the app shell for %s %s', (method, url) => {
    expect(isSpaRoute(method, url)).toBe(true)
  })

  it.each([
    ['GET', '/api'],
    ['GET', '/api/'],
    ['GET', '/api/v1/nope'],
    ['GET', '/api/v1/accounts?x=1'],
  ])('leaves %s %s to the API', (method, url) => {
    expect(isSpaRoute(method, url)).toBe(false)
  })

  it.each([
    ['GET', '/assets/index-abc123.js'],
    ['GET', '/plugins/budgets/remoteEntry.js'],
    ['GET', '/favicon.ico'],
    ['GET', '/.env'],
    ['GET', '/deep/path/file.map?v=1'],
  ])('answers a missing file (%s %s) with a 404, not HTML', (method, url) => {
    expect(isSpaRoute(method, url)).toBe(false)
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('never answers %s with the app shell', (method) => {
    expect(isSpaRoute(method, '/transactions')).toBe(false)
  })

  it('treats a route that merely starts with "api" as an app route', () => {
    expect(isSpaRoute('GET', '/apiary')).toBe(true)
  })
})
