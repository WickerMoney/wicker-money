/**
 * Every value the Config section of Settings can show, and nothing else.
 *
 * An allow-list rather than a deny-list, on purpose: a deny-list is safe until
 * the next config value is added and nobody remembers to add it to the list,
 * at which point it leaks by default. An allow-list fails the other way: a new
 * value is simply invisible until someone deliberately adds it.
 *
 * Never here, and never should be: the auth secret, the database connection
 * URLs and the application role's password. The connection URLs are covered by
 * exposing only the database name parsed from the path, never the credentials.
 */
export interface ConfigInfo {
  /** The runtime environment, e.g. `production`. */
  readonly nodeEnv: string
  /** The configured log level. */
  readonly logLevel: string
  /** The port the API listens on. */
  readonly port: number
  /** Parsed from the database URL's path only, never the credentials in it. */
  readonly databaseName: string
  /** Name of the low-privilege role the application connects as. */
  readonly appRole: string
  /**
   * The most recent migration the migration bookkeeping table says ran, or
   * `null` if that table is unreadable for some reason. Read from the database
   * rather than the compiled migration list, because those two can disagree.
   */
  readonly latestMigration: string | null
}
