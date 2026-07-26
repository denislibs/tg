import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import App from './App'
import './styles/index.scss'
import { ManagersProvider } from './core/hooks/useManagers'
import { bootstrap } from './client/boot'
import { startChatsCachePersist } from './stores/chatsCache'

// Весь холодный старт — в bootstrap() (client/boot.ts). Здесь остаётся только
// рендер после того, как критические данные подняты, и запуск персиста кэша.
void bootstrap().then(({ managers }) => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ManagersProvider managers={managers}>
        <App />
      </ManagersProvider>
    </React.StrictMode>,
  )
  startChatsCachePersist() // персист диалогов для следующего холодного старта
})
