import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CategoryOptions } from './CategoryOptions.js'
import type { GroupableCategory } from './GroupableCategory.js'
import { orderByParent } from './orderByParent.js'

const CATS: GroupableCategory[] = [
  { id: 'food', name: 'Food', parent_id: null },
  { id: 'groceries', name: 'Groceries', parent_id: 'food' },
  { id: 'takeout', name: 'Takeout', parent_id: 'food' },
  { id: 'gifts', name: 'Gifts', parent_id: null },
  { id: 'solo', name: 'Solo', parent_id: null },
]

function renderOptions(props: Partial<Parameters<typeof CategoryOptions>[0]> = {}) {
  return render(
    <select aria-label="Category" defaultValue="">
      <CategoryOptions categories={CATS} {...props} />
    </select>,
  )
}

/** The rendered structure, as a reader of the dropdown would experience it. */
function structure(): string[] {
  const select = screen.getByLabelText('Category')
  return Array.from(select.children).map((node) =>
    node.tagName === 'OPTGROUP'
      ? `group:${node.getAttribute('label')}(${Array.from(node.children).map((o) => o.textContent).join(',')})`
      : `option:${node.textContent}`,
  )
}

describe('grouping a category picker', () => {
  it('nests children under their parent instead of interleaving them', () => {
    renderOptions()
    // The flat list was sorted by name across both levels, so Groceries landed
    // between Gifts and Housing rather than under Food.
    expect(structure()).toEqual([
      'group:Food(Food,Groceries,Takeout)',
      'option:Gifts',
      'option:Solo',
    ])
  })

  it('keeps the parent selectable inside its own group', () => {
    renderOptions()
    // "Food" is a legitimate answer when none of its children fit. A heading
    // that cannot be chosen would make the parent unreachable.
    const group = screen.getByLabelText('Category').querySelector('optgroup')
    expect(group?.firstElementChild?.textContent).toBe('Food')
    expect((group?.firstElementChild as HTMLOptionElement).value).toBe('food')
  })

  it('renders a childless top-level category as a plain option', () => {
    renderOptions()
    // An empty optgroup is a heading with nothing under it.
    expect(structure()).toContain('option:Gifts')
  })

  it('puts the placeholder first when there is one', () => {
    renderOptions({ placeholder: { value: '', label: 'Uncategorized' } })
    expect(structure()[0]).toBe('option:Uncategorized')
  })

  it('still offers a child whose parent was excluded', () => {
    renderOptions({ exclude: new Set(['food']) })
    // Groceries is a perfectly valid category. Dropping it because its parent
    // is filtered out would make it unreachable with no way to tell.
    expect(structure()).toContain('group:Other(Groceries,Takeout)')
  })

  it('excludes exactly the ids given, and no others', () => {
    renderOptions({ exclude: new Set(['groceries']) })
    expect(structure()).toEqual([
      'group:Food(Food,Takeout)',
      'option:Gifts',
      'option:Solo',
    ])
  })

  it('renders nothing rather than failing on an empty list', () => {
    render(
      <select aria-label="Category">
        <CategoryOptions categories={[]} />
      </select>,
    )
    expect(screen.getByLabelText('Category').children.length).toBe(0)
  })
})

describe('orderByParent', () => {
  it('puts each parent immediately before its own children', () => {
    expect(orderByParent(CATS).map((c) => c.id)).toEqual([
      'food', 'groceries', 'takeout', 'gifts', 'solo',
    ])
  })

  it('keeps an orphan rather than dropping it', () => {
    const orphaned = [...CATS, { id: 'lost', name: 'Lost', parent_id: 'missing' }]
    expect(orderByParent(orphaned).map((c) => c.id)).toContain('lost')
  })

  it('handles an empty list', () => {
    expect(orderByParent([])).toEqual([])
  })
})

describe('when a parent means everything under it', () => {
  it('says so in the parent option', () => {
    renderOptions({ includesChildren: true })
    // The filter behaves that way regardless; the label exists so the picker
    // does not quietly mean something different from what it says.
    expect(structure()).toContain('group:Food(All of Food,Groceries,Takeout)')
  })

  it('leaves a childless top-level category alone', () => {
    renderOptions({ includesChildren: true })
    // "All of Gifts" would promise a breadth that does not exist.
    expect(structure()).toContain('option:Gifts')
  })

  it('is off by default, so an assignment picker still reads as one', () => {
    renderOptions()
    expect(structure()).toContain('group:Food(Food,Groceries,Takeout)')
  })
})
