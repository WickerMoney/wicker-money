import { subtractMoney, sumMoney, ZERO_MONEY } from '@wickermoney/plugin-sdk/money'
import {
  accountTileId, accountTileLabel, draftPlannedFrom, elapsedFraction, monthPeriod, previousMonth, statusAt,
} from '../../shared/index.js'
import type { BudgetRepositories } from '../repository/BudgetRepositories.js'
import type { AccountMonthLine } from './AccountMonthLine.js'
import { openingAccountBalances } from './openingAccountBalances.js'

/** What {@link accountMonthLines} found for one month. */
export interface AccountMonthLines {
  readonly lines: AccountMonthLine[]
  /** True when the lines are last month's, previewed and not stored. */
  readonly draft: boolean
}

/**
 * Builds the month's account lines.
 *
 * Judged by total, not by pace (`judgePace: false`), as windows are. An
 * allowance is spent in lumps and a half-spent $150 on the 3rd is not an
 * alarm; running out is. So a line is only ever `over`, `unused` or
 * `on-track`.
 *
 * With `allowDraft`, a month with no stored account lines previews the
 * previous month's, with nothing carried in: what it would inherit depends on
 * how the current month actually ends, as for category lines.
 *
 * @param repos - Repositories bound to the caller's transaction.
 * @param monthKey - The month being shown, `YYYY-MM`.
 * @param today - Today's date in the user's zone, `YYYY-MM-DD`.
 * @param allowDraft - Whether an unplanned month may preview the previous month's lines.
 * @returns The lines, ordered by account name, and whether they are a draft.
 */
export async function accountMonthLines(
  repos: BudgetRepositories,
  monthKey: string,
  today: string,
  allowDraft: boolean,
): Promise<AccountMonthLines> {
  const own = await repos.accountLines.listForMonth(monthKey)
  const draft = own.length === 0 && allowDraft
  const source = own.length > 0 ? own : draft ? await repos.accountLines.listForMonth(previousMonth(monthKey)) : []
  if (source.length === 0) return { lines: [], draft: false }

  const nameOf = new Map((await repos.accounts.list()).map((a) => [a.id, a.name]))
  const { start, end } = monthPeriod(monthKey)
  const spent = await repos.spend.byAccountScopes(
    source.map((l) => ({
      key: l.account_id, accountId: l.account_id, start, end, excluded: l.excluded_category_ids,
    })),
  )
  const carried = draft
    ? new Map<string, string>()
    : await openingAccountBalances(
        repos.balances,
        monthKey,
        source.filter((l) => l.rollover).map((l) => l.account_id),
      )
  const elapsed = elapsedFraction(monthKey, today)

  const lines = source.map((line): AccountMonthLine => {
    const accountName = nameOf.get(line.account_id) ?? 'Unknown account'
    const planned = draft ? draftPlannedFrom(line) : line.planned
    const carriedIn = carried.get(line.account_id) ?? ZERO_MONEY
    const available = sumMoney([planned, carriedIn])
    const spentNow = spent.get(line.account_id) ?? ZERO_MONEY
    const status = statusAt(
      {
        categoryId: accountTileId(line.account_id),
        categoryName: accountTileLabel(accountName),
        planned,
        available,
        spent: spentNow,
        remaining: subtractMoney(available, spentNow),
        rollover: line.rollover,
      },
      elapsed,
      { judgePace: false },
    )
    return {
      ...status,
      id: draft ? null : line.id,
      accountId: line.account_id,
      accountName,
      carriedIn,
      excludedCategoryIds: line.excluded_category_ids,
      note: line.note,
      draft,
    }
  })
  lines.sort((a, b) => a.accountName.localeCompare(b.accountName))
  return { lines, draft }
}
