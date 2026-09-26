/**
 * Pulls just the database name out of a Postgres connection string.
 *
 * Only the path segment is read, so credentials in the URL are never touched.
 *
 * @param databaseUrl - A Postgres connection URL.
 * @returns The database name, `(unknown)` when the path is empty, or
 * `(unparseable)` when the URL cannot be parsed.
 */
export function databaseNameFromUrl(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl)
    const name = parsed.pathname.replace(/^\//, '')
    return name === '' ? '(unknown)' : name
  } catch {
    return '(unparseable)'
  }
}
