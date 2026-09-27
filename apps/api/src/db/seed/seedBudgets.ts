import { BUDGETS_PLUGIN_ID } from '@wickermoney/plugin-budgets/server'
import { asPlugin, type Db } from '../client.js'
import { pluginRoleName } from '../plugin-roles.js'
import { queryRunner } from '../../plugins/queryRunner.js'
import { addMonthsClamped, firstDayOfMonth, todayIso } from './seedRng.js'

/** One `plugin_budgets.budget_lines` row to create, for one calendar month. */
export interface BudgetLineDef {
  readonly categorySlug: string
  readonly monthsAgo: number
  readonly planned: string
  readonly rollover: boolean
  readonly note?: string
}

/**
 * `hero`'s budget lines, covering the current and previous month and every
 * state the plugin's own docs call out as meaningfully different: a line
 * comfortably under plan with rollover on, one deliberately under-funded so it
 * reads as at-risk or over, one planned at exactly zero (`planned >= 0` is a
 * real, meaningful state per the migration's own comment — "budgeted at
 * nothing" on purpose, not the same as no line at all), and at least one
 * category (`household-items`, which already has real spend from the Costco
 * split and the Amazon rule) left with no line whatsoever.
 */
export function budgetLineDefsFor(personaKey: 'hero' | 'second' | 'fresh'): readonly BudgetLineDef[] {
  if (personaKey === 'hero') {
    const months = [0, 1]
    return months.flatMap((monthsAgo) => [
      { categorySlug: 'groceries', monthsAgo, planned: '350.0000', rollover: true },
      { categorySlug: 'takeout', monthsAgo, planned: '60.0000', rollover: false, note: 'Deliberately tight — meant to run over.' },
      { categorySlug: 'gas', monthsAgo, planned: '120.0000', rollover: false },
      { categorySlug: 'coffee-shops', monthsAgo, planned: '0.0000', rollover: false, note: 'Budgeted at nothing on purpose.' },
    ])
  }
  if (personaKey === 'second') {
    return [{ categorySlug: 'groceries', monthsAgo: 0, planned: '300.0000', rollover: false }]
  }
  return []
}

/**
 * Inserts every budget line under the budgets plugin's own database role, the
 * same way `plugin_budgets.budget_lines`' real `upsert` does — that role, not
 * the application role, is the one actually granted access to the
 * `plugin_budgets` schema (migration 011), so this cannot be written through
 * `asUser`.
 *
 * @param db - Application database handle.
 * @param userId - The persona's user id.
 * @param defs - From {@link budgetLineDefsFor}.
 * @param slugToId - This persona's catalog slug to category id map.
 */
export async function createBudgetLines(
  db: Db,
  userId: string,
  defs: readonly BudgetLineDef[],
  slugToId: ReadonlyMap<string, string>,
): Promise<void> {
  if (defs.length === 0) return
  const role = pluginRoleName(BUDGETS_PLUGIN_ID)
  await asPlugin(db, role, userId, async (trx) => {
    const q = queryRunner(trx)
    for (const def of defs) {
      const categoryId = slugToId.get(def.categorySlug)
      if (categoryId === undefined) continue
      const monthAnchor = addMonthsClamped(todayIso(), -def.monthsAgo)
      const periodStart = firstDayOfMonth(monthAnchor)
      const periodEnd = firstDayOfMonth(addMonthsClamped(monthAnchor, 1))
      await q`
        INSERT INTO plugin_budgets.budget_lines
          (user_id, category_id, period_start, period_end, planned, rollover, note)
        VALUES (
          core.current_user_id(), ${categoryId}, ${periodStart}::date, ${periodEnd}::date,
          ${def.planned}::numeric, ${def.rollover}, ${def.note ?? null}
        )
        ON CONFLICT (user_id, category_id, period_start) DO NOTHING
      `
    }
  })
}
