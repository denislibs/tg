// Правая колонка для компонентных тестов: вечный синглтон `AppSidebarRight`
// (создан при импорте над статичным `#column-right`, `test/staticMarkup.ts`) и
// вкладка №0 активного чата. Нужна экранам, которые открывают колонку классом
// (вкладки `appSidebarRight.createTab(…).open()`). Хелпер переносит колонку в
// `body` и возвращает её в статику на `dispose()`.
//
// Вкладка №0 здесь — пустая `SliderSuperTab` на месте `AppSharedMediaTab`:
// экранам нужна вкладка под ними в истории, а не профиль. Настоящая вкладка
// профиля рендерит содержимое динамическим импортом на `setPeer` (у чата —
// задолго до `toggleSidebar`), а без пира её `open()` уступил бы очередь
// открываемой вкладке. Сама вкладка профиля — `tabs/sharedMediaTab.solid.test.tsx`.
import appNavigationController from '@core/navigation/appNavigationController'
import appSidebarRight from '@components/sidebarRight'
import SliderSuperTab from '@components/sliderTab'
import type AppSharedMediaTab from '@components/sidebarRight/tabs/sharedMediaTab'
import type { Managers } from '../client/bootstrap'
import { returnToStaticMarkup } from './staticMarkup'

export function installSidebarRight(managers = {} as Managers) {
  const column = appSidebarRight.sidebarEl
  const slider = column.querySelector<HTMLElement>('.sidebar-slider')!
  document.body.append(column)

  ;(appSidebarRight as unknown as { managers: Managers }).managers = managers
  const tab = appSidebarRight.createTab(SliderSuperTab, false, true)
  tab.slider = appSidebarRight
  appSidebarRight.replaceSharedMediaTab(tab as AppSharedMediaTab)

  return {
    sidebar: appSidebarRight,
    column,
    slider,
    dispose() {
      void appSidebarRight.toggleSidebar(false)
      appSidebarRight.closeAllTabs()
      appSidebarRight.replaceSharedMediaTab(undefined)
      // закрытые вкладки снимаются с узла отложенно — следующему тесту нужен пустой слайдер
      slider.replaceChildren()
      appNavigationController.spliceItems(0, Infinity)
      returnToStaticMarkup(column)
    },
  }
}
