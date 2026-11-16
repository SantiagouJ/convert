import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initApi } from './api'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

initApi().then(
  () =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    ),
  (error: unknown) =>
    root.render(<p className="fatal">{error instanceof Error ? error.message : String(error)}</p>)
)
