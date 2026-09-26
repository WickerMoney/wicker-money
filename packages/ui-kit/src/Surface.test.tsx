import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Surface } from './Surface.js'

describe('Surface', () => {
  it('renders its children', () => {
    render(<Surface>content</Surface>)
    expect(screen.getByText('content')).toBeDefined()
  })

  it('renders a heading when given a title', () => {
    render(<Surface title="Net worth">body</Surface>)
    expect(screen.getByRole('heading', { name: 'Net worth' })).toBeDefined()
  })

  it('omits the heading when no title is given', () => {
    render(<Surface>body</Surface>)
    expect(screen.queryByRole('heading')).toBeNull()
  })
})
