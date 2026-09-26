/**
 * `tab.slider.sliceTabsUntilTab(AppSettingsTab, tab)` мастера 2FA (tweb
 * `2fa/index.tsx:34`, `2fa/passwordSet.tsx:23`) — срез истории до корня
 * настроек, чтобы «назад» с финального шага вело в настройки, а не обратно по
 * шагам мастера.
 *
 * ШОВ (снимается задачей 28 плана 2D): вкладки `AppSettingsTab` у нас нет —
 * корень настроек и «Конфиденциальность» ещё React под слоем хоста
 * (`sidebarLeft/settingsSliderHost.ts`), в истории слайдера их нет, и
 * `sliceTabsUntilTab` оригинала не встретил бы, где остановиться. Срез идёт до
 * корня хоста — это тот же `sliceTabsUntilTab` без вкладки-упора. Разница видна
 * одна: закрытие последнего шага открывает «Конфиденциальность» (React-экран
 * под хостом), а не корень настроек. С задачей 28 файл уходит, вызывающие
 * зовут `sliceTabsUntilTab(AppSettingsTab, tab)` дословно.
 */
import type SidebarSlider from '@components/slider'
import type SliderSuperTab from '@components/sliderTab'

export default function sliceTabsUntilSettings(tab: SliderSuperTab) {
  const slider = tab.slider as SidebarSlider
  const history = slider.getHistory()
  for(let i = history.length - 1; i >= 0; --i) {
    const t = history[i]
    if(t === tab) continue
    slider.removeTabFromHistory(t)
  }
}
