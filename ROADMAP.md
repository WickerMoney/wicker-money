# Roadmap

Wicker Money is pre-1.0 and has a single maintainer. This is direction, not a
promise: items move, shrink or disappear, and there are no dates.

**Now** is the scope of the first public release, `v0.1.0`: nothing under Now is
optional, and nothing outside it blocks the tag.

## Shipped

| Milestone | What it added |
|---|---|
| M1 | Auth and ledger: users, accounts, categories, rules, transactions, splits, all under row-level security |
| M2 | The shell and the first plugin: Module Federation host, dashboard widgets from plugins, scoped plugin client |
| M3 | Import and categorization: CSV import, category rules with preview, triage tools |

## Now

- Get to a first tagged release (`v0.1.0`): self-hosting quickstart, published
  container image, published `plugin-sdk` and `ui-kit`.
- Hardening the first-run and deployment story (registration policy, secure
  cookie guidance).
- Add a `semimonthly` recurrence frequency (twice a month, such as the 1st and
  15th). It is a core database enum, so it is cheaper to add before the first
  tag than after.
- Fill the gaps in the design tokens, such as a chart palette, before plugins
  depend on them. Tokens and `ui-kit` classes now use the `--wm-` / `wm-`
  prefix; renaming a public token later is a breaking change.

## Next

- Recurring items management in core, on its own page: create, edit and end
  recurring bills and income. The table and its export exist today, but nothing
  can populate it.
- An upcoming bills and income dashboard widget. Read-only and at a glance from
  today, running through the next payday. It shows expected income and bills at
  their nominal dates, and warns if a checking account would fall below its buffer
  amount before that payday. Credit card and loan payments show as bills, and
  transfers between your own accounts, such as checking to savings, sit behind
  an "all" option. Occurrence math lives
  in a shared, well-tested module so forecasting can reuse it.
- Paid / landed matching for that widget, as a fast follow: match expected items
  against ledger transactions and show which have arrived, which also settles
  weekend and holiday shifting as expected versus cleared. Needs a link between
  a recurring item and a transaction, and per-occurrence overrides (skip a
  month, change one month's amount).
- Forecasting, using recurring items for the known part of the future.
- A plugin picker (UI to enable and disable plugins). Plugins in the same area,
  such as several budgeting approaches, can be enabled together.
- A debt payoff plugin with snowball and avalanche strategies. It keeps its own
  per-debt balance, rate and minimum payment.

- A settings danger zone: "erase my data" (delete the calling user's own rows
  across core and every plugin schema) and "erase this entire instance" (drop
  every user and reset every plugin schema to empty), as two distinct,
  separately-confirmed actions. Decided in an earlier session but never built;
  Settings today only has About, Config and Export.
- A per-plugin theme contribution point (`contributes.themes` on the plugin
  manifest), so a plugin can ship an additional theme alongside the built-in
  light/dark/system switcher. Also decided, not yet built — do not confuse
  with the global theme switcher already shipped, which is a different,
  simpler thing.

## Later

- Cross-plugin data access: a plugin reading data another plugin owns, for
  example debt details feeding net worth or FIRE, or comparing two budgeting
  plugins side by side. Today a plugin only sees core tables.
- An envelope budgeting plugin, alongside the existing budgets plugin.
- FIRE plugins, one per approach (lean, fat, barista, coast) so they can run side
  by side and be compared, built on a shared calculation module. Each one is kept
  light so several can run without growing the container or server footprint.
  Depends on forecasting.
- Extending the shortfall warning to savings and other accounts, measured
  against each account's buffer amount, for planning larger purchases.
- Editing an occurrence from the calendar widget, and a month grid view.
- Suggesting recurring items by detecting patterns in transaction history.
- Themes as a data-only plugin type (a validated set of design tokens, no code).
- Third-party plugin install. This depends on plugin isolation, which does not
  exist yet; today plugin code runs fully trusted.
- Freezing the plugin API (`SDK_MAJOR_VERSION`) ahead of 1.0.
