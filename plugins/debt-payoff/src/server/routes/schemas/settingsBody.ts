import { z } from 'zod'
import { moneyField } from './moneyField.js'
import { strategyField } from './strategyField.js'

/** The body of `PUT /settings`: either or both fields; one not sent keeps its value. */
export const settingsBody = z
  .strictObject({
    extraPayment: moneyField.optional(),
    strategy: strategyField.optional(),
  })
  .refine((body) => body.extraPayment !== undefined || body.strategy !== undefined, {
    error: 'Send extraPayment, strategy or both.',
  })
