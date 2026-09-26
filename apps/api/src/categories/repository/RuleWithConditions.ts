import type { CategoryRuleCondition } from '../../db/models/index.js'
import type { RuleListRow } from './RuleListRow.js'

/** A rule row together with all of its conditions. */
export type RuleWithConditions = RuleListRow & { conditions: CategoryRuleCondition[] }
