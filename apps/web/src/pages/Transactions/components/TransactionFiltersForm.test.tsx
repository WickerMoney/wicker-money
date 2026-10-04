import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { errorOf } from '../../../testing/errorOf.js'
import type { TransactionFilters } from '../state/TransactionFilters.js'
import { TransactionFiltersForm } from './TransactionFiltersForm.js'

const filters: TransactionFilters = {
  search: '', from: '', to: '', accountId: '', categoryId: '',
  sort: 'date', direction: 'desc', onlyUncategorized: false,
}

function mount(over: Partial<TransactionFilters> = {}) {
  const onChange = vi.fn()
  render(
    <TransactionFiltersForm
      filters={{ ...filters, ...over }} accounts={[]} enabledCategories={[]} busy={false}
      onChange={onChange} onClear={() => {}}
    />,
  )
  return { onChange, user: userEvent.setup() }
}

describe('TransactionFiltersForm', () => {
  it('refuses a search longer than the API accepts, under the field, without applying it', async () => {
    const { onChange, user } = mount()

    await user.click(screen.getByLabelText('Search merchant'))
    await user.paste('x'.repeat(201))
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(errorOf('Search merchant')).toBe('Must be 200 characters or fewer.')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('says so under To when it is before From', () => {
    mount({ from: '2026-03-10', to: '2026-03-01' })

    expect(errorOf('To')).toBe('Must be on or after From.')
  })
})
