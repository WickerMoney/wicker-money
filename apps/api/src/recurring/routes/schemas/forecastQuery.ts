import { z } from 'zod'
import { FORECAST_HORIZONS } from '../../service/FORECAST_HORIZONS.js'

/** Query for a forecast: which account, and how far ahead. Both optional. */
export const forecastQuery = z.object({
  accountId: z.string().uuid().optional(),
  horizon: z.enum(FORECAST_HORIZONS).optional(),
})
