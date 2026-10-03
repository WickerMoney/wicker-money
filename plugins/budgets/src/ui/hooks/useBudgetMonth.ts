import { useCallback, useEffect, useRef, useState } from 'react'
import type { PluginContext } from '@wickermoney/plugin-sdk'
import { isBudgetable, isValidPlan, monthKeyOf, shiftMonth, todayIn } from '../../shared/index.js'
import { BUDGETS_API_BASE } from '../../server/constants.js'
import { monthLabel } from '../helpers/monthLabel.js'
import type { Category, MonthLine, MonthResponse, WindowDraft } from '../models/index.js'

/** What {@link useBudgetMonth} returns. */
export interface BudgetMonth {
  readonly monthKey: string
  /** `null` while a month is loading. */
  readonly month: MonthResponse | null
  /** Categories that can carry a budget line: enabled, and neither income nor transfer. */
  readonly categories: readonly Category[]
  /** The message currently shown: a failure, or a notice after carrying lines over. */
  readonly message: string | null
  readonly busy: boolean
  /** Plans being typed and not yet saved, keyed by category id. */
  readonly edits: Readonly<Record<string, string>>
  readonly previousMonth: () => void
  readonly nextMonth: () => void
  readonly thisMonth: () => void
  readonly editPlan: (categoryId: string, value: string) => void
  /** Saves a line's plan and rollover setting. */
  readonly save: (line: MonthLine, planned: string, rollover: boolean) => Promise<void>
  readonly remove: (line: MonthLine) => Promise<void>
  /** Saves the previewed lines as this month's budget. */
  readonly adopt: () => Promise<void>
  /** Adds a zero-plan line for a category. */
  readonly addLine: (categoryId: string) => Promise<void>
  /**
   * Creates a window, or saves changes to one.
   *
   * @returns `true` once saved, so the form can clear itself; `false` when it
   *   was refused, with the reason in `message`.
   */
  readonly saveWindow: (draft: WindowDraft) => Promise<boolean>
}

/**
 * Loads one month of budget and provides the actions that change it.
 *
 * Every figure except the plan is derived from the ledger by the server on each
 * load, so nothing here can disagree with the transactions page.
 *
 * Only the newest load may write to state: starting one aborts the one before
 * it, so a slow response for an earlier month can never replace the month the
 * user is now looking at. A save that finishes after the user has moved on does
 * not reload the month they left.
 *
 * The hook depends on the API client and the time zone, not on the identity of
 * the context object, so a host that rebuilds the context on every render does
 * not cause a refetch.
 *
 * @param ctx - The plugin context supplying the scoped API client and the user's time zone.
 */
export function useBudgetMonth(ctx: PluginContext): BudgetMonth {
  const { api } = ctx
  const timezone = ctx.session.timezone

  const [monthKey, setMonthKey] = useState(() => monthKeyOf(todayIn(timezone)))
  const [month, setMonth] = useState<MonthResponse | null>(null)
  const [categories, setCategories] = useState<readonly Category[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [edits, setEdits] = useState<Record<string, string>>({})

  const shownKey = useRef(monthKey)
  const inFlight = useRef<AbortController | null>(null)

  const load = useCallback(async (key: string) => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    const { signal } = controller

    setMessage(null)
    try {
      const [loaded, cats] = await Promise.all([
        api.get<MonthResponse>(
          `${BUDGETS_API_BASE}/month?month=${key}&tz=${encodeURIComponent(timezone)}`,
          { signal },
        ),
        api.get<Category[]>('/core/categories/list', { signal }),
      ])
      if (signal.aborted) return
      setMonth(loaded)
      // Only categories a budget can count; income and transfers would always read zero.
      setCategories(cats.filter(isBudgetable))
      setEdits({})
    } catch (e) {
      // A superseded load is not a failure: whoever superseded it reports on the month now shown.
      if (!signal.aborted) throw e
    }
  }, [api, timezone])

  // Reloads after a change, unless the user has since moved to another month:
  // that month has its own load, and this one would replace it.
  const reload = useCallback(
    (key: string) => (key === shownKey.current ? load(key) : Promise.resolve()),
    [load],
  )

  useEffect(() => {
    shownKey.current = monthKey
    setMonth(null)
    load(monthKey).catch((e: unknown) => {
      setMessage(e instanceof Error ? e.message : 'Could not load this month.')
    })
    return () => inFlight.current?.abort()
  }, [load, monthKey])

  const save = useCallback(async (line: MonthLine, planned: string, rollover: boolean) => {
    if (!isValidPlan(planned)) {
      setMessage(`'${planned}' is not an amount.`)
      return
    }
    setBusy(true); setMessage(null)
    try {
      await api.put(`${BUDGETS_API_BASE}/line`, {
        month: monthKey, categoryId: line.categoryId, planned, rollover, note: line.note,
      })
      await reload(monthKey)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save that line.')
    } finally { setBusy(false) }
  }, [api, monthKey, reload])

  const remove = useCallback(async (line: MonthLine) => {
    setBusy(true); setMessage(null)
    try {
      // A window is removed as a whole, by id, whichever of its months is shown.
      await api.del(
        line.window != null && line.id !== null
          ? `${BUDGETS_API_BASE}/window?id=${line.id}`
          : `${BUDGETS_API_BASE}/line?month=${monthKey}&categoryId=${line.categoryId}`,
      )
      await reload(monthKey)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not remove that line.')
    } finally { setBusy(false) }
  }, [api, monthKey, reload])

  const adopt = useCallback(async () => {
    setBusy(true); setMessage(null)
    try {
      const r = await api.post<{ created: number }>(`${BUDGETS_API_BASE}/month/adopt`, { month: monthKey })
      await reload(monthKey)
      if (monthKey === shownKey.current) {
        setMessage(`${r.created} lines carried over from ${monthLabel(shiftMonth(monthKey, -1))}.`)
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not start this month.')
    } finally { setBusy(false) }
  }, [api, monthKey, reload])

  const addLine = useCallback(async (categoryId: string) => {
    if (categoryId === '') return
    setBusy(true); setMessage(null)
    try {
      await api.put(`${BUDGETS_API_BASE}/line`, {
        month: monthKey, categoryId, planned: '0.0000', rollover: false,
      })
      await reload(monthKey)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not add that line.')
    } finally { setBusy(false) }
  }, [api, monthKey, reload])

  const saveWindow = useCallback(async (draft: WindowDraft): Promise<boolean> => {
    if (!isValidPlan(draft.planned)) {
      setMessage(`'${draft.planned}' is not an amount.`)
      return false
    }
    setBusy(true); setMessage(null)
    try {
      await api.put(`${BUDGETS_API_BASE}/window`, draft)
      await reload(monthKey)
      return true
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save that window.')
      return false
    } finally { setBusy(false) }
  }, [api, monthKey, reload])

  const previousMonth = useCallback(() => setMonthKey((k) => shiftMonth(k, -1)), [])
  const nextMonth = useCallback(() => setMonthKey((k) => shiftMonth(k, 1)), [])
  const thisMonth = useCallback(() => setMonthKey(monthKeyOf(todayIn(timezone))), [timezone])
  const editPlan = useCallback(
    (categoryId: string, value: string) => setEdits((c) => ({ ...c, [categoryId]: value })),
    [],
  )

  return {
    monthKey, month, categories, message, busy, edits,
    previousMonth, nextMonth, thisMonth, editPlan,
    save, remove, adopt, addLine, saveWindow,
  }
}
