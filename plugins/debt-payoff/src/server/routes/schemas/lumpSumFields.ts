import { isUuid } from '@wickermoney/plugin-sdk/server'
import { z } from 'zod'
import { MAX_ACTIVE_DEBTS } from '../../constants.js'
import { dateField } from './dateField.js'
import { positiveMoneyField } from './positiveMoneyField.js'

/** What a lump sum is for, in the person's words: up to 200 characters once trimmed; blank for none. */
export const noteField = z
  .string({ error: 'Send the note as text.' })
  .trim()
  .max(200, 'Use 200 characters or fewer.')

/**
 * The parts of a lump sum aimed at particular debts. Only the shape is checked
 * here: that the debts are the person's own, each appears once and the parts do
 * not add up to more than the lump sum is checked by the service, against the
 * database.
 */
export const allocationsField = z
  .array(
    z.strictObject({
      debtId: z.string({ error: 'Choose a debt.' }).refine(isUuid, 'Choose a debt.'),
      amount: positiveMoneyField,
    }),
    { error: 'Send the amounts for single debts as a list.' },
  )
  .max(MAX_ACTIVE_DEBTS, `You can aim a lump sum at up to ${MAX_ACTIVE_DEBTS} debts.`)

/** The date and the amount of a lump sum, which every route that takes one needs. */
export const onDateField = dateField
export const amountField = positiveMoneyField
