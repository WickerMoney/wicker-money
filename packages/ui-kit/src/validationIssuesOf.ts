import type { ValidationIssue } from './ValidationIssue.js'

/**
 * The field-level issues a failed request carries, if any.
 *
 * Duck-typed on an `issues` property so it works with the host's own error
 * class and with whatever a plugin's scoped client rejects with, neither of
 * which a plugin can import. Anything not shaped like `{ path, message }[]`
 * is ignored rather than trusted.
 *
 * @param error - Whatever a request rejected with.
 * @returns The issues, or an empty list when there are none.
 */
export function validationIssuesOf(error: unknown): readonly ValidationIssue[] {
  if (typeof error !== 'object' || error === null || !('issues' in error)) return []
  const { issues } = error as { issues: unknown }
  if (!Array.isArray(issues)) return []
  return issues.filter((i): i is ValidationIssue => {
    if (typeof i !== 'object' || i === null) return false
    const { path, message } = i as { path?: unknown; message?: unknown }
    return typeof message === 'string' && Array.isArray(path)
      && path.every((p) => typeof p === 'string' || typeof p === 'number')
  })
}
