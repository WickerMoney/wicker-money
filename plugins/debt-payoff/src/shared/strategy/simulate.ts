import { BALANCE_CEILING_UNITS } from './BALANCE_CEILING_UNITS.js'
import type { CapReason } from './CapReason.js'
import { MAX_PLAN_MONTHS } from './MAX_PLAN_MONTHS.js'
import { monthlyInterest } from './monthlyInterest.js'
import type { ParsedDebt } from './ParsedDebt.js'

/** One debt's running figures while a simulation runs. */
export interface DebtRun {
  readonly debt: ParsedDebt
  /** What is owed now. */
  balance: bigint
  /** Interest accrued so far. */
  interest: bigint
  /** Paid so far. */
  paid: bigint
  /** The month it reached zero, or `null` while it has not. */
  payoffMonth: number | null
}

/** One debt's figures for one simulated month, in units. */
export interface RunDebtMonth {
  readonly run: DebtRun
  readonly interest: bigint
  readonly payment: bigint
  readonly balance: bigint
}

/** One simulated month, in units. */
export interface RunMonth {
  readonly month: number
  readonly interest: bigint
  readonly payment: bigint
  readonly balance: bigint
  readonly debts: readonly RunDebtMonth[]
}

/** What a simulation produced. */
export interface Simulation {
  /** Every debt's final figures, in the order given. */
  readonly runs: readonly DebtRun[]
  /** One entry per month simulated. */
  readonly months: readonly RunMonth[]
  /** Why it stopped short, or `null` if everything was paid. */
  readonly capped: CapReason | null
}

/** What to simulate. */
export interface SimulationInput {
  /** Debts with a balance, highest priority first. */
  readonly debts: readonly ParsedDebt[]
  /** Paid every month above the minimums, in units. Ignored unless `rollover` is set. */
  readonly extra: bigint
  /**
   * Whether the money is pooled. With it, one amount is paid every month (the
   * sum of the minimums plus the extra), each debt takes its own minimum, and
   * everything else goes to the highest-priority debt that still has a
   * balance, so a paid-off debt's minimum is aimed at the next one. Without
   * it, each debt gets only its own minimum and nothing moves between them.
   */
  readonly rollover: boolean
}

/**
 * Runs the payoff month by month.
 *
 * Each month, for every debt with a balance:
 *
 * 1. **Interest accrues** on the opening balance (see {@link monthlyInterest}).
 * 2. **The minimum is paid**, but never more than the debt now owes, so a
 *    minimum larger than the balance clears it and leaves nothing negative.
 * 3. **With `rollover`**, whatever is left of the month's pooled amount is
 *    aimed down the priority list: the first debt takes up to what it owes,
 *    the next takes what remains, and so on. That one rule covers an extra
 *    payment, a freed minimum, and the leftover when a final payment is
 *    smaller than the minimum.
 *
 * The month a balance reaches zero is its payoff month. The run ends when
 * nothing is owed, or at {@link MAX_PLAN_MONTHS}, or when a balance reaches
 * {@link BALANCE_CEILING_UNITS}; the last two are reported as capped.
 *
 * Every figure is an exact integer except the interest, which is rounded once
 * per debt per month inside {@link monthlyInterest}.
 *
 * @param input - See {@link SimulationInput}.
 * @returns The schedule and each debt's totals.
 */
export function simulate(input: SimulationInput): Simulation {
  const runs: DebtRun[] = input.debts.map((debt) => ({
    debt, balance: debt.balance, interest: 0n, paid: 0n, payoffMonth: null,
  }))
  const pool = input.rollover
    ? runs.reduce((sum, run) => sum + run.debt.minimum, 0n) + input.extra
    : 0n

  const months: RunMonth[] = []
  let capped: CapReason | null = null

  for (let month = 1; ; month += 1) {
    const open = runs.filter((run) => run.balance > 0n)
    if (open.length === 0) break
    if (month > MAX_PLAN_MONTHS) {
      capped = 'month_limit'
      break
    }
    if (open.some((run) => run.balance >= BALANCE_CEILING_UNITS)) {
      capped = 'balance_limit'
      break
    }

    const lines = open.map((run) => {
      const interest = monthlyInterest(run.balance, run.debt.apr)
      run.balance += interest
      run.interest += interest
      return { run, interest, payment: 0n }
    })

    let spent = 0n
    for (const line of lines) {
      const payment = line.run.debt.minimum < line.run.balance ? line.run.debt.minimum : line.run.balance
      line.payment = payment
      line.run.balance -= payment
      spent += payment
    }

    if (input.rollover) {
      let left = pool - spent
      for (const line of lines) {
        if (left <= 0n) break
        const payment = left < line.run.balance ? left : line.run.balance
        line.payment += payment
        line.run.balance -= payment
        left -= payment
      }
    }

    for (const line of lines) {
      line.run.paid += line.payment
      if (line.run.balance === 0n) line.run.payoffMonth = month
    }

    months.push({
      month,
      interest: lines.reduce((sum, line) => sum + line.interest, 0n),
      payment: lines.reduce((sum, line) => sum + line.payment, 0n),
      balance: runs.reduce((sum, run) => sum + run.balance, 0n),
      debts: lines.map((line) => ({
        run: line.run, interest: line.interest, payment: line.payment, balance: line.run.balance,
      })),
    })
  }

  return { runs, months, capped }
}
