import { DOWNLOAD_TYPES, MAX_DOWNLOAD_BYTES, type DownloadMessage } from '@wickermoney/plugin-sdk/isolated'

/** A MIME type a frame may ask the host to save. */
type DownloadMime = keyof typeof DOWNLOAD_TYPES

/** A file a frame asked the host to save, after the host has checked it. */
export interface CheckedFile {
  /** The name the host will use: safe characters only, and the extension of `mime`. */
  readonly filename: string
  readonly mime: DownloadMime
  readonly bytes: Uint8Array<ArrayBuffer>
}

/** The result of {@link checkDownload}. A refusal carries the code the frame sees. */
export type FileCheck =
  | { readonly ok: true; readonly file: CheckedFile }
  | { readonly ok: false; readonly code: 'file_too_large' | 'file_type_not_allowed' | 'file_invalid'; readonly message: string }

/** How long a Blob URL lives after the click, in milliseconds. Safari starts the download after the click returns. */
export const REVOKE_AFTER_MS = 30_000

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const MAX_STEM = 80

/**
 * The file name the host uses.
 *
 * The suggestion is normalised (NFKC), cut to its last path segment (either slash), and loses what looks like its own
 * extension. Everything but letters, digits, space, `_`, `-`, `(` and `)` becomes `_` (dots too, so `a.pdf.exe` cannot
 * keep a second extension, and a bidirectional override or a control character cannot survive). Leading and trailing
 * separators go, the stem is capped at 80 characters and a Windows device name is prefixed. The extension is always
 * the one that belongs to the checked MIME type, never the frame's.
 */
export function safeFilename(suggested: string, extension: string): string {
  const last = suggested.normalize('NFKC').split(/[\\/]/).pop() ?? ''
  let stem = last.replace(/\.[A-Za-z0-9]{1,5}$/, '')
  stem = stem.replace(/[^\p{L}\p{N} _()-]+/gu, '_').replace(/\s+/g, ' ').replace(/^[ _.-]+|[ _.-]+$/g, '').slice(0, MAX_STEM).trim()
  if (stem === '') stem = 'download'
  if (RESERVED.test(stem)) stem = `_${stem}`
  return `${stem}.${extension}`
}

const startsWith = (b: Uint8Array, magic: readonly number[]): boolean => magic.every((v, i) => b[i] === v)

/** What an HTML, SVG or XML document starts with, after a byte order mark and whitespace. */
const MARKUP = /^<(?:!doctype|html|head|body|svg|script|iframe|object|embed|\?xml)/i

/** Drops one leading byte order mark (U+FEFF). */
const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

/** Decodes as strict UTF-8, or `null` when the bytes are not valid text. */
function decodeText(b: Uint8Array<ArrayBuffer>): string | null {
  if (b.includes(0)) return null
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b) } catch { return null }
}

/**
 * Whether the bytes are what the type says they are. PNG, JPEG and PDF by their magic bytes. Text, CSV and JSON must
 * be valid UTF-8 with no NUL; a document that starts like HTML, SVG or XML is refused as text, and JSON must parse.
 */
function looksLike(mime: DownloadMime, b: Uint8Array<ArrayBuffer>): boolean {
  switch (mime) {
    case 'image/png': return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/jpeg': return startsWith(b, [0xff, 0xd8, 0xff])
    case 'application/pdf': return startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])
    default: {
      const text = decodeText(b)
      if (text === null) return false
      if (MARKUP.test(stripBom(text).trimStart())) return false
      if (mime === 'application/json') {
        try { JSON.parse(text) } catch { return false }
      }
      return true
    }
  }
}

/**
 * Checks the type, size and content of a download request. The size is read before the bytes are touched, then the
 * type, then the content.
 */
export function checkDownload(message: Pick<DownloadMessage, 'filename' | 'mime' | 'data'>): FileCheck {
  const size = message.data.byteLength
  if (size > MAX_DOWNLOAD_BYTES) {
    return { ok: false, code: 'file_too_large', message: `A file may be at most ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MiB.` }
  }
  if (!Object.prototype.hasOwnProperty.call(DOWNLOAD_TYPES, message.mime)) {
    return { ok: false, code: 'file_type_not_allowed', message: 'That file type cannot be saved from a plugin.' }
  }
  const mime = message.mime as DownloadMime
  if (size === 0) return { ok: false, code: 'file_invalid', message: 'The file is empty.' }
  const bytes = new Uint8Array(message.data)
  if (!looksLike(mime, bytes)) return { ok: false, code: 'file_invalid', message: 'The file does not match its type.' }
  return { ok: true, file: { filename: safeFilename(message.filename, DOWNLOAD_TYPES[mime]), mime, bytes } }
}

/**
 * Starts the browser's own download from the host's document: a Blob and an anchor made here, in the host's page,
 * never in the frame. The URL is revoked after {@link REVOKE_AFTER_MS}.
 */
export function saveFile(file: CheckedFile): void {
  const url = URL.createObjectURL(new Blob([file.bytes], { type: file.mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => { URL.revokeObjectURL(url) }, REVOKE_AFTER_MS)
}
