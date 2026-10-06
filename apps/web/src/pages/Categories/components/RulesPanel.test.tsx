import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import type { Rule, RuleCondition } from '../../../models/index.js'
import { makeCategory } from '../../../testing/makeCategory.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { RulesPanel } from './RulesPanel.js'

const condition = (id: string, text: string): RuleCondition => ({
  id, condition_type: 'merchant_contains', text_value: text, is_case_sensitive: false,
  direction: null, amount_value: null, amount_min: null, amount_max: null,
})
const rule = (id: string, category_id: string, text: string): Rule =>
  ({ id, category_id, priority: 0, conditions: [condition(`c-${id}`, text)] })

const categories = [
  makeCategory({ id: 'food', name: 'Food' }),
  makeCategory({ id: 'car', name: 'Car', slug: 'car' }),
]
const rules = [rule('r1', 'food', 'KROGER'), rule('r2', 'car', 'SHELL'), rule('r3', 'food', 'ALDI')]

function mount(onChanged = vi.fn(async () => {})) {
  const status = makeStatus()
  render(<RulesPanel rules={rules} categories={categories} status={status} onChanged={onChanged} />)
  return { user: userEvent.setup(), onChanged, status }
}

afterEach(() => { vi.restoreAllMocks() })

describe('RulesPanel', () => {
  it('shows one closed group per category with its rule count, and no rules yet', () => {
    mount()
    expect(screen.getByRole('button', { name: /Food\s*2 rules/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: /Car\s*1 rule$/ })).toBeTruthy()
    expect(screen.queryByText(/KROGER/)).toBeNull()
    expect(screen.getByText('3 rules in 2 categories')).toBeTruthy()
  })

  it('opens a group to show its rules, and closes it again', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: /Food/ }))
    expect(screen.getByText(/KROGER/)).toBeTruthy()
    expect(screen.getByText(/ALDI/)).toBeTruthy()
    expect(screen.queryByText(/SHELL/)).toBeNull()

    await user.click(screen.getByRole('button', { name: /Food/ }))
    expect(screen.queryByText(/KROGER/)).toBeNull()
  })

  it('expands and collapses every group', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getByText(/SHELL/)).toBeTruthy()
    expect(screen.getByText(/KROGER/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByText(/SHELL/)).toBeNull()
  })

  it('deletes a rule from an open group and tells the page to reload', async () => {
    const del = vi.spyOn(api, 'del').mockResolvedValue(undefined)
    const { user, onChanged } = mount()
    await user.click(screen.getByRole('button', { name: /Car/ }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => { expect(onChanged).toHaveBeenCalled() })
    expect(del).toHaveBeenCalledWith('/category-rules/r2')
  })

  it('shows the empty state, with no groups, when there are no rules', () => {
    render(<RulesPanel rules={[]} categories={categories} status={makeStatus()} onChanged={vi.fn(async () => {})} />)
    expect(screen.getByText('No rules yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Expand all' })).toBeNull()
  })
})
