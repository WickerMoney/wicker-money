import type { Migration, MigrationProvider } from 'kysely/migration'

import * as m001 from './001_core_schema.js'
import * as m002 from './002_identity.js'
import * as m003 from './003_ledger.js'
import * as m004 from './004_rls.js'
import * as m005 from './005_app_role.js'
import * as m006 from './006_preauth_functions.js'
import * as m007 from './007_preauth_force_rls.js'
import * as m008 from './008_plugin_import.js'
import * as m009 from './009_owned_references.js'
import * as m010 from './010_onboarding.js'
import * as m011 from './011_plugin_budgets.js'
import * as m012 from './012_kinds_and_transfers.js'
import * as m013 from './013_migration_table_grant.js'
import * as m014 from './014_rule_conditions.js'
import * as m015 from './015_performance_indexes.js'
import * as m016 from './016_session_families.js'
import * as m017 from './017_import_idempotency.js'
import * as m018 from './018_tenant_context_signature.js'
import * as m019 from './019_app_deployments.js'
import * as m020 from './020_semimonthly_frequency.js'
import * as m021 from './021_recurring_item_legs.js'
import * as m022 from './022_account_spendable.js'
import * as m023 from './023_budget_windows.js'

/**
 * The complete, ordered set of schema migrations, keyed by migration name.
 *
 * Kysely applies them in lexicographic key order, so the numeric prefix is the
 * ordering. They are listed explicitly rather than read from disk: the compiled
 * output has no TypeScript source files to scan, and an explicit list keeps
 * ordering reviewable in a diff.
 */
export const MIGRATIONS: Record<string, Migration> = {
  '001_core_schema': m001,
  '002_identity': m002,
  '003_ledger': m003,
  '004_rls': m004,
  '005_app_role': m005,
  '006_preauth_functions': m006,
  '007_preauth_force_rls': m007,
  '008_plugin_import': m008,
  '009_owned_references': m009,
  '010_onboarding': m010,
  '011_plugin_budgets': m011,
  '012_kinds_and_transfers': m012,
  '013_migration_table_grant': m013,
  '014_rule_conditions': m014,
  '015_performance_indexes': m015,
  '016_session_families': m016,
  '017_import_idempotency': m017,
  '018_tenant_context_signature': m018,
  '019_app_deployments': m019,
  '020_semimonthly_frequency': m020,
  '021_recurring_item_legs': m021,
  '022_account_spendable': m022,
  '023_budget_windows': m023,
}

/** Kysely {@link MigrationProvider} that serves the fixed {@link MIGRATIONS} set. */
export class StaticMigrationProvider implements MigrationProvider {
  /** @returns The {@link MIGRATIONS} record. */
  async getMigrations(): Promise<Record<string, Migration>> {
    return MIGRATIONS
  }
}
