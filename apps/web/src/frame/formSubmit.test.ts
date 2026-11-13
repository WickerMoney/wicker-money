import { afterEach, describe, expect, it, vi } from 'vitest'
import { startFormSubmit } from './formSubmit.js'

function setup(html: string) {
  document.body.innerHTML = html
  const form = document.querySelector('form')!
  const onSubmit = vi.fn((e: Event) => { e.preventDefault() })
  form.addEventListener('submit', onSubmit)
  return { form, onSubmit, stop: startFormSubmit(document) }
}
const enter = (el: Element): KeyboardEvent => { const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); el.dispatchEvent(e); return e }

afterEach(() => { document.body.replaceChildren() })

describe('startFormSubmit', () => {
  it('dispatches submit when a submit button is clicked, with the button as submitter', () => {
    const { onSubmit, stop } = setup('<form><input name="a"><button type="submit">Go</button></form>')
    document.querySelector('button')!.click()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect((onSubmit.mock.calls[0]![0] as SubmitEvent).submitter).toBe(document.querySelector('button'))
    stop()
  })
  it('ignores buttons that are not submit buttons and disabled ones', () => {
    const { onSubmit, stop } = setup('<form><button type="button">A</button><button type="submit" disabled>B</button></form>')
    for (const b of document.querySelectorAll('button')) b.click()
    expect(onSubmit).not.toHaveBeenCalled()
    stop()
  })
  it('ignores an aria-disabled submit button: a busy control that keeps focus must not submit (click and Enter)', () => {
    const { onSubmit, stop } = setup('<form><input name="a"><button type="submit" aria-disabled="true">Go</button></form>')
    document.querySelector('button')!.click()
    const e = enter(document.querySelector('input')!)
    expect(e.defaultPrevented).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
    stop()
  })
  it('submits on Enter in a field, through the default button', () => {
    const { onSubmit, stop } = setup('<form><input name="a"><input name="b"><button type="submit">Go</button></form>')
    const e = enter(document.querySelector('input')!)
    expect(e.defaultPrevented).toBe(true)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    stop()
  })
  it('does not submit on Enter when the default button is disabled', () => {
    const { onSubmit, stop } = setup('<form><input name="a"><button type="submit" disabled>Go</button></form>')
    enter(document.querySelector('input')!)
    expect(onSubmit).not.toHaveBeenCalled()
    stop()
  })
  it('leaves Enter alone in a textarea, on a button and in a button-less form of several fields', () => {
    const { onSubmit, stop } = setup('<form><textarea></textarea><input name="a"><input name="b"></form>')
    expect(enter(document.querySelector('textarea')!).defaultPrevented).toBe(false)
    expect(enter(document.querySelector('input')!).defaultPrevented).toBe(false)
    expect(onSubmit).not.toHaveBeenCalled()
    stop()
  })
  it('checks constraints first unless the form says noValidate', () => {
    const a = setup('<form><input required><button type="submit">Go</button></form>')
    document.querySelector('button')!.click()
    expect(a.onSubmit).not.toHaveBeenCalled()
    a.stop()
    const b = setup('<form novalidate><input required><button type="submit">Go</button></form>')
    document.querySelector('button')!.click()
    expect(b.onSubmit).toHaveBeenCalledTimes(1)
    b.stop()
  })
  it('stops listening when stopped', () => {
    const { stop } = setup('<form novalidate><button type="submit">Go</button></form>')
    const seen: boolean[] = []
    document.addEventListener('click', (e) => { queueMicrotask(() => seen.push(e.defaultPrevented)) })
    stop()
    document.querySelector('button')!.click()
    // The browser's own submission is no longer cancelled by the shim.
    return Promise.resolve().then(() => expect(seen).toEqual([false]))
  })
})

// ADR 0010 asked of the shim: a page with no <form> (Import CSV, Budgets) must behave as it did before the shim.
describe('startFormSubmit leaves a page without a form alone', () => {
  const keydown = (el: Element, key: string): KeyboardEvent => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    el.dispatchEvent(e)
    return e
  }

  it('does not touch Enter in a plain input outside a form', () => {
    document.body.innerHTML = '<div><input id="a" type="text"><input id="d" type="date"></div>'
    const stop = startFormSubmit(document)
    expect(enter(document.getElementById('a')!).defaultPrevented).toBe(false)
    expect(enter(document.getElementById('d')!).defaultPrevented).toBe(false)
    stop()
  })

  it('does not stop a click on a type="button" button, inside a form or outside one', () => {
    document.body.innerHTML = '<button id="o" type="button">Out</button><form><button id="i" type="button">In</button></form>'
    const form = document.querySelector('form')!
    const onSubmit = vi.fn()
    form.addEventListener('submit', onSubmit)
    const stop = startFormSubmit(document)
    const seen: boolean[] = []
    for (const id of ['o', 'i']) {
      const button = document.getElementById(id)!
      button.addEventListener('click', (e) => { queueMicrotask(() => seen.push(e.defaultPrevented)) })
      button.click()
    }
    expect(onSubmit).not.toHaveBeenCalled()
    return Promise.resolve().then(() => { expect(seen).toEqual([false, false]); stop() })
  })

  it('leaves a file input and a select alone, in or out of a form', () => {
    document.body.innerHTML = '<input id="f" type="file"><select id="s"><option>a</option></select><form><input id="ff" type="file"><select id="fs"><option>a</option></select><button type="submit">Go</button></form>'
    const onSubmit = vi.fn()
    document.querySelector('form')!.addEventListener('submit', onSubmit)
    const stop = startFormSubmit(document)
    const prevented: boolean[] = []
    for (const id of ['f', 's', 'ff', 'fs']) {
      const el = document.getElementById(id)!
      el.addEventListener('click', (e) => { queueMicrotask(() => prevented.push(e.defaultPrevented)) })
      el.click()
      prevented.push(enter(el).defaultPrevented, keydown(el, ' ').defaultPrevented)
    }
    expect(onSubmit).not.toHaveBeenCalled()
    return Promise.resolve().then(() => { expect(prevented.filter(Boolean)).toEqual([]); stop() })
  })
})
