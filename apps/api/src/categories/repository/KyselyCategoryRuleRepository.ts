import { sql } from 'kysely'
import type { CategoryRule, CategoryRuleCondition } from '../../db/models/index.js'
import type { Trx } from '../../db/Trx.js'
import type { MatchRule } from '../engine.js'
import { fetchRulesInResolutionOrder } from './rules/fetchRulesInResolutionOrder.js'
import { kyselyRunner } from './rules/kyselyRunner.js'
import type { CategoryRuleRepository } from './CategoryRuleRepository.js'
import type { NewConditionInput } from './NewConditionInput.js'
import type { NewRuleInput } from './NewRuleInput.js'
import type { RuleCandidate } from './RuleCandidate.js'
import type { RuleListRow } from './RuleListRow.js'
import type { RuleWithConditions } from './RuleWithConditions.js'

/** Kysely implementation of {@link CategoryRuleRepository}. */
export class KyselyCategoryRuleRepository implements CategoryRuleRepository {
  /** @param trx - The transaction all queries run on. */
  constructor(private readonly trx: Trx) {}

  /** @inheritdoc */
  async listWithConditions(): Promise<RuleWithConditions[]> {
    // The ORDER BY intentionally repeats the short resolution ordering used when
    // fetching rules for matching: this query also needs each rule's own id,
    // priority and timestamps, which the matching shape omits.
    const rules = await sql<RuleListRow>`
      SELECT r.id, r.user_id, r.category_id, r.priority, r.created_at, r.updated_at
      FROM core.category_rules r
      ORDER BY r.priority DESC,
               (SELECT count(*) FROM core.category_rule_conditions cc WHERE cc.rule_id = r.id) DESC,
               r.created_at ASC
    `.execute(this.trx)
    if (rules.rows.length === 0) return []

    const conditions = await this.trx
      .selectFrom('core.category_rule_conditions')
      .selectAll()
      .where('rule_id', 'in', rules.rows.map((r) => r.id))
      .execute()

    const byRule = new Map<string, CategoryRuleCondition[]>()
    for (const c of conditions) {
      const list = byRule.get(c.rule_id) ?? []
      list.push(c)
      byRule.set(c.rule_id, list)
    }
    return rules.rows.map((r) => ({ ...r, conditions: byRule.get(r.id) ?? [] }))
  }

  /** @inheritdoc */
  fetchForMatching(): Promise<MatchRule[]> {
    return fetchRulesInResolutionOrder(kyselyRunner(this.trx))
  }

  /** @inheritdoc */
  insertRule(input: NewRuleInput): Promise<CategoryRule> {
    return this.trx
      .insertInto('core.category_rules')
      .values({ user_id: input.userId, category_id: input.categoryId, priority: input.priority })
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  /** @inheritdoc */
  insertConditions(conditions: readonly NewConditionInput[]): Promise<CategoryRuleCondition[]> {
    return this.trx
      .insertInto('core.category_rule_conditions')
      .values(
        conditions.map(({ userId, ruleId, ...columns }) => ({ user_id: userId, rule_id: ruleId, ...columns })),
      )
      .returningAll()
      .execute()
  }

  /** @inheritdoc */
  async delete(id: string): Promise<boolean> {
    const gone = await this.trx.deleteFrom('core.category_rules').where('id', '=', id).returning('id').executeTakeFirst()
    return gone !== undefined
  }

  /** @inheritdoc */
  async candidatePage(options: {
    readonly includeCategorized: boolean
    readonly afterId: string | null
    readonly limit: number
  }): Promise<RuleCandidate[]> {
    const after = options.afterId === null ? sql`` : sql`AND id > ${options.afterId}::uuid`
    const scope = options.includeCategorized
      ? sql`(category_id IS NULL OR category_source <> 'manual')`
      : sql`category_id IS NULL`
    const page = await sql<RuleCandidate>`
      SELECT id, merchant, notes, category_id, amount::text AS amount
      FROM core.transactions
      WHERE transfer_id IS NULL AND ${scope} ${after}
      ORDER BY id
      LIMIT ${options.limit}
    `.execute(this.trx)
    return page.rows
  }
}
