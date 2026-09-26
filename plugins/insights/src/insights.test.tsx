import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '@wickermoney/plugin-sdk'
import DonutWidget from './DonutWidget.js'
import TrendWidget from './TrendWidget.js'
import { labelEvery } from './helpers/labelEvery.js'
import { monthLabel } from './helpers/monthLabel.js'
import { topCategories } from './helpers/topCategories.js'
import { totalsByMonth } from './helpers/totalsByMonth.js'
import type { SummaryRow } from './models/index.js'

const rows: SummaryRow[] = [
  { month: '2026-07', categoryId: 'a', categoryName: 'Groceries', kind: 'expense', total: '120.00' },
  { month: '2026-07', categoryId: 'b', categoryName: 'Transport', kind: 'expense', total: '40.00' },
  { month: '2026-08', categoryId: 'a', categoryName: 'Groceries', kind: 'expense', total: '90.00' },
]

function ctxWith(rows: SummaryRow[], reject?: string): PluginContext {
  return {
    session: { userId: 'u1', email: 'u@example.com', timezone: 'UTC' },
    api: {
      get: vi.fn(async () =>
        reject !== undefined ? Promise.reject(new Error(reject)) : ({ months: 12, rows } as never),
      ),
      post: vi.fn(),
      put: vi.fn(),
      del: vi.fn(),
    },
    navigate: vi.fn(),
    formatMoney: (v) => `$${Number(v).toFixed(2)}`,
    formatDate: (v) => v,
  }
}

describe('aggregation', () => {
  it('totals by month, oldest first', () => {
    expect(totalsByMonth(rows)).toEqual([
      { month: '2026-07', income: '0.0000', expense: '160.0000', net: '-160.0000' },
      { month: '2026-08', income: '0.0000', expense: '90.0000', net: '-90.0000' },
    ])
  })

  it('ranks categories by spend', () => {
    expect(topCategories(rows)).toEqual([
      { name: 'Groceries', total: '210.0000' },
      { name: 'Transport', total: '40.0000' },
    ])
  })

  // The categorical palette is validated for a fixed number of slots, so a
  // seventh series must fold rather than invent a hue.
  it('folds everything past the limit into Other', () => {
    const many: SummaryRow[] = Array.from({ length: 9 }, (_, i) => ({
      month: '2026-08', categoryId: String(i), categoryName: `Cat ${i}`, kind: 'expense',
      total: String(100 - i * 10),
    }))
    const result = topCategories(many, 5)
    expect(result).toHaveLength(6)
    expect(result[5]?.name).toBe('Other')
    expect(result[5]?.total).toBe('140.0000')
  })

  it('omits Other when nothing is left over', () => {
    expect(topCategories(rows, 5).some((c) => c.name === 'Other')).toBe(false)
  })

  it('labels months', () => expect(monthLabel('2026-01')).toBe('Jan'))
})

describe('TrendWidget', () => {
  it('renders a labelled chart once loaded', async () => {
    render(<TrendWidget ctx={ctxWith(rows)} size="lg" />)
    expect(await screen.findByRole('img', { name: /spending per month/i })).toBeDefined()
  })

  it('shows an empty state rather than an empty chart', async () => {
    render(<TrendWidget ctx={ctxWith([])} size="lg" />)
    // The chart shows both directions now, so an empty ledger is "nothing
    // recorded", not "nothing spent".
    expect(await screen.findByText('Nothing recorded yet')).toBeDefined()
  })

  it('surfaces a refused grant as an error, not a crash', async () => {
    render(<TrendWidget ctx={ctxWith([], "Plugin did not request read access to 'accounts'")} size="lg" />)
    expect(await screen.findByRole('alert')).toBeDefined()
  })
})

describe('DonutWidget', () => {
  it('lists every category with its value in text, not colour alone', async () => {
    render(<DonutWidget ctx={ctxWith(rows)} size="md" />)
    expect(await screen.findByText('Groceries')).toBeDefined()
    expect(screen.getByText('Transport')).toBeDefined()
    expect(screen.getByText('$210.00')).toBeDefined()
    expect(screen.getByText('$40.00')).toBeDefined()
  })

  it('shows the total in the centre', async () => {
    render(<DonutWidget ctx={ctxWith(rows)} size="md" />)
    expect(await screen.findByText('$250.00')).toBeDefined()
  })
})

describe('stylesheet delivery', () => {
  it('injects the palette into the document, once, for the whole plugin', () => {
    // Importing either widget pulls in ./styles.js. A federated remote's
    // emitted stylesheet is never requested by the host, so if this ever stops
    // happening the charts render with every custom property unset — black
    // fills, no errors, nothing failing.
    const tags = document.querySelectorAll('style[id="wickermoney-plugin-styles:wickermoney.insights"]')
    expect(tags).toHaveLength(1)
    expect(tags[0]?.textContent).toContain('--viz-1')
  })
})

describe('months with no spending', () => {
  const sparse: SummaryRow[] = [
    { month: '2026-03', categoryId: 'a', categoryName: 'Groceries', kind: 'expense', total: '100.00' },
    { month: '2026-09', categoryId: 'a', categoryName: 'Groceries', kind: 'expense', total: '200.00' },
  ]

  it('keeps the gap when the range says the months exist', () => {
    const expected = ['2026-07', '2026-08', '2026-09']

    expect(totalsByMonth(sparse, expected)).toEqual([
      { month: '2026-07', income: '0.0000', expense: '0.0000', net: '0.0000' },
      { month: '2026-08', income: '0.0000', expense: '0.0000', net: '0.0000' },
      { month: '2026-09', income: '0.0000', expense: '200.0000', net: '-200.0000' },
    ])
  })

  it('collapses the gap without a range, as it always did', () => {
    // Without a range the function keeps only the months that have data: two
    // bars side by side for months six apart. Filling the gap is what passing
    // a range opts into, not something to decide unasked.
    expect(totalsByMonth(sparse)).toEqual([
      { month: '2026-03', income: '0.0000', expense: '100.0000', net: '-100.0000' },
      { month: '2026-09', income: '0.0000', expense: '200.0000', net: '-200.0000' },
    ])
  })

  it('returns a slot per expected month even when nothing matches at all', () => {
    expect(totalsByMonth([], ['2026-01', '2026-02'])).toEqual([
      { month: '2026-01', income: '0.0000', expense: '0.0000', net: '0.0000' },
      { month: '2026-02', income: '0.0000', expense: '0.0000', net: '0.0000' },
    ])
  })
})

describe('axis label density', () => {
  it('labels every month when they fit and thins them out when they do not', () => {
    // A 24-month axis with a label per bar is a smear, not an axis.
    expect(labelEvery(6)).toBe(1)
    expect(labelEvery(12)).toBe(2)
    expect(labelEvery(24)).toBe(3)
  })
})

describe('the widgets and the dashboard range', () => {
  const range = {
    key: '3m' as const, label: '3 months', months: 3,
    from: '2026-07-01', to: '2026-10-01',
  }

  it('asks the API for the range it was given', async () => {
    const ctx = ctxWith(rows)
    render(<TrendWidget ctx={ctx} size="lg" range={range} />)
    await screen.findByRole('img')
    expect(ctx.api.get).toHaveBeenCalledWith('/core/transactions/monthly-summary?months=3', {
      signal: expect.any(AbortSignal) as AbortSignal,
    })
  })

  it('falls back to twelve months when rendered without a range', async () => {
    const ctx = ctxWith(rows)
    render(<TrendWidget ctx={ctx} size="lg" />)
    await screen.findByRole('img')
    expect(ctx.api.get).toHaveBeenCalledWith('/core/transactions/monthly-summary?months=12', {
      signal: expect.any(AbortSignal) as AbortSignal,
    })
  })

  it('draws a bar for every month in the range, not only the ones with data', async () => {
    const ctx = ctxWith(rows)
    render(<TrendWidget ctx={ctx} size="lg" range={range} />)
    // July, August and September — September has no rows and still gets a slot.
    const marks = await screen.findAllByRole('listitem')
    expect(marks.length).toBe(3)
  })

  it('reaches every value without a hover', async () => {
    const ctx = ctxWith(rows)
    render(<TrendWidget ctx={ctx} size="lg" range={range} />)
    // Tooltips enhance, they never gate: the figure is on the mark itself.
    expect(await screen.findByLabelText(/Jul 2026: \$0\.00 in, \$160\.00 out/)).toBeTruthy()
    expect(screen.getByLabelText(/Sep 2026: \$0\.00 in, \$0\.00 out/)).toBeTruthy()
  })

  it('says the range is empty rather than claiming the ledger is', async () => {
    const ctx = ctxWith([])
    render(<TrendWidget ctx={ctx} size="lg" range={range} />)
    // "No spending yet" for a too-narrow range would send someone looking for
    // transactions that are sitting right there in an earlier month.
    expect(await screen.findByText(/Nothing in the last 3 months/)).toBeTruthy()
  })

  it('names the range in the donut centre', async () => {
    const ctx = ctxWith(rows)
    render(<DonutWidget ctx={ctx} size="md" range={range} />)
    expect(await screen.findByText('3 months')).toBeTruthy()
  })
})

describe('income against expense', () => {
  const mixed: SummaryRow[] = [
    { month: '2026-07', categoryId: 's', categoryName: 'Salary', kind: 'income', total: '3000.00' },
    { month: '2026-07', categoryId: 'a', categoryName: 'Groceries', kind: 'expense', total: '400.00' },
    { month: '2026-08', categoryId: 'a', categoryName: 'Groceries', kind: 'expense', total: '500.00' },
  ]

  it('separates the two series and derives the net', () => {
    expect(totalsByMonth(mixed)).toEqual([
      { month: '2026-07', income: '3000.0000', expense: '400.0000', net: '2600.0000' },
      // A month with outgoings and no income is negative, not zero.
      { month: '2026-08', income: '0.0000', expense: '500.0000', net: '-500.0000' },
    ])
  })

  it('keeps income out of "where it went"', () => {
    // Mixing a salary slice into a spending breakdown would make the largest
    // wedge the one thing that did not go anywhere.
    expect(topCategories(mixed).map((c) => c.name)).toEqual(['Groceries'])
  })

  it('draws both series and names both in the readout', async () => {
    const ctx = ctxWith(mixed)
    render(<TrendWidget ctx={ctx} size="lg" />)
    expect(await screen.findByLabelText(/Jul 2026: \$3,?000\.00 in, \$400\.00 out, \$2,?600\.00 net/))
      .toBeTruthy()
  })

  it('shows a legend, because two series can never be colour alone', async () => {
    const ctx = ctxWith(mixed)
    render(<TrendWidget ctx={ctx} size="lg" />)
    expect(await screen.findByText('Income')).toBeTruthy()
    expect(screen.getByText('Spending')).toBeTruthy()
    expect(screen.getByText('Net')).toBeTruthy()
  })

  it('scales both directions the same, so the two are comparable', async () => {
    const ctx = ctxWith(mixed)
    const { container } = render(<TrendWidget ctx={ctx} size="lg" />)
    await screen.findByRole('img')
    const bars = [...container.querySelectorAll('rect.viz__bar')] as SVGRectElement[]
    const july = bars.slice(0, 2).map((b) => Number(b.getAttribute('height')))
    // 3000 in against 400 out: the income bar must be about 7.5x the expense
    // bar. Giving each side its own scale would make them look comparable while
    // being nothing of the sort.
    expect((july[0] ?? 0) / (july[1] ?? 1)).toBeCloseTo(3000 / 400, 1)
  })
})

describe('a month whose refunds exceeded its spending', () => {
  const refunded: SummaryRow[] = [
    { month: '2026-07', categoryId: 'a', categoryName: 'Shoes', kind: 'expense', total: '-300.00' },
  ]

  it('reports the negative total rather than hiding it', () => {
    expect(totalsByMonth(refunded)).toEqual([
      { month: '2026-07', income: '0.0000', expense: '-300.0000', net: '300.0000' },
    ])
  })

  it('still draws a bar, on the side the sign implies', async () => {
    const ctx = ctxWith(refunded)
    const { container } = render(<TrendWidget ctx={ctx} size="lg" />)
    await screen.findByRole('img')
    const bars = [...container.querySelectorAll('rect.viz__bar')] as SVGRectElement[]
    const drawn = bars.filter((b) => Number(b.getAttribute('height')) > 0)

    // Clamping a negative total to zero drew nothing while the legend still
    // counted it — the chart disagreeing with its own total.
    expect(drawn.length).toBe(1)
    const zero = Number(drawn[0]?.getAttribute('y'))
    // Above the zero line, because money came back in.
    expect(zero).toBeLessThan(150)
  })
})
