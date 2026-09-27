/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/privacy/privacyTab.tsx:1-24 (812502980)
 * дословно — фабрика Solid-компонента вкладки правила приватности: сам компонент
 * ничего не рисует, на монтировании вешает на вкладку классы `privacy-tab` + свой
 * и отдаёт eventable-вкладку в `build`, который дописывает в её скроллер
 * императивные `PrivacySection` (они пишут правило на `destroy` вкладки).
 */
import { onMount, type Component } from 'solid-js'
import type { SliderSuperTabEventable } from '@components/sliderTab'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'

const privacyTab = (containerClass: string, build: (tab: SliderSuperTabEventable) => void): Component => {
  return () => {
    const [tab] = useSuperTab()

    onMount(() => {
      tab.container.classList.add('privacy-tab', containerClass)
      build(tab as SliderSuperTabEventable)
    })

    return null
  }
}

export default privacyTab
