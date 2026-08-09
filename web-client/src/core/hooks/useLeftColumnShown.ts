// tweb appImManager.selectTab(tab) — переключатель АКТИВНОЙ ВКЛАДКИ
// (APP_TABS.CHATLIST | APP_TABS.CHAT), а не признак «Shell смонтирован»:
// document.body.classList.toggle(LEFT_COLUMN_ACTIVE_CLASSNAME, id === APP_TABS.CHATLIST)
// (appImManager.ts:2593), и selectTab(CHAT) зовётся при открытии любого пира —
// на всех ширинах, не только на мобиле (appImManager.ts:2800, :2819).
//
// Наш CSS уже трактует класс именно так (не «Shell есть», а «список активен»):
//   _chat.scss (handhelds): body.is-left-column-shown & { translate3d(100vw) opacity:0 } — #column-center
//   _leftSidebar.scss: body:not(.is-left-column-shown) & { translate3d(-25vw) opacity:0 } — #column-left
// Поэтому класс обязан следовать за «выбран ли чат», а не ставиться один раз.
import { useLayoutEffect } from 'react'

const CLASS = 'is-left-column-shown'

/** @param chatOpen — открыт ли чат/тред (эквивалент APP_TABS.CHAT в tweb) */
export function useLeftColumnShown(chatOpen: boolean): void {
  useLayoutEffect(() => {
    document.body.classList.toggle(CLASS, !chatOpen)
  }, [chatOpen])

  // Снимается при размонтировании Shell (выход/логаут) — отдельный эффект с
  // пустыми deps, чтобы не зависеть от порядка ре-рендеров toggle-эффекта выше.
  useLayoutEffect(() => () => { document.body.classList.remove(CLASS) }, [])
}
