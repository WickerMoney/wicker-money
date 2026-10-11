import type { ExportedSettings } from './ExportedSettings.js'
import type { SettingsRow } from './SettingsRow.js'

/** The user's saved plan settings: at most one row. */
export interface SettingsRepository {
  /** @returns The saved settings, or `undefined` if the user has never saved any. */
  get(): Promise<SettingsRow | undefined>

  /**
   * Saves the settings, creating the row on first use.
   *
   * @param extraPayment - The monthly extra, as a decimal string.
   * @param strategy - `snowball` or `avalanche`.
   * @returns The settings as saved.
   */
  save(extraPayment: string, strategy: string): Promise<SettingsRow | undefined>

  /** @returns The saved settings with their timestamps, or `undefined`, for the data export. */
  getForExport(): Promise<ExportedSettings | undefined>
}
