import { buildPayoffPlan, type Strategy } from '../../shared/index.js'
import { DEBT_PAYOFF_API_BASE } from '../../server/constants.js'
import type { AccountSuggestion, Debt, PlanSettings } from '../models/index.js'
import { makeApi } from './makeApi.js'
import type { MockApi } from './MockApi.js'

/** The day every test plan starts from. */
export const TODAY = '2026-10-10'

/** An in-memory stand-in for the plugin's API, honouring the same routes and shapes. */
export interface Backend {
  readonly api: MockApi
  readonly state: { debts: Debt[]; settings: PlanSettings; suggestions: AccountSuggestion[] }
  /** The requests made, as `METHOD path`. */
  readonly calls: () => string[]
}

/**
 * Builds a fake API over a list of debts, computing plans with the real planner
 * so a page test sees what a person would.
 *
 * @param debts - The debts to start with.
 * @param suggestions - The accounts offered for linking.
 */
export function makeBackend(debts: readonly Debt[] = [], suggestions: readonly AccountSuggestion[] = []): Backend {
  const state = {
    debts: [...debts],
    suggestions: [...suggestions],
    settings: { strategy: 'avalanche', extraPayment: '0.0000', saved: false } as PlanSettings,
  }
  const api = makeApi()
  const log: string[] = []
  const strip = (path: string) => path.replace(DEBT_PAYOFF_API_BASE, '')

  api.get.mockImplementation(async (path: string) => {
    log.push(`GET ${strip(path)}`)
    const [route = '', query = ''] = strip(path).split('?')
    const params = new URLSearchParams(query)
    if (route === '/debts') {
      return { debts: params.get('includeArchived') === 'true' ? state.debts : state.debts.filter((d) => !d.archived) }
    }
    if (route === '/settings') return state.settings
    if (route === '/account-suggestions') return { accounts: state.suggestions }
    if (route === '/plan') {
      return buildPayoffPlan(
        state.debts.filter((d) => !d.archived).map((d) => ({
          id: d.id, name: d.name, balance: d.balance, apr: d.apr, minimumPayment: d.minimumPayment,
        })),
        {
          strategy: (params.get('strategy') ?? state.settings.strategy) as Strategy,
          extraPayment: params.get('extra') ?? state.settings.extraPayment,
          startDate: TODAY,
        },
      )
    }
    throw new Error(`unexpected GET ${path}`)
  })
  api.post.mockImplementation(async (path: string, body: unknown) => {
    log.push(`POST ${strip(path)}`)
    const b = body as Record<string, string | null>
    const debt: Debt = {
      id: `new-${state.debts.length + 1}`,
      name: String(b['name']),
      balance: `${b['balance']}`.includes('.') ? String(b['balance']) : `${b['balance']}.0000`,
      apr: String(b['apr']),
      minimumPayment: String(b['minimumPayment']),
      accountId: (b['accountId'] ?? null) as string | null,
      sortOrder: state.debts.length,
      archived: false,
    }
    state.debts.push(debt)
    return debt
  })
  api.put.mockImplementation(async (path: string, body: unknown) => {
    log.push(`PUT ${strip(path)}`)
    const route = strip(path)
    const b = body as Record<string, unknown>
    if (route === '/settings') {
      state.settings = {
        strategy: (b['strategy'] as Strategy | undefined) ?? state.settings.strategy,
        extraPayment: b['extraPayment'] === undefined ? state.settings.extraPayment : `${Number(b['extraPayment']).toFixed(4)}`,
        saved: true,
      }
      return state.settings
    }
    const id = route.replace('/debts/', '')
    state.debts = state.debts.map((d) => (d.id === id ? { ...d, ...(b as Partial<Debt>) } : d))
    return state.debts.find((d) => d.id === id)
  })
  api.del.mockImplementation(async (path: string) => {
    log.push(`DELETE ${strip(path)}`)
    const id = strip(path).replace('/debts/', '')
    state.debts = state.debts.filter((d) => d.id !== id)
    return { removed: 1 }
  })

  return { api, state, calls: () => log }
}

