/**
 * Колоночный слайдер для тестов вкладок левой колонки — тот же
 * `createColumnSlider`, что заводит `Sidebar.tsx`, на разметке tweb
 * `index.html:91-99` (`.sidebar-slider.tabs-container > .tabs-tab
 * .sidebar-slider-item.item-main.active`). Вкладки открываются так же, как из
 * продукта: `slider.createTab(AppXxxTab).open(…)`; `openTab` — эта пара одним
 * вызовом, промис разрешается, когда содержимое вкладки готово.
 */
import type { Managers } from '@/client/bootstrap'
import type SidebarSlider from '@components/slider'
import type SliderSuperTab from '@components/sliderTab'
import type { SliderSuperTabConstructable } from '@components/sliderTab'
import { createColumnSlider, destroyColumnSlider } from '@components/sidebarLeft/columnSlider'

export interface TestColumnSlider {
  slider: SidebarSlider
  /** `.item-main` — вкладка №0 */
  mainEl: HTMLElement
  openTab<T extends SliderSuperTab>(ctor: SliderSuperTabConstructable<T>, ...args: Parameters<T['init']>): Promise<T>
  destroy(): void
}

export function mountTestColumnSlider(columnEl: HTMLElement, managers: Managers): TestColumnSlider {
  const sliderEl = document.createElement('div')
  sliderEl.classList.add('sidebar-slider', 'tabs-container')
  const mainEl = document.createElement('div')
  mainEl.classList.add('tabs-tab', 'sidebar-slider-item', 'item-main', 'active')
  sliderEl.append(mainEl)
  columnEl.append(sliderEl)

  const slider = createColumnSlider(columnEl, managers)
  return {
    slider,
    mainEl,
    async openTab(ctor, ...args) {
      const tab = slider.createTab(ctor)
      await tab.open(...args)
      return tab
    },
    destroy() {
      destroyColumnSlider(slider)
      sliderEl.remove()
    },
  }
}
