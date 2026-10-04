import { describe, expect, it } from 'vitest'
import { describeContributions } from './describeContributions.js'

describe('describeContributions', () => {
  it('lists pages, then widgets, then the server half', () => {
    expect(describeContributions({ pages: ['Budgets'], widgets: ['Budget breakdown'], endpoints: true }))
      .toBe('Budgets page · Budget breakdown widget · server API')
  })

  it('says nothing for a plugin that adds nothing', () => {
    expect(describeContributions({ pages: [], widgets: [], endpoints: false })).toBeNull()
  })
})
