/**
 * Public surface of the plugin SDK: the contract both the host and every
 * plugin implement.
 *
 * The manifest exports are plain validated data that is safe to import on the
 * server; the runtime exports are React types for browser-side plugin code.
 * The two groups are kept apart so a Node process can import the manifest
 * exports without pulling in React.
 */
export {
  CORE_TABLES,
  checkRemoteEntry,
  remoteEntrySchema,
  PERMISSIONS,
  REMOTE_ENTRY_TYPE,
  SDK_MAJOR_VERSION,
  WIDGET_SIZES,
  WIDGET_SLOTS,
  federationName,
  isCompatible,
  pagePath,
  parseManifest,
  pageContributionSchema,
  pluginManifestSchema,
  tableGrantSchema,
  widgetContributionSchema,
} from './manifest/index.js'
export type {
  CoreTableName,
  ManifestParseResult,
  PageContribution,
  Permission,
  PluginManifest,
  TableGrant,
  WidgetContribution,
  WidgetSize,
  WidgetSlot,
} from './manifest/index.js'

export { adoptPluginStyles } from './runtime.js'
export type {
  PluginApi,
  PluginContext,
  PluginModule,
  PluginPage,
  PluginPageProps,
  PluginSession,
  PluginWidget,
  PluginWidgetProps,
} from './runtime.js'

export {
  RANGE_KEYS, DEFAULT_RANGE_KEY, isRangeKey, rangeLabel, resolveRange, monthsInRange,
} from './range.js'
export type { DashboardRange, RangeKey } from './range.js'

export {
  DEFAULT_SEMIMONTHLY_DAYS, RECURRENCE_FREQUENCIES,
  dailyBalances, flowTotals, monthlyEquivalent, nextOccurrence, nextPayday, nextScheduledOccurrence,
  occurrences, scheduledOccurrences,
} from './recurrence/index.js'
export type {
  DailyBalance, FlowTotals, OccurrenceOverride, RecurrenceFrequency, RecurrenceSchedule, RecurringItem,
  RecurringLeg, ScheduledOccurrence,
} from './recurrence/index.js'

export {
  MONEY_SCALE, MONEY_UNIT, ZERO_MONEY,
  absMoney, addMoney, compareMoney, divideUnits, editableMoney, equalMoney, isNegativeMoney,
  isZeroMoney, moneyToUnits, negateMoney, normalizeMoney, subtractMoney, sumMoney, unitsToMoney,
} from './money/index.js'
export type { Money } from './money/index.js'
