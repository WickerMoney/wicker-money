import { z } from 'zod'
import { moneyString } from './moneyString.js'

/** Request body carrying the new opening balance for an account. */
export const initialBalanceBody = z.object({ initialBalance: moneyString })
