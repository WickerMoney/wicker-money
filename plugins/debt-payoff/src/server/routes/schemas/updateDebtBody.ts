import { z } from 'zod'
import { accountIdField } from './accountIdField.js'
import { aprField } from './aprField.js'
import { moneyField } from './moneyField.js'
import { nameField } from './nameField.js'
import { sortOrderField } from './sortOrderField.js'

/**
 * The body of `PUT /debts/:id`: any of the debt's fields; those not sent keep
 * their value. `accountId: null` removes the link. At least one is required,
 * since an empty update is almost certainly a client that sent the wrong thing.
 */
export const updateDebtBody = z
  .strictObject({
    name: nameField.optional(),
    balance: moneyField.optional(),
    apr: aprField.optional(),
    minimumPayment: moneyField.optional(),
    accountId: accountIdField.optional(),
    sortOrder: sortOrderField.optional(),
    archived: z.boolean({ error: 'Send true or false.' }).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    error: 'Send at least one field to change.',
  })
