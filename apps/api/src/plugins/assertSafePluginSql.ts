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
 * What this is for: catching an honest mistake in bundled plugin code, such as
 * a stray `SET ROLE` or `set_config('app.user_id', ...)` that would silently
 * undo the role and user binding the host set up, and failing it loudly in
 * development instead of misbehaving in production.
 *
 * What it is not: a security boundary. It reads statement text, and SQL can
 * assemble a statement at run time. A `DO` block whose `EXECUTE` builds
 * `RESET ROLE` from pieces passes this check and returns the transaction to the
 * application role (checked against PostgreSQL 16), which drops the manifest's
 * table limits. Tenant isolation survives that escape: row-level security keys
 * on the signed tenant context, so a forged `app.user_id` reads no other
 * user's rows (see `db/tenantContext.integration.test.ts`). So the per-plugin
 * grant holds for plugin code that behaves, which is the only kind there is
 * until third-party install is supported.
 *
 * It is deliberately not extended with more patterns (`DO`, `EXECUTE`,
 * `format`, ...). A deny-list over SQL text is whack-a-mole, and a longer list
 * would suggest a guarantee this layer cannot give. Making the role a boundary
 * against untrusted server-side code needs a connection the plugin cannot
 * leave (a login role and pool per plugin, or a separate process), which
 * belongs with the plugin isolation work.
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
