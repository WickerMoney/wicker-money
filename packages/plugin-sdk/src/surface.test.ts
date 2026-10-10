import { describe, expect, it } from 'vitest'
import * as root from './index.js'
import * as money from './money/index.js'
import * as recurrence from './recurrence/index.js'
import * as runtime from './runtime.js'
import * as server from './server/index.js'

/**
 * The runtime export names of each entry point, written out in full.
 *
 * Adding, removing or renaming an export changes what plugin authors can
 * import, so it should be a decision, not a side effect. When this fails, the
 * change is either intended (update the list, and for a removal or rename
 * follow the tier rules in the README) or an accident (undo it). Types are
 * erased at runtime, so a type-only change is not caught here.
 */
const names = (ns: object): string[] => Object.keys(ns).sort()

describe('public runtime surface', () => {
  it('/runtime', () => {
    expect(names(runtime)).toEqual(['adoptPluginStyles'])
  })

  it('/recurrence', () => {
    expect(names(recurrence)).toEqual([
      'DEFAULT_SEMIMONTHLY_DAYS',
      'RECURRENCE_FREQUENCIES',
      'addDays',
      'addMonths',
      'dailyBalances',
      'flowTotals',
      'monthlyEquivalent',
      'nextOccurrence',
      'nextPayday',
      'nextScheduledOccurrence',
      'occurrences',
      'scheduledOccurrences',
    ])
  })

  it('/money', () => {
    expect(names(money)).toEqual([
      'MONEY_SCALE',
      'MONEY_UNIT',
      'ZERO_MONEY',
      'absMoney',
      'addMoney',
      'compareMoney',
      'divideUnits',
      'editableMoney',
      'equalMoney',
      'isNegativeMoney',
      'isZeroMoney',
      'moneyToUnits',
      'negateMoney',
      'normalizeMoney',
      'subtractMoney',
      'sumMoney',
      'unitsToMoney',
    ])
  })

  it('/server', () => {
    expect(names(server)).toEqual(['PluginRouteError', 'isUuid'])
  })

  it('the root', () => {
    expect(names(root)).toEqual([
      'CORE_TABLES',
      'DEFAULT_RANGE_KEY',
      'DEFAULT_SEMIMONTHLY_DAYS',
      'MONEY_SCALE',
      'MONEY_UNIT',
      'PERMISSIONS',
      'PluginRouteError',
      'RANGE_KEYS',
      'RECURRENCE_FREQUENCIES',
      'REMOTE_ENTRY_TYPE',
      'SDK_MAJOR_VERSION',
      'WIDGET_SIZES',
      'WIDGET_SLOTS',
      'ZERO_MONEY',
      'absMoney',
      'addDays',
      'addMoney',
      'addMonths',
      'adoptPluginStyles',
      'checkRemoteEntry',
      'compareMoney',
      'dailyBalances',
      'divideUnits',
      'editableMoney',
      'equalMoney',
      'federationName',
      'flowTotals',
      'isCompatible',
      'isNegativeMoney',
      'isRangeKey',
      'isUuid',
      'isZeroMoney',
      'moneyToUnits',
      'monthlyEquivalent',
      'monthsInRange',
      'negateMoney',
      'nextOccurrence',
      'nextPayday',
      'nextScheduledOccurrence',
      'normalizeMoney',
      'occurrences',
      'pageContributionSchema',
      'pagePath',
      'parseManifest',
      'pluginManifestSchema',
      'rangeLabel',
      'remoteEntrySchema',
      'resolveRange',
      'scheduledOccurrences',
      'subtractMoney',
      'sumMoney',
      'tableGrantSchema',
      'unitsToMoney',
      'widgetContributionSchema',
    ])
  })
})
