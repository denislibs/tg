/**
 * Порт tweb/src/components/sidebarRight/index.ts:1-143 (812502980) —
 * `AppSidebarRight`, класс правой колонки: слайдер вкладок на статичном
 * `#column-right` и единственный писатель `body.is-right-column-shown`.
 *
 * Как открыть вкладку правой колонки — ровно как у tweb (`sharedMedia.tsx:674-702`,
 * `emoticonsDropdown/index.ts:301-308`, `stickers.tsx:215`, `gifs.tsx:109`):
 *
 *     appSidebarRight.createTab(AppXxxTab).open(payload)
 *     appSidebarRight.toggleSidebar(true)   // если колонка могла быть закрыта
 *
 * `open` кладёт вкладку поверх истории слайдера (Back/Esc снимают её по
 * одной), `toggleSidebar(true)` при непустой истории вкладку профиля не
 * трогает. Из React зовётся тем же текстом в обработчике события: `import
 * appSidebarRight from '@components/sidebarRight'`.
 *
 * Расхождения с оригиналом (все временные, с номером задачи, которая снимает):
 *  1. (снято на К-2) Синглтон создаётся при импорте, как у tweb (`:141`), над
 *     статичным `#column-right` из `index.html`.
 *  2. ВРЕМЕННО до 3-1. Вкладка «общих медиа» — `AppReactProfileTab`
 *     (`reactProfileTab.ts`, хост React-панели `UserInfoPanel`), а не
 *     `AppSharedMediaTab`. `replaceSharedMediaTab` зовёт `Chat.tsx`, когда
 *     инстанс становится активным (порт смысла `chat.ts:1239-1242`,
 *     `appImManager.ts:3277`) — ВРЕМЕННО до Э6.
 *  3. ВРЕМЕННО до Э4-2. `appImManager.selectTab(active ? CHAT : PROFILE,
 *     animate)` (`:125`) — класса нет, строка зовёт срез его тела
 *     `selectProfileTab` (`core/navigation/chatHistory.ts`).
 *  4. `sharedMediaTab` объявлен необязательным (строгие типы: до первого
 *     `replaceSharedMediaTab` его нет и у оригинала); `toggleSidebar` обращается
 *     к нему с `!` — там, где оригинал обращается напрямую.
 */
import SidebarSlider, { SliderSuperTab } from '@components/slider'
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import AppReactProfileTab from '@components/sidebarRight/reactProfileTab'
import { MOUNT_CLASS_TO } from '@config/debug'
import type { Managers } from '../../client/bootstrap'
import appNavigationController from '@core/navigation/appNavigationController'
import rootScope from '@lib/rootScope'
import { installColumnWidthsUpdater } from '@core/dom/updateColumnWidths'
import installColumnResize from '@core/dom/installColumnResize'
import animationIntersector from '@components/animationIntersector'
import { selectProfileTab } from '@core/navigation/chatHistory'

export const RIGHT_COLUMN_ACTIVE_CLASSNAME = 'is-right-column-shown'

export class AppSidebarRight extends SidebarSlider {
  public sharedMediaTab?: AppReactProfileTab

  constructor() {
    super({
      sidebarEl: document.getElementById('column-right') as HTMLElement,
      canHideFirst: true,
      navigationType: 'right',
    })

    this.sidebarEl.inert = !document.body.classList.contains(RIGHT_COLUMN_ACTIVE_CLASSNAME)
  }

  construct(managers: Managers) {
    this.managers = managers

    mediaSizes.addEventListener('changeScreen', (from, to) => {
      if(to === ScreenSize.medium && from !== ScreenSize.mobile) {
        void this.toggleSidebar(false)
      }
    })

    installColumnWidthsUpdater()
    installColumnResize({ columnEl: this.sidebarEl, side: 'right' })
  }

  public createSharedMediaTab() {
    const tab = this.createTab(AppReactProfileTab, false, true)
    tab.slider = this
    // this.tabsContainer.prepend(tab.container);
    return tab
  }

  public replaceSharedMediaTab(tab?: AppReactProfileTab) {
    const previousTab = this.sharedMediaTab
    if(previousTab) {
      const idx = this.historyTabIds.indexOf(previousTab)

      if(this._selectTab.getFrom() === previousTab.container) {
        this._selectTab.setFrom(tab?.container)
      }

      if(tab) {
        if(idx !== -1) {
          this.historyTabIds[idx] = tab
        }

        const wasActive = previousTab.container.classList.contains('active')
        if(wasActive) {
          tab.container.classList.add('active')
        }

        previousTab.container.replaceWith(tab.container)
      } else {
        if(idx !== -1) {
          this.historyTabIds.splice(idx, 1)
        }

        previousTab.container.remove()
      }
    } else if(tab) {
      // both undefined means there is nothing to remove and nothing to mount — reaching for
      // `tab.container` here threw, and the throw aborted whatever peer change was running
      this.tabsContainer.prepend(tab.container)
    }

    this.sharedMediaTab = tab
  }

  public onCloseTab(id: number | SliderSuperTab | undefined, animate?: boolean, isNavigation?: boolean) {
    if(!this.historyTabIds.length) {
      void this.toggleSidebar(false, animate)
    }

    super.onCloseTab(id, animate, isNavigation)
  }

  public hide() {
    this.sidebarEl.inert = true
    document.body.classList.remove(RIGHT_COLUMN_ACTIVE_CLASSNAME)
    appNavigationController.removeByType('right')
    // The column is hidden with a transform (stays mounted), so pause any video
    // avatars playing inside it — the IntersectionObserver won't catch the move.
    animationIntersector.toggleVideosUnder(this.sidebarEl, true)
    rootScope.dispatchEventSingle('right_sidebar_toggle', false)
  }

  public toggleSidebar(enable?: boolean, animate?: boolean) {
    const active = document.body.classList.contains(RIGHT_COLUMN_ACTIVE_CLASSNAME)
    let willChange: boolean | undefined
    if(enable !== undefined) {
      if(enable) {
        if(!active) {
          willChange = true
        }
      } else if(active) {
        willChange = true
      }
    } else {
      willChange = true
    }

    if(!willChange) return Promise.resolve()

    if(!active && !this.historyTabIds.length) {
      void this.sharedMediaTab!.open()
    }

    const animationPromise = selectProfileTab(animate) // ВРЕМЕННО до Э4-2 — appImManager.selectTab(active ? APP_TABS.CHAT : APP_TABS.PROFILE, animate)
    if(!enable) this.hide()
    else {
      document.body.classList.add(RIGHT_COLUMN_ACTIVE_CLASSNAME)
      this.sidebarEl.inert = false
      if(!appNavigationController.findItemByType('right')) {
        this.pushNavigationItem(this.sharedMediaTab)
      }
      // Resume video avatars paused by a previous hide() (see toggleVideosUnder).
      animationIntersector.toggleVideosUnder(this.sidebarEl, false)
      rootScope.dispatchEventSingle('right_sidebar_toggle', true)
    }
    return animationPromise
  }
}

const appSidebarRight = new AppSidebarRight()
MOUNT_CLASS_TO.appSidebarRight = appSidebarRight
export default appSidebarRight
