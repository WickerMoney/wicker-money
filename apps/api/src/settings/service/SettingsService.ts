import type { UnitOfWork } from '../../data/UnitOfWork.js'
import { buildConfigInfo } from './buildConfigInfo.js'
import type { ConfigInfo } from './ConfigInfo.js'
import { EXPORT_SECTIONS } from './EXPORT_SECTIONS.js'
import { EXPORTERS } from './EXPORTERS.js'
import type { ExportSink } from './ExportSink.js'
import type { PluginExporter } from './PluginExporter.js'
import type { SettingsServiceDeps } from './SettingsServiceDeps.js'
import { writeExportTable } from './writeExportTable.js'
import { writePluginExports } from './writePluginExports.js'

/** Instance configuration report and whole-account data export. */
export class SettingsService {
  private readonly exporters: Readonly<Record<string, PluginExporter>>

  /**
   * @param uow - Opens transactions and supplies repositories.
   * @param deps - Configuration, plugin registry and exporters.
   */
  constructor(
    private readonly uow: UnitOfWork,
    private readonly deps: SettingsServiceDeps,
  ) {
    this.exporters = deps.exporters ?? EXPORTERS
  }

  /**
   * Non-sensitive, allow-listed instance state for the Config section of Settings.
   *
   * @returns Only the fields of {@link ConfigInfo}; never a secret.
   */
  async getConfigInfo(): Promise<ConfigInfo> {
    let latestMigration: string | null = null
    try {
      latestMigration = await this.uow.forSystem((r) => r.exports.latestMigrationName(), { readOnly: true })
    } catch {
      // Whatever the reason (missing grant, missing table), the rest of the
      // Config section is still worth showing.
    }
    return buildConfigInfo(this.deps.config, latestMigration)
  }

  /**
   * Writes everything the user owns to `sink` as one JSON document:
   * `{ exportedAt, core: { profile, <tables>... }, plugins: { <pluginId>: data } }`.
   *
   * The whole export runs in one read-only `repeatable read` transaction, so
   * core tables and plugin data describe the same instant even if the user is
   * changing things while it runs. It runs under the long statement limit
   * (`DB_LONG_STATEMENT_TIMEOUT`), since a plugin's exporter reads its tables
   * in one statement. Tables are read a page at a time and each
   * page is handed to the sink before the next is read, so memory does not
   * grow with the size of the ledger.
   *
   * Row-level security has already narrowed every read to this user; nothing
   * here is a separate check. Credentials are never selected. Plugin-owned
   * schemas are not queried directly, because core does not know they exist:
   * each enabled bundled plugin's exporter runs under that plugin's own
   * database role, assumed and released by the host around the call.
   *
   * @param userId - The signed-in user.
   * @param sink - Receives the document text in order.
   */
  async exportUserData(userId: string, sink: ExportSink): Promise<void> {
    const { plugins } = await this.deps.plugins.loadRegistry()
    const exporting = plugins.filter(
      ({ manifest }) => manifest.contributes.exporters && this.exporters[manifest.id] !== undefined,
    )

    await this.uow.forUser(
      userId,
      async ({ exports }) => {
        const profile = await exports.readProfile(userId)
        await sink.write(
          `{"exportedAt":${JSON.stringify(new Date().toISOString())},"core":{"profile":${JSON.stringify(profile ?? null)}`,
        )

        for (const { key, table } of EXPORT_SECTIONS) await writeExportTable(exports, sink, key, table)

        await sink.write('},"plugins":{')
        await writePluginExports(
          exports,
          sink,
          exporting.map(({ manifest }) => manifest.id),
          this.exporters,
        )
        await sink.write('}}')
      },
      {
        isolation: 'repeatable read',
        readOnly: true,
        statementTimeoutMillis: this.deps.config.DB_LONG_STATEMENT_TIMEOUT,
      },
    )
  }
}
