# Roadmap

Wicker Money is pre-1.0 and has a single maintainer. This is direction, not a
promise: items move, shrink or disappear, and there are no dates.

**Now** is what the next release is working toward. The current release is
`v0.2.1`; see `CHANGELOG.md` for what each tag contains.

## Shipped

| Milestone | What it added |
|---|---|
| M1 | Auth and ledger: users, accounts, categories, rules, transactions, splits, all under row-level security |
| M2 | The shell and the first plugin: Module Federation host, dashboard widgets from plugins, scoped plugin client |
| M3 | Import and categorization: CSV import, category rules with preview, triage tools |
| M4 (`v0.1.0`) | Release readiness and brand identity: self-hosting quickstart, published container image and `plugin-sdk`/`ui-kit`, first-run hardening, `semimonthly` recurrence, the `--wm-` design-token rename, the theme switcher, and a real brand accent and chart palette derived from the logo |
| `v0.2.1` | Recurring items, Phase B: a Forecast page (bundled plugin) showing each account's projected daily balance from its recurring items over 30/60/90 days, 6 months or to year end. It has a step chart with zero and buffer lines, a first-breach banner, stat tiles, and what moves the line. Also a time zone setting, with the browser's zone taken at sign-up |
| `v0.2.0` | Recurring items, Phase A: a Recurring page for income, bills, debt payments and transfers (items plus per-account legs), the "Until payday" dashboard widget with per-account shortfall warnings and a choice of which accounts count toward safe to spend, buffers editable on the Accounts page, the `plugin-sdk` recurrence module, and transfer `externalId` for duplicate-safe imports |

## Now

The fast follow to recurring items:

- Paid / landed matching for "Until payday" and the forecast (in review):
  transactions matched to occurrences, suggested matches to confirm,
  per-occurrence skip, move and amount, and late occurrences carried
  forward on items that are matched. Follow-ups: matching from the
  Transactions page, dismissing a suggestion, and seed data that shows it.

## Next

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
