import { sql } from 'kysely'
import type { Db } from '../client.js'
import type { Services } from '../../composition/Services.js'
import { accountDefsFor, createAccounts } from './seedAccounts.js'
import { budgetLineDefsFor, createBudgetLines } from './seedBudgets.js'
import { createImportCsvFixtures } from './seedImportCsv.js'
import type { Persona } from './seedPersonas.js'
import { createRecurringItems, recurringItemDefsFor } from './seedRecurringItems.js'
import { seedFrom, SeedRng } from './seedRng.js'
import { createRules, ruleDefsFor } from './seedRules.js'
import { seedLightHistory, seedMonthlyHistory, seedSpecialFixtures } from './seedTransactions.js'

/** What a persona run needs: both database connections and the same service registry the API itself uses. */
export interface RunContext {
  /** Application-role connection — every RLS-scoped read and write goes through this. */
  readonly db: Db
  /** Owner connection — used only for the pre-existence lookup below, never for tenant data. */
  readonly ownerDb: Db
  readonly services: Services
}

/**
 * Looks up a seed persona's user id by exact email, without needing any
 * tenant context — see {@link import('./resetSeedUsers.js').resetSeedUsers}
 * for why the owner connection can do this.
 *
 * @param ownerDb - Owner connection.
 * @param email - Exact address to look up (case-insensitive).
 * @returns The user's id, or `undefined` if no such user exists.
 */
export async function findExistingUserId(ownerDb: Db, email: string): Promise<string | undefined> {
  const result = await sql<{ id: string }>`
    SELECT id FROM core.users WHERE lower(email) = lower(${email})
  `.execute(ownerDb)
  return result.rows[0]?.id
}

/** What {@link runPersona} did, for the CLI's summary. */
export type RunOutcome = 'created' | 'skipped'

/**
 * Creates one persona's full dataset, or does nothing if it already exists.
 *
 * Idempotent by skipping, not by merging: a persona already found by email is
 * left exactly as it is and this returns `'skipped'` rather than trying to
 * reconcile new fixtures into old data. `pnpm seed --reset` is the supported
 * way to start over. This is also why `fresh` stops immediately after
 * registration — running onboarding or creating a single account for it would
 * defeat the one thing it exists to demonstrate.
 *
 * @param ctx - Both database connections and the service registry.
 * @param persona - One entry of `PERSONAS`.
 * @returns `'created'` if a new dataset was written, `'skipped'` if the
 *   persona already existed.
 */
export async function runPersona(ctx: RunContext, persona: Persona): Promise<RunOutcome> {
  const existingId = await findExistingUserId(ctx.ownerDb, persona.email)
  if (existingId !== undefined) return 'skipped'

  const session = await ctx.services.auth.register(persona.email, persona.password)
  const userId = session.user.id

  if (!persona.onboard) return 'created'

  const rng = new SeedRng(seedFrom(persona.key))
  const accountIds = await createAccounts(ctx.services.accounts, userId, accountDefsFor(persona))

  await ctx.services.onboarding.complete(userId, persona.situations)
  const categories = await ctx.services.categories.list(userId)
  const slugToId = new Map(categories.map((c) => [c.slug, c.id]))

  await createRules(ctx.services.categoryRules, userId, ruleDefsFor(persona), slugToId)

  if (persona.key === 'hero') {
    await seedMonthlyHistory(ctx.services.transactions, ctx.db, userId, accountIds, slugToId, rng, 14)
    const special = await seedSpecialFixtures(ctx.services.transactions, userId, accountIds, slugToId)
    await createRecurringItems(ctx.db, userId, recurringItemDefsFor('hero'), accountIds, slugToId)
    await createBudgetLines(ctx.db, userId, budgetLineDefsFor('hero'), slugToId)
    const [linked1, linked2] = special.linkableIds
    if (linked1 !== undefined && linked2 !== undefined) {
      await createImportCsvFixtures(ctx.db, userId, accountIds.get('checking')!, [linked1, linked2])
    }
  } else if (persona.key === 'second') {
    await seedLightHistory(ctx.services.transactions, userId, accountIds, slugToId, rng)
    await createRecurringItems(ctx.db, userId, recurringItemDefsFor('second'), accountIds, slugToId)
    await createBudgetLines(ctx.db, userId, budgetLineDefsFor('second'), slugToId)
  }

  return 'created'
}
