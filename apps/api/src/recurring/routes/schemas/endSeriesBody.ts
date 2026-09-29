import { z } from 'zod'
import { isoDate } from '../../../transactions/routes/schemas/isoDate.js'

/** Request body for ending a series. `endDate` defaults to the user's today. */
export const endSeriesBody = z.object({ endDate: isoDate.optional() }).default({})
