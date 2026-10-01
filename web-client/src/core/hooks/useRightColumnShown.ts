// ВРЕМЕННО до 0б-11 — мост экрана поиска стикеров/GIF (`rightSidebar/RightSearchTab.tsx`)
// к классу правой колонки. У tweb эти экраны — вкладки слайдера `#column-right`
// (`sidebarRight/tabs/stickers.tsx`, `gifs.tsx`): их открытие —
// `appSidebarRight.createTab(AppStickersTab).open()` + `toggleSidebar(true)`
// (`stickers.tsx:215`, `gifs.tsx:109`), и `body.is-right-column-shown` ставит
// сам класс (`sidebarRight/index.ts:128`). Наш экран пока отдельный React-портал
// с геометрией колонки, поэтому до своей задачи он лишь просит класс открыть
// колонку, пока смонтирован, и закрывает её, только если открывал сам: колонка,
// открытая до него (профиль), переживает закрытие поиска — как у tweb, где
// снятие вкладки поиска возвращает к профилю под ней.
import { useLayoutEffect } from 'react'
import appSidebarRight, { RIGHT_COLUMN_ACTIVE_CLASSNAME } from '@components/sidebarRight'

export function useRightColumnShown(): void {
  useLayoutEffect(() => {
    const sidebar = appSidebarRight
    const wasShown = document.body.classList.contains(RIGHT_COLUMN_ACTIVE_CLASSNAME)
    if (!wasShown) void sidebar.toggleSidebar(true)
    return () => {
      if (!wasShown) void sidebar.toggleSidebar(false)
    }
  }, [])
}
