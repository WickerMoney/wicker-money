import { BUDGETS_PLUGIN_ID } from '@wickermoney/plugin-budgets/server'
import { addMonths } from '@wickermoney/plugin-sdk/recurrence'
import { asPlugin, type Db } from '../client.js'
import { pluginRoleName } from '../plugin-roles.js'
import { queryRunner } from '../../plugins/queryRunner.js'
import { firstDayOfMonth, todayIso } from './seedRng.js'
import type { Persona } from './seedPersonas.js'

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
export function budgetLineDefsFor(personaKey: Persona['key']): readonly BudgetLineDef[] {
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
      const monthAnchor = addMonths(todayIso(), -def.monthsAgo)
      const periodStart = firstDayOfMonth(monthAnchor)
      const periodEnd = firstDayOfMonth(addMonths(monthAnchor, 1))
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

/** One `plugin_budgets.account_lines` row to create, for one calendar month. */
export interface AccountLineDef {
  /** The persona's account key, as in `seedAccounts`. */
  readonly accountKey: string
  readonly monthsAgo: number
  readonly planned: string
  readonly rollover: boolean
  /** Catalog slugs of categories that do not count against the line. Unknown slugs are skipped. */
  readonly excludedSlugs: readonly string[]
  readonly note?: string
}

/**
 * The account lines each persona gets: an allowance on one checking account,
 * for the current and previous month so the first has something to carry in.
 *
 * `household` is the shape this feature exists for, a monthly spending
 * allowance in the Monthly Expenses checking account that also receives
 * holiday money; `hero` has a plain one on its everyday checking.
 *
 * @param personaKey - The persona.
 * @returns The definitions, empty for a persona with none.
 */
export function accountLineDefsFor(personaKey: Persona['key']): readonly AccountLineDef[] {
  if (personaKey === 'household') {
    return [0, 1].map((monthsAgo) => ({
      accountKey: 'monthly', monthsAgo, planned: '150.0000', rollover: true, excludedSlugs: ['gifts'],
      note: 'Spending money. Holiday gifts have their own window.',
    }))
  }
  if (personaKey === 'hero') {
    return [0, 1].map((monthsAgo) => ({
      accountKey: 'checking', monthsAgo, planned: '400.0000', rollover: true, excludedSlugs: [],
    }))
  }
  return []
}

/**
 * Inserts every account line under the budgets plugin's own database role, as
 * {@link createBudgetLines} does for category lines.
 *
 * @param db - Application database handle.
 * @param userId - The persona's user id.
 * @param defs - From {@link accountLineDefsFor}.
 * @param accountIds - This persona's account key to account id map.
 * @param slugToId - This persona's catalog slug to category id map.
 */
export async function createAccountLines(
  db: Db,
  userId: string,
  defs: readonly AccountLineDef[],
  accountIds: ReadonlyMap<string, string>,
  slugToId: ReadonlyMap<string, string>,
): Promise<void> {
  if (defs.length === 0) return
  const role = pluginRoleName(BUDGETS_PLUGIN_ID)
  await asPlugin(db, role, userId, async (trx) => {
    const q = queryRunner(trx)
    for (const def of defs) {
      const accountId = accountIds.get(def.accountKey)
      if (accountId === undefined) continue
      const excluded = def.excludedSlugs.flatMap((slug) => slugToId.get(slug) ?? [])
      const monthAnchor = addMonths(todayIso(), -def.monthsAgo)
      const periodStart = firstDayOfMonth(monthAnchor)
      const periodEnd = firstDayOfMonth(addMonths(monthAnchor, 1))
      await q`
        INSERT INTO plugin_budgets.account_lines
          (user_id, account_id, period_start, period_end, planned, rollover, excluded_category_ids, note)
        VALUES (
          core.current_user_id(), ${accountId}, ${periodStart}::date, ${periodEnd}::date,
          ${def.planned}::numeric, ${def.rollover}, ${excluded}::uuid[], ${def.note ?? null}
        )
        ON CONFLICT (user_id, account_id, period_start) DO NOTHING
      `
    }
  })
}
