import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { PluginContext } from '@wickermoney/plugin-sdk'
import { formErrorsFrom, hasFormErrors, useFormErrors, type FormErrors } from '@wickermoney/ui-kit'
import {
  defaultDateFormat, mapParsedRows, mappingIssues, parseCsv, suggestAmountStyle, suggestColumns,
  type AmountStyle, type ColumnMap, type DateFormat, type MapResult, type ParsedCsv, type SourceMapping,
} from '../../shared/index.js'
import { IMPORT_API_BASE } from '../../server/constants.js'
import type {
  AnalyzeResult, ImportAccount, ImportResult, SavedMapping, Stage,
} from '../models/index.js'
import { planUpload, type UploadPlan } from '../staging/planUpload.js'
import { RequestPacer } from '../staging/RequestPacer.js'
import { StagingFailure } from '../staging/StagingFailure.js'
import { stageUpload, type StagingHandle } from '../staging/stageUpload.js'
import { newIdempotencyKey } from './newIdempotencyKey.js'

/**
 * Where the upload of the chosen file stands. The file goes to the server while
 * the person maps columns, so by the time they ask for the check it is usually
 * already there.
 */
export interface UploadStatus {
  readonly phase: 'idle' | 'uploading' | 'ready' | 'failed'
  /** Chunks the server has accepted, and how many there are. */
  readonly sent: number
  readonly total: number
  /** Why it failed, for the person; `null` unless `phase` is `failed`. */
  readonly message: string | null
}

const IDLE: UploadStatus = { phase: 'idle', sent: 0, total: 0, message: null }

/** Whether a request failed because the server no longer has the staged file. */
function isUploadGone(e: unknown): boolean {
  const f = e as { status?: unknown; code?: unknown }
  return f?.status === 404 && f.code === 'upload_not_found'
}

/** What {@link useImportFlow} returns. */
export interface ImportFlow {
  readonly accounts: readonly ImportAccount[]
  readonly accountId: string
  readonly setAccountId: (id: string) => void
  readonly fileName: string
  readonly csv: string
  readonly stage: Stage
  /** The upload of the chosen file to the server's staging area. */
  readonly upload: UploadStatus
  /** A failure to load the page itself (the account list); shown with the file and account. */
  readonly error: string | null
  /**
   * Why the file, the mapping or a step was refused: `fields` keyed by the
   * request's own names (`accountId`, `csv`, `sourceName`, `columns.date`...),
   * shown under each control, and `form` for beside the step's button.
   */
  readonly errors: FormErrors
  /** Attach to the page, so focus can move to the first problem. */
  readonly formRef: RefObject<HTMLDivElement | null>
  readonly busy: boolean
  /** The file's header names; empty until a file is chosen. */
  readonly headers: readonly string[]
  readonly columns: ColumnMap
  readonly setColumns: (next: ColumnMap) => void
  readonly dateFormat: DateFormat
  readonly setDateFormat: (next: DateFormat) => void
  readonly amountStyle: AmountStyle
  readonly setAmountStyle: (next: AmountStyle) => void
  readonly invertAmount: boolean
  readonly setInvertAmount: (next: boolean) => void
  readonly sourceName: string
  readonly setSourceName: (next: string) => void
  /** The file parsed with the current settings, or `null` until a date and description column are chosen. */
  readonly preview: MapResult | null
  readonly analysis: AnalyzeResult | null
  /** Row numbers of possible duplicates the user has ticked to import anyway. */
  readonly accepted: ReadonlySet<number>
  readonly setAccepted: (next: ReadonlySet<number>) => void
  readonly result: ImportResult | null
  /** Changes whenever the batch history should reload. */
  readonly historyKey: number
  /** The name of the saved mapping applied to the current file, if any. */
  readonly matchedSource: string | null
  /** Reads a chosen file, starts sending it to the server, and moves to the mapping step. */
  readonly onFile: (file: File) => Promise<void>
  /** Checks the file for duplicates and moves to the review step. */
  readonly analyze: () => Promise<void>
  /**
   * Loads the next page of possible duplicates from the server into `analysis`.
   * The file is analysed again, with the mapping and account it was first
   * analysed with, so the list stays one list.
   */
  readonly loadMoreFlagged: () => Promise<boolean>
  /** Saves the mapping, writes the transactions and moves to the done step. */
  readonly commit: () => Promise<void>
  /** Discards the current file and returns to the first step. */
  readonly reset: () => void
  readonly refreshHistory: () => void
}

/** Returned while no file is loaded, so `headers` keeps one identity. */
const NO_HEADERS: readonly string[] = []

/** Every request field the page has a control for. */
const FIELDS = [
  'accountId', 'csv', 'sourceName', 'dateFormat', 'amountStyle',
  'columns.date', 'columns.merchant', 'columns.amount', 'columns.debit', 'columns.credit',
  'columns.notes', 'columns.externalId',
]

/**
 * State and actions for the four-step CSV import flow.
 *
 * Nothing is written until the user has seen the file parsed with their chosen
 * settings and been shown what would be skipped. The preview is computed in the
 * browser by the same functions the server runs on commit, so what the user sees
 * is what gets written by construction rather than by two implementations
 * agreeing.
 *
 * The file is parsed once, when it is chosen. The preview is re-mapped only
 * when a setting that changes the result changes; typing the source name, which
 * does not, leaves it untouched.
 *
 * @param ctx - The plugin context supplying the scoped API client.
 */
export function useImportFlow(ctx: PluginContext): ImportFlow {
  const [accounts, setAccounts] = useState<readonly ImportAccount[]>([])
  const [accountId, setAccountId] = useState('')
  const [fileName, setFileName] = useState('')
  const [csv, setCsv] = useState('')
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [stage, setStage] = useState<Stage>('choose')
  const [error, setError] = useState<string | null>(null)
  const form = useFormErrors<HTMLDivElement>()
  const { clear: clearErrors, clearField, show: showErrors } = form
  const [busy, setBusy] = useState(false)

  const [sourceName, setSourceName] = useState('')
  const [columns, setColumns] = useState<ColumnMap>({ date: '', merchant: '' })
  const [dateFormat, setDateFormat] = useState<DateFormat>(
    defaultDateFormat(typeof navigator === 'undefined' ? 'en-US' : navigator.language),
  )
  const [amountStyle, setAmountStyle] = useState<AmountStyle>('signed')
  const [invertAmount, setInvertAmount] = useState(false)

  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null)
  const [accepted, setAccepted] = useState<ReadonlySet<number>>(new Set())
  const [result, setResult] = useState<ImportResult | null>(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [saved, setSaved] = useState<readonly SavedMapping[]>([])
  const [matchedSource, setMatchedSource] = useState<string | null>(null)
  const [upload, setUpload] = useState<UploadStatus>(IDLE)

  // The chosen file as the server is sent it, and the upload of it that is running or done.
  const plan = useRef<UploadPlan | null>(null)
  const staging = useRef<StagingHandle | null>(null)
  // One pacer for the page: an upload that is being replaced and its successor still share the frame's limit.
  const pacer = useRef<RequestPacer | null>(null)
  // Counts the files chosen, and resets. An answer that belongs to an earlier one is dropped.
  const epoch = useRef(0)

  // Names one commit intent. It is created on the first commit attempt and
  // kept, so a retry after a network error or a second click sends the same
  // key and the server imports at most once. Anything that starts a new
  // review (a new file, a fresh analysis, a reset) drops it.
  const commitKey = useRef<string | null>(null)

  // What the shown analysis was made from. Paging asks the server about the
  // same file the same way even if the mapping controls have moved since.
  const analyzedWith = useRef<{ accountId: string; mapping: SourceMapping } | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([
      ctx.api.get<{ accounts: ImportAccount[] }>('/core/accounts/list'),
      // Saved mappings are read back so the second import from a bank needs no
      // mapping at all. Writing them without ever reading them would make
      // "remembered per source" a promise the UI does not keep.
      ctx.api.get<{ mappings: SavedMapping[] }>(`${IMPORT_API_BASE}/mappings`),
    ])
      .then(([a, m]) => {
        if (!live) return
        setAccounts(a.accounts)
        setAccountId((current) => (current === '' ? (a.accounts[0]?.id ?? '') : current))
        setSaved(m.mappings)
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : 'Could not load accounts.')
      })
    return () => {
      live = false
    }
  }, [ctx])

  /** Starts sending the planned file. Replaces nothing: the caller has already dealt with the previous upload. */
  const startUpload = useCallback((next: UploadPlan): StagingHandle => {
    pacer.current ??= new RequestPacer()
    const mine = epoch.current
    const live = (): boolean => epoch.current === mine
    setUpload({ phase: 'uploading', sent: 0, total: next.chunks.length, message: null })
    const handle = stageUpload(ctx.api, next, {
      pacer: pacer.current,
      onProgress: (sent, total) => {
        if (live()) setUpload({ phase: 'uploading', sent, total, message: null })
      },
    })
    handle.ready.then(
      () => { if (live()) setUpload((u) => ({ ...u, phase: 'ready', sent: u.total })) },
      (e: unknown) => {
        if (!live() || (e instanceof StagingFailure && e.kind === 'cancelled')) return
        setUpload((u) => ({ ...u, phase: 'failed', message: e instanceof Error ? e.message : 'Your file could not be sent to the server.' }))
      },
    )
    return handle
  }, [ctx])

  /** Stops the current upload and has the server discard it. */
  const dropUpload = useCallback(() => {
    staging.current?.abort()
    staging.current = null
    setUpload(IDLE)
  }, [])

  // Leaving the page or the frame: give the staged file back, so the person is not held at the server's limit of two.
  useEffect(() => {
    const leave = (): void => { staging.current?.abort() }
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      leave()
    }
  }, [])

  /**
   * Runs one request that names the staged file, and sends the file again when
   * the server has lost it.
   *
   * A staged file expires 15 minutes after its last new chunk, and `analyze`
   * does not extend that, so a person who maps for a long time finds it gone.
   * The text is still here, so it is sent again (once) and the request is
   * repeated with the new id. A failed upload is started again the same way when
   * the person asks for the next step.
   */
  const withUpload = useCallback(async <T,>(run: (uploadId: string) => Promise<T>): Promise<T> => {
    const mine = epoch.current
    // Another file was chosen, or the page was reset, while this was waiting: it is not this request's file any more.
    const stale = (): StagingFailure | null =>
      epoch.current === mine ? null : new StagingFailure('cancelled', 'Another file was chosen.')
    const text = plan.current
    if (text === null) throw new StagingFailure('gone', 'Choose the file again.')
    if (staging.current === null || staging.current.state() === 'failed') staging.current = startUpload(text)
    const first = await staging.current.ready
    const gone = stale()
    if (gone !== null) throw gone
    try {
      return await run(first)
    } catch (e) {
      const other = stale()
      if (other !== null) throw other
      if (!isUploadGone(e)) throw e
    }
    staging.current = startUpload(text)
    const second = await staging.current.ready
    try {
      return await run(second)
    } catch (e) {
      const other = stale()
      if (other !== null) throw other
      if (isUploadGone(e)) {
        throw new StagingFailure('gone', 'The server no longer has your file, and sending it again did not help. Choose the file again.')
      }
      throw e
    }
  }, [startUpload])

  /**
   * Applies a saved mapping to the file just picked.
   *
   * Matched on the columns the file actually has rather than on its name: banks
   * name exports `activity (3).csv`, and a mapping keyed on that would never
   * match twice. The headers are the stable thing about a source.
   */
  const applySaved = useCallback((fileHeaders: readonly string[]): SavedMapping | null => {
    const has = (name: string | undefined): boolean =>
      name === undefined || name === '' || fileHeaders.some((h) => h.toLowerCase() === name.toLowerCase())
    const fits = saved.find(
      (m) => has(m.columns.date) && has(m.columns.merchant) && has(m.columns.amount) &&
             has(m.columns.debit) && has(m.columns.credit) && has(m.columns.externalId),
    )
    if (fits === undefined) return null

    setColumns(fits.columns)
    setDateFormat(fits.dateFormat)
    setAmountStyle(fits.amountStyle)
    setInvertAmount(fits.invertAmount)
    setSourceName(fits.sourceName)
    return fits
  }, [saved])

  const headers = parsed?.headers ?? NO_HEADERS

  const mapping: SourceMapping = useMemo(
    () => ({ sourceName: sourceName.trim() || fileName.replace(/\.csv$/i, ''), columns, dateFormat, amountStyle, invertAmount }),
    [sourceName, fileName, columns, dateFormat, amountStyle, invertAmount],
  )

  // The source name is left out of the dependencies on purpose: it does not
  // change how a row is read, and re-mapping a large file per keystroke is the
  // cost this avoids.
  const preview = useMemo(() => {
    if (parsed === null || columns.date === '' || columns.merchant === '') return null
    return mapParsedRows(parsed, { sourceName: '', columns, dateFormat, amountStyle, invertAmount })
  }, [parsed, columns, dateFormat, amountStyle, invertAmount])

  const onFile = useCallback(async (file: File) => {
    const mine = (epoch.current += 1)
    dropUpload()
    plan.current = null
    // An answer for the previous file is dropped from here on, and so is the "busy" it would have cleared.
    setBusy(false)
    clearErrors()
    commitKey.current = null
    const text = await file.text()
    // Another file was chosen while this one was being read.
    if (epoch.current !== mine) return

    if (text.length > 0) {
      let planned: UploadPlan
      try {
        planned = planUpload(text)
      } catch (e) {
        setCsv('')
        setParsed(null)
        setFileName(file.name)
        setStage('choose')
        showErrors({ fields: { csv: e instanceof Error ? e.message : 'That file cannot be imported.' }, form: null })
        return
      }
      // Sending starts now and goes on while the file is parsed and the columns are mapped.
      plan.current = planned
      staging.current = startUpload(planned)
    }

    const parsedFile = parseCsv(text)
    setCsv(text)
    setParsed(parsedFile)
    setFileName(file.name)
    if (parsedFile.headers.length === 0) {
      dropUpload()
      plan.current = null
      showErrors({ fields: { csv: 'That file has no header row. Export it again with column names.' }, form: null })
      return
    }
    // A saved mapping wins over the header heuristics: it is what the user
    // confirmed last time, and a guess should never quietly override it.
    const reused = applySaved(parsedFile.headers)
    setMatchedSource(reused?.sourceName ?? null)

    if (reused === null) {
      const suggested = suggestColumns(parsedFile.headers)
      setColumns({
        date: suggested.date ?? '',
        merchant: suggested.merchant ?? '',
        amount: suggested.amount ?? '',
        debit: suggested.debit ?? '',
        credit: suggested.credit ?? '',
        notes: suggested.notes ?? '',
        externalId: suggested.externalId ?? '',
      })
      setAmountStyle(suggestAmountStyle(parsedFile.headers))
      setSourceName((current) => (current === '' ? file.name.replace(/\.csv$/i, '') : current))
    }
    setStage('map')
  }, [applySaved, clearErrors, showErrors, dropUpload, startUpload])

  /** Checks what the person chose with the server's own rules; shows and returns whether anything is wrong. */
  const refuse = useCallback((): boolean => {
    const problems: FormErrors = {
      fields: Object.fromEntries([
        ...(accountId === '' ? [['accountId', 'Choose an account.']] : []),
        ...mappingIssues(mapping).map((i) => [i.path.join('.'), i.message]),
      ]),
      form: null,
    }
    showErrors(problems)
    return hasFormErrors(problems)
  }, [accountId, mapping, showErrors])

  const analyze = useCallback(async () => {
    if (refuse()) return
    const mine = epoch.current
    setBusy(true)
    try {
      const r = await withUpload((uploadId) => ctx.api.post<AnalyzeResult>(`${IMPORT_API_BASE}/analyze`, {
        accountId, uploadId, ...mapping,
      }))
      if (epoch.current !== mine) return
      setAnalysis(r)
      analyzedWith.current = { accountId, mapping }
      setAccepted(new Set())
      commitKey.current = null
      setStage('review')
    } catch (e) {
      if (epoch.current === mine) showErrors(formErrorsFrom(e, FIELDS, 'Could not analyze that file.'))
    } finally {
      if (epoch.current === mine) setBusy(false)
    }
  }, [ctx, accountId, mapping, refuse, showErrors, withUpload])

  const loadMoreFlagged = useCallback(async (): Promise<boolean> => {
    const basis = analyzedWith.current
    if (analysis === null || basis === null) return false
    const mine = epoch.current
    try {
      const r = await withUpload((uploadId) => ctx.api.post<AnalyzeResult>(`${IMPORT_API_BASE}/analyze`, {
        accountId: basis.accountId, uploadId, ...basis.mapping,
        flaggedOffset: analysis.flagged.offset + analysis.flagged.rows.length,
      }))
      if (epoch.current !== mine) return false
      setAnalysis((current) => {
        if (current === null) return current
        // Keep a row once, by its place in the file, so a page that overlaps
        // (the ledger moved between requests) cannot list it twice.
        const have = new Set(current.flagged.rows.map((row) => row.rowNumber))
        const added = r.flagged.rows.filter((row) => !have.has(row.rowNumber))
        return { ...current, flagged: { ...current.flagged, total: r.flagged.total, rows: [...current.flagged.rows, ...added] } }
      })
      return true
    } catch (e) {
      if (epoch.current === mine) showErrors(formErrorsFrom(e, FIELDS, 'Could not load more rows.'))
      return false
    }
  }, [ctx, analysis, showErrors, withUpload])

  const commit = useCallback(async () => {
    if (refuse()) return
    const mine = epoch.current
    setBusy(true)
    try {
      // Saving the mapping is part of committing, not a separate button: the
      // mapping that produced a successful import is the one worth keeping.
      await ctx.api.post(`${IMPORT_API_BASE}/mappings`, { ...mapping })
      commitKey.current ??= newIdempotencyKey()
      const key = commitKey.current
      const r = await withUpload((uploadId) => ctx.api.post<ImportResult>(
        `${IMPORT_API_BASE}/commit`,
        { accountId, uploadId, fileName, acceptRowNumbers: [...accepted], idempotencyKey: key, ...mapping },
      ))
      // The server frees the staged text when a commit succeeds: there is nothing left to give back.
      staging.current = null
      setUpload(IDLE)
      setResult(r)
      setStage('done')
      setHistoryKey((k) => k + 1)
    } catch (e) {
      if (epoch.current === mine) showErrors(formErrorsFrom(e, FIELDS, 'Could not import that file.'))
    } finally {
      if (epoch.current === mine) setBusy(false)
    }
  }, [ctx, accountId, fileName, accepted, mapping, refuse, showErrors, withUpload])

  const reset = useCallback(() => {
    epoch.current += 1
    dropUpload()
    plan.current = null
    setBusy(false)
    commitKey.current = null
    setCsv('')
    setParsed(null)
    setFileName('')
    setAnalysis(null)
    analyzedWith.current = null
    setResult(null)
    setAccepted(new Set())
    setMatchedSource(null)
    setStage('choose')
    clearErrors()
  }, [clearErrors, dropUpload])

  const refreshHistory = useCallback(() => setHistoryKey((k) => k + 1), [])

  return {
    accounts,
    accountId,
    setAccountId: (id: string) => { setAccountId(id); clearField('accountId') },
    fileName, csv, stage, upload, error, errors: form.errors, formRef: form.ref, busy,
    headers,
    columns,
    setColumns: (next: ColumnMap) => {
      setColumns(next)
      for (const key of Object.keys(next)) clearField(`columns.${key}`)
    },
    dateFormat, setDateFormat, amountStyle, setAmountStyle,
    invertAmount, setInvertAmount,
    sourceName,
    setSourceName: (next: string) => { setSourceName(next); clearField('sourceName') },
    preview, analysis,
    accepted, setAccepted, result, historyKey, matchedSource,
    onFile, analyze, loadMoreFlagged, commit, reset, refreshHistory,
  }
}
