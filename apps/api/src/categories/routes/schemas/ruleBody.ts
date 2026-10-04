import { z } from 'zod'
import { money } from '../../../money.js'
import { conditionBody } from './conditionBody.js'

/** Request body for creating a rule, or previewing one before it is created. */
export const ruleBody = z
  .object({
    categoryId: z.string().uuid(),
    priority: z.number().int().default(0),
    /**
     * A rule matches when every one of its conditions does. Conditions are
     * AND-only; OR is expressed as separate rules. At least one condition is
     * required, because the matcher treats an empty set as matching nothing.
     */
    conditions: z.array(conditionBody).min(1, 'A rule needs at least one condition.'),
    /**
     * Off by default. When true, the rule is also applied to transactions that
     * already have a category, but never to ones a person categorized by hand.
     */
    applyToExisting: z.boolean().default(false),
  })
  .superRefine((body, ctx) => {
    body.conditions.forEach((c, i) => {
      if (c.conditionType !== 'amount_range') return
      if (c.amountMin == null && c.amountMax == null) {
        ctx.addIssue({
          code: 'custom',
          path: ['conditions', i, 'amountMin'],
          message: 'Set a minimum, a maximum, or both.',
        })
      }
      if (c.amountMin != null && c.amountMax != null && money(c.amountMin).greaterThan(money(c.amountMax))) {
        ctx.addIssue({
          code: 'custom',
          path: ['conditions', i, 'amountMax'],
          message: 'Cannot be less than the minimum.',
        })
      }
    })
  })
