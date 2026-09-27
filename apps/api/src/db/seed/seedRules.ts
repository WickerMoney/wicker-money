import type { CategoryRuleService } from '../../categories/service/CategoryRuleService.js'
import type { ConditionInput } from '../../categories/service/ConditionInput.js'
import type { Persona } from './seedPersonas.js'

/** One rule to create, referencing its target category by catalog slug rather than an id. */
export interface RuleDef {
  readonly categorySlug: string
  readonly priority: number
  readonly conditions: readonly ConditionInput[]
}

/**
 * The auto-categorization rules each onboarded persona gets.
 *
 * `hero`'s set deliberately exercises every {@link ConditionInput} shape (all
 * three text condition types, both amount condition types), a two-condition
 * AND rule, and a same-merchant priority conflict (two "Amazon" rules where
 * the higher priority must win regardless of which was created first) — the
 * resolution order the schema comment in `014_rule_conditions.ts` documents
 * (`priority DESC, condition_count DESC, created_at ASC`) has nothing to prove
 * itself against without at least one of each case actually present.
 *
 * Applied with `applyToExisting: false`: these are meant to categorize new
 * transactions created in the same run without reaching back and rewriting
 * transactions the seed deliberately left manually categorized or
 * uncategorized (see `seedTransactions.ts`).
 */
export function ruleDefsFor(persona: Persona): readonly RuleDef[] {
  if (persona.key === 'hero') {
    return [
      { categorySlug: 'groceries', priority: 0, conditions: [
        { conditionType: 'merchant_contains', textValue: 'Wegmans', isCaseSensitive: false },
      ] },
      { categorySlug: 'takeout', priority: 0, conditions: [
        { conditionType: 'merchant_contains', textValue: 'DoorDash', isCaseSensitive: false },
      ] },
      { categorySlug: 'coffee-shops', priority: 0, conditions: [
        { conditionType: 'merchant_exact', textValue: 'Starbucks', isCaseSensitive: false },
      ] },
      { categorySlug: 'gas', priority: 0, conditions: [
        { conditionType: 'merchant_contains', textValue: 'Shell Gas', isCaseSensitive: false },
      ] },
      { categorySlug: 'streaming-video', priority: 0, conditions: [
        { conditionType: 'merchant_contains', textValue: 'Netflix', isCaseSensitive: false },
      ] },
      { categorySlug: 'streaming-music', priority: 0, conditions: [
        { conditionType: 'merchant_contains', textValue: 'Spotify', isCaseSensitive: false },
      ] },
      // description_contains: the CSV/manual "notes" field is what this matches, not the merchant.
      { categorySlug: 'gas', priority: 0, conditions: [
        { conditionType: 'description_contains', textValue: 'parking', isCaseSensitive: false },
      ] },
      // amount_exact: "a check for exactly this amount is always the car payment" — the
      // motivating example from the rule_conditions migration's own comment.
      { categorySlug: 'car-payment-lease', priority: 0, conditions: [
        { conditionType: 'amount_exact', direction: 'out', amountValue: '425.00' },
      ] },
      // amount_range with no merchant at all: catches a typical fill-up regardless of station.
      { categorySlug: 'gas', priority: 0, conditions: [
        { conditionType: 'amount_range', direction: 'out', amountMin: '40.00', amountMax: '60.00' },
      ] },
      // Two conditions, AND-ed: only a "CHECK"-labelled transaction in the rent's
      // usual range is the rent — proves multi-condition matching and gives the
      // 2-condition/1-condition tie-break something real to break.
      { categorySlug: 'mortgage-rent', priority: 10, conditions: [
        { conditionType: 'merchant_contains', textValue: 'CHECK', isCaseSensitive: false },
        { conditionType: 'amount_range', direction: 'out', amountMin: '1400.00', amountMax: '1700.00' },
      ] },
      // Same merchant fragment, two rules, different priority: the priority-10
      // rule must win over the priority-0 one however transactions are matched.
      { categorySlug: 'household-items', priority: 0, conditions: [
        { conditionType: 'merchant_contains', textValue: 'Amazon', isCaseSensitive: false },
      ] },
      { categorySlug: 'toiletries', priority: 5, conditions: [
        { conditionType: 'merchant_contains', textValue: 'Amazon', isCaseSensitive: false },
      ] },
    ]
  }
  if (persona.key === 'second') {
    return [
      { categorySlug: 'groceries', priority: 0, conditions: [
        { conditionType: 'merchant_contains', textValue: 'Kroger', isCaseSensitive: false },
      ] },
    ]
  }
  return []
}

/**
 * Creates every rule in `defs` against the categories `slugToId` resolves.
 *
 * @param service - Reused as-is, same as `POST /category-rules`.
 * @param userId - The persona's user id.
 * @param defs - From {@link ruleDefsFor}.
 * @param slugToId - This persona's catalog slug to category id map.
 * @throws {Error} If a def names a slug the persona's onboarding never created —
 *   a sign the rule defs and the situations in `seedPersonas.ts` have drifted apart.
 */
export async function createRules(
  service: CategoryRuleService,
  userId: string,
  defs: readonly RuleDef[],
  slugToId: ReadonlyMap<string, string>,
): Promise<void> {
  for (const def of defs) {
    const categoryId = slugToId.get(def.categorySlug)
    if (categoryId === undefined) {
      throw new Error(
        `seedRules: category slug '${def.categorySlug}' does not exist for this persona — ` +
          'add the matching situation in seedPersonas.ts, or fix the slug.',
      )
    }
    await service.create(userId, {
      categoryId,
      priority: def.priority,
      conditions: def.conditions,
      applyToExisting: false,
    })
  }
}
