import { describe, expect, it } from 'vitest'
import { tileFlow } from './tileFlow.js'

// 100px tiles with a 10px gap: n rows are 110n - 10 tall.
const base = { tileHeight: 100, gap: 10, minTileWidth: 230 }

describe('tileFlow', () => {
  it('stays one column while the tiles fit the height', () => {
    expect(tileFlow({ ...base, count: 4, height: 600, width: 800 }))
      .toMatchObject({ columns: 1, rows: 4 })
  })

  it('starts a second column when the first runs out of height, and fills the first one first', () => {
    // Room for 4 (4*110-10 = 430 <= 450 < 540): 6 tiles are 4 + 2.
    expect(tileFlow({ ...base, count: 6, height: 450, width: 800 }))
      .toMatchObject({ columns: 2, rows: 4 })
  })

  it('keeps adding columns, up to as many as fit across', () => {
    // Room for 3 rows (the floor), 8 tiles: 3 + 3 + 2. Three columns fit across (3*230 + 2*10 = 710 <= 800).
    expect(tileFlow({ ...base, count: 8, height: 320, width: 800 }))
      .toMatchObject({ columns: 3, rows: 3 })
  })

  it('grows taller instead of adding a column that does not fit', () => {
    // One column fits across, so all six stack, however short the area measured.
    const flow = tileFlow({ ...base, count: 6, height: 200, width: 300 })
    expect(flow).toMatchObject({ columns: 1, rows: 6 })
    expect(flow.minHeight).toBe(6 * 110 - 10)
  })

  it('raises a shorter area to the three-row floor before deciding', () => {
    // 220px would hold two rows, but the floor is three, so six tiles are 3 + 3, not 2 + 2 + 2.
    expect(tileFlow({ ...base, count: 6, height: 220, width: 800 })).toMatchObject({ columns: 2, rows: 3 })
  })

  it('is never shorter than three rows, or the count if fewer', () => {
    expect(tileFlow({ ...base, count: 6, height: 0, width: 800 }).minHeight).toBe(3 * 110 - 10)
    expect(tileFlow({ ...base, count: 2, height: 0, width: 800 }).minHeight).toBe(2 * 110 - 10)
  })

  it('does not depend on the measured height for its minimum, so it cannot feed back into itself', () => {
    const heights = [0, 100, 330, 700, 2000]
    const mins = heights.map((height) => tileFlow({ ...base, count: 5, height, width: 500 }).minHeight)
    expect(new Set(mins).size).toBe(1)
  })

  it('does not leave empty rows when there are fewer tiles than fit', () => {
    expect(tileFlow({ ...base, count: 2, height: 900, width: 800 })).toMatchObject({ columns: 1, rows: 2 })
  })

  it('copes with nothing to lay out and with an unmeasured tile', () => {
    expect(tileFlow({ ...base, count: 0, height: 500, width: 800 })).toEqual({ columns: 1, rows: 1, minHeight: 0 })
    expect(tileFlow({ ...base, tileHeight: 0, count: 3, height: 500, width: 800 }))
      .toEqual({ columns: 1, rows: 3, minHeight: 0 })
  })
})
