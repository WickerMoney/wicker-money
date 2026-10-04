import type { AccountsTable } from './AccountsTable.js'
import type { AppDeploymentsTable } from './AppDeploymentsTable.js'
import type { CategoriesTable } from './CategoriesTable.js'
import type { CategoryRuleConditionsTable } from './CategoryRuleConditionsTable.js'
import type { CategoryRulesTable } from './CategoryRulesTable.js'
import type { PluginsTable } from './PluginsTable.js'
import type { RecurringItemLegsTable } from './RecurringItemLegsTable.js'
import type { RecurringItemsTable } from './RecurringItemsTable.js'
import type { RecurringOccurrenceLegsTable } from './RecurringOccurrenceLegsTable.js'
import type { RecurringMatchDismissalsTable } from './RecurringMatchDismissalsTable.js'
import type { RecurringOccurrencesTable } from './RecurringOccurrencesTable.js'
import type { SessionsTable } from './SessionsTable.js'
import type { TransactionSplitsTable } from './TransactionSplitsTable.js'
import type { TransactionsTable } from './TransactionsTable.js'
import type { UsersTable } from './UsersTable.js'

/** The schema Kysely type-checks queries against, keyed by schema-qualified table name. */
export interface Database {
  'core.users': UsersTable
  'core.sessions': SessionsTable
  'core.accounts': AccountsTable
  'core.categories': CategoriesTable
  'core.category_rules': CategoryRulesTable
  'core.category_rule_conditions': CategoryRuleConditionsTable
  'core.transactions': TransactionsTable
  'core.transaction_splits': TransactionSplitsTable
  'core.recurring_items': RecurringItemsTable
  'core.recurring_item_legs': RecurringItemLegsTable
  'core.recurring_occurrences': RecurringOccurrencesTable
  'core.recurring_occurrence_legs': RecurringOccurrenceLegsTable
  'core.recurring_match_dismissals': RecurringMatchDismissalsTable
  'core.plugins': PluginsTable
  'core.app_deployments': AppDeploymentsTable
}
