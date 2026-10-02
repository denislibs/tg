// Левая колонка для тестов: вечный синглтон `AppSidebarLeft` (создан при импорте
// над статикой `index.html`, `test/staticMarkup.ts`). Хелпер переносит его
// `#column-left` в `body` (тестам вкладок нужен документ) и возвращает обратно на
// `destroy()`, закрыв вкладки и сняв записи навигации.
//
// `construct` колонки зовёт владелец списка (`appDialogsManager.start`, tweb
// `appDialogsManager.ts:983`) — ему нужна разметка целиком (`full`); тестам
// вкладок, которым нужен только слайдер, шапка и список `.item-main` на время
// теста вынимаются (иначе их запросы `.sidebar-header` попадали бы в шапку
// колонки). `openTab` — `createTab(…).open(…)` одним вызовом, промис
// разрешается, когда содержимое вкладки готово.
//
// `columnEl` — прежний аргумент: тест сам заводил узел колонки. Синглтон
// берёт свой узел из статики, поэтому переданный узел убирается из документа
// (два `#column-left` сбили бы `getElementById`).
import appSidebarLeft from '@components/sidebarLeft'
import type SliderSuperTab from '@components/sliderTab'
import type { SliderSuperTabConstructable } from '@components/sliderTab'
import appNavigationController from '@core/navigation/appNavigationController'
import type { Managers } from '../client/bootstrap'
import { returnToStaticMarkup } from './staticMarkup'

export type InstalledSidebarLeft = ReturnType<typeof installSidebarLeft>

export function installSidebarLeft(managers = {} as Managers, columnEl?: HTMLElement, { full = false } = {}) {
  if(columnEl && columnEl !== appSidebarLeft.sidebarEl) columnEl.remove()

  const column = appSidebarLeft.sidebarEl
  const overlay = document.querySelector('.sidebar-left-overlay')!
  const sliderEl = column.querySelector<HTMLElement>('.sidebar-slider')!
  const mainEl = sliderEl.querySelector<HTMLElement>('.item-main')!
  const header = mainEl.querySelector<HTMLElement>('.sidebar-header')!
  const content = mainEl.querySelector<HTMLElement>('.sidebar-content')!
  const detached = full ? [] : [header, content]
  detached.forEach((node) => node.remove())
  document.body.append(column)

  // без `construct` вкладкам нужен только реестр менеджеров (tweb `slider.ts:270`)
  ;(appSidebarLeft as unknown as { managers: Managers }).managers = managers

  return {
    column,
    sliderEl,
    mainEl,
    header,
    backBtn: header.querySelector<HTMLElement>('.sidebar-back-button')!,
    chatlistContainer: content.querySelector<HTMLElement>('#chatlist-container')!,
    host: content.querySelector<HTMLElement>('.connection-status-bottom')!,
    searchContainer: content.querySelector<HTMLElement>('#search-container')!,
    overlay,
    sidebar: appSidebarLeft,
    /** Совместимое имя для тестов вкладок: слайдер колонки и есть класс. */
    slider: appSidebarLeft,
    async openTab<T extends SliderSuperTab>(ctor: SliderSuperTabConstructable<T>, ...args: Parameters<T['init']>): Promise<T> {
      const tab = appSidebarLeft.createTab(ctor)
      await tab.open(...args)
      return tab
    },
    destroy() {
      appSidebarLeft.closeAllTabs()
      appNavigationController.spliceItems(0, Infinity)
      mainEl.append(...detached)
      returnToStaticMarkup(column)
    },
  }
}
