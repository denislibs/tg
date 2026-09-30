// Правая колонка для компонентных тестов: статичный `#column-right` (как
// рисует `App.tsx`), синглтон `AppSidebarRight` и вкладка №0 активного чата.
// Нужна экранам, которые открывают колонку классом (мост `useRightColumnShown`,
// будущие вкладки `appSidebarRight.createTab(…).open()`): без синглтона их
// обработчики обращаются к пустой привязке, как в приложении до монтирования шелла.
import appNavigationController from '@core/navigation/appNavigationController'
import { createAppSidebarRight } from '@components/sidebarRight'
import type { Managers } from '../client/bootstrap'

export function installSidebarRight(managers = {} as Managers) {
  const column = document.createElement('div')
  column.id = 'column-right'
  column.className = 'tabs-tab sidebar sidebar-right main-column'
  const slider = document.createElement('div')
  slider.className = 'sidebar-content sidebar-slider tabs-container'
  column.append(slider)
  document.body.append(column)

  const sidebar = createAppSidebarRight()
  sidebar.construct(managers)
  sidebar.replaceSharedMediaTab(sidebar.createSharedMediaTab())

  return {
    sidebar,
    column,
    slider,
    dispose() {
      sidebar.destroy()
      appNavigationController.spliceItems(0, Infinity)
      column.remove()
    },
  }
}
