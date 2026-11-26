import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app'
import './index.css'
import { flushOfflineQueue } from './lib/offlineQueue'

window.addEventListener('online', () => flushOfflineQueue().catch(() => {}))
if (navigator.onLine) flushOfflineQueue().catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
