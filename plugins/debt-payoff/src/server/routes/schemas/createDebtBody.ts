import { z } from 'zod'
import { accountIdField } from './accountIdField.js'
import { COMPOUNDING_OPTIONS, PROMO_INTEREST_BASES } from '../../../shared/index.js'
import { aprField } from './aprField.js'
import { dateField } from './dateField.js'
import { moneyField } from './moneyField.js'
import { nameField } from './nameField.js'
import { sortOrderField } from './sortOrderField.js'

/**
 * The body of `POST /debts`. Unknown fields are refused, so a misspelt
 * `minimumPayment` is an error and not a debt with a zero minimum.
 */
export const createDebtBody = z.strictObject({
  name: nameField,
  balance: moneyField,
  apr: aprField,
  minimumPayment: moneyField,
  accountId: accountIdField.optional(),
  sortOrder: sortOrderField.optional(),
  archived: z.boolean({ error: 'Send true or false.' }).optional(),
  included: z.boolean({ error: 'Send true or false.' }).optional(),
  extraPayment: moneyField.optional(),
  repaymentStartsOn: dateField.nullable().optional(),
  promoApr: aprField.nullable().optional(),
  promoEndsOn: dateField.nullable().optional(),
  promoDeferredInterest: z.boolean({ error: 'Send true or false.' }).optional(),
  promoInterestBase: z.enum(PROMO_INTEREST_BASES, { error: 'Choose original balance or declining balance.' }).optional(),
  compounding: z.enum(COMPOUNDING_OPTIONS, { error: 'Choose monthly, daily or simple daily.' }).optional(),
})
