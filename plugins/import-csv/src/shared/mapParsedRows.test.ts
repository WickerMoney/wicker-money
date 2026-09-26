import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv.js'
import { mapParsedRows } from './mapParsedRows.js'
import { mapRows, type SourceMapping } from './mapping.js'

const MAPPING: SourceMapping = {
  sourceName: 'Bank',
  columns: { date: 'Date', merchant: 'Description', amount: 'Amount' },
  dateFormat: 'MM/DD/YYYY',
  amountStyle: 'signed',
  invertAmount: false,
}
const CSV = 'Date,Description,Amount\n03/04/2026,COFFEE,-4.50\nbad,BROKEN,1.00\n03/06/2026,,2.00'

describe('mapParsedRows', () => {
  it('gives the same result as mapping the text', () => {
    expect(mapParsedRows(parseCsv(CSV), MAPPING)).toEqual(mapRows(CSV, MAPPING))
  })

  it('ignores the source name', () => {
    const parsed = parseCsv(CSV)
    expect(mapParsedRows(parsed, { ...MAPPING, sourceName: 'Other' })).toEqual(mapParsedRows(parsed, MAPPING))
  })

  it('counts rows from the header, reports errors and keeps the good rows', () => {
    const { rows, errors } = mapParsedRows(parseCsv(CSV), MAPPING)
    expect(rows.map((r) => r.rowNumber)).toEqual([2])
    expect(errors.map((e) => [e.rowNumber, e.field])).toEqual([[3, 'date'], [4, 'merchant']])
  })
})
