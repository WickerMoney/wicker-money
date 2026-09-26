import type { ExportRepository } from '../repository/ExportRepository.js'
import type { ExportSink } from './ExportSink.js'
import type { PluginExporter } from './PluginExporter.js'

/**
 * Streams the `plugins` object body: one member per plugin, holding whatever
 * that plugin's exporter returns.
 *
 * Each exporter runs under its own plugin's database role, assumed and
 * released around the call.
 *
 * @param exports - Repository used to run exporters as their plugin.
 * @param sink - Receives the text in order.
 * @param pluginIds - The plugins to export, in output order.
 * @param exporters - Exporter functions keyed by plugin id; ids without one are skipped.
 */
export async function writePluginExports(
  exports: Pick<ExportRepository, 'runAsPlugin'>,
  sink: ExportSink,
  pluginIds: readonly string[],
  exporters: Readonly<Record<string, PluginExporter>>,
): Promise<void> {
  let first = true
  for (const id of pluginIds) {
    const exporter = exporters[id]
    if (exporter === undefined) continue
    const data = await exports.runAsPlugin(id, exporter)
    await sink.write(`${first ? '' : ','}${JSON.stringify(id)}:${JSON.stringify(data ?? null)}`)
    first = false
  }
}
