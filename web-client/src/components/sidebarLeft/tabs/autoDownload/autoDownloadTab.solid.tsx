/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/autoDownload/autoDownloadTab.tsx:1-22
 * (812502980) 1:1 — тонкая Solid-обёртка вкладки автозагрузки: на монтировании
 * отдаёт императивному `build` саму eventable-вкладку, секции тот кладёт в
 * `tab.scrollable` сам (`photo`/`video`/`file.solid.tsx`).
 *
 * Расширение `.solid.tsx` без JSX — маска рантаймов (`shared/solid/fileRuntime.ts`),
 * как у `checkboxFieldTsx.solid.tsx`.
 */
import { onMount, type Component } from 'solid-js'
import type { SliderSuperTabEventable } from '@components/sliderTab'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'

/**
 * Thin Solid wrapper for an auto-download sub-tab: builds its section(s) on
 * mount with the eventable tab instance (the parent dataAndStorage tab listens
 * for this tab's `destroy` event to refresh its subtitles).
 */
const autoDownloadTab = (build: (tab: SliderSuperTabEventable) => void): Component => {
  return () => {
    const [tab] = useSuperTab()

    onMount(() => {
      build(tab as SliderSuperTabEventable)
    })

    return null
  }
}

export default autoDownloadTab
