import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TransactionPager, type TransactionPagerProps } from './TransactionPager.js'

function mount(over: Partial<TransactionPagerProps> = {}) {
  const props: TransactionPagerProps = {
    total: 120, limit: 50, pageNumber: 1, hasPrevious: false, hasNext: true, busy: false,
    onPageSizeChange: vi.fn(), onPrevious: vi.fn(), onNext: vi.fn(), ...over,
  }
  render(<TransactionPager {...props} />)
  return { props, user: userEvent.setup() }
}

describe('TransactionPager', () => {
  it('shows the total, the page number and the page count', () => {
    mount({ total: 1234, limit: 50, pageNumber: 3 })

    expect(screen.getByText('1,234 transactions')).toBeTruthy()
    expect(screen.getByText('Page 3 of 25')).toBeTruthy()
  })

  it('does not add a page for an exact multiple of the page size', () => {
    mount({ total: 100, limit: 50, pageNumber: 2 })

    expect(screen.getByText('Page 2 of 2')).toBeTruthy()
  })

  it('shows only the page number until the total is known', () => {
    mount({ total: null, pageNumber: 2 })

    expect(screen.getByText('Page 2')).toBeTruthy()
    expect(screen.queryByText(/ of /)).toBeNull()
  })

  it('counts no transactions as one page', () => {
    mount({ total: 0 })

    expect(screen.getByText('Page 1 of 1')).toBeTruthy()
  })

  it('never shows fewer pages than the one on screen after the total shrinks', () => {
    // 150 left at 50 per page is 3 pages, but page 4 is still showing.
    mount({ total: 150, limit: 50, pageNumber: 4, hasPrevious: true, hasNext: false })

    expect(screen.getByText('Page 4 of 4')).toBeTruthy()
  })

  it('says so when there are none', () => {
    mount({ total: 0 })

    expect(screen.getByText('No transactions')).toBeTruthy()
  })

  it('says "1 transaction" for a single one', () => {
    mount({ total: 1 })

    expect(screen.getByText('1 transaction')).toBeTruthy()
  })

  it('shows no count until it is known', () => {
    mount({ total: null })

    expect(screen.queryByText(/transaction/i)).toBeNull()
  })

  it('disables Previous on the first page and Next on the last', () => {
    mount({ hasPrevious: false, hasNext: false })

    expect((screen.getByRole('button', { name: /Previous/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('calls back for Previous and Next', async () => {
    const { props, user } = mount({ hasPrevious: true, hasNext: true, pageNumber: 2 })

    await user.click(screen.getByRole('button', { name: /Previous/ }))
    await user.click(screen.getByRole('button', { name: /Next/ }))

    expect(props.onPrevious).toHaveBeenCalledTimes(1)
    expect(props.onNext).toHaveBeenCalledTimes(1)
  })

  it('disables both buttons while busy', () => {
    mount({ busy: true, hasPrevious: true, hasNext: true })

    expect((screen.getByRole('button', { name: /Previous/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('reports a new page size', async () => {
    const { props, user } = mount()

    await user.selectOptions(screen.getByLabelText('Per page'), '100')

    expect(props.onPageSizeChange).toHaveBeenCalledWith(100)
  })
})
