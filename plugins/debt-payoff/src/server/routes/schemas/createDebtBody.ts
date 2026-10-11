import { z } from 'zod'
import { accountIdField } from './accountIdField.js'
import { aprField } from './aprField.js'
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
})
