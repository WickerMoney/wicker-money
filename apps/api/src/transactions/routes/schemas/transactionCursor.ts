import { z } from 'zod'
import { isoDate } from './isoDate.js'

/** The text `Buffer` accepts for base64url: no padding, no other characters. */
const BASE64URL = /^[A-Za-z0-9_-]+$/

const position = { direction: z.enum(['asc', 'desc']), id: z.string().uuid() }

/**
 * What a cursor holds, checked strictly per sort so a value that would fail
 * when cast in the database (a bad date, a non-number) is refused here as a
 * request error rather than surfacing as a server error.
 */
const cursorPayload = z.discriminatedUnion(
  'sort',
  [
  z.strictObject({ sort: z.literal('date'), value: isoDate, ...position }),
  z.strictObject({
    sort: z.literal('amount'),
    value: z.string().regex(/^-?\d{1,15}(\.\d{1,4})?$/, 'Must be a decimal amount.'),
    ...position,
  }),
  z.strictObject({
    sort: z.literal('merchant'),
    // PostgreSQL text cannot contain a NUL byte.
    value: z.string().max(300).refine((v) => !v.includes('\0'), 'Must not contain NUL.'),
    ...position,
  }),
  ],
  { error: 'Malformed cursor.' },
)

/**
 * Decodes the opaque `cursor` query value: base64url of a JSON object holding
 * the sort, its direction, the last row's sort value and its id. Anything else
 * (bad encoding, bad JSON, missing, unknown or mistyped fields) fails
 * validation with `Malformed cursor.`
 */
export const transactionCursor = z
  .string()
  .max(1024)
  .regex(BASE64URL, 'Malformed cursor.')
  .transform((raw): unknown => {
    try {
      return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    } catch {
      return null
    }
  })
  .pipe(cursorPayload)
