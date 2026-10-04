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
import { newIdempotencyKey } from './newIdempotencyKey.js'

/** What {@link useImportFlow} returns. */
export interface ImportFlow {
  readonly accounts: readonly ImportAccount[]
  readonly accountId: string
  readonly setAccountId: (id: string) => void
  readonly fileName: string
  readonly csv: string
  readonly stage: Stage
  /** A failure to load the page itself (the account list); shown at the top. */
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
  /** Reads a chosen file and moves to the mapping step. */
  readonly onFile: (file: File) => Promise<void>
  /** Checks the file for duplicates and moves to the review step. */
  readonly analyze: () => Promise<void>
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

  // Names one commit intent. It is created on the first commit attempt and
  // kept, so a retry after a network error or a second click sends the same
  // key and the server imports at most once. Anything that starts a new
  // review (a new file, a fresh analysis, a reset) drops it.
  const commitKey = useRef<string | null>(null)

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
    clearErrors()
    commitKey.current = null
    const text = await file.text()
    const parsedFile = parseCsv(text)
    setCsv(text)
    setParsed(parsedFile)
    setFileName(file.name)
    if (parsedFile.headers.length === 0) {
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
  }, [applySaved, clearErrors, showErrors])

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
    setBusy(true)
    try {
      const r = await ctx.api.post<AnalyzeResult>(`${IMPORT_API_BASE}/analyze`, {
        accountId, csv, ...mapping,
      })
      setAnalysis(r)
      setAccepted(new Set())
      commitKey.current = null
      setStage('review')
    } catch (e) {
      showErrors(formErrorsFrom(e, FIELDS, 'Could not analyze that file.'))
    } finally {
      setBusy(false)
    }
  }, [ctx, accountId, csv, mapping, refuse, showErrors])

  const commit = useCallback(async () => {
    if (refuse()) return
    setBusy(true)
    try {
      // Saving the mapping is part of committing, not a separate button: the
      // mapping that produced a successful import is the one worth keeping.
      await ctx.api.post(`${IMPORT_API_BASE}/mappings`, { ...mapping })
      commitKey.current ??= newIdempotencyKey()
      const r = await ctx.api.post<ImportResult>(
        `${IMPORT_API_BASE}/commit`,
        { accountId, csv, fileName, acceptRowNumbers: [...accepted], idempotencyKey: commitKey.current, ...mapping },
      )
      setResult(r)
      setStage('done')
      setHistoryKey((k) => k + 1)
    } catch (e) {
      showErrors(formErrorsFrom(e, FIELDS, 'Could not import that file.'))
    } finally {
      setBusy(false)
    }
  }, [ctx, accountId, csv, fileName, accepted, mapping, refuse, showErrors])

  const reset = useCallback(() => {
    commitKey.current = null
    setCsv('')
    setParsed(null)
    setFileName('')
    setAnalysis(null)
    setResult(null)
    setAccepted(new Set())
    setMatchedSource(null)
    setStage('choose')
    clearErrors()
  }, [clearErrors])

  const refreshHistory = useCallback(() => setHistoryKey((k) => k + 1), [])

  return {
    accounts,
    accountId,
    setAccountId: (id: string) => { setAccountId(id); clearField('accountId') },
    fileName, csv, stage, error, errors: form.errors, formRef: form.ref, busy,
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
    onFile, analyze, commit, reset, refreshHistory,
  }
}
