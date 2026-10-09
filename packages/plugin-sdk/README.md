# @wickermoney/plugin-sdk

The contract between [Wicker Money](https://github.com/WickerMoney/wicker-money)
and its plugins. The host and every plugin build against this package: it
defines the plugin manifest and validates it, and it declares the props and
context a plugin's React components receive.

Wicker Money is self-hostable personal finance built as a thin core plus
installable plugins. Budgets, insights, importers and forecasting are all
plugins. Full documentation lives at [wickermoney.dev](https://wickermoney.dev).

> **Pre-1.0.** `SDK_MAJOR_VERSION` is `0`, so the contract can still change
> between minor releases. A host refuses any manifest built against a different
> SDK major version.

## Install

```sh
npm install @wickermoney/plugin-sdk
# or: pnpm add @wickermoney/plugin-sdk
```

Browser-side plugin code also needs `react` 19, which the host shares with every
plugin as a Module Federation singleton.

## Entry points

| Import | Use it for | Contents |
|---|---|---|
| `@wickermoney/plugin-sdk/runtime` | Plugin UI code (browser) | Types for the React components a plugin exports (`PluginWidgetProps`, `PluginPageProps`, `PluginContext`, ...), and `adoptPluginStyles` |
| `@wickermoney/plugin-sdk/recurrence` | Anything (browser or Node) | Recurring-item date maths and projections: `occurrences`, `nextOccurrence`, `scheduledOccurrences`, `nextScheduledOccurrence`, `nextPayday`, `monthlyEquivalent`, `dailyBalances`, `flowTotals`, with per-occurrence overrides (skip, move, change the legs) |
| `@wickermoney/plugin-sdk/money` | Anything (browser or Node) | Exact money arithmetic on decimal strings: `addMoney`, `sumMoney`, `compareMoney`, `equalMoney`, `moneyToUnits`, `divideUnits`, ... |
| `@wickermoney/plugin-sdk` | Hosts, tooling, tests (Node) | Everything above, plus the Zod manifest schemas, `parseManifest`, dashboard-range helpers and constants |

Import from `/runtime` (and `/money` or `/recurrence` if you need them) in plugin UI code.
The package root re-exports the Zod manifest schemas, which add about 85 kB to
a plugin bundle that never uses them.

## Recurring items

`/recurrence` is pure and dependency-free: calendar dates in and out as
`YYYY-MM-DD`, money as decimal strings (never `number`), and no clock. Work out
the user's today once, in their time zone, and pass it in. Ranges are
half-open, like `DashboardRange`: `from` inclusive, `to` exclusive.

```ts
import { dailyBalances, nextPayday, occurrences } from '@wickermoney/plugin-sdk/recurrence'

const rent = {
  frequency: 'monthly',
  seriesStartDate: '2026-01-31',          // immutable anchor
  legs: [{ accountId: 'checking', amount: '-1550.0000' }],
} as const

occurrences(rent, '2026-02-01', '2026-04-01') // ['2026-02-28', '2026-03-31']

const payday = nextPayday(items, today)       // strictly after today, or null
const series = dailyBalances(items, { checking: '812.4000' }, tomorrow, payday ?? fallback)
```

Monthly, quarterly and annual items clamp to the end of short months, computed
from the anchor each time (Jan 31 → Feb 28 → Mar 31). `semimonthly` takes two
days (`semimonthlyDays`, default `[1, 15]`). An unknown frequency throws rather
than dropping an item from a forecast.

An item can carry `overrides`, keyed by nominal date, to change single
occurrences: `skipped`, a new `date` (earlier or later, even outside the range
asked about) or replacement `legs`. Every projection honours them, and
`scheduledOccurrences(item, from, to)` lists what lands in a range after them.
An empty `legs` list means "happens, moves nothing", which is how money that
has already posted is kept out of a projection.

```ts
const bills = { ...rent, overrides: { '2026-03-31': { skipped: true }, '2026-04-30': { date: '2026-05-01' } } }
scheduledOccurrences(bills, '2026-03-01', '2026-06-01')
// [{ nominalDate: '2026-04-30', date: '2026-05-01', legs }, { nominalDate: '2026-05-31', ... }]
```

## Money

Money is `numeric(19,4)` in the database and a decimal string in TypeScript,
never a `number`. `/money` does the arithmetic exactly, in `bigint` units of
0.0001, and hands back canonical four-decimal strings.

```ts
import { addMoney, compareMoney, equalMoney, sumMoney } from '@wickermoney/plugin-sdk/money'

sumMoney(['0.1', '0.2'])              // '0.3000', not 0.30000000000000004
equalMoney('-81.2000', '-81.20')      // true; `===` would say false
rows.sort((a, b) => compareMoney(a.total, b.total))
```

For loops that add up many values, work in units and format once:

```ts
import { moneyToUnits, unitsToMoney, divideUnits } from '@wickermoney/plugin-sdk/money'

let total = 0n
for (const row of rows) total += moneyToUnits(row.amount)
unitsToMoney(total)                           // '1234.5600'
unitsToMoney(divideUnits(total * 26n, 12n))   // scale, then round once
```

The rules:

- **Strict input.** A plain decimal string with at most four decimal places.
  Anything else, including a fifth decimal place, throws `RangeError`. Nothing
  is silently truncated or rounded, and the API refuses the same input.
- **Canonical output.** Four decimal places, and never `'-0.0000'`.
- **One rounding rule.** Only `divideUnits` rounds, half away from zero. That
  is the API's rule as well, so a plugin and the server agree to the unit.
- **Not for display.** `unitsToMoney` returns the storage form. Show amounts
  with the host's `ctx.formatMoney`, and prefill inputs with `editableMoney`
  (`'450.0000'` → `'450.00'`).

## A plugin, in brief

A plugin is a **manifest** plus a **Module Federation remote** whose exposed
modules default-export React components.

### Manifest

```ts
import { parseManifest, SDK_MAJOR_VERSION } from '@wickermoney/plugin-sdk'

const result = parseManifest({
  id: 'example.cash-runway',          // reverse-domain
  name: 'Cash Runway',
  version: '0.1.0',
  sdkVersion: SDK_MAJOR_VERSION,
  requiredTables: [{ table: 'transactions', access: 'read' }],
  permissions: [],
  remoteEntry: '/plugins/cash-runway/remoteEntry.js',
  contributes: {
    widgets: [
      {
        id: 'runway',
        slot: 'dashboard.secondary',  // dashboard.primary | dashboard.secondary | account.detail
        title: 'Cash runway',
        defaultSize: 'md',            // sm | md | lg | full
        module: './RunwayWidget',
      },
    ],
  },
})

if ('error' in result) throw new Error(result.error)
```

`requiredTables` is enforced by PostgreSQL for a plugin's **server-side** code.
Each bundled plugin's server code runs under its own database role, which is
granted exactly the tables its manifest lists. A query against any other table
is refused.

It is **not** enforced against your plugin's UI code. See
[Trust model](#trust-model) below.

### Widget

```tsx
import type { PluginWidgetProps } from '@wickermoney/plugin-sdk/runtime'

export default function RunwayWidget({ ctx, size, range }: PluginWidgetProps) {
  // ctx.api is scoped to your plugin and the tables your manifest grants
  // (a convenience that catches mistakes early, not a sandbox); the host
  // attaches credentials, so well-behaved plugin code never handles a token.
  // Paths are relative to the API root; don't prefix /api/v1 yourself.
  // ...
  return <p>{ctx.formatMoney('1234.5600')}</p>
}
```

Money crosses the contract as a **decimal string**, never a JavaScript
`number`. Use `ctx.formatMoney` to display it.

## Two rules that fail at runtime, not build time

1. **The remote entry must be an ES module.** The host loads remotes with a
   dynamic `import()`. A remote built as a classic script fails when each widget
   mounts, with *"Cannot use import statement outside a module"*.
2. **Inject CSS; don't import it for its side effect.** A remote has no HTML
   document, so the host never requests the stylesheet the bundler emits. Import
   the CSS as text and adopt it instead:

   ```ts
   import { adoptPluginStyles } from '@wickermoney/plugin-sdk/runtime'
   import css from './widget.css?inline'

   adoptPluginStyles('example.cash-runway', css)
   ```

   This is not a style sandbox. Scope your selectors under a class your plugin
   owns.

## Trust model

UI plugins (widgets and pages loaded over Module Federation) run **fully
trusted, in the host application's origin**. They share the page, its memory and
the signed-in user's session with the host. The host's scoped client, the
`x-wickermoney-plugin` header and the manifest check in `ctx.api` are
developer feedback, not a security boundary: UI code that wants to can call any
`/api/v1/*` route as the user, including routes outside its `requiredTables`.

What is enforced against plugin code is the per-plugin PostgreSQL role, and only
for server-side code (`contributes.endpoints`, bundled plugins only).

So today:

- Third-party plugin install is not supported. Treat every UI plugin as code
  with full access to the user's data, and only run plugins you wrote or have
  reviewed.
- Operators should keep `PLUGIN_REMOTE_ORIGINS` empty unless they fully trust
  every origin listed.
- Declare `requiredTables` honestly anyway. It is what the database enforces
  for your server code, and the contract a future isolation model will rely on.

## Server-side code

Only bundled plugins may contribute server endpoints (`contributes.endpoints`).
The host has no sandbox for third-party server code yet. Third-party plugins are
UI-only and use core endpoints through `ctx.api`.

## Related

- [`@wickermoney/ui-kit`](https://www.npmjs.com/package/@wickermoney/ui-kit):
  the host's components and design tokens, so a plugin looks native.
- [Writing a plugin](https://github.com/WickerMoney/wicker-money#writing-a-plugin)
  in the main repo README.
- The bundled plugins in
  [`plugins/`](https://github.com/WickerMoney/wicker-money/tree/main/plugins)
  are working examples.

## License

[Apache-2.0](./LICENSE). The Wicker Money application is licensed separately
(AGPL-3.0); see the [main repository](https://github.com/WickerMoney/wicker-money).
