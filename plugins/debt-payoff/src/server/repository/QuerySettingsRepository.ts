import type { Query } from '@wickermoney/plugin-sdk/server'
import type { ExportedSettings } from './ExportedSettings.js'
import type { SettingsRepository } from './SettingsRepository.js'
import type { SettingsRow } from './SettingsRow.js'

/** {@link SettingsRepository} over a user-bound query runner. */
export class QuerySettingsRepository implements SettingsRepository {
  /** @param q - A query runner already bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  async get(): Promise<SettingsRow | undefined> {
    const rows = await this.q<SettingsRow>`
      SELECT extra_payment::text AS extra_payment, strategy
      FROM plugin_debt_payoff.plan_settings
    `
    return rows[0]
  }

  /** @inheritdoc */
  async save(extraPayment: string, strategy: string): Promise<SettingsRow | undefined> {
    const rows = await this.q<SettingsRow>`
      INSERT INTO plugin_debt_payoff.plan_settings (user_id, extra_payment, strategy)
      VALUES (core.current_user_id(), ${extraPayment}::numeric, ${strategy})
      ON CONFLICT (user_id) DO UPDATE
        SET extra_payment = EXCLUDED.extra_payment,
            strategy = EXCLUDED.strategy,
            updated_at = now()
      RETURNING extra_payment::text AS extra_payment, strategy
    `
    return rows[0]
  }

  /** @inheritdoc */
  async getForExport(): Promise<ExportedSettings | undefined> {
    const rows = await this.q<ExportedSettings>`
      SELECT extra_payment::text AS extra_payment, strategy, created_at, updated_at
      FROM plugin_debt_payoff.plan_settings
    `
    return rows[0]
  }
}
