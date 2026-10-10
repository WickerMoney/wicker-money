import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveRange, type PluginManifest, type WidgetSize } from '@wickermoney/plugin-sdk'
import { setAccessToken } from '../api/client.js'
import { buildPluginContext } from './context.js'
// The real widgets, with their real `useMonthlySummary` hooks, as the dashboard
// mounts them. Imported by path because plugins are not workspace libraries.
import DonutWidget from '../../../../plugins/insights/src/DonutWidget.js'
import TrendWidget from '../../../../plugins/insights/src/TrendWidget.js'
import SpendingTrendsWidget from '../../../../plugins/spending-trends/src/SpendingTrendsWidget.js'

const user = { id: 'u1', email: 'u1@example.com', timezone: 'UTC', role: 'member' as const }

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

function manifest(id: string): PluginManifest {
  return {
    id, name: id, version: '0.1.0', description: '', author: '', sdkVersion: 0, permissions: [],
    remoteEntry: '',
    requiredTables: [{ table: 'transactions', access: 'read' }, { table: 'categories', access: 'read' }],
    contributes: { widgets: [], pages: [] },
  } as unknown as PluginManifest
}

const range = resolveRange('12m', '2026-10-09')
const size: WidgetSize = 'md'

let fetchMock: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>

beforeEach(() => {
  fetchMock = vi.fn(async () => json({
    months: 12,
    rows: [{ month: '2026-09', categoryId: 'c1', categoryName: 'Groceries', kind: 'expense', total: '40.00' }],
  }))
  vi.stubGlobal('fetch', fetchMock)
  setAccessToken(null)
})

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
})

describe('the dashboard\'s three monthly-summary consumers', () => {
  it('cost one network request between them, with no change to the plugins', async () => {
    const insights = buildPluginContext(manifest('wickermoney.insights'), user, () => {})
    const trends = buildPluginContext(manifest('wickermoney.spending-trends'), user, () => {})

    render(
      <>
        <DonutWidget ctx={insights} size={size} range={range} />
        <TrendWidget ctx={insights} size={size} range={range} />
        <SpendingTrendsWidget ctx={trends} size={size} range={range} />
      </>,
    )

    await waitFor(() => expect(screen.queryByLabelText(/loading/i)).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
    const summaryCalls = fetchMock.mock.calls.filter(([url]) => url.includes('/core/transactions/monthly-summary'))
    expect(summaryCalls).toHaveLength(1)
    expect(summaryCalls[0]![0]).toBe('/api/v1/core/transactions/monthly-summary?months=12')
  })
})
