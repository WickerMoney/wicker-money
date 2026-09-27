import { asUser, type Db } from '../client.js'
import { toMoney } from '../../money.js'
import type { TransactionService } from '../../transactions/service/TransactionService.js'
import { addDays, addMonthsClamped, firstDayOfMonth, type SeedRng, todayIso } from './seedRng.js'

/** One fixed (non-random) monthly transaction or transfer, anchored to a day offset from the 1st. */
interface FixedMonthly {
  readonly dayOffset: number
  readonly merchant: string
  /** Signed amount for an expense/income row; omitted for a transfer (see {@link transfer}). */
  readonly amount?: string
  /** Explicit category slug, or `undefined` to let the seeded rules assign one. */
  readonly categorySlug?: string
  readonly accountKey: string
  /** Present only for the monthly credit-card payment, which is a transfer, not a categorized row. */
  readonly transfer?: { readonly toAccountKey: string; readonly amountRange: readonly [number, number] }
}

/**
 * The fixed monthly items every month of `hero`'s history gets, in addition to
 * the randomised discretionary spend in {@link seedDiscretionarySpend}.
 *
 * Two of these — the rent "CHECK" and the exact `-425.00` auto loan payment —
 * are sized deliberately to fall inside the amount conditions
 * `seedRules.ts` creates, so leaving their `categorySlug` unset is what
 * proves those rules actually fire on real data rather than only in a test.
 *
 * The auto loan payment is a categorized expense row here, not a transfer into
 * the `loan` account this persona also has. That is a deliberate modeling
 * choice, not an oversight: `ROADMAP.md` treats a transfer into a tracked
 * loan/credit-card account as a *recurring item* concern (it decides how the
 * upcoming-bills widget classifies that item), which is exactly how
 * `seedRecurringItems.ts` models it. A real ledger transaction is free to
 * record the same real-world payment as a plain categorized expense instead —
 * common when nobody bothers to keep the loan account's own balance current —
 * so the `loan` account here stays at its opening balance for the whole run
 * rather than drifting toward zero, and that is expected, not a bug to chase.
 */
const FIXED_MONTHLY: readonly FixedMonthly[] = [
  { dayOffset: 0, merchant: 'CHECK #1042', amount: '-1550.00', accountKey: 'checking' },
  { dayOffset: 4, merchant: 'Auto Loan Payment', amount: '-425.00', accountKey: 'checking' },
  { dayOffset: 5, merchant: 'City Electric Co', categorySlug: 'electricity', accountKey: 'checking' },
  { dayOffset: 6, merchant: 'Metro Gas Co', categorySlug: 'natural-gas', accountKey: 'checking' },
  { dayOffset: 9, merchant: 'Verizon Wireless', amount: '-85.00', categorySlug: 'mobile-phone', accountKey: 'checking' },
  { dayOffset: 9, merchant: 'Xfinity Internet', amount: '-70.00', categorySlug: 'home-internet', accountKey: 'checking' },
  { dayOffset: 3, merchant: 'Netflix.com', amount: '-15.49', accountKey: 'checking' },
  { dayOffset: 3, merchant: 'Spotify USA', amount: '-10.99', accountKey: 'checking' },
  {
    dayOffset: 20,
    merchant: 'Credit Card Payment',
    accountKey: 'checking',
    transfer: { toAccountKey: 'credit_card', amountRange: [300, 500] },
  },
]

/**
 * Records `hero`'s ~14 months of history: two paychecks, the fixed monthly
 * bills above and a handful of randomised discretionary purchases, oldest
 * month first.
 *
 * @param service - Reused as-is, same as the real `/transactions` endpoints.
 * @param db - Needed only for the two `category_source` overrides at the end
 *   (`import`, `ai`) — no route ever produces those, since they are set by the
 *   CSV importer and (eventually) an AI suggestion feature this codebase does
 *   not have yet, so the only way to show every value of the enum in a UI
 *   review is to write two of them directly.
 * @param userId - The persona's user id.
 * @param accountIds - From {@link createAccounts}.
 * @param slugToId - This persona's catalog slug to category id map.
 * @param rng - This persona's seeded generator.
 * @param monthsBack - How many months of history to generate (14 for `hero`).
 * @returns Every created transaction's id, in creation order.
 */
export async function seedMonthlyHistory(
  service: TransactionService,
  db: Db,
  userId: string,
  accountIds: ReadonlyMap<string, string>,
  slugToId: ReadonlyMap<string, string>,
  rng: SeedRng,
  monthsBack: number,
): Promise<string[]> {
  const createdIds: string[] = []
  const today = todayIso()

  for (let monthsAgo = monthsBack - 1; monthsAgo >= 0; monthsAgo--) {
    const monthFirst = firstDayOfMonth(addMonthsClamped(today, -monthsAgo))

    // Two paychecks, semi-monthly. `semimonthly` is not yet a recurrence
    // frequency in `core.recurrence_frequency` (it is on the `Now` roadmap for
    // recurring items, not shipped) — these are ordinary transactions, so
    // nothing here waits on that migration.
    for (const dayOffset of [0, 14]) {
      const id = await create(service, userId, {
        accountId: accountIds.get('checking')!,
        amount: toMoney(2850 + rng.int(-40, 60)),
        merchant: 'Employer Payroll',
        transactionDate: addDays(monthFirst, dayOffset),
        categoryId: slugToId.get('salary'),
      })
      createdIds.push(id)
    }

    for (const item of FIXED_MONTHLY) {
      const date = addDays(monthFirst, item.dayOffset)
      if (item.transfer !== undefined) {
        const [min, max] = item.transfer.amountRange
        const { legs } = await service.createTransfer(userId, {
          fromAccountId: accountIds.get(item.accountKey)!,
          toAccountId: accountIds.get(item.transfer.toAccountKey)!,
          amount: rng.amount(min, max),
          transactionDate: date,
          description: item.merchant,
        })
        createdIds.push(...legs.map((l) => l.id))
        continue
      }
      const id = await create(service, userId, {
        accountId: accountIds.get(item.accountKey)!,
        amount: item.amount ?? toMoney(-(rng.int(30, 110))),
        merchant: item.merchant,
        transactionDate: date,
        categoryId: item.categorySlug === undefined ? undefined : slugToId.get(item.categorySlug),
      })
      createdIds.push(id)
    }

    createdIds.push(
      ...(await seedDiscretionarySpend(service, userId, accountIds, slugToId, rng, monthFirst, monthsAgo)),
    )
  }

  // Two of the transactions just created are re-tagged directly, bypassing
  // every service, purely so the `category_source` enum's `import` and `ai`
  // values both appear somewhere reviewable. Both already carry a real
  // category from the loop above; only their source changes.
  if (createdIds.length >= 5) {
    await asUser(db, userId, async (trx) => {
      await trx
        .updateTable('core.transactions')
        .set({ category_source: 'import' })
        .where('id', '=', createdIds[2]!)
        .execute()
      await trx
        .updateTable('core.transactions')
        .set({ category_source: 'ai' })
        .where('id', '=', createdIds[4]!)
        .execute()
    })
  }

  return createdIds
}

/**
 * Merchant templates for randomised monthly discretionary spend, each with how
 * many times it shows up in a typical month. Left uncategorized (no
 * `categorySlug`) so the seeded rules in `seedRules.ts` assign them — this is
 * the generator that actually proves the rule engine runs on a real dataset,
 * not just in its own unit tests.
 */
const DISCRETIONARY: readonly { readonly merchant: string; readonly range: readonly [number, number]; readonly perMonth: readonly [number, number] }[] = [
  { merchant: 'Wegmans #204', range: [60, 140], perMonth: [1, 2] },
  { merchant: 'DoorDash*Takeout', range: [18, 45], perMonth: [1, 2] },
  { merchant: 'Starbucks', range: [4, 8], perMonth: [2, 3] },
  { merchant: 'Shell Gas #552', range: [38, 58], perMonth: [1, 2] },
  { merchant: 'Amazon.com', range: [15, 90], perMonth: [1, 1] },
]

/**
 * One month's randomised discretionary spend on the credit card, plus an
 * occasional transaction that no rule matches (an uncategorized triage
 * backlog) and, every third month, one deliberately mis-categorized-by-hand
 * transaction that proves a manual category survives a matching rule.
 *
 * @param service - Reused as-is.
 * @param userId - The persona's user id.
 * @param accountIds - From {@link createAccounts}.
 * @param slugToId - This persona's catalog slug to category id map.
 * @param rng - This persona's seeded generator.
 * @param monthFirst - The first day of the month being generated.
 * @param monthsAgo - 0 for the current month, used only to gate the every-third-month manual override.
 * @returns Every created transaction's id.
 */
async function seedDiscretionarySpend(
  service: TransactionService,
  userId: string,
  accountIds: ReadonlyMap<string, string>,
  slugToId: ReadonlyMap<string, string>,
  rng: SeedRng,
  monthFirst: string,
  monthsAgo: number,
): Promise<string[]> {
  const creditCard = accountIds.get('credit_card')!
  const ids: string[] = []

  for (const template of DISCRETIONARY) {
    const count = rng.int(template.perMonth[0], template.perMonth[1])
    for (let i = 0; i < count; i++) {
      const id = await create(service, userId, {
        accountId: creditCard,
        amount: toMoney(-Number(rng.amount(template.range[0], template.range[1]))),
        merchant: template.merchant,
        transactionDate: addDays(monthFirst, rng.int(1, 27)),
      })
      ids.push(id)
    }
  }

  // An uncategorized triage-backlog item, most months: no rule matches it.
  if (rng.chance(0.6)) {
    const id = await create(service, userId, {
      accountId: creditCard,
      amount: toMoney(-Number(rng.amount(10, 40))),
      merchant: rng.pick(['Local Diner #113', 'Corner Market', 'Roadside Stand']),
      transactionDate: addDays(monthFirst, rng.int(1, 27)),
    })
    ids.push(id)
  }

  // Every third month: an explicit category that a rule would NOT have chosen,
  // to prove `create()`'s manual source protects it from ever being swept.
  if (monthsAgo % 3 === 0) {
    const id = await create(service, userId, {
      accountId: creditCard,
      amount: toMoney(-Number(rng.amount(20, 50))),
      merchant: 'Wegmans #204',
      transactionDate: addDays(monthFirst, rng.int(1, 27)),
      categoryId: slugToId.get('coffee-shops'),
    })
    ids.push(id)
  }

  return ids
}

/** Thin wrapper so every call site above reads as one line. */
function create(
  service: TransactionService,
  userId: string,
  input: {
    readonly accountId: string
    readonly amount: string
    readonly merchant: string
    readonly transactionDate: string
    readonly categoryId?: string | undefined
    readonly notes?: string | undefined
    readonly externalId?: string | undefined
  },
): Promise<string> {
  return service.create(userId, input).then((t) => t.id)
}

/**
 * A short, light history for `second`: a few months of one paycheck and a
 * handful of grocery runs, enough to be visibly real without trying to be
 * `hero`'s dataset in miniature.
 *
 * @param service - Reused as-is.
 * @param userId - The persona's user id.
 * @param accountIds - From {@link createAccounts}.
 * @param slugToId - This persona's catalog slug to category id map.
 * @param rng - This persona's seeded generator.
 */
export async function seedLightHistory(
  service: TransactionService,
  userId: string,
  accountIds: ReadonlyMap<string, string>,
  slugToId: ReadonlyMap<string, string>,
  rng: SeedRng,
): Promise<void> {
  const today = todayIso()
  for (let monthsAgo = 2; monthsAgo >= 0; monthsAgo--) {
    const monthFirst = firstDayOfMonth(addMonthsClamped(today, -monthsAgo))
    await create(service, userId, {
      accountId: accountIds.get('checking')!,
      amount: '2100.0000',
      merchant: 'Employer Payroll',
      transactionDate: monthFirst,
      categoryId: slugToId.get('salary'),
    })
    for (let i = 0; i < rng.int(2, 3); i++) {
      await create(service, userId, {
        accountId: accountIds.get('checking')!,
        amount: toMoney(-Number(rng.amount(35, 95))),
        merchant: 'Kroger',
        transactionDate: addDays(monthFirst, rng.int(2, 26)),
      })
    }
  }
}

/**
 * The one-off fixtures that demonstrate a specific mechanic each, dated in the
 * last month so they surface near the top of any recent-activity view:
 *
 *  - a transfer between the persona's own two asset accounts (checking to
 *    savings) — the "all" option in the upcoming widget's transfer filter;
 *  - a split purchase across three categories;
 *  - a positive-amount refund landing on an expense category, proving a
 *    refund is not mistaken for income by sign alone.
 *
 * @param service - Reused as-is.
 * @param userId - The persona's user id.
 * @param accountIds - From {@link createAccounts}.
 * @param slugToId - This persona's catalog slug to category id map.
 * @returns The ids touched, for anything that later fixtures (budgets, the
 *   import batch) want to point back at.
 */
export async function seedSpecialFixtures(
  service: TransactionService,
  userId: string,
  accountIds: ReadonlyMap<string, string>,
  slugToId: ReadonlyMap<string, string>,
): Promise<{ readonly splitTransactionId: string; readonly linkableIds: readonly string[] }> {
  const today = todayIso()
  const checking = accountIds.get('checking')!
  const savings = accountIds.get('savings')!
  const creditCard = accountIds.get('credit_card')!

  await service.createTransfer(userId, {
    fromAccountId: checking,
    toAccountId: savings,
    amount: '400.0000',
    transactionDate: addDays(today, -6),
    description: 'Monthly savings transfer',
  })

  // The only transaction anywhere in the seed that sets `notes` — without one,
  // the description_contains 'parking' rule in seedRules.ts would be created
  // but never actually matched against real data.
  await service.create(userId, {
    accountId: checking,
    amount: '-18.0000',
    merchant: 'City Garage Authority',
    transactionDate: addDays(today, -7),
    notes: 'Parking validated at gate, downtown garage',
  })

  const costco = await service.create(userId, {
    accountId: creditCard,
    amount: '-186.4200',
    merchant: 'Costco Wholesale',
    transactionDate: addDays(today, -4),
    externalId: 'seed-costco-0001',
  })
  await service.replaceSplits(userId, costco.id, [
    { amount: '-104.1100', categoryId: slugToId.get('groceries') ?? null, notes: 'Groceries' },
    { amount: '-52.3100', categoryId: slugToId.get('household-items') ?? null, notes: 'Paper towels, cleaning supplies' },
    { amount: '-30.0000', categoryId: slugToId.get('toiletries') ?? null, notes: 'Toiletries' },
  ])

  // A positive amount against an EXPENSE category: a partial refund, not income.
  const refund = await service.create(userId, {
    accountId: creditCard,
    amount: '22.5000',
    merchant: 'DoorDash*Takeout Refund',
    transactionDate: addDays(today, -2),
    categoryId: slugToId.get('takeout'),
  })

  // Two transactions carrying an external id, as a real CSV import would leave
  // them — for the import-csv fixture batch in seedImportCsv.ts to point at.
  const linked1 = await service.create(userId, {
    accountId: checking,
    amount: '-58.1200',
    merchant: 'Home Depot #4102',
    transactionDate: addDays(today, -10),
    categoryId: slugToId.get('home-repairs-maintenance') ?? slugToId.get('household-items'),
    externalId: 'seed-import-0001',
  })
  const linked2 = await service.create(userId, {
    accountId: checking,
    amount: '-64.9000',
    merchant: 'Petco #221',
    transactionDate: addDays(today, -9),
    categoryId: slugToId.get('household-items'),
    externalId: 'seed-import-0002',
  })

  return { splitTransactionId: costco.id, linkableIds: [linked1.id, linked2.id, refund.id] }
}
