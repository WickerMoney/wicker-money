import { z } from 'zod'
import { allocationsField, amountField, noteField, onDateField } from './lumpSumFields.js'

/**
 * The body of `POST /lump-sums` and `PUT /lump-sums/:id`: the whole lump sum.
 * Unknown fields are refused, so a misspelt `onDate` is an error and not a lump
 * sum with no date.
 */
export const lumpSumBody = z.strictObject({
  onDate: onDateField,
  amount: amountField,
  note: noteField.optional(),
  allocations: allocationsField.optional(),
})
