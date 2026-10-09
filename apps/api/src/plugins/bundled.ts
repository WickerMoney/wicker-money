import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { SDK_MAJOR_VERSION } from '@wickermoney/plugin-sdk'

/**
 * Plugins that ship in the image and are enabled on first boot.
 *
 * They hold NO privilege a third-party plugin could not also request: the same
 * manifest shape, the same `requiredTables`, the same loader. The only
 * difference is that they are present at install time. That constraint is the
 * point — if a bundled plugin could reach around the SDK, the SDK would stop
 * being exercised by the code most likely to find its gaps.
 */
export const BUNDLED_PLUGINS: readonly PluginManifest[] = [
  {
    id: 'wickermoney.insights',
    name: 'Insights',
    version: '0.1.0',
    description: 'Income against spending, and where the spending went.',
    author: 'Wicker',
    sdkVersion: SDK_MAJOR_VERSION,
    // Read-only, and only what the two charts actually plot. Note the absence
    // of `accounts`: these widgets never need it, so they cannot reach it.
    requiredTables: [
      { table: 'transactions', access: 'read' },
      { table: 'categories', access: 'read' },
    ],
    permissions: [],
    remoteEntry: '/plugins/insights/remoteEntry.js',
    contributes: {
      pages: [],
      widgets: [
        {
          id: 'spend-trend',
          slot: 'dashboard.primary',
          // Not "Spending by month" any more: the chart shows both directions,
          // and a title naming only one of them is the caption disagreeing with
          // the picture.
          title: 'Money in and out',
          defaultSize: 'lg',
          order: 10,
          module: './TrendWidget',
        },
        {
          id: 'category-breakdown',
          slot: 'dashboard.secondary',
          title: 'Where it went',
          defaultSize: 'md',
          order: 20,
          module: './DonutWidget',
        },
      ],
      endpoints: false,
      // No schema of its own to export — insights only reads core tables it
      // is already granted, and core's own export already covers those.
      exporters: false,
    },
  },
  {
    id: 'wickermoney.spending-trends',
    name: 'Spending Trends',
    version: '0.1.0',
    description: 'Monthly spending stacked by category, with a filter per category.',
    author: 'Wicker',
    sdkVersion: SDK_MAJOR_VERSION,
    // Read-only, and the same two tables as insights: the chart plots the
    // monthly-summary aggregate and nothing else. `accounts` is absent because
    // a spending-by-category chart never needs to know which account money left,
    // so it cannot reach it.
    requiredTables: [
      { table: 'transactions', access: 'read' },
      { table: 'categories', access: 'read' },
    ],
    permissions: [],
    remoteEntry: '/plugins/spending-trends/remoteEntry.js',
    contributes: {
      pages: [],
      widgets: [
        {
          id: 'spending-trend',
          slot: 'dashboard.primary',
          title: 'Spending trends',
          defaultSize: 'lg',
          // After insights' "Money in and out" (10): income against spending
          // first, then where the spending went.
          order: 20,
          module: './SpendingTrendsWidget',
        },
      ],
      // No server half: it reads core's monthly-summary through the SDK client.
      endpoints: false,
      // No schema of its own to export; core's export already covers the
      // tables it reads.
      exporters: false,
    },
  },
  {
    id: 'wickermoney.import-csv',
    name: 'CSV Import',
    version: '0.1.0',
    description: 'Imports bank and card statements, with saved column mappings per source.',
    author: 'Wicker',
    sdkVersion: SDK_MAJOR_VERSION,
    /**
     * The first plugin to ask for write access, and a good illustration of why
     * the field is a list rather than a boolean. It can add transactions and
     * read the four tables it needs to do that sensibly — and it still cannot
     * touch recurring_items or transaction_splits, which an importer has no
     * business in. The matching PostgreSQL role is provisioned from exactly
     * this list, so the two cannot drift.
     */
    requiredTables: [
      { table: 'transactions', access: 'write' },
      { table: 'accounts', access: 'read' },
      { table: 'categories', access: 'read' },
      { table: 'category_rules', access: 'read' },
      // Categorization needs a rule's conditions, not just the rule row
      // itself, to decide a match.
      { table: 'category_rule_conditions', access: 'read' },
    ],
    permissions: [],
    remoteEntry: '/plugins/import-csv/remoteEntry.js',
    contributes: {
      pages: [
        {
          path: 'import',
          title: 'Import',
          nav: { label: 'Import', section: 'main', order: 30 },
          module: './ImportPage',
        },
      ],
      widgets: [],
      // Bundled, so its server half ships in the image and is mounted at
      // boot. Only bundled plugins may set this: the server code they run is
      // reviewed with the rest of the application, which a third-party
      // plugin's is not.
      endpoints: true,
      // Same bundled-only trust boundary as endpoints: this plugin's
      // exportImportData reads plugin_import_csv, a schema core does not know
      // exists, so only bundled plugin code is trusted to run it.
      exporters: true,
    },
  },
  {
    id: 'wickermoney.budgets',
    name: 'Budgets',
    version: '0.1.0',
    description: 'Monthly budget instances with per-line carry-forward, and what is at risk.',
    author: 'Wicker',
    sdkVersion: SDK_MAJOR_VERSION,
    /**
     * Read-only on core, and narrower than it looks.
     *
     * `transaction_splits` is here because budget spend that reads
     * `transactions` alone attributes a split transaction's whole amount to the
     * parent category and shows every split category nothing. That error is
     * invisible, because the numbers are all plausible.
     *
     * `accounts` is here for account lines, the allowance measured against one
     * account ("$150 a month into checking to spend"). It names the account a
     * line is on and checks that it is a checking account. Spending on an
     * account needs no grant of its own: `transactions` already carries
     * `account_id`.
     *
     * Absent, and each absence is deliberate: `category_rules` (categorization
     * is settled before a budget reads it), and `recurring_items` (income-side
     * planning is genuinely useful but not something the plugin does yet, so
     * asking for the grant would mean holding a privilege nothing uses).
     */
    requiredTables: [
      { table: 'transactions', access: 'read' },
      { table: 'transaction_splits', access: 'read' },
      { table: 'categories', access: 'read' },
      { table: 'accounts', access: 'read' },
    ],
    permissions: [],
    remoteEntry: '/plugins/budgets/remoteEntry.js',
    contributes: {
      /**
       * The first plugin to contribute a page AND a widget AND endpoints.
       *
       * That combination is what the SDK was shaped for and what nothing had
       * exercised end to end: insights has widgets with no server half, the
       * importer has a page and a server half but no widget.
       */
      pages: [
        {
          path: 'budgets',
          title: 'Budgets',
          nav: { label: 'Budgets', section: 'main', order: 25 },
          module: './BudgetsPage',
        },
      ],
      widgets: [
        {
          id: 'budget-at-risk',
          // Beside "Until payday" at the top: what is safe to spend next to
          // which budgets need attention. `md` is half of the primary slot.
          slot: 'dashboard.primary',
          title: 'Budget breakdown',
          defaultSize: 'md',
          order: 6,
          module: './AtRiskWidget',
        },
      ],
      endpoints: true,
      // Same bundled-only trust boundary as endpoints: this plugin's
      // exportBudgetsData reads plugin_budgets, a schema core does not know
      // exists, so only bundled plugin code is trusted to run it.
      exporters: true,
    },
  },
  {
    id: 'wickermoney.upcoming',
    name: 'Upcoming',
    version: '0.1.0',
    description: 'What is safe to spend until payday, and what lands before then.',
    author: 'Wicker',
    sdkVersion: SDK_MAJOR_VERSION,
    // Read-only. `recurring_items` (which brings its legs) for what is due, and
    // `accounts` because the outlook is built from balances and buffers and a
    // transfer names both of its accounts. No transactions: the balance the
    // projection starts from is computed by core, not summed here.
    requiredTables: [
      { table: 'recurring_items', access: 'read' },
      { table: 'accounts', access: 'read' },
    ],
    permissions: [],
    remoteEntry: '/plugins/upcoming/remoteEntry.js',
    contributes: {
      pages: [],
      widgets: [
        {
          id: 'until-payday',
          slot: 'dashboard.primary',
          title: 'Until payday',
          // Half the primary slot, with the budgets watch list beside it.
          defaultSize: 'md',
          // First on the dashboard: "will I make it to payday?" is the question
          // the charts below it are context for.
          order: 5,
          module: './UpcomingWidget',
        },
      ],
      // No server half: it reads core's upcoming outlook through the SDK client.
      endpoints: false,
      exporters: false,
    },
  },
  {
    id: 'wickermoney.forecast',
    name: 'Forecast',
    version: '0.1.0',
    description: 'Each account\'s projected daily balance from its recurring items, with when it would dip below its buffer.',
    author: 'Wicker',
    sdkVersion: SDK_MAJOR_VERSION,
    // The same two read grants as "Until payday", for the same reasons: the
    // projection is built from recurring items (and their legs) and starts
    // from an account's balance and buffer, both computed by core. No
    // transactions: the forecast is what the schedule says, not a guess from
    // spending history.
    requiredTables: [
      { table: 'recurring_items', access: 'read' },
      { table: 'accounts', access: 'read' },
    ],
    permissions: [],
    remoteEntry: '/plugins/forecast/remoteEntry.js',
    contributes: {
      pages: [
        {
          path: 'forecast',
          title: 'Forecast',
          // First of the plugin pages: it reads straight on from Recurring,
          // the last core entry, which is where its data is entered.
          nav: { label: 'Forecast', section: 'main', order: 20 },
          module: './ForecastPage',
        },
      ],
      widgets: [],
      // No server half: it reads core's forecast through the SDK client.
      endpoints: false,
      exporters: false,
    },
  },
]
