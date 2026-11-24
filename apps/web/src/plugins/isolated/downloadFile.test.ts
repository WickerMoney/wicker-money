import { DOWNLOAD_TYPES, MAX_DOWNLOAD_BYTES } from '@wickermoney/plugin-sdk/isolated'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkDownload, REVOKE_AFTER_MS, safeFilename, saveFile, type CheckedFile } from './downloadFile.js'

const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer
const bytes = (...v: number[]): ArrayBuffer => new Uint8Array(v).buffer
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const check = (mime: string, data: ArrayBuffer, filename = 'file') => checkDownload({ filename, mime, data })
const refusal = (mime: string, data: ArrayBuffer): string | undefined => {
  const r = check(mime, data)
  return r.ok ? undefined : r.code
}

describe('safeFilename', () => {
  it.each([
    ['report', 'csv', 'report.csv'],
    ['report.csv', 'csv', 'report.csv'],
    ['report.exe', 'csv', 'report.csv'],
    ['report.pdf.exe', 'pdf', 'report_pdf.pdf'],
    ['a/b/c/share.png', 'png', 'share.png'],
    ['..\\..\\windows\\system32\\evil.dll', 'txt', 'evil.txt'],
    ['../../etc/passwd', 'txt', 'passwd.txt'],
    ['', 'txt', 'download.txt'],
    ['...', 'txt', 'download.txt'],
    ['.hidden', 'txt', 'hidden.txt'],
    ['CON', 'txt', '_CON.txt'],
    ['nul.txt', 'txt', '_nul.txt'],
    ['LPT1', 'txt', '_LPT1.txt'],
    ['my  spaced   name', 'txt', 'my spaced name.txt'],
    ['Q3 (final)', 'pdf', 'Q3 (final).pdf'],
    ['a;b|c<d>e:f*g?h"i', 'txt', 'a_b_c_d_e_f_g_h_i.txt'],
    ['  lead and trail  ', 'txt', 'lead and trail.txt'],
    ['uber\u202etxt.exe', 'txt', 'uber_txt.txt'],
    ['null\u0000byte', 'txt', 'null_byte.txt'],
    ['line\nbreak', 'txt', 'line_break.txt'],
    ['\uff0e\uff0e\uff0fevil', 'txt', 'evil.txt'],
    ['\ufb01le', 'txt', 'file.txt'],
    ['caf\u00e9 report', 'txt', 'caf\u00e9 report.txt'],
  ])('%j with .%s becomes %j', (suggested, ext, expected) => {
    expect(safeFilename(suggested, ext)).toBe(expected)
  })

  it('caps the stem at 80 characters and always uses the given extension', () => {
    const name = safeFilename('a'.repeat(300), 'png')
    expect(name).toBe(`${'a'.repeat(80)}.png`)
    expect(safeFilename('x.html', 'png').endsWith('.png')).toBe(true)
  })

  it('never contains a separator, a dot other than the extension dot, or a control character', () => {
    for (const s of ['a/b', 'a\\b', 'a.b.c', 'a\u0007b', 'a\u202eb', '\u2215a', '\uff3ca', '\u2024\u2024']) {
      const name = safeFilename(s, 'txt')
      expect(name).toMatch(/^[\p{L}\p{N} _()-]+\.txt$/u)
    }
  })
})

describe('checkDownload', () => {
  it('offers exactly the six types, with one extension each, and no HTML or SVG', () => {
    expect(DOWNLOAD_TYPES).toEqual({
      'text/plain': 'txt', 'text/csv': 'csv', 'application/json': 'json', 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf',
    })
    expect(Object.keys(DOWNLOAD_TYPES).some((m) => /html|svg|javascript|xml/.test(m))).toBe(false)
  })

  it.each([
    ['text/plain', enc('hello'), 'txt'],
    ['text/csv', enc('a,b\n1,2\n'), 'csv'],
    ['application/json', enc('{"a":[1,2]}'), 'json'],
    ['application/json', enc('[]'), 'json'],
    ['image/png', bytes(...PNG, 0), 'png'],
    ['image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0), 'jpg'],
    ['application/pdf', enc('%PDF-1.7\n'), 'pdf'],
    ['text/plain', enc('\ufeffwith a BOM'), 'txt'],
    ['text/csv', enc('<note> and 5 < 6, a CSV that starts with text'), 'csv'],
    ['text/plain', enc('less than: <3'), 'txt'],
  ])('accepts a good %s', (mime, data, ext) => {
    const r = check(mime, data, 'name.exe')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.file.filename).toBe(`name.${ext}`)
  })

  it('returns the bytes as a copy of what was sent', () => {
    const data = enc('abc')
    const r = check('text/plain', data)
    expect(r.ok && Array.from(r.file.bytes)).toEqual([97, 98, 99])
  })

  it.each([
    ['text/html'], ['image/svg+xml'], ['application/xhtml+xml'], ['text/xml'], ['application/xml'], ['text/javascript'],
    ['application/javascript'], ['application/octet-stream'], ['application/x-msdownload'], ['application/zip'],
    ['TEXT/PLAIN'], ['text/plain; charset=utf-8'], [' text/plain'], [''], ['image/png\u0000'],
    ['toString'], ['constructor'], ['__proto__'], ['hasOwnProperty'],
  ])('refuses the type %j', (mime) => {
    expect(refusal(mime, enc('x'))).toBe('file_type_not_allowed')
  })

  it.each([
    ['png: too short', 'image/png', bytes(0x89, 0x50)],
    ['png: wrong magic', 'image/png', bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)],
    ['png: JPEG bytes', 'image/png', bytes(0xff, 0xd8, 0xff, 0xe0)],
    ['jpeg: PNG bytes', 'image/jpeg', bytes(...PNG)],
    ['jpeg: too short', 'image/jpeg', bytes(0xff, 0xd8)],
    ['pdf: no dash', 'application/pdf', enc('%PDF')],
    ['pdf: leading whitespace', 'application/pdf', enc(' %PDF-1.7')],
    ['pdf: an HTML page', 'application/pdf', enc('<html></html>')],
    ['png: an HTML page', 'image/png', enc('<html><script>alert(1)</script></html>')],
    ['text: NUL byte', 'text/plain', bytes(0x61, 0, 0x62)],
    ['text: invalid UTF-8', 'text/plain', bytes(0xff, 0xfe, 0xfd)],
    ['text: a lone continuation byte', 'text/csv', bytes(0x61, 0x80)],
    ['text: an overlong encoding', 'text/plain', bytes(0xc0, 0xaf)],
    ['text: an HTML document', 'text/plain', enc('<!DOCTYPE html><html><body>x</body></html>')],
    ['text: an HTML document in upper case', 'text/plain', enc('<HTML><BODY>x</BODY></HTML>')],
    ['text: an HTML document after whitespace', 'text/csv', enc('\n  \t<html>')],
    ['text: an HTML document after a BOM', 'text/plain', enc('\ufeff<html>')],
    ['text: a script tag', 'text/plain', enc('<script>alert(1)</script>')],
    ['text: an SVG', 'text/plain', enc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')],
    ['text: an XML document', 'text/csv', enc('<?xml version="1.0"?><x/>')],
    ['text: an iframe', 'text/plain', enc('<iframe src="//evil.test"></iframe>')],
    ['json: not JSON', 'application/json', enc('hello')],
    ['json: trailing comma', 'application/json', enc('{"a":1,}')],
    ['json: empty', 'application/json', enc('  ')],
    ['json: an HTML page', 'application/json', enc('<html></html>')],
    ['empty png', 'image/png', new ArrayBuffer(0)],
    ['empty text', 'text/plain', new ArrayBuffer(0)],
  ])('refuses the bytes: %s', (_what, mime, data) => {
    expect(refusal(mime, data)).toBe('file_invalid')
  })

  it('refuses a file over 5 MiB as too large before looking at anything else, and accepts exactly 5 MiB', () => {
    expect(MAX_DOWNLOAD_BYTES).toBe(5 * 1024 * 1024)
    expect(refusal('text/html', new ArrayBuffer(MAX_DOWNLOAD_BYTES + 1))).toBe('file_too_large')
    const edge = new Uint8Array(MAX_DOWNLOAD_BYTES).fill(0x61)
    expect(check('text/plain', edge.buffer).ok).toBe(true)
    expect(refusal('text/plain', new ArrayBuffer(MAX_DOWNLOAD_BYTES + 1))).toBe('file_too_large')
  })
})

describe('saveFile', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  const file: CheckedFile = { filename: 'out.csv', mime: 'text/csv', bytes: new TextEncoder().encode('a,b') as Uint8Array<ArrayBuffer> }

  it('clicks a host-made anchor with the safe name, removes it, and revokes the Blob URL after 30 seconds', () => {
    vi.useFakeTimers()
    const create = vi.fn(() => 'blob:host/1')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    saveFile(file)
    expect(create).toHaveBeenCalledOnce()
    const blob = (create.mock.calls[0] as unknown as [Blob])[0]
    expect(blob.type).toBe('text/csv')
    const seen = click.mock.contexts[0] as HTMLAnchorElement
    expect(click).toHaveBeenCalledOnce()
    expect(seen.download).toBe('out.csv')
    expect(seen.getAttribute('href')).toBe('blob:host/1')
    expect(seen.rel).toBe('noopener')
    expect(document.body.contains(seen)).toBe(false)
    vi.advanceTimersByTime(REVOKE_AFTER_MS - 1)
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revoke).toHaveBeenCalledWith('blob:host/1')
    expect(REVOKE_AFTER_MS).toBe(30_000)
  })
})
