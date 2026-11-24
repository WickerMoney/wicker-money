# Debt payoff

Bundled plugin `wickermoney.debt-payoff`: a list of debts, a payoff plan by
snowball, avalanche or your own order, and a "Debt-free date" dashboard widget.

## Lump sums and the what-if

A lump sum is a one-off payment: a date, an amount, an optional note (up to 200
characters), and optionally part of it aimed at particular debts.

- **When it is paid.** On the first payment date on or after its date, after that
  month's interest and minimums. Parts aimed at a debt go first (never more than
  it owes), then the rest goes to the debt the strategy would pay next. This is
  the same for snowball, avalanche and Custom order.
- **Money nobody can take.** If every debt is paid off or not yet due, the rest is
  not used and the page says how much.
- **A date that has passed** is ignored by the plan, because your balances
  already include money paid before today. The page notes it and offers to
  remove it. A date after the plan's last month (600 months) is ignored too.
- **What if?** Enter a date and an amount (and optionally parts) to see the
  debt-free date and the interest it would save against your current plan, with
  your saved lump sums already counted. Nothing is saved until you choose "Save
  as a lump sum". The answer is shown as a sentence and read out by the page's
  live region.

### API

Under `/api/v1/p/wickermoney.debt-payoff`: `GET/POST /lump-sums`,
`PUT/DELETE /lump-sums/:id`, `POST /plan/what-if`. `GET /plan` adds `lumpSums`
(what the plan did with each) only when there are lump sums. See
`DEVELOPMENT.md`, "Debt payoff".

### Data

Tables `lump_sums` and `lump_sum_allocations` in `plugin_debt_payoff` (migration
037), under forced row-level security. They are included in the data export
(`lumpSums`) and removed with the rest of the plugin's data on erase.

### What the docs site needs later

A "Lump sums" section under Debt payoff covering the rules above (payment date,
parts, ignored past dates, unused money) and the what-if; the three new
endpoints and the `lumpSums` field of the plan and of the export. This change
does not touch the docs site.
