import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseCsv } from './csv.js'
import { defaultDateFormat, negateMoney, parseDate, parseMoney } from './fields.js'
import { mapRows, suggestAmountStyle, suggestColumns, type SourceMapping } from './mapping.js'
import { classifyRows, sameMoney, summarize, type ExistingTransaction } from './dedupe.js'

describe('CSV reading', () => {
  it('keeps a comma inside a quoted field with the field', () => {
    const { headers, rows } = parseCsv('Date,Description,Amount\n2026-01-02,"AMAZON MKTPL, SEATTLE",-12.34')
    expect(headers).toEqual(['Date', 'Description', 'Amount'])
    expect(rows[0]).toEqual(['2026-01-02', 'AMAZON MKTPL, SEATTLE', '-12.34'])
  })

  it('unescapes a doubled quote', () => {
    const { rows } = parseCsv('A\n"He said ""hi"""')
    expect(rows[0]?.[0]).toBe('He said "hi"')
  })

  it('treats CRLF as one row terminator', () => {
    const { rows } = parseCsv('A,B\r\n1,2\r\n3,4\r\n')
    expect(rows).toEqual([['1', '2'], ['3', '4']])
  })

  it('strips the BOM Excel writes', () => {
    const { headers } = parseCsv('﻿Date,Amount\n2026-01-02,1.00')
    expect(headers[0]).toBe('Date')
  })

  it('detects a semicolon-delimited export', () => {
    expect(detectDelimiter('Datum;Beschreibung;Betrag')).toBe(';')
    expect(parseCsv('Datum;Beschreibung;Betrag\n02.01.2026;REWE;-12,34').rows[0]).toEqual([
      '02.01.2026', 'REWE', '-12,34',
    ])
  })

  it('pads a short row instead of shifting cells', () => {
    const { rows } = parseCsv('A,B,C\n1,2')
    expect(rows[0]).toEqual(['1', '2', ''])
  })

  it('ignores a trailing newline rather than emitting an empty row', () => {
    expect(parseCsv('A,B\n1,2\n').rows).toHaveLength(1)
  })
})

describe('date parsing (Q24)', () => {
  it('reads the same text differently under each format, which is the point', () => {
    expect(parseDate('03/04/2026', 'MM/DD/YYYY')).toEqual({ value: '2026-03-04' })
    expect(parseDate('03/04/2026', 'DD/MM/YYYY')).toEqual({ value: '2026-04-03' })
  })

  it('rejects a date that does not exist instead of rolling it over', () => {
    // Date would happily turn this into 3 March.
    expect(parseDate('31/02/2026', 'DD/MM/YYYY')).toHaveProperty('error')
  })

  it('rejects a value that does not match the chosen format', () => {
    expect(parseDate('2026-03-04', 'MM/DD/YYYY')).toHaveProperty('error')
  })

  it('tolerates a time suffix', () => {
    expect(parseDate('2026-03-04T00:00:00Z', 'YYYY-MM-DD')).toEqual({ value: '2026-03-04' })
    expect(parseDate('03/04/2026 14:22', 'MM/DD/YYYY')).toEqual({ value: '2026-03-04' })
  })

  it('defaults from locale without committing to it', () => {
    expect(defaultDateFormat('en-US')).toBe('MM/DD/YYYY')
    expect(defaultDateFormat('en-GB')).toBe('DD/MM/YYYY')
  })
})

describe('money parsing', () => {
  it('keeps values as exact strings', () => {
    expect(parseMoney('1,234.56')).toEqual({ value: '1234.56' })
    expect(parseMoney('$1,234.56')).toEqual({ value: '1234.56' })
    expect(parseMoney('-12.34')).toEqual({ value: '-12.34' })
  })

  it('reads parentheses and a trailing minus as negative', () => {
    expect(parseMoney('(12.34)')).toEqual({ value: '-12.34' })
    expect(parseMoney('12.34-')).toEqual({ value: '-12.34' })
  })

  it('handles a European decimal comma', () => {
    expect(parseMoney('1.234,56')).toEqual({ value: '1234.56' })
    expect(parseMoney('-12,34')).toEqual({ value: '-12.34' })
  })

  it('reads a lone comma as a thousands separator when it groups three digits', () => {
    expect(parseMoney('1,234')).toEqual({ value: '1234' })
  })

  it('never produces negative zero', () => {
    expect(parseMoney('(0.00)')).toEqual({ value: '0.00' })
    expect(negateMoney('0.00')).toBe('0.00')
  })

  it('refuses more precision than numeric(19,4) holds', () => {
    expect(parseMoney('1.23456')).toHaveProperty('error')
  })

  it('refuses junk rather than coercing it', () => {
    expect(parseMoney('n/a')).toHaveProperty('error')
    expect(parseMoney('1-2')).toHaveProperty('error')
    expect(parseMoney('')).toHaveProperty('error')
  })
})

const signed: SourceMapping = {
  sourceName: 'Test Bank',
  columns: { date: 'Date', merchant: 'Description', amount: 'Amount', externalId: 'Transaction ID' },
  dateFormat: 'MM/DD/YYYY',
  amountStyle: 'signed',
  invertAmount: false,
}

describe('mapping rows', () => {
  const csv = [
    'Date,Description,Amount,Transaction ID',
    '03/04/2026,"COFFEE BAR, MAIN ST",-4.50,tx-1',
    '03/05/2026,PAYCHECK,"2,500.00",tx-2',
  ].join('\n')

  it('produces ledger-ready values', () => {
    const { rows, errors } = mapRows(csv, signed)
    expect(errors).toEqual([])
    expect(rows[0]).toMatchObject({
      date: '2026-03-04', merchant: 'COFFEE BAR, MAIN ST', amount: '-4.50', externalId: 'tx-1',
    })
    expect(rows[1]).toMatchObject({ date: '2026-03-05', amount: '2500.00' })
  })

  it('numbers rows as a spreadsheet does, so an error is findable', () => {
    const bad = 'Date,Description,Amount\n03/04/2026,OK,-1.00\nnot-a-date,BAD,-2.00'
    const { errors } = mapRows(bad, { ...signed, columns: { date: 'Date', merchant: 'Description', amount: 'Amount' } })
    expect(errors).toHaveLength(1)
    expect(errors[0]?.rowNumber).toBe(3)
  })

  it('collects bad rows instead of failing the whole file', () => {
    const mixed = 'Date,Description,Amount\n03/04/2026,OK,-1.00\n03/05/2026,BAD,n/a'
    const { rows, errors } = mapRows(mixed, { ...signed, columns: { date: 'Date', merchant: 'Description', amount: 'Amount' } })
    expect(rows).toHaveLength(1)
    expect(errors).toHaveLength(1)
  })

  it('reads a debit/credit pair into one signed amount', () => {
    const dc = 'Date,Description,Debit,Credit\n03/04/2026,RENT,1500.00,\n03/05/2026,SALARY,,2500.00'
    const { rows } = mapRows(dc, {
      ...signed,
      columns: { date: 'Date', merchant: 'Description', debit: 'Debit', credit: 'Credit' },
      amountStyle: 'debit-credit',
    })
    expect(rows[0]?.amount).toBe('-1500.00')
    expect(rows[1]?.amount).toBe('2500.00')
  })

  it('inverts every sign when the source reports spending as positive', () => {
    const { rows } = mapRows(csv, { ...signed, invertAmount: true })
    expect(rows[0]?.amount).toBe('4.50')
    expect(rows[1]?.amount).toBe('-2500.00')
  })

  it('suggests columns and an amount style from headers', () => {
    const headers = ['Posted Date', 'Description', 'Debit', 'Credit']
    expect(suggestColumns(headers)).toMatchObject({ date: 'Posted Date', merchant: 'Description' })
    expect(suggestAmountStyle(headers)).toBe('debit-credit')
  })
})

describe('duplicate detection (Q25)', () => {
  const existing: ExistingTransaction[] = [
    { id: 'a', date: '2026-03-04', merchant: 'COFFEE BAR', amount: '-4.50', externalId: 'tx-1' },
    { id: 'b', date: '2026-03-06', merchant: 'AMAZON MKTPL 4XJ22', amount: '-31.10', externalId: null },
  ]
  const row = (over: Partial<Parameters<typeof classifyRows>[0][number]>) => ({
    rowNumber: 2, date: '2026-03-04', merchant: 'COFFEE BAR', amount: '-4.50',
    notes: null, externalId: null, raw: [], ...over,
  })

  it('skips an external_id the ledger already holds', () => {
    const [r] = classifyRows([row({ externalId: 'tx-1' })], existing)
    expect(r?.status).toBe('duplicate')
  })

  it('accepts a new external_id without consulting the heuristic', () => {
    // Same day, same merchant, same amount as an existing row — but a distinct
    // id, so it is a second coffee, not a re-import.
    const [r] = classifyRows([row({ externalId: 'tx-99' })], existing)
    expect(r?.status).toBe('new')
  })

  it('flags a heuristic match for review rather than dropping it', () => {
    const [r] = classifyRows([row({})], existing)
    expect(r?.status).toBe('needs-review')
    expect(r?.matched?.id).toBe('a')
  })

  it('matches within the date window but not outside it', () => {
    expect(classifyRows([row({ date: '2026-03-05' })], existing)[0]?.status).toBe('needs-review')
    expect(classifyRows([row({ date: '2026-03-08' })], existing)[0]?.status).toBe('new')
  })

  it('sees through a trailing card reference on the merchant', () => {
    const [r] = classifyRows(
      [row({ date: '2026-03-06', merchant: 'AMAZON MKTPL', amount: '-31.10' })],
      existing,
    )
    expect(r?.status).toBe('needs-review')
  })

  it('catches a file that repeats its own id', () => {
    const rows = [row({ externalId: 'tx-50' }), row({ externalId: 'tx-50' })]
    const [first, second] = classifyRows(rows, [])
    expect(first?.status).toBe('new')
    expect(second?.status).toBe('duplicate')
  })

  it('counts each outcome for the summary the user sees', () => {
    const rows = [row({ externalId: 'tx-1' }), row({}), row({ date: '2026-03-20', merchant: 'NEW' })]
    expect(summarize(classifyRows(rows, existing))).toEqual({
      total: 3, new: 1, duplicate: 1, needsReview: 1,
    })
  })
})

describe('money comparison', () => {
  it('matches the same amount however many trailing zeros it carries', () => {
    // numeric(19,4) returns '-81.2000'; the CSV said '-81.20'. Comparing those
    // as strings silently disabled heuristic duplicate detection entirely.
    expect(sameMoney('-81.2000', '-81.20')).toBe(true)
    expect(sameMoney('2500.0000', '2500')).toBe(true)
    expect(sameMoney('0.00', '-0.00')).toBe(true)
  })

  it('still distinguishes different amounts', () => {
    expect(sameMoney('-81.20', '-81.21')).toBe(false)
    expect(sameMoney('81.20', '-81.20')).toBe(false)
  })

  it('classifies a database-shaped amount as a match', () => {
    const existing = [
      { id: 'a', date: '2026-03-06', merchant: 'GROCERY WORLD', amount: '-81.2000', externalId: null },
    ]
    const row = {
      rowNumber: 2, date: '2026-03-06', merchant: 'GROCERY WORLD', amount: '-81.20',
      notes: null, externalId: null, raw: [],
    }
    expect(classifyRows([row], existing)[0]?.status).toBe('needs-review')
  })
})
