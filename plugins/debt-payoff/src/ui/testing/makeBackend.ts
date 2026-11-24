import { buildPayoffPlan, whatIfLumpSum, type PlanResponse, type Strategy } from '../../shared/index.js'
import { DEBT_PAYOFF_API_BASE } from '../../server/constants.js'
import type { AccountSuggestion, Debt, LumpSum, PlanSettings } from '../models/index.js'
import { makeApi } from './makeApi.js'
import type { MockApi } from './MockApi.js'

/** The day every test plan starts from. */
export const TODAY = '2026-10-10'

/** An in-memory stand-in for the plugin's API, honouring the same routes and shapes. */
export interface Backend {
  readonly api: MockApi
  readonly state: { debts: Debt[]; settings: PlanSettings; suggestions: AccountSuggestion[]; lumpSums: LumpSum[] }
  /** The requests made, as `METHOD path`. */
  readonly calls: () => string[]
}

/**
 * Builds a fake API over a list of debts, computing plans with the real planner
 * so a page test sees what a person would.
 *
 * @param debts - The debts to start with.
 * @param suggestions - The accounts offered for linking.
 * @param lumpSums - The lump sums to start with.
 */
export function makeBackend(
  debts: readonly Debt[] = [],
  suggestions: readonly AccountSuggestion[] = [],
  lumpSums: readonly LumpSum[] = [],
): Backend {
  const state = {
    debts: [...debts],
    suggestions: [...suggestions],
    lumpSums: [...lumpSums],
    settings: { strategy: 'avalanche', extraPayment: '0.0000', saved: false } as PlanSettings,
  }
  const api = makeApi()
  const log: string[] = []
  const active = () => state.debts.filter((d) => !d.archived)
  const inputs = () => active().filter((d) => d.included).map((d) => ({
    id: d.id, name: d.name, balance: d.balance, apr: d.apr, minimumPayment: d.minimumPayment,
    extraPayment: d.extraPayment, repaymentStartsOn: d.repaymentStartsOn, promoApr: d.promoApr,
    promoEndsOn: d.promoEndsOn, promoDeferredInterest: d.promoDeferredInterest,
    promoInterestBase: d.promoInterestBase, compounding: d.compounding,
  }))
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
    if (route === '/lump-sums') return { lumpSums: sorted(state.lumpSums) }
    if (route === '/plan') {
      const active = state.debts.filter((d) => !d.archived)
      const plan = buildPayoffPlan(
        inputs(),
        {
          strategy: (params.get('strategy') ?? state.settings.strategy) as Strategy,
          extraPayment: params.get('extra') ?? state.settings.extraPayment,
          startDate: TODAY,
          lumpSums: state.lumpSums.map(toInput),
        },
      )
      const response: PlanResponse = {
        ...plan,
        excludedDebts: active.filter((d) => !d.included).map((d) => ({ id: d.id, name: d.name })),
      }
      return response
    }
    throw new Error(`unexpected GET ${path}`)
  })
  api.post.mockImplementation(async (path: string, body: unknown) => {
    log.push(`POST ${strip(path)}`)
    if (strip(path) === '/lump-sums') {
      const lump = lumpFrom(`lump-${state.lumpSums.length + 1}`, body as Record<string, unknown>)
      state.lumpSums.push(lump)
      return lump
    }
    if (strip(path) === '/plan/what-if') {
      const b = body as Record<string, unknown>
      const candidate = lumpFrom('what-if', b)
      return whatIfLumpSum(
        inputs(),
        {
          strategy: (b['strategy'] ?? state.settings.strategy) as Strategy,
          extraPayment: String(b['extra'] ?? state.settings.extraPayment),
          startDate: TODAY,
          lumpSums: state.lumpSums.map(toInput),
        },
        toInput(candidate),
      )
    }
    const b = body as Record<string, string | boolean | null>
    const debt: Debt = {
      id: `new-${state.debts.length + 1}`,
      name: String(b['name']),
      balance: `${b['balance']}`.includes('.') ? String(b['balance']) : `${b['balance']}.0000`,
      apr: String(b['apr']),
      minimumPayment: String(b['minimumPayment']),
      accountId: (b['accountId'] ?? null) as string | null,
      sortOrder: state.debts.length,
      archived: false,
      included: b['included'] !== false,
      extraPayment: b['extraPayment'] === undefined ? '0.0000' : `${Number(b['extraPayment']).toFixed(4)}`,
      repaymentStartsOn: (b['repaymentStartsOn'] ?? null) as string | null,
      promoApr: b['promoApr'] == null ? null : `${Number(b['promoApr']).toFixed(4)}`,
      promoEndsOn: (b['promoEndsOn'] ?? null) as string | null,
      promoDeferredInterest: b['promoDeferredInterest'] === true,
      promoInterestBase: (b['promoInterestBase'] ?? 'original') as Debt['promoInterestBase'],
      compounding: (b['compounding'] ?? 'monthly') as Debt['compounding'],
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
    if (route === '/debts/order') {
      // As the server does: every active debt once, numbered from zero in the order sent.
      const ids = (b['ids'] as string[])
      const active = state.debts.filter((d) => !d.archived)
      if (ids.length !== active.length || ids.some((id) => !active.some((d) => d.id === id))) {
        throw new Error('ids: Send every debt that is not archived.')
      }
      const moved = ids.map((id, i) => ({ ...(active.find((d) => d.id === id) as Debt), sortOrder: i }))
      state.debts = [...moved, ...state.debts.filter((d) => d.archived)]
      return { debts: moved }
    }
    if (route.startsWith('/lump-sums/')) {
      const id = route.replace('/lump-sums/', '')
      const updated = lumpFrom(id, b)
      state.lumpSums = state.lumpSums.map((l) => (l.id === id ? updated : l))
      return updated
    }
    const id = route.replace('/debts/', '')
    state.debts = state.debts.map((d) => (d.id === id ? { ...d, ...(b as Partial<Debt>) } : d))
    return state.debts.find((d) => d.id === id)
  })
  api.del.mockImplementation(async (path: string) => {
    log.push(`DELETE ${strip(path)}`)
    if (strip(path).startsWith('/lump-sums/')) {
      const id = strip(path).replace('/lump-sums/', '')
      state.lumpSums = state.lumpSums.filter((l) => l.id !== id)
      return { removed: 1 }
    }
    const id = strip(path).replace('/debts/', '')
    state.debts = state.debts.filter((d) => d.id !== id)
    return { removed: 1 }
  })

  return { api, state, calls: () => log }
}


/** Four decimal places, as the server returns money. */
const money = (value: unknown): string => Number(value).toFixed(4)

/** A lump sum as the server would save and return what the form sent. */
function lumpFrom(id: string, body: Record<string, unknown>): LumpSum {
  const parts = (body['allocations'] ?? []) as Array<{ debtId: string; amount: string }>
  return {
    id,
    onDate: String(body['onDate']),
    amount: money(body['amount']),
    note: String(body['note'] ?? ''),
    allocations: parts.map((a) => ({ debtId: a.debtId, amount: money(a.amount) })),
  }
}

const toInput = (l: LumpSum) => ({ id: l.id, onDate: l.onDate, amount: l.amount, allocations: l.allocations })

const sorted = (lumps: readonly LumpSum[]): LumpSum[] => [...lumps].sort((a, b) => a.onDate.localeCompare(b.onDate))
