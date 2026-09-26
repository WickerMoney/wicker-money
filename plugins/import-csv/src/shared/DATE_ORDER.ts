import type { DateFormat } from './fields.js'

/** The separator and the order of year, month and day for each supported date layout. */
export const DATE_ORDER: Record<DateFormat, { sep: string; parts: readonly ('Y' | 'M' | 'D')[] }> = {
  'MM/DD/YYYY': { sep: '/', parts: ['M', 'D', 'Y'] },
  'DD/MM/YYYY': { sep: '/', parts: ['D', 'M', 'Y'] },
  'YYYY-MM-DD': { sep: '-', parts: ['Y', 'M', 'D'] },
  'MM-DD-YYYY': { sep: '-', parts: ['M', 'D', 'Y'] },
  'DD-MM-YYYY': { sep: '-', parts: ['D', 'M', 'Y'] },
  'DD.MM.YYYY': { sep: '.', parts: ['D', 'M', 'Y'] },
  'YYYY/MM/DD': { sep: '/', parts: ['Y', 'M', 'D'] },
}
