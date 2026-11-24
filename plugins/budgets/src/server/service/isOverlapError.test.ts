import { describe, expect, it } from 'vitest'
import { isOverlapError } from './isOverlapError.js'

const pg = (code: string, constraint?: string) => Object.assign(new Error('boom'), { code, ...(constraint ? { constraint } : {}) })

describe('isOverlapError', () => {
  it('accepts the exclusion violation', () => {
    expect(isOverlapError(pg('23P01', 'ex_budget_lines_no_overlap'))).toBe(true)
    expect(isOverlapError(pg('23P01'))).toBe(true)
  })

  it('accepts a second line starting the same day, which the unique index refuses first', () => {
    expect(isOverlapError(pg('23505', 'ux_budget_lines_user_category_period'))).toBe(true)
    expect(isOverlapError(Object.assign(new Error('x'), { code: '23505', constraint_name: 'ux_budget_lines_user_category_period' }))).toBe(true)
  })

  it('refuses every other error', () => {
    expect(isOverlapError(pg('23505', 'ux_account_lines_user_account_period'))).toBe(false)
    expect(isOverlapError(pg('23505'))).toBe(false)
    expect(isOverlapError(pg('23514', 'ck_budget_lines_planned'))).toBe(false)
    expect(isOverlapError(pg('40P01'))).toBe(false)
    expect(isOverlapError(new Error('plain'))).toBe(false)
    expect(isOverlapError(null)).toBe(false)
    expect(isOverlapError('23P01')).toBe(false)
  })
})
