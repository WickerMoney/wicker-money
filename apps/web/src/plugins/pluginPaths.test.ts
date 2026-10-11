import { describe, expect, it } from 'vitest'
import { plainPath, refusalFor, tableFromPath } from './pluginPaths.js'

describe('tableFromPath', () => {
  it.each([
    ['/core/transactions', 'transactions'],
    ['/core/transactions/monthly-summary?months=12', 'transactions'],
    ['/core/recurring-items/upcoming', 'recurring_items'],
    ['/core/accounts?x=1', 'accounts'],
  ])('reads the table from %s', (path, table) => {
    expect(tableFromPath(path)).toBe(table)
  })

  it.each(['/p/x/y', '/core', '/core/', '/auth/me', 'core/transactions'])('finds none in %s', (path) => {
    expect(tableFromPath(path)).toBeNull()
  })
})

describe('plainPath', () => {
  it.each([
    '/core/transactions', '/core/transactions?limit=5&q=a/b', '/p/wickermoney.budgets/month?month=2026-05',
    '/p/wickermoney.budgets/', '/core/recurring-items/upcoming',
  ])('passes %s', (path) => {
    expect(plainPath(path)).toBe(path)
  })

  it.each([
    ['a dot segment', '/p/a.b/./x'],
    ['a parent segment', '/p/a.b/../../auth/refresh'],
    ['a parent segment after a table', '/core/transactions/../../auth/me'],
    ['an empty segment', '/core//transactions'],
    ['an encoded dot', '/p/a.b/%2e%2e/auth/me'],
    ['an encoded dot, upper case', '/p/a.b/%2E%2E/auth/me'],
    ['an encoded slash', '/p/a.b%2f..%2fauth'],
    ['an encoded backslash', '/p/a.b/%5c..'],
    ['an encoded NUL', '/core/transactions%00'],
    ['a backslash', '/p/a.b/..\\auth'],
    ['a control character', '/core/trans\nactions'],
    ['a fragment', '/core/transactions#x'],
    ['no leading slash', 'core/transactions'],
    ['a protocol-relative url', '//evil.example.com/x'],
    ['an absolute url', 'https://evil.example.com/x'],
  ])('refuses %s', (_name, path) => {
    expect(plainPath(path)).toBeNull()
  })

  it('allows dots inside a segment and inside the query', () => {
    expect(plainPath('/p/wickermoney.debt-payoff/plans?a=../b')).not.toBeNull()
  })
})

describe('refusalFor', () => {
  const granted = new Set(['transactions', 'recurring_items'])
  const id = 'wickermoney.budgets'

  it('allows a read of a granted core table', () => {
    expect(refusalFor(id, granted, 'GET', '/core/transactions/monthly-summary?months=12')).toBeNull()
    expect(refusalFor(id, granted, 'GET', '/core/recurring-items/upcoming')).toBeNull()
  })

  it('allows any method under the plugin\'s own namespace', () => {
    for (const m of ['GET', 'POST', 'PUT', 'DELETE']) {
      expect(refusalFor(id, granted, m, `/p/${id}/month`)).toBeNull()
    }
  })

  it('refuses a core table the manifest does not list', () => {
    expect(refusalFor(id, granted, 'GET', '/core/accounts')).toBe('outside_grants')
  })

  it('refuses a write to core, which has no route a plugin may use', () => {
    for (const m of ['POST', 'PUT', 'DELETE']) {
      expect(refusalFor(id, granted, m, '/core/transactions')).toBe('core_is_read_only')
    }
  })

  it.each([
    '/auth/refresh', '/auth/me', '/settings/export', '/plugins/wickermoney.budgets/token', '/plugins',
    '/users', '/transactions', '/p/wickermoney.import-csv/import', `/p/${'wickermoney.budgetsx'}/month`, '/p/wickermoney.budgets',
  ])('refuses %s', (path) => {
    expect(refusalFor(id, granted, 'GET', path)).toBe('outside_grants')
  })

  it('refuses a path that only looks like it is in the namespace', () => {
    expect(refusalFor(id, granted, 'GET', `/p/${id}/../../auth/refresh`)).toBe('not_plain')
    expect(refusalFor(id, granted, 'GET', `/p/${id}/%2e%2e/auth/refresh`)).toBe('not_plain')
    expect(refusalFor(id, granted, 'GET', '/core/transactions/../accounts')).toBe('not_plain')
  })
})
