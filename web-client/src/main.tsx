import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.scss'
import { ManagersProvider } from './core/hooks/useManagers'
import { bootstrap } from './client/boot'
import { loadFonts } from './core/dom/loadFonts'
import { setRootClasses } from './core/dom/rootClasses'
import { startDialogsPersist } from './stores/dialogsPersist'

// Шрифты — вне критического рендер-пути: @font-face (@fontsource) уходит в ленивый
// чанк, глифы Roboto/tgico тёплятся через document.fonts (см. loadFonts). Раньше
// три @fontsource/*.css импортились статикой и блокировали критический CSS. FOUT
// на первом заходе снимает font-display: swap (дефолт @fontsource); #root не
// прячем, чтобы не ломать instant-boot (#57).
void loadFonts()

// Классы окружения на <html> до первого рендера — иначе hover/платформенные
// правила портированных партиалов tweb не матчатся на первом кадре.
setRootClasses()

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
  // Персист для мгновенного/офлайн следующего старта: диалоги+me. main лишь
  // собирает свежий вид и шлёт снапшот воркеру — физически пишет он один
  // (persistManager), поэтому подписка получает managers. Папки и черновики сюда
  // не входят: они живут в State и пишутся write-through через setAppState.
  startDialogsPersist(managers)
})
