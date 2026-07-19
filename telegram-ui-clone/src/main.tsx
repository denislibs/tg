import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import App from './App'
import './styles/index.scss'
import { ManagersProvider } from './core/hooks/useManagers'
import { startClient } from './client/bootstrap'
import { initPwaInstall } from './core/pwa'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* push unavailable */ })
}

// Ловим beforeinstallprompt для пункта «Установить приложение» (PWA).
initPwaInstall()

// Single injection point for the manager layer: the worker-backed singleton in prod
// (tests render subtrees under their own <ManagersProvider managers={mock}>).
const { managers } = startClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ManagersProvider managers={managers}>
      <App />
    </ManagersProvider>
  </React.StrictMode>
)
