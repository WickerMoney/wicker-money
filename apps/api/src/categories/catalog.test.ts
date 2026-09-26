import { describe, expect, it } from 'vitest'
import {
  CATEGORY_CATALOG, SITUATIONS, SITUATION_GROUPS, askableSituations, kindOf, selectForSituations,
} from './catalog.js'

describe('the catalog as data', () => {
  it('has a unique slug per entry', () => {
    const slugs = CATEGORY_CATALOG.map((e) => e.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('never names a parent that is not itself in the catalog', () => {
    const tops = new Set(CATEGORY_CATALOG.filter((e) => e.parent === null).map((e) => e.slug))
    const dangling = CATEGORY_CATALOG.filter((e) => e.parent !== null && !tops.has(e.parent))
    expect(dangling).toEqual([])
  })

  it('is two levels deep, not more', () => {
    const tops = new Set(CATEGORY_CATALOG.filter((e) => e.parent === null).map((e) => e.slug))
    // A child whose parent is itself a child would need a tree UI nobody has
    // asked for, and a budget line whose meaning depends on depth.
    const deep = CATEGORY_CATALOG.filter(
      (e) => e.parent !== null && !tops.has(e.parent),
    )
    expect(deep).toEqual([])
  })

  it('only uses situations that exist', () => {
    const known = new Set<string>(SITUATIONS)
    const unknown = CATEGORY_CATALOG.flatMap((e) => e.situations).filter((s) => !known.has(s))
    expect(unknown).toEqual([])
  })
})

describe('the catalog and the wizard cover each other', () => {
  it('leaves no entry that no answer can ever create', () => {
    // The first cut of this shipped 45 entries tagged with nothing at all. They
    // were in the file, they were in the API response, and no combination of
    // answers would produce one — a category you could read about and not have.
    const reachable = selectForSituations([...SITUATIONS]).map((e) => e.slug)
    const unreachable = CATEGORY_CATALOG.filter((e) => !reachable.includes(e.slug))
    expect(unreachable.map((e) => e.slug)).toEqual([])
  })

  it('asks about every situation the catalog uses', () => {
    const tagged = new Set(CATEGORY_CATALOG.flatMap((e) => e.situations))
    tagged.delete('always')
    const asked = new Set(askableSituations())
    expect([...tagged].filter((s) => !asked.has(s))).toEqual([])
  })

  it('asks no question that would add nothing', () => {
    const tagged = new Set(CATEGORY_CATALOG.flatMap((e) => e.situations))
    expect(askableSituations().filter((s) => !tagged.has(s))).toEqual([])
  })

  it('asks each question exactly once', () => {
    const asked = askableSituations()
    expect(new Set(asked).size).toBe(asked.length)
  })

  it('never asks about the base set', () => {
    // 'always' is not a circumstance anyone can decline; offering it as a
    // checkbox would let someone produce an install with no categories at all.
    expect(askableSituations()).not.toContain('always')
  })

  it('gives every question a label a person could answer about themselves', () => {
    for (const group of SITUATION_GROUPS) {
      expect(group.title.length).toBeGreaterThan(0)
      for (const q of group.questions) {
        expect(q.label.length).toBeGreaterThan(0)
        expect(q.label).not.toBe(q.situation)
      }
    }
  })
})

describe('selectForSituations', () => {
  it('returns a usable starter set for the universal case alone', () => {
    const picked = selectForSituations(['always'])
    const parents = picked.filter((e) => e.parent === null)

    // Big enough to categorize real spending, small enough to read in a
    // dropdown. Seeding the whole catalog into every install would be far too long.
    expect(picked.length).toBeGreaterThan(40)
    expect(picked.length).toBeLessThan(80)
    expect(parents.length).toBeGreaterThan(12)
  })

  it('leaves situational branches out until they are asked for', () => {
    const base = selectForSituations(['always']).map((e) => e.slug)
    expect(base).not.toContain('pets')
    expect(base).not.toContain('veterinarian')
    expect(base).not.toContain('gas')
  })

  it('adds a whole branch when its situation applies', () => {
    const withPets = selectForSituations(['always', 'pets']).map((e) => e.slug)
    expect(withPets).toContain('pets')
    expect(withPets).toContain('veterinarian')
    expect(withPets).toContain('pet-food')
  })

  it('pulls in a parent that only situational children reach', () => {
    // Nothing under Kids is universal, so the parent is never in the base set —
    // but selecting it must not produce children with no parent.
    const kids = selectForSituations(['kids-young'])
    expect(kids.some((e) => e.slug === 'kids' && e.parent === null)).toBe(true)
    expect(kids.some((e) => e.slug === 'daycare')).toBe(true)
  })

  it('separates the two ages of children rather than lumping them', () => {
    const young = selectForSituations(['kids-young']).map((e) => e.slug)
    const school = selectForSituations(['kids-school']).map((e) => e.slug)

    expect(young).toContain('daycare')
    expect(young).not.toContain('school-supplies')
    expect(school).toContain('school-supplies')
    expect(school).not.toContain('daycare')
    // Both ages wear clothes and both get a college fund.
    expect(young).toContain('kids-clothing')
    expect(school).toContain('kids-clothing')
  })

  it('separates owning a car from owing on one', () => {
    const owned = selectForSituations(['vehicle']).map((e) => e.slug)
    expect(owned).toContain('gas')
    // An empty "Car payment" line in every budget was the complaint that split
    // this off from the vehicle question.
    expect(owned).not.toContain('car-payment-lease')
    expect(selectForSituations(['car-loan']).map((e) => e.slug)).toContain('car-payment-lease')
  })

  it('separates owning a home from paying someone to maintain one', () => {
    const owner = selectForSituations(['homeowner']).map((e) => e.slug)
    expect(owner).toContain('property-taxes')
    expect(owner).not.toContain('lawn-care')
    expect(owner).not.toContain('hoa-fees')
    expect(selectForSituations(['home-services']).map((e) => e.slug)).toContain('lawn-care')
  })

  it('orders every parent before any child, so parent_id can resolve', () => {
    const picked = selectForSituations([...SITUATIONS])
    const seen = new Set<string>()
    for (const entry of picked) {
      if (entry.parent !== null) expect(seen.has(entry.parent)).toBe(true)
      seen.add(entry.slug)
    }
  })

  it('never returns a child whose parent it left out', () => {
    for (const s of SITUATIONS) {
      const picked = selectForSituations([s])
      const tops = new Set(picked.filter((e) => e.parent === null).map((e) => e.slug))
      const orphans = picked.filter((e) => e.parent !== null && !tops.has(e.parent))
      expect(orphans).toEqual([])
    }
  })

  it('returns nothing for no situations rather than everything', () => {
    expect(selectForSituations([])).toEqual([])
  })
})

describe('what each entry means for cash flow', () => {
  it('marks the whole Income branch as income', () => {
    const income = CATEGORY_CATALOG.filter(
      (e) => e.slug === 'income' || e.parent === 'income',
    )
    expect(income.length).toBeGreaterThan(5)
    expect(income.every((e) => kindOf(e) === 'income')).toBe(true)
  })

  it('marks the whole Transfers branch as transfer', () => {
    const transfers = CATEGORY_CATALOG.filter(
      (e) => e.slug === 'transfers' || e.parent === 'transfers',
    )
    expect(transfers.length).toBeGreaterThan(2)
    expect(transfers.every((e) => kindOf(e) === 'transfer')).toBe(true)
  })

  it('offers a credit card payment category, which is the classic false expense', () => {
    // Paying a card moves money you already owed; counted as spending it
    // double-counts every purchase on that card.
    expect(CATEGORY_CATALOG.some((e) => e.slug === 'credit-card-payment')).toBe(true)
  })

  it('leaves everything else an expense', () => {
    const odd = CATEGORY_CATALOG.filter(
      (e) =>
        kindOf(e) !== 'expense' &&
        e.slug !== 'income' && e.parent !== 'income' &&
        e.slug !== 'transfers' && e.parent !== 'transfers',
    )
    expect(odd.map((e) => e.slug)).toEqual([])
  })

  it('never gives a child a different kind from its parent', () => {
    // A "Transfers" parent whose children were expenses would exclude nothing,
    // and the user would have marked it and seen no change.
    const byslug = new Map(CATEGORY_CATALOG.map((e) => [e.slug, e]))
    for (const entry of CATEGORY_CATALOG) {
      if (entry.parent === null) continue
      const parent = byslug.get(entry.parent)
      if (parent === undefined) continue
      expect(`${entry.slug}:${kindOf(entry)}`).toBe(`${entry.slug}:${kindOf(parent)}`)
    }
  })
})
