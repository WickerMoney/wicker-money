import type { ForecastHorizon } from '../models/index.js'

/** The horizon choices, in the order the page offers them, with their labels. */
export const HORIZONS: readonly { readonly value: ForecastHorizon; readonly label: string }[] = [
  { value: '30d', label: '30 days' },
  { value: '60d', label: '60 days' },
  { value: '90d', label: '90 days' },
  { value: '6m', label: '6 months' },
  { value: 'eoy', label: 'End of year' },
]
