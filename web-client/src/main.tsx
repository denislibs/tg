import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
// Шрифты вкладки «Текст» медиа-редактора (порядок/веса — из tweb fontInfoMap).
import '@fontsource/suez-one/400.css'
import '@fontsource/rubik-bubbles/400.css'
import '@fontsource/chewy/400.css'
import '@fontsource/courier-prime/700.css'
import '@fontsource/fugaz-one/400.css'
import '@fontsource/sedan/400.css'
import '@fontsource/playwrite-be-vlg/400.css'
import App from './App'
import './styles/index.scss'
import { ManagersProvider } from './core/hooks/useManagers'
import { startClient } from './client/bootstrap'
import { initPwaInstall } from './core/pwa'
import { getInitial, loadLang } from './i18n'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* push unavailable */ })
}

// Ловим beforeinstallprompt для пункта «Установить приложение» (PWA).
initPwaInstall()

// Single injection point for the manager layer: the worker-backed singleton in prod
// (tests render subtrees under their own <ManagersProvider managers={mock}>).
const { managers } = startClient()

// Убираем статический сплеш (index.html) после первого рендера — с фейдом.
function removeInitialLoader() {
  const loader = document.getElementById('initial-loader')
  if (!loader) return
  loader.classList.add('hide')
  loader.addEventListener('transitionend', () => loader.remove(), { once: true })
}

// Загружаем словарь активного языка до первого рендера — иначе не-английский UI
// на миг мигнул бы английским, пока подтягивается языковой чанк.
void loadLang(getInitial()).then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ManagersProvider managers={managers}>
        <App />
      </ManagersProvider>
    </React.StrictMode>,
  )
  requestAnimationFrame(removeInitialLoader)
})
