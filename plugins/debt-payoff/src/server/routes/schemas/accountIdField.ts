import { isUuid } from '@wickermoney/plugin-sdk/server'
import { z } from 'zod'

/** The id of the account a debt tracks, or `null` for none. */
export const accountIdField = z
  .string({ error: 'Choose an account.' })
  .refine(isUuid, 'Choose an account.')
  .nullable()
