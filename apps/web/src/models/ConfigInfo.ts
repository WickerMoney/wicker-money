/** The non-secret runtime configuration returned by `GET /settings/config`. */
export interface ConfigInfo {
  /** The `NODE_ENV` the API runs under. */
  readonly nodeEnv: string
  /** The configured log level. */
  readonly logLevel: string
  /** The port the API listens on. */
  readonly port: number
  /** The name of the connected database. */
  readonly databaseName: string
  /** The database role the API connects as. */
  readonly appRole: string
  /** Name of the most recently applied migration, or `null` if none can be read. */
  readonly latestMigration: string | null
}
