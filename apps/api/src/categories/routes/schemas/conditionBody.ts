import { z } from 'zod'
import { amountExactBody } from './amountExactBody.js'
import { amountRangeBody } from './amountRangeBody.js'
import { descriptionContainsBody } from './descriptionContainsBody.js'
import { merchantContainsBody } from './merchantContainsBody.js'
import { merchantExactBody } from './merchantExactBody.js'

/** Any one rule condition, discriminated by `conditionType`. */
export const conditionBody = z.discriminatedUnion('conditionType', [
  merchantExactBody,
  merchantContainsBody,
  descriptionContainsBody,
  amountExactBody,
  amountRangeBody,
])

/** A validated rule condition as received from the wire. */
export type ConditionBody = z.infer<typeof conditionBody>
