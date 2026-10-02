// Левая колонка для тестов: разметка tweb `index.html:89-107` (та же, что
// рисует `components/Sidebar.tsx` — `.sidebar-slider.tabs-container >
// .item-main.active > .sidebar-header` с бургером и `.sidebar-content >
// #chatlist-container > .connection-status-bottom` + `#search-container`),
// оверлей `.sidebar-left-overlay` шелла и синглтон `AppSidebarLeft` на ней.
// `construct` колонки зовёт владелец списка (`appDialogsManager.start`, tweb
// `appDialogsManager.ts:983`) — ему нужна разметка целиком (`full`); тестам
// вкладок, которым нужен только слайдер, — `.item-main` без шапки и списка
// (иначе их запросы `.sidebar-header` попадали бы в шапку колонки). `openTab` —
// `createTab(…).open(…)` одним вызовом, промис разрешается, когда содержимое
// вкладки готово.
import { createAppSidebarLeft } from '@components/sidebarLeft'
import type SliderSuperTab from '@components/sliderTab'
import type { SliderSuperTabConstructable } from '@components/sliderTab'
import type { Managers } from '../client/bootstrap'

/** Разметка колонки tweb `index.html:89-107`, без класса. */
export function mountLeftColumn(columnEl: HTMLElement = document.createElement('div'), full = true) {
  const overlay = document.createElement('div')
  overlay.className = 'sidebar-left-overlay'

  columnEl.id = 'column-left'
  columnEl.classList.add('tabs-tab', 'chatlist-container', 'sidebar', 'sidebar-left', 'main-column')
  const sliderEl = document.createElement('div')
  sliderEl.className = 'sidebar-slider tabs-container'
  const mainEl = document.createElement('div')
  mainEl.className = 'tabs-tab sidebar-slider-item item-main active'
  const header = document.createElement('div')
  header.className = 'sidebar-header main-search-sidebar-header'
  const buttons = document.createElement('div')
  buttons.className = 'sidebar-header__btn-container left-sidebar-burger'
  const menuIcon = document.createElement('div')
  menuIcon.className = 'animated-menu-icon'
  const backBtn = document.createElement('div')
  backBtn.className = 'btn-icon sidebar-back-button'
  buttons.append(menuIcon, backBtn)
  header.append(buttons)
  const content = document.createElement('div')
  content.className = 'sidebar-content transition zoom-fade'
  const chatlistContainer = document.createElement('div')
  chatlistContainer.id = 'chatlist-container'
  chatlistContainer.className = 'transition-item active'
  const host = document.createElement('div')
  host.className = 'connection-status-bottom'
  chatlistContainer.append(host)
  const searchContainer = document.createElement('div')
  searchContainer.id = 'search-container'
  searchContainer.className = 'transition-item sidebar-search'
  content.append(chatlistContainer, searchContainer)
  if(full) mainEl.append(header, content)
  sliderEl.append(mainEl)
  columnEl.append(sliderEl)

  if(!columnEl.isConnected) document.body.append(columnEl)
  document.body.prepend(overlay)

  return { column: columnEl, sliderEl, mainEl, header, backBtn, chatlistContainer, host, searchContainer, overlay }
}

export type InstalledSidebarLeft = ReturnType<typeof installSidebarLeft>

/**
 * `columnEl` — узел, который тест уже положил в документ (вкладки рисуют в
 * него), иначе заводится свой.
 */
export function installSidebarLeft(managers = {} as Managers, columnEl?: HTMLElement, { full = false } = {}) {
  const dom = mountLeftColumn(columnEl, full)
  const sidebar = createAppSidebarLeft()
  // без `construct` вкладкам нужен только реестр менеджеров (tweb `slider.ts:270`)
  ;(sidebar as unknown as { managers: Managers }).managers = managers

  return {
    ...dom,
    sidebar,
    /** Совместимое имя для тестов вкладок: слайдер колонки и есть класс. */
    slider: sidebar,
    async openTab<T extends SliderSuperTab>(ctor: SliderSuperTabConstructable<T>, ...args: Parameters<T['init']>): Promise<T> {
      const tab = sidebar.createTab(ctor)
      await tab.open(...args)
      return tab
    },
    destroy() {
      sidebar.destroy()
      dom.sliderEl.remove()
      dom.overlay.remove()
    },
  }
}
