import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PluginContext } from '@wickermoney/plugin-sdk/runtime'
import { NO_FORM_ERRORS, formErrorsFrom, type FormErrors } from '@wickermoney/ui-kit'
import { DEBT_PAYOFF_API_BASE } from '../../server/constants.js'
import type { PlanResponse, Strategy } from '../../shared/index.js'
import { checkDraft } from '../helpers/checkDraft.js'
import { colorFor } from '../helpers/colorFor.js'
import { draftBody } from '../helpers/draftBody.js'
import { moneyProblem } from '../helpers/moneyProblem.js'
import type {
  AccountSuggestion, AccountSuggestionsResponse, Debt, DebtDraft, DebtsResponse, PlanSettings,
} from '../models/index.js'

const DEBT_FIELDS = ['name', 'balance', 'apr', 'minimumPayment', 'accountId', 'archived', 'included', 'extraPayment'] as const
const SETTINGS_FIELDS = ['extraPayment', 'strategy'] as const

/** What {@link useDebtPayoff} returns. */
export interface DebtPayoff {
  /** The person's debts, in their own order; `null` while loading. */
  readonly debts: readonly Debt[] | null
  /** Each active debt's chart colour by id. Colour follows a debt's place in the list, not the payoff order. */
  readonly colors: ReadonlyMap<string, string>
  /** The saved strategy and extra; `null` while loading. */
  readonly settings: PlanSettings | null
  /** The plan for the saved strategy and extra; kept on screen while the next one loads. */
  readonly plan: PlanResponse | null
  /** Whether a plan is being fetched. */
  readonly planLoading: boolean
  /** Loan and credit card accounts a debt could track. */
  readonly suggestions: readonly AccountSuggestion[]
  readonly showArchived: boolean
  readonly setShowArchived: (value: boolean) => void
  /** A failure to show above the page, or `null`. */
  readonly message: string | null
  /** What just happened, for the page's live region. Empty until something does. */
  readonly status: string
  /** Whether a change is being saved. */
  readonly busy: boolean
  /** Picks a strategy and saves the choice. */
  readonly chooseStrategy: (strategy: Strategy) => Promise<void>
  /**
   * Saves a new monthly extra.
   *
   * @returns The problem to show on the field, or no errors once saved.
   */
  readonly applyExtra: (text: string) => Promise<FormErrors>
  /**
   * Adds a debt, or changes one.
   *
   * @param id - The debt to change, or `null` to add one.
   * @returns The problems by field, or no errors once saved.
   */
  readonly saveDebt: (id: string | null, draft: DebtDraft) => Promise<FormErrors>
  /** Removes a debt for good. Resolves to whether it went. */
  readonly removeDebt: (debt: Debt) => Promise<boolean>
  /** Switches a debt into or out of the plan, saved at once. */
  readonly setIncluded: (debt: Debt, included: boolean) => Promise<void>
}

/**
 * Loads the debts, the saved settings and the plan, and provides the actions
 * that change them.
 *
 * Each load is tied to an `AbortController`, so a slow answer for an earlier
 * request can never replace a newer one. The plan is asked for with the strategy
 * and extra explicitly, which costs the server one statement fewer than letting
 * it read the settings.
 *
 * @param ctx - The plugin context.
 */
export function useDebtPayoff(ctx: PluginContext): DebtPayoff {
  const { api } = ctx
  const { timezone } = ctx.session
  const [debts, setDebts] = useState<readonly Debt[] | null>(null)
  const [settings, setSettings] = useState<PlanSettings | null>(null)
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<readonly AccountSuggestion[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  // Bumped after any change to the debts, so the list, the suggestions and the plan are read again.
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    api.get<PlanSettings>(`${DEBT_PAYOFF_API_BASE}/settings`, { signal })
      .then((s) => { if (!signal.aborted) setSettings(s) })
      .catch((e: unknown) => {
        if (signal.aborted) return
        setMessage(messageOf(e, 'Could not load your plan settings.'))
        setSettings({ strategy: 'avalanche', extraPayment: '0.0000', saved: false })
      })
    return () => controller.abort()
  }, [api])

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const query = showArchived ? '?includeArchived=true' : ''
    api.get<DebtsResponse>(`${DEBT_PAYOFF_API_BASE}/debts${query}`, { signal })
      .then((r) => { if (!signal.aborted) { setDebts(r.debts); setMessage(null) } })
      .catch((e: unknown) => {
        if (signal.aborted) return
        setDebts((d) => d ?? [])
        setMessage(messageOf(e, 'Could not load your debts.'))
      })
    api.get<AccountSuggestionsResponse>(`${DEBT_PAYOFF_API_BASE}/account-suggestions`, { signal })
      .then((r) => { if (!signal.aborted) setSuggestions(r.accounts) })
      // Suggestions are a convenience; the page works without them.
      .catch(() => { if (!signal.aborted) setSuggestions([]) })
    return () => controller.abort()
  }, [api, showArchived, version])

  const strategy = settings?.strategy
  const extra = settings?.extraPayment
  useEffect(() => {
    if (strategy === undefined || extra === undefined) return
    const controller = new AbortController()
    const { signal } = controller
    setPlanLoading(true)
    const query = `?strategy=${strategy}&extra=${encodeURIComponent(extra)}&tz=${encodeURIComponent(timezone)}`
    api.get<PlanResponse>(`${DEBT_PAYOFF_API_BASE}/plan${query}`, { signal })
      .then((p) => { if (!signal.aborted) { setPlan(p); setPlanLoading(false) } })
      .catch((e: unknown) => {
        if (signal.aborted) return
        setPlanLoading(false)
        setMessage(messageOf(e, 'Could not work out the plan.'))
      })
    return () => controller.abort()
  }, [api, timezone, strategy, extra, version])

  const colors = useMemo(() => {
    const map = new Map<string, string>()
    ;(debts ?? []).filter((d) => !d.archived).forEach((d, i) => map.set(d.id, colorFor(i)))
    return map
  }, [debts])

  const saveSettings = useCallback(async (patch: Partial<Pick<PlanSettings, 'strategy' | 'extraPayment'>>) => {
    const saved = await api.put<PlanSettings>(`${DEBT_PAYOFF_API_BASE}/settings`, patch)
    setSettings(saved)
    return saved
  }, [api])

  const chooseStrategy = useCallback(async (next: Strategy) => {
    if (next === strategy) return
    setBusy(true)
    try {
      await saveSettings({ strategy: next })
      setMessage(null)
      setStatus(`${next === 'snowball' ? 'Snowball' : 'Avalanche'} selected. Updating the plan.`)
    } catch (e: unknown) {
      setMessage(messageOf(e, 'Could not save that choice.'))
    } finally {
      setBusy(false)
    }
  }, [saveSettings, strategy])

  const applyExtra = useCallback(async (text: string): Promise<FormErrors> => {
    const problem = moneyProblem(text.trim() === '' ? '0' : text)
    if (problem !== null) return { fields: { extraPayment: problem }, form: null }
    setBusy(true)
    try {
      await saveSettings({ extraPayment: text.trim() === '' ? '0' : text.trim() })
      setMessage(null)
      setStatus('Extra payment saved. Updating the plan.')
      return NO_FORM_ERRORS
    } catch (e: unknown) {
      return formErrorsFrom(e, SETTINGS_FIELDS, 'Could not save the extra payment.')
    } finally {
      setBusy(false)
    }
  }, [saveSettings])

  const saveDebt = useCallback(async (id: string | null, draft: DebtDraft): Promise<FormErrors> => {
    const problems = checkDraft(draft)
    if (problems.form !== null || Object.keys(problems.fields).length > 0) return problems
    setBusy(true)
    try {
      const body = draftBody(draft, id !== null)
      if (id === null) await api.post<Debt>(`${DEBT_PAYOFF_API_BASE}/debts`, body)
      else await api.put<Debt>(`${DEBT_PAYOFF_API_BASE}/debts/${id}`, body)
      setVersion((v) => v + 1)
      setMessage(null)
      setStatus(`${draft.name.trim()} ${id === null ? 'added' : 'saved'}. Updating the plan.`)
      return NO_FORM_ERRORS
    } catch (e: unknown) {
      return formErrorsFrom(e, DEBT_FIELDS, 'Could not save that debt.')
    } finally {
      setBusy(false)
    }
  }, [api])

  const setIncluded = useCallback(async (debt: Debt, included: boolean): Promise<void> => {
    setBusy(true)
    try {
      await api.put<Debt>(`${DEBT_PAYOFF_API_BASE}/debts/${debt.id}`, { included })
      setVersion((v) => v + 1)
      setMessage(null)
      setStatus(`${debt.name} ${included ? 'is now in' : 'left out of'} the plan. Updating the plan.`)
    } catch (e: unknown) {
      setMessage(messageOf(e, `Could not change whether ${debt.name} is in the plan.`))
    } finally {
      setBusy(false)
    }
  }, [api])

  const removeDebt = useCallback(async (debt: Debt): Promise<boolean> => {
    setBusy(true)
    try {
      await api.del(`${DEBT_PAYOFF_API_BASE}/debts/${debt.id}`)
      setVersion((v) => v + 1)
      setMessage(null)
      setStatus(`${debt.name} removed. Updating the plan.`)
      return true
    } catch (e: unknown) {
      setMessage(messageOf(e, 'Could not remove that debt.'))
      return false
    } finally {
      setBusy(false)
    }
  }, [api])

  return {
    debts, colors, settings, plan, planLoading, suggestions, showArchived, setShowArchived,
    message, status, busy, chooseStrategy, applyExtra, saveDebt, removeDebt, setIncluded,
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== '' ? error.message : fallback
}
