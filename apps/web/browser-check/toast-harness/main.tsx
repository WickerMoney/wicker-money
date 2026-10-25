/**
 * The page the toast browser check drives: the real AppShell, app.css and
 * ui-kit with a stand-in account menu, a Transactions-like page (a title,
 * filters and a long list) and buttons that raise toasts. No API, no database.
 */
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { Dialog, ToastProvider, useToast, type ToastApi } from '@wickermoney/ui-kit'
import { AppShell } from '../../src/shell/AppShell.js'
// Imported by path: the package's own `sideEffects` list does not name src/, so a bundle
// that reaches ui-kit through the alias would drop the CSS imports in its index.ts.
import '../../../../packages/ui-kit/src/tokens.css'
import '../../../../packages/ui-kit/src/components.css'
import '../../src/app.css'

declare global { interface Window { __toast: ToastApi } }

function Page() {
  const toast = useToast()
  window.__toast = toast
  const [open, setOpen] = useState(false)
  return (
    <div className="page">
      <h1 className="page__title" id="title">Transactions</h1>
      <div className="txn__filters">
        <label>Search <input id="search" type="search" /></label>
        <label>Category <select id="category"><option>All</option></select></label>
        <button type="button" className="wm-btn" onClick={() => { setOpen(true) }}>Add transaction</button>
      </div>
      {Array.from({ length: 80 }, (_, i) => <p key={i}>Row {i + 1}</p>)}
      {open ? <Dialog title="Add transaction" onClose={() => { setOpen(false) }}><p>Form</p></Dialog> : null}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <ToastProvider>
      <Routes>
        <Route element={<AppShell plugins={[]} />}>
          <Route path="*" element={<Page />} />
        </Route>
      </Routes>
    </ToastProvider>
  </BrowserRouter>,
)
