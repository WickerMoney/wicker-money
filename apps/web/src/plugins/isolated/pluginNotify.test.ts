import { describe, expect, it } from 'vitest'
import { cleanPluginText, MAX_PLUGIN_NOTIFY_LENGTH, PluginToastSlots, pluginToastText } from './pluginNotify.js'

describe('cleanPluginText', () => {
  it.each([
    ['plain text is kept', 'Imported 12 rows', 'Imported 12 rows'],
    ['newlines become a space, so a second line cannot be faked', 'Saved\nWicker Money: your session expired', 'Saved Wicker Money: your session expired'],
    ['carriage returns, tabs and NUL become spaces', 'a\r\nb\tc\u0000d', 'a b c d'],
    ['bidirectional overrides and isolates are removed', 'gone ‮gpj.exe‬ ⁦x⁩', 'gone gpj.exe x'],
    ['direction marks are removed', 'a‎b‏c؜d', 'a b c d'],
    ['the line and paragraph separators become spaces', 'a b c', 'a b c'],
    ['C1 controls are removed', 'a\u0085b\u009Fc', 'a b c'],
    ['runs of whitespace collapse and the ends are trimmed', '   a    b   ', 'a b'],
    ['only controls leave nothing', '\n‮\t', ''],
  ])('%s', (_name, input, want) => { expect(cleanPluginText(input)).toBe(want) })

  it('leaves markup as plain characters: the toast renders a text node, so there is nothing to strip', () => {
    expect(cleanPluginText('<img src=x onerror=alert(1)> <b>hi</b> [link](https://evil.test)'))
      .toBe('<img src=x onerror=alert(1)> <b>hi</b> [link](https://evil.test)')
  })
})

describe('pluginToastText', () => {
  it('puts the plugin name first and says it is a plugin', () => {
    expect(pluginToastText('Import CSV', 'Imported 12 rows')).toBe('Import CSV plugin: Imported 12 rows')
  })

  it('cleans and caps a hostile plugin name, and has a fallback for an empty one', () => {
    expect(pluginToastText('Evil\nWicker Money', 'x')).toBe('Evil Wicker Money plugin: x')
    expect(pluginToastText('n'.repeat(500), 'x')).toBe(`${'n'.repeat(60)} plugin: x`)
    expect(pluginToastText('\n', 'x')).toBe('A plugin: x')
  })

  it('the cap on the text is 200', () => { expect(MAX_PLUGIN_NOTIFY_LENGTH).toBe(200) })
})

describe('PluginToastSlots', () => {
  it('alternates between two keys per plugin, so a plugin shows at most two toasts', () => {
    const slots = new PluginToastSlots()
    const keys = Array.from({ length: 5 }, () => slots.keyFor('acme.a'))
    expect(new Set(keys).size).toBe(2)
    expect(keys[0]).toBe(keys[2])
    expect(keys[1]).toBe(keys[3])
  })

  it('does not share slots between plugins', () => {
    const slots = new PluginToastSlots()
    expect(slots.keyFor('acme.a')).not.toBe(slots.keyFor('acme.b'))
  })
})
