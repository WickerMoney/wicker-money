import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { describe, expect, it } from 'vitest'
import { pageTitleFor } from './pageTitleFor.js'

const plugin = {
  id: 'budgets',
  contributes: { pages: [{ path: 'budgets', title: 'Budgets' }, { path: 'budgets/windows', title: 'Budget windows' }] },
} as unknown as PluginManifest

describe('pageTitleFor', () => {
  it('names core pages', () => {
    expect(pageTitleFor('/', [])).toBe('Dashboard - Wicker Money')
    expect(pageTitleFor('/accounts', [])).toBe('Accounts - Wicker Money')
    expect(pageTitleFor('/settings', [])).toBe('Settings - Wicker Money')
  })

  it('names a nested path after its parent route', () => {
    expect(pageTitleFor('/categories/anything', [])).toBe('Categories - Wicker Money')
  })

  it('does not treat every path as the dashboard', () => {
    expect(pageTitleFor('/nowhere', [])).toBe('Page not found - Wicker Money')
  })

  it('names plugin pages from their manifest title, longest match first', () => {
    expect(pageTitleFor('/p/budgets/budgets', [plugin])).toBe('Budgets - Wicker Money')
    expect(pageTitleFor('/p/budgets/budgets/windows', [plugin])).toBe('Budget windows - Wicker Money')
  })

  it('says so when a plugin address has no page behind it', () => {
    expect(pageTitleFor('/p/gone/page', [plugin])).toBe('Plugin unavailable - Wicker Money')
  })
})
