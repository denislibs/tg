import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.scss'
import { ManagersProvider } from './core/hooks/useManagers'
import { bootstrap } from './client/boot'
import { loadFonts } from './core/dom/loadFonts'
import { startChatsCachePersist } from './stores/chatsCache'
import { startFoldersPersist } from './stores/foldersStore'
import { startDraftsPersist } from './stores/draftsStore'

// Шрифты — вне критического рендер-пути: @font-face (@fontsource) уходит в ленивый
// чанк, глифы Roboto/tgico тёплятся через document.fonts (см. loadFonts). Раньше
// три @fontsource/*.css импортились статикой и блокировали критический CSS. FOUT
// на первом заходе снимает font-display: swap (дефолт @fontsource); #root не
// прячем, чтобы не ломать instant-boot (#57).
void loadFonts()

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
  // Персист для мгновенного/офлайн следующего старта: диалоги+me, папки, черновики.
  startChatsCachePersist()
  startFoldersPersist()
  startDraftsPersist()
})
