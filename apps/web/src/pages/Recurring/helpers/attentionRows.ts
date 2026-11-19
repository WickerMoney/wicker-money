import type { DismissedSuggestion, MatchSuggestion, RecurringItem } from '../../../models/index.js'

/** One unsettled occurrence that needs a payment found for it. */
export interface AttentionRow {
  readonly item: RecurringItem
  /** The occurrence's nominal date: its identity. */
  readonly nominalDate: string
  /** `late` is still counted as coming; `missed` is not. */
  readonly state: 'late' | 'missed'
  /** Whole days from the nominal date to today. */
  readonly daysLate: number
}

/** The dismissed pairs for one item. */
export interface DismissedGroup {
  readonly itemId: string
  readonly name: string
  readonly entries: readonly DismissedSuggestion[]
}

/**
 * Whole days from one ISO date to another.
 *
 * @param from - The earlier date, `YYYY-MM-DD`.
 * @param to - The later date, `YYYY-MM-DD`.
 * @returns The difference in days; negative if `to` is first.
 */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/**
 * The late and missed occurrences to list: late first, then missed, the
 * oldest first within each. One that already has a suggested match is left
 * out, because the suggestion above it is the way to settle it.
 *
 * @param items - The recurring items as the server lists them.
 * @param today - The server's today.
 * @param suggestions - The suggested matches on the page.
 * @returns The rows.
 */
export function attentionRows(
  items: readonly RecurringItem[],
  today: string,
  suggestions: readonly MatchSuggestion[],
): AttentionRow[] {
  const suggested = new Set(suggestions.map((s) => `${s.occurrence.itemId}:${s.occurrence.nominalDate}`))
  const rows: AttentionRow[] = []
  for (const item of items) {
    for (const [state, dates] of [['late', item.late], ['missed', item.missed]] as const) {
      for (const nominalDate of dates) {
        if (suggested.has(`${item.id}:${nominalDate}`)) continue
        rows.push({ item, nominalDate, state, daysLate: daysBetween(nominalDate, today) })
      }
    }
  }
  const rank = (r: AttentionRow) => (r.state === 'late' ? 0 : 1)
  return rows.sort((a, b) => rank(a) - rank(b) || b.daysLate - a.daysLate || a.item.name.localeCompare(b.item.name))
}

/**
 * Groups dismissed suggestions by the item they were dismissed for, so a
 * misclick is found under the item's name. Groups sort by name; entries keep
 * the server's order.
 *
 * @param dismissed - The dismissed pairs.
 * @returns The groups.
 */
export function groupDismissed(dismissed: readonly DismissedSuggestion[]): DismissedGroup[] {
  const groups = new Map<string, { name: string; entries: DismissedSuggestion[] }>()
  for (const d of dismissed) {
    const found = groups.get(d.occurrence.itemId)
    if (found === undefined) groups.set(d.occurrence.itemId, { name: d.occurrence.name, entries: [d] })
    else found.entries.push(d)
  }
  return [...groups].map(([itemId, g]) => ({ itemId, ...g })).sort((a, b) => a.name.localeCompare(b.name))
}
