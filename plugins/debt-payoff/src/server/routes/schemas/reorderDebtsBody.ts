import { isUuid } from '@wickermoney/plugin-sdk/server'
import { z } from 'zod'
import { MAX_ACTIVE_DEBTS } from '../../constants.js'

/**
 * The body of `PUT /debts/order`: the ids of the person's debts, first in
 * line first. The ids are checked against the person's debts by the service;
 * this only checks the shape, so a malformed body is refused before the
 * database is opened.
 */
export const reorderDebtsBody = z.strictObject({
  ids: z
    .array(z.string({ error: 'Send debt ids.' }).refine(isUuid, 'That is not a debt id.'), { error: 'Send the debt ids as a list.' })
    .max(MAX_ACTIVE_DEBTS, `You can order up to ${MAX_ACTIVE_DEBTS} debts.`),
})
