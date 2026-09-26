import { FORBIDDEN_SQL } from './FORBIDDEN_SQL.js'
import { PluginSqlRejectedError } from './PluginSqlRejectedError.js'

/**
 * Refuses statement text that would change the database role or a session
 * setting.
 *
 * Two views of the text are checked: the text as written, and the text with
 * comments replaced by a space (so a comment placed between the words of a
 * statement is caught). Both are needed:
 * a comment marker inside a string literal must not hide live SQL from the
 * check, and stripping alone would let it.
 *
 * This is a textual screen and can be defeated by code that builds a statement
 * at run time; it is defence in depth for bundled plugin code, not a boundary
 * for untrusted code.
 *
 * @param strings - The literal parts of the tagged template.
 * @throws {PluginSqlRejectedError} When the text contains a forbidden construct.
 */
export function assertSafePluginSql(strings: readonly string[]): void {
  const text = strings.join(' ? ')
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n\r]*/g, ' ')
  for (const { pattern, what } of FORBIDDEN_SQL) {
    if (pattern.test(text) || pattern.test(withoutComments)) {
      throw new PluginSqlRejectedError(`${what} is not allowed; the host controls the role and session settings.`)
    }
  }
}
