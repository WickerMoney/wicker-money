import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AmountCell } from './AmountCell.js'

/** Colour is never the only cue: outgoing amounts carry a minus sign in the text. */
describe('AmountCell', () => {
  it('shows a minus sign on a bill, which is also coloured', () => {
    const { container } = render(<AmountCell value="-2100.0000" kind="bill" currency="USD" />)
    expect(container.textContent).toMatch(/^[-−]/)
    expect(container.querySelector('.wm-neg')).not.toBeNull()
  })
  it('signs a debt payment as outgoing even though it is stored positive', () => {
    const { container } = render(<AmountCell value="150.0000" kind="debt_payment" currency="USD" />)
    expect(container.textContent).toMatch(/^[-−]/)
  })
  it('leaves income unsigned and uncoloured red', () => {
    const { container } = render(<AmountCell value="3000.0000" kind="income" currency="USD" />)
    expect(container.textContent).not.toMatch(/^[-−]/)
    expect(container.querySelector('.wm-pos')).not.toBeNull()
  })
})
