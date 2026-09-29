import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginManifest } from '@wickermoney/plugin-sdk'

const apiGet = vi.fn()
const apiPost = vi.fn()

vi.mock('../api/client.js', () => ({ api: { get: apiGet, post: apiPost } }))

const { buildPluginContext } = await import('./context.js')

const user = { id: 'u1', email: 'demo@example.com', timezone: 'UTC' }

function manifestWith(tables: { table: string; access: string }[]): PluginManifest {
  return {
    id: 'wickermoney.insights',
    name: 'Insights',
    version: '0.1.0',
    description: '',
    author: '',
    sdkVersion: 0,
    permissions: [],
    remoteEntry: '/plugins/insights/remoteEntry.js',
    requiredTables: tables,
    contributes: { widgets: [], pages: [] },
  } as unknown as PluginManifest
}

beforeEach(() => {
  apiGet.mockReset()
  apiPost.mockReset()
  apiGet.mockResolvedValue({})
  apiPost.mockResolvedValue({})
})

describe('the scoped client handed to a plugin', () => {
  it('attaches the plugin id so the server can check the manifest', async () => {
    const ctx = buildPluginContext(
      manifestWith([{ table: 'transactions', access: 'read' }]), user, () => {},
    )

    await ctx.api.get('/core/transactions/monthly-summary?months=12')

    expect(apiGet).toHaveBeenCalledWith(
      '/core/transactions/monthly-summary?months=12',
      expect.objectContaining({ pluginId: 'wickermoney.insights' }),
    )
  })

  it('refuses a core table the manifest never asked for', async () => {
    const ctx = buildPluginContext(
      manifestWith([{ table: 'transactions', access: 'read' }]), user, () => {},
    )

    await expect(ctx.api.get('/core/accounts/summary')).rejects.toThrow(
      /no grant for 'accounts'/,
    )
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('maps a kebab-case path segment to its snake_case table', async () => {
    const granted = buildPluginContext(
      manifestWith([{ table: 'recurring_items', access: 'read' }]), user, () => {},
    )
    await granted.api.get('/core/recurring-items/upcoming')
    expect(apiGet).toHaveBeenCalledWith('/core/recurring-items/upcoming', expect.anything())

    const ungranted = buildPluginContext(
      manifestWith([{ table: 'transactions', access: 'read' }]), user, () => {},
    )
    await expect(ungranted.api.get('/core/recurring-items/list')).rejects.toThrow(/no grant for 'recurring_items'/)
  })

  it('applies the same guard to writes', async () => {
    const ctx = buildPluginContext(
      manifestWith([{ table: 'transactions', access: 'read' }]), user, () => {},
    )

    await expect(ctx.api.post('/core/budgets', { name: 'x' })).rejects.toThrow(/no grant/)
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('leaves non-core paths alone — a plugin owns its own namespace', async () => {
    const ctx = buildPluginContext(manifestWith([]), user, () => {})

    await ctx.api.get('/plugins/wickermoney.insights/settings')

    expect(apiGet).toHaveBeenCalledTimes(1)
  })
})

describe('formatting helpers', () => {
  it('formats a money string without going through a float in the plugin', () => {
    const ctx = buildPluginContext(manifestWith([]), user, () => {})
    expect(ctx.formatMoney('1234.50')).toBe('$1,234.50')
  })
})

describe('the version-prefix guard', () => {
  it('rejects a path that spells the API version itself', async () => {
    // The client adds /api/v1. A plugin repeating it produced
    // /api/v1/api/v1/p/... and a 404 that read like a missing route.
    const ctx = buildPluginContext(manifestWith([]), user, () => {})

    await expect(ctx.api.post('/api/v1/p/wickermoney.import-csv/analyze', {})).rejects.toThrow(
      /drop the '\/api\/v1' prefix/,
    )
    expect(apiPost).not.toHaveBeenCalled()
  })
})
