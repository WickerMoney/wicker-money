import './configureZod.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@wickermoney/ui-kit'
import { App } from './App.js'

const container = document.getElementById('root')
if (container === null) throw new Error('Root element #root not found.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
