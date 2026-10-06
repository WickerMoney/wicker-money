import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useExpandedGroups } from '../../../disclosure/index.js'
import { makeCategory } from '../../../testing/makeCategory.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { CategoriesPanel } from './CategoriesPanel.js'

const food = makeCategory({ id: 'food', name: 'Food', slug: 'food' })
const home = makeCategory({ id: 'home', name: 'Housing', slug: 'housing' })
const solo = makeCategory({ id: 'solo', name: 'Pets', slug: 'pets' })
const groceries = makeCategory({ id: 'groc', name: 'Groceries', slug: 'groceries', parent_id: 'food' })
const dining = makeCategory({ id: 'dine', name: 'Dining', slug: 'dining', parent_id: 'food' })
const rent = makeCategory({ id: 'rent', name: 'Rent', slug: 'rent', parent_id: 'home' })
const all = [food, groceries, dining, home, rent, solo]

function mount(categories = all) {
  render(
    <CategoriesPanel
      categories={categories}
      parents={categories.filter((c) => c.parent_id === null)}
      status={makeStatus()}
      onChanged={vi.fn(async () => {})}
    />,
  )
  return userEvent.setup()
}

describe('CategoriesPanel accordions', () => {
  it('lists parents only until one is opened', () => {
    mount()
    expect(screen.getByText('Food')).toBeTruthy()
    expect(screen.getByText('Housing')).toBeTruthy()
    expect(screen.getByText('Pets')).toBeTruthy()
    expect(screen.queryByText('Groceries')).toBeNull()
    expect(screen.queryByText('Rent')).toBeNull()
  })

  it('opens and closes one parent without touching the others, and says what the arrow will do', async () => {
    const user = mount()
    await user.click(screen.getByRole('button', { name: 'Show 2 subcategories of Food' }))

    expect(screen.getByText('Groceries')).toBeTruthy()
    expect(screen.getByText('Dining')).toBeTruthy()
    expect(screen.queryByText('Rent')).toBeNull()

    const hide = screen.getByRole('button', { name: 'Hide 2 subcategories of Food' })
    expect(hide.getAttribute('aria-expanded')).toBe('true')
    await user.click(hide)
    expect(screen.queryByText('Groceries')).toBeNull()
  })

  it('gives a parent with no children no arrow', () => {
    mount()
    expect(screen.queryByRole('button', { name: /of Pets/ })).toBeNull()
  })

  it('expands and collapses everything at once', async () => {
    const user = mount()
    await user.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getByText('Groceries')).toBeTruthy()
    expect(screen.getByText('Rent')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByText('Groceries')).toBeNull()
    expect(screen.queryByText('Rent')).toBeNull()
  })

  it('offers no expand controls when nothing has children', () => {
    mount([food, solo])
    expect(screen.queryByRole('button', { name: 'Expand all' })).toBeNull()
  })

  it('keeps a child whose parent is not listed visible, since it has no arrow to open it', () => {
    const disabledParent = makeCategory({ id: 'old', name: 'Old', slug: 'old', is_enabled: false })
    const orphan = makeCategory({ id: 'kid', name: 'Orphaned', slug: 'orphaned', parent_id: 'old' })
    mount([food, disabledParent, orphan])
    expect(screen.getByText('Orphaned')).toBeTruthy()
  })

  it('puts Edit, Disable and Delete on each row as named icon buttons', () => {
    mount([solo])
    const row = screen.getByText('Pets').closest('tr') as HTMLElement
    for (const name of ['Edit', 'Disable', 'Delete']) {
      expect(within(row).getByRole('button', { name }).getAttribute('title')).toBe(name)
    }
  })
})

describe('CategoriesPanel with the page owning the open groups', () => {
  it('shows a parent as open when the page opens it', async () => {
    let open: (id: string) => void = () => {}
    function Page() {
      const groups = useExpandedGroups()
      open = groups.expand
      return (
        <CategoriesPanel
          categories={all}
          parents={all.filter((c) => c.parent_id === null)}
          status={makeStatus()}
          onChanged={vi.fn(async () => {})}
          groups={groups}
        />
      )
    }
    render(<Page />)
    expect(screen.queryByText('Rent')).toBeNull()

    await act(async () => { open('home') })

    expect(screen.getByText('Rent')).toBeTruthy()
    expect(screen.queryByText('Groceries')).toBeNull()
  })
})
