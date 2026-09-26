import type { PluginPageProps } from '@wickermoney/plugin-sdk'
import { Alert } from '@wickermoney/ui-kit'
import './styles.js'
import { DATE_FORMATS } from '../shared/index.js'
import { BatchHistory } from './components/BatchHistory.js'
import { CheckDuplicatesAction } from './components/CheckDuplicatesAction.js'
import { FileAccountStep } from './components/FileAccountStep.js'
import { ImportDoneStep } from './components/ImportDoneStep.js'
import { MappingStep } from './components/MappingStep.js'
import { ReviewStep } from './components/ReviewStep.js'
import { useImportFlow } from './hooks/useImportFlow.js'

/**
 * The import flow, as four visible steps: file and account, column mapping,
 * duplicate review, and result.
 *
 * The ordering is the point. Nothing is written until the user has seen the file
 * parsed with their chosen settings and been shown what would be skipped. The
 * date format and the treatment of possible duplicates are decisions the user
 * makes here rather than conventions the importer applies quietly.
 *
 * Exposed to the host as a default export.
 */
export default function ImportPage({ ctx }: PluginPageProps) {
  const flow = useImportFlow(ctx)
  const inProgress = flow.stage !== 'choose' && flow.stage !== 'done'

  return (
    <div className="page imp">
      <h1 className="page__title">Import transactions</h1>

      {flow.error !== null ? <Alert>{flow.error}</Alert> : null}

      <FileAccountStep
        accounts={flow.accounts}
        accountId={flow.accountId}
        onAccountChange={flow.setAccountId}
        fileName={flow.fileName}
        matchedSource={flow.matchedSource}
        onFile={(file) => void flow.onFile(file)}
      />

      {inProgress && flow.csv !== '' ? (
        <MappingStep
          headers={flow.headers}
          columns={flow.columns}
          onColumns={flow.setColumns}
          dateFormat={flow.dateFormat}
          onDateFormat={flow.setDateFormat}
          dateFormats={DATE_FORMATS}
          amountStyle={flow.amountStyle}
          onAmountStyle={flow.setAmountStyle}
          invertAmount={flow.invertAmount}
          onInvertAmount={flow.setInvertAmount}
          sourceName={flow.sourceName}
          onSourceName={flow.setSourceName}
          preview={flow.preview}
          formatMoney={ctx.formatMoney}
        />
      ) : null}

      <CheckDuplicatesAction
        hasRows={inProgress && (flow.preview?.rows.length ?? 0) > 0}
        busy={flow.busy}
        accountMissing={flow.accountId === ''}
        onCheck={() => void flow.analyze()}
      />

      {flow.stage === 'review' && flow.analysis !== null ? (
        <ReviewStep
          analysis={flow.analysis}
          accepted={flow.accepted}
          onAccepted={flow.setAccepted}
          formatMoney={ctx.formatMoney}
          busy={flow.busy}
          onCommit={() => void flow.commit()}
        />
      ) : null}

      {flow.stage === 'done' && flow.result !== null ? (
        <ImportDoneStep result={flow.result} onReset={flow.reset} />
      ) : null}

      <BatchHistory ctx={ctx} refreshKey={flow.historyKey} onReverted={flow.refreshHistory} />
    </div>
  )
}
