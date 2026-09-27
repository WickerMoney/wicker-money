import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button, EmptyState, Field, Stat, Surface, Table } from './index.js'

describe('Surface', () => {
  it('renders children', () => {
    render(<Surface>content</Surface>)
    expect(screen.getByText('content')).toBeDefined()
  })
  it('omits the header when there is nothing to put in it', () => {
    render(<Surface>body</Surface>)
    expect(screen.queryByRole('heading')).toBeNull()
  })
  it('renders title and action together', () => {
    render(<Surface title="Net worth" action={<span>all time</span>}>b</Surface>)
    expect(screen.getByRole('heading', { name: 'Net worth' })).toBeDefined()
    expect(screen.getByText('all time')).toBeDefined()
  })
})

describe('Button', () => {
  it('defaults to type=button so it cannot submit a form by accident', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('type')).toBe('button')
  })
  it('allows an explicit submit', () => {
    render(<Button type="submit">Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' }).getAttribute('type')).toBe('submit')
  })
})

describe('Field', () => {
  it('associates its label with the control', () => {
    render(<Field label="Email" defaultValue="" />)
    expect(screen.getByLabelText('Email')).toBeDefined()
  })
  it('marks itself invalid and describes the error', () => {
    render(<Field label="Amount" error="Too many decimals" />)
    const input = screen.getByLabelText('Amount')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Too many decimals')).toBeDefined()
  })
})

describe('Stat', () => {
  it('derives a negative tone from the value', () => {
    const { container } = render(<Stat label="Balance" value="-42.00" tone="auto" />)
    expect(container.querySelector('.wm-neg')).not.toBeNull()
  })
  it('derives a positive tone from the value', () => {
    const { container } = render(<Stat label="Balance" value="42.00" tone="auto" />)
    expect(container.querySelector('.wm-pos')).not.toBeNull()
  })
})

describe('Table', () => {
  const columns = [
    { key: 'name', header: 'Name', render: (r: { name: string }) => r.name },
    { key: 'amt', header: 'Amount', numeric: true, render: () => '1.00' },
  ]
  it('renders rows', () => {
    render(<Table columns={columns} rows={[{ name: 'Coffee' }]} rowKey={(r) => r.name} />)
    expect(screen.getByText('Coffee')).toBeDefined()
  })
  it('shows the empty state instead of an empty body', () => {
    render(
      <Table columns={columns} rows={[]} rowKey={(r) => r.name}
        empty={<EmptyState title="Nothing yet" />} />,
    )
    expect(screen.getByText('Nothing yet')).toBeDefined()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
