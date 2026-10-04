import type { FormErrors } from './FormErrors.js'
import { validationIssuesOf } from './validationIssuesOf.js'

/**
 * Which form field a server path belongs to: a list of field names that are
 * the dotted path itself (`'name'`, `'conditions.0.amountMin'`), or a
 * function from the dotted path to a field name, `undefined` for none.
 */
export type FieldMatcher = readonly string[] | ((path: string) => string | undefined)

/**
 * Turns a failed request into messages for a form: each server issue on the
 * field it names, and the rest as one form-level message.
 *
 * A failure with no issues (a conflict, a network error, an older server)
 * becomes a form-level message: the error's own message when it has one,
 * otherwise `fallback`. Only the first message per field is kept, since one
 * thing to fix at a time is easier to act on.
 *
 * @param error - Whatever the request rejected with.
 * @param fields - Which server paths the form has a field for.
 * @param fallback - What to say when the error has no message of its own.
 * @returns The errors to show.
 * @example
 * formErrorsFrom(e, ['name', 'amount'], 'Could not save that.')
 */
export function formErrorsFrom(error: unknown, fields: FieldMatcher, fallback: string): FormErrors {
  const issues = validationIssuesOf(error)
  if (issues.length === 0) {
    const own = error instanceof Error && error.message !== '' ? error.message : fallback
    return { fields: {}, form: own }
  }
  const fieldFor = typeof fields === 'function'
    ? fields
    : (path: string) => (fields.includes(path) ? path : undefined)
  const byField: Record<string, string> = {}
  const rest: string[] = []
  for (const issue of issues) {
    const field = issue.path.length > 0 ? fieldFor(issue.path.join('.')) : undefined
    if (field === undefined) {
      if (!rest.includes(issue.message)) rest.push(issue.message)
    } else {
      byField[field] ??= issue.message
    }
  }
  return { fields: byField, form: rest.length > 0 ? rest.join(' ') : null }
}
