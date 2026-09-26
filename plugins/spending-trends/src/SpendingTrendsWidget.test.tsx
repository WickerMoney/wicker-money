import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { resolveRange, type PluginContext } from '@wickermoney/plugin-sdk'
import SpendingTrendsWidget from './SpendingTrendsWidget.js'
import type { SummaryRow } from './models/index.js'

const row = (
  month: string, id: string | null, name: string, total: string, kind: SummaryRow['kind'] = 'expense',
): SummaryRow => ({ month, categoryId: id, categoryName: name, kind, total })

const rows: SummaryRow[] = [
  row('2026-07', 'a', 'Groceries', '120.00'),
  row('2026-07', 'b', 'Transport', '40.00'),
  row('2026-08', 'a', 'Groceries', '90.00'),
]

function ctxWith(data: SummaryRow[], reject?: string): PluginContext {
  return {
    session: { userId: 'u1', email: 'u@example.com', timezone: 'UTC' },
    api: {
      get: vi.fn(async () =>
        reject !== undefined ? Promise.reject(new Error(reject)) : ({ months: 12, rows: data } as never),
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

const segments = (container: HTMLElement) => container.querySelectorAll('.spt__segment')

describe('SpendingTrendsWidget', () => {
  it('renders a labelled chart once loaded', async () => {
    render(<SpendingTrendsWidget ctx={ctxWith(rows)} size="lg" />)
    expect(await screen.findByRole('img', { name: /spending by category/i })).toBeDefined()
  })

  it('reads the monthly summary for the range the dashboard is showing', async () => {
    const ctx = ctxWith(rows)
    render(<SpendingTrendsWidget ctx={ctx} size="lg" range={resolveRange('6m', '2026-09-19')} />)
    await screen.findByRole('img')
    expect(ctx.api.get).toHaveBeenCalledWith(
      '/core/transactions/monthly-summary?months=6',
      expect.anything(),
    )
  })

  it('names each category and its total in text, not colour alone', async () => {
    render(<SpendingTrendsWidget ctx={ctxWith(rows)} size="lg" />)
    const groceries = await screen.findByRole('button', { name: /Groceries/ })
    expect(groceries.textContent).toContain('$210.00')
    expect(groceries.getAttribute('aria-pressed')).toBe('true')
    expect((await screen.findByRole('button', { name: /Transport/ })).textContent).toContain('$40.00')
  })

  it('draws one segment per category per month that spent', async () => {
    const { container } = render(<SpendingTrendsWidget ctx={ctxWith(rows)} size="lg" />)
    await screen.findByRole('img')
    expect(segments(container)).toHaveLength(3)
  })

  it('removes a category from the bars when its chip is turned off, and back on again', async () => {
    const user = userEvent.setup()
    const { container } = render(<SpendingTrendsWidget ctx={ctxWith(rows)} size="lg" />)
    const transport = await screen.findByRole('button', { name: /Transport/ })

    await user.click(transport)
    expect(transport.getAttribute('aria-pressed')).toBe('false')
    expect(segments(container)).toHaveLength(2)

    await user.click(transport)
    expect(transport.getAttribute('aria-pressed')).toBe('true')
    expect(segments(container)).toHaveLength(3)
  })

  it('does not recolour the remaining categories when one is hidden', async () => {
    const user = userEvent.setup()
    const { container } = render(<SpendingTrendsWidget ctx={ctxWith(rows)} size="lg" />)
    const colour = () => container.querySelector('[data-series="b"]')?.getAttribute('fill')
    await screen.findByRole('img')
    const before = colour()

    await user.click(screen.getByRole('button', { name: /Groceries/ }))

    expect(before).toBe('var(--spt-2)')
    expect(colour()).toBe(before)
  })

  it('says so, and keeps the chips, when every category is hidden', async () => {
    const user = userEvent.setup()
    render(<SpendingTrendsWidget ctx={ctxWith(rows)} size="lg" />)
    await user.click(await screen.findByRole('button', { name: /Groceries/ }))
    await user.click(screen.getByRole('button', { name: /Transport/ }))

    expect(screen.getByRole('status').textContent).toContain('Every category is hidden')
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('shows the month a pointer is on, category by category with a total', async () => {
    render(<SpendingTrendsWidget ctx={ctxWith(rows)} size="lg" />)
    const [first] = await screen.findAllByRole('listitem')
    expect(screen.queryByText('Total')).toBeNull()

    fireEvent.mouseEnter(first as HTMLElement)

    expect(screen.getByText('Total')).toBeDefined()
    expect(screen.getByText('$160.00')).toBeDefined()
    fireEvent.mouseLeave(first as HTMLElement)
    expect(screen.queryByText('Total')).toBeNull()
  })

  it('keeps the readout beside the bar, on the side with room', async () => {
    const { container } = render(<SpendingTrendsWidget ctx={ctxWith(rows)} size="lg" range={resolveRange('12m', '2026-09-19')} />)
    const items = await screen.findAllByRole('listitem')

    fireEvent.mouseEnter(items[0] as HTMLElement)
    expect(container.querySelector('.spt__tip--right')).not.toBeNull()
    fireEvent.mouseLeave(items[0] as HTMLElement)

    fireEvent.mouseEnter(items[items.length - 1] as HTMLElement)
    expect(container.querySelector('.spt__tip--left')).not.toBeNull()
  })

  it('reaches the same readout from the keyboard', async () => {
    render(<SpendingTrendsWidget ctx={ctxWith(rows)} size="lg" />)
    const [first] = await screen.findAllByRole('listitem')
    fireEvent.focus(first as HTMLElement)
    expect(screen.getByText('Total')).toBeDefined()
  })
})

describe('empty and failing states', () => {
  it('shows an empty state rather than an empty chart', async () => {
    render(<SpendingTrendsWidget ctx={ctxWith([])} size="lg" />)
    expect(await screen.findByText('No spending yet')).toBeDefined()
  })

  it('tells a too-narrow range apart from an empty ledger', async () => {
    render(<SpendingTrendsWidget ctx={ctxWith([])} size="lg" range={resolveRange('3m', '2026-09-19')} />)
    expect(await screen.findByText('No spending in this range')).toBeDefined()
  })

  it('does not draw income as spending', async () => {
    render(<SpendingTrendsWidget ctx={ctxWith([row('2026-07', 's', 'Salary', '5000.00', 'income')])} size="lg" />)
    expect(await screen.findByText('No spending yet')).toBeDefined()
  })

  it('surfaces a refused grant as an error, not a crash', async () => {
    render(<SpendingTrendsWidget ctx={ctxWith([], "Plugin did not request read access to 'accounts'")} size="lg" />)
    expect((await screen.findByRole('alert')).textContent).toContain('accounts')
  })
})

describe('negative amounts', () => {
  // A month whose refunds exceed its spending is real. Three places in this
  // codebase once treated it as empty; this is the widget-level check that
  // this one does not.
  const refunds = [row('2026-08', 'a', 'Groceries', '-50.00')]

  it('draws a month of pure refunds instead of the empty state', async () => {
    const { container } = render(<SpendingTrendsWidget ctx={ctxWith(refunds)} size="lg" />)
    expect(await screen.findByRole('img')).toBeDefined()
    expect(screen.queryByText('No spending yet')).toBeNull()
    expect(segments(container)).toHaveLength(1)
  })

  it('shows the refund in the tooltip as a negative figure', async () => {
    const { container } = render(<SpendingTrendsWidget ctx={ctxWith(refunds)} size="lg" />)
    const [first] = await screen.findAllByRole('listitem')
    fireEvent.mouseEnter(first as HTMLElement)
    // Scoped to the tooltip: the filter chip also shows this figure.
    expect(container.querySelector('.spt__tip strong.is-neg')?.textContent).toBe('$-50.00')
  })
})

describe('months with no spending', () => {
  it('keeps a slot for every month in the range, so a gap stays a gap', async () => {
    const sparse = [row('2026-07', 'a', 'Groceries', '100.00'), row('2026-09', 'a', 'Groceries', '200.00')]
    render(<SpendingTrendsWidget ctx={ctxWith(sparse)} size="lg" range={resolveRange('3m', '2026-09-19')} />)

    const months = await screen.findAllByRole('listitem')

    expect(months).toHaveLength(3)
    expect(months[1]?.getAttribute('aria-label')).toMatch(/no spending/i)
  })
})

describe('stylesheet delivery', () => {
  it('injects the palette into the document, once', () => {
    // Importing the widget pulls in ./styles.js. A federated remote's emitted
    // stylesheet is never requested by the host, so if this ever stops
    // happening the chart renders with every custom property unset — black
    // fills, no errors, nothing failing.
    const tags = document.querySelectorAll('style[id="wickermoney-plugin-styles:wickermoney.spending-trends"]')
    expect(tags).toHaveLength(1)
    expect(tags[0]?.textContent).toContain('--spt-1')
  })

  it('cannot restyle the insights charts that share the page', () => {
    // Both plugins' CSS lands in one document. A class in common would let
    // whichever loaded second win.
    const css = document.querySelector('style[id="wickermoney-plugin-styles:wickermoney.spending-trends"]')?.textContent
    expect(css).not.toMatch(/\.viz\b/)
  })
})
