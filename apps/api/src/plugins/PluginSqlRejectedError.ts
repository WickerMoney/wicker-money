/** Raised when plugin code hands the query runner a statement that manipulates the database role or session settings. */
export class PluginSqlRejectedError extends Error {
  /** @param reason - What about the statement was refused. */
  constructor(reason: string) {
    super(`Plugin query refused: ${reason}`)
    this.name = 'PluginSqlRejectedError'
  }
}
