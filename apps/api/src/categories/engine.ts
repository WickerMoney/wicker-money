import type { CategoryRuleCondition, RuleConditionType } from '../db/models/index.js'
import { money } from '../money.js'

/** The transaction fields a rule's conditions are evaluated against. */
export interface MatchSubject {
  /** Merchant text. */
  readonly merchant: string
  /** Free-text notes/description, if any. */
  readonly notes?: string | null
  /**
   * Signed decimal string, exactly as stored on the ledger (negative is money
   * out). Conditions themselves never store a signed value; the sign is
   * compared against the condition's direction.
   */
  readonly amount: string
}

/**
 * The columns a condition needs to be matched. A structural subset of
 * `CategoryRuleCondition` rather than that type itself, so a caller that built
 * one from a preview request body (which has no `id`/`rule_id`/`created_at`
 * yet) can still use it.
 */
export type MatchCondition = Pick<
  CategoryRuleCondition,
  'condition_type' | 'text_value' | 'is_case_sensitive' | 'direction' | 'amount_value' | 'amount_min' | 'amount_max'
>

/** A categorization rule reduced to what matching needs. */
export interface MatchRule {
  /** Category assigned when every condition matches. */
  readonly category_id: string
  /** Conditions that must ALL match (AND). */
  readonly conditions: readonly MatchCondition[]
}

/**
 * Whether one amount condition matches one transaction.
 *
 * Conditions store a positive magnitude plus a direction ('in' | 'out'),
 * never a signed value, even though `core.transactions.amount` is signed.
 * Typing -375.00 into a rule form is the kind of mistake that is made once and
 * then matches nothing forever, silently, because the rule "worked" — it just
 * never fires. A magnitude with an explicit "money out" toggle is the same
 * information and harder to get backwards. This is the one place the sign is
 * reintroduced, by comparing `subject.amount`'s own sign against the
 * condition's direction before comparing magnitudes.
 *
 * A zero-amount transaction matches no amount condition: zero is neither
 * money in nor money out, and picking one arbitrarily would be more confusing
 * than excluding it.
 *
 * @param condition - An `amount_exact` or `amount_range` condition.
 * @param subject - The transaction being tested.
 * @returns True if direction and magnitude both match.
 */
function matchesAmount(condition: MatchCondition, subject: MatchSubject): boolean {
  const amount = money(subject.amount)
  if (amount.isZero()) return false

  const isOut = amount.isNegative()
  if (condition.direction === 'out' && !isOut) return false
  if (condition.direction === 'in' && isOut) return false

  const magnitude = amount.abs()

  if (condition.condition_type === 'amount_exact') {
    return condition.amount_value !== null && magnitude.equals(money(condition.amount_value))
  }

  // amount_range. Either bound may be absent — "amount out, at least 500"
  // needs only a minimum, not a sentinel maximum.
  if (condition.amount_min !== null && magnitude.lessThan(money(condition.amount_min))) return false
  if (condition.amount_max !== null && magnitude.greaterThan(money(condition.amount_max))) return false
  return true
}

/**
 * Whether one condition matches one transaction.
 *
 * Exposed separately from {@link matches} (the AND of every condition on a
 * rule) so callers can report which individual condition failed, not just
 * whether the rule as a whole matched.
 *
 * Text conditions compare case-insensitively unless `is_case_sensitive` is set;
 * `description_contains` never matches a blank or missing notes field.
 *
 * @param condition - The condition to evaluate.
 * @param subject - The transaction being tested.
 * @returns True if this condition matches.
 */
export function matchesCondition(condition: MatchCondition, subject: MatchSubject): boolean {
  const type: RuleConditionType = condition.condition_type
  switch (type) {
    case 'merchant_exact':
    case 'merchant_contains':
    case 'description_contains':
      return matchesText(condition, subject)
    case 'amount_exact':
    case 'amount_range':
      return matchesAmount(condition, subject)
  }
}

/**
 * Whether a text condition (`merchant_exact`, `merchant_contains` or
 * `description_contains`) matches. A condition with no `text_value` never matches.
 */
function matchesText(condition: MatchCondition, subject: MatchSubject): boolean {
  if (condition.text_value === null) return false
  const fold = (s: string): string => (condition.is_case_sensitive ? s : s.toLowerCase())
  const needle = fold(condition.text_value)

  if (condition.condition_type === 'merchant_exact') {
    return fold(subject.merchant) === needle
  }
  if (condition.condition_type === 'merchant_contains') {
    return fold(subject.merchant).includes(needle)
  }
  // description_contains
  const notes = subject.notes
  if (notes == null || notes.trim() === '') return false
  return fold(notes).includes(needle)
}

/**
 * Whether a rule matches: every one of its conditions does (AND-only).
 *
 * A rule with zero conditions never matches. That state should not exist (rules
 * are required to have at least one condition when written), but this treats it
 * as "matches nothing" rather than "matches everything" defensively: a rule
 * silently applying to every transaction is far worse than one silently
 * applying to none.
 *
 * @param conditions - The rule's conditions.
 * @param subject - The transaction being tested.
 * @returns True if there is at least one condition and all match.
 */
export function matches(conditions: readonly MatchCondition[], subject: MatchSubject): boolean {
  return conditions.length > 0 && conditions.every((c) => matchesCondition(c, subject))
}

/**
 * Resolves the category for a transaction: the first rule in order that
 * matches wins.
 *
 * `rules` MUST arrive ordered by priority DESC, condition_count DESC,
 * created_at ASC, which is what {@link fetchRulesInResolutionOrder} produces
 * and the only place rules are ordered, so the contract has one implementation
 * to keep honest.
 *
 * Priority is the sole *explicit* signal and always wins when set.
 * `condition_count` only breaks a tie, in favour of the more specific rule;
 * counting AND-ed conditions is unambiguous, unlike guessing which condition
 * *type* is "more specific". `created_at` is the final tiebreak.
 *
 * @param rules - Rules in resolution order.
 * @param subject - The transaction to categorize.
 * @returns The winning rule's category id, or `null` when no rule matches.
 * @example
 * const rules = await fetchRulesInResolutionOrder(kyselyRunner(trx))
 * const categoryId = resolveCategory(rules, { merchant: 'CHECK', amount: '-375.00' })
 */
export function resolveCategory(rules: readonly MatchRule[], subject: MatchSubject): string | null {
  for (const rule of rules) {
    if (matches(rule.conditions, subject)) return rule.category_id
  }
  return null
}
