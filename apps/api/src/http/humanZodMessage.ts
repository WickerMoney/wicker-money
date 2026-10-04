import type { z } from 'zod'

/** How each JSON type is named in a sentence. */
const TYPE_NAMES: Readonly<Record<string, string>> = {
  string: 'text',
  number: 'a number',
  int: 'a whole number',
  boolean: 'true or false',
  array: 'a list',
  object: 'an object',
  date: 'a date',
}

/** How each string format is named in a sentence. */
const FORMAT_NAMES: Readonly<Record<string, string>> = {
  uuid: 'Must be a valid id.',
  email: 'Must be an email address.',
  date: 'Must be a date like 2026-10-04.',
  datetime: 'Must be a date and time.',
}

/**
 * Words zod's built-in failures as sentences a person can act on.
 *
 * zod's defaults describe the schema ("Too small: expected string to have
 * >=1 characters"). These describe the field, without naming it, because the
 * form shows the message under the field's own label. A message a schema
 * sets itself (`.refine(fn, 'Buffer cannot be negative.')`) wins over this,
 * since zod only consults a per-parse error map when the schema has none.
 *
 * @param issue - The raw issue zod is about to report.
 * @returns The sentence, or `undefined` to fall back to zod's own wording.
 */
export function humanZodMessage(issue: z.core.$ZodRawIssue): string | undefined {
  switch (issue.code) {
    case 'invalid_type': {
      if (issue.input === undefined) return 'This is required.'
      if (issue.input === null) return 'This cannot be empty.'
      const name = TYPE_NAMES[issue.expected] ?? issue.expected
      return `Must be ${name}.`
    }
    case 'too_small': {
      const min = Number(issue.minimum)
      if (issue.origin === 'string') {
        return min <= 1 ? 'This cannot be empty.' : `Must be at least ${min} characters.`
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        return min <= 1 ? 'Add at least one.' : `Add at least ${min}.`
      }
      return issue.inclusive === false ? `Must be more than ${min}.` : `Must be ${min} or more.`
    }
    case 'too_big': {
      const max = Number(issue.maximum)
      if (issue.origin === 'string') return `Must be ${max} characters or fewer.`
      if (issue.origin === 'array' || issue.origin === 'set') return `Can have at most ${max}.`
      return issue.inclusive === false ? `Must be less than ${max}.` : `Must be ${max} or less.`
    }
    case 'invalid_format':
      return FORMAT_NAMES[issue.format] ?? 'Is not in the expected format.'
    case 'invalid_value':
      return `Must be one of: ${issue.values.map(String).join(', ')}.`
    case 'invalid_union':
      return 'Is not one of the accepted values.'
    case 'unrecognized_keys':
      return `Not a field this accepts: ${issue.keys.join(', ')}.`
    case 'not_multiple_of':
      return `Must be a multiple of ${String(issue.divisor)}.`
    default:
      return undefined
  }
}
