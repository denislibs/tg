/**
 * ВРЕМЕННЫЙ МОСТ (снимается задачей 2D-23): React-экран настроек вкладкой
 * колоночного слайдера.
 *
 * Корень настроек — Solid-вкладка `AppSettingsTab` (задача 2D-28), а его
 * последний не портированный подэкран существует только React-компонентом на
 * React-ките `settings/kit.tsx`: «Конфиденциальность» (2D-23); «Стикеры и
 * эмодзи» (2D-15), «Динамики и камера» (2D-26) и «Редактировать профиль»
 * (2D-27) уже Solid. Строка Solid-корня обязана открывать его так же, как у tweb, —
 * `tab.slider.createTab(AppXxxTab).open()`. Поэтому классы вкладок заведены под
 * именами оригинала в `solidJsTabs/tabs.ts`, а их содержимое до порта рисует
 * этот мост: вкладка слайдера, в которой вместо Solid-острова — React-корень
 * старого экрана. Задача порта меняет в `tabs.ts` ОДНУ строку —
 * `scaffoldReactScreenTab` на `scaffoldSolidJSTab` — и удаляет React-экран;
 * вызывающие не меняются.
 *
 * Это обратный мост (React внутри Solid-дерева настроек), которого план 2D не
 * заводил: корень переехал раньше своих листьев, потому что колоночный слайдер
 * нужен волне 7 (этап 0а). Форма моста — та же, что у острова инстанса чата
 * волны 7 (React-корень внутри класса, Э4-3): узлом вкладки владеет слайдер,
 * содержимым — React-корень, который вкладка снимает сама на
 * `onCloseAfterTimeout` (как Solid-остров у `scaffoldSolidJSTab`).
 *
 * Каркас экрана (шапка со стрелкой, скроллер, вложенные саб-экраны) остаётся
 * киту: `SettingsScreen` рисует свой `.tabs-container > .tabs-tab`. Поэтому
 * шапка и `.sidebar-content` самой вкладки из её узла вынимаются, а свой
 * въезд кит глушит по `InSliderContext` — въезд и выезд даёт слайдер.
 */
import type { ComponentType } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import SliderSuperTab from '@components/sliderTab'
import { ManagersProvider } from '@core/hooks/useManagers'
import { InSliderContext } from '@components/settings/kit'
import s from './reactScreenTab.module.scss'

export type ReactScreenTabProps = {
  /** вкладка-хозяин: экран открывает следующие вкладки её `slider`, как tweb */
  tab: SliderSuperTab
  /** стрелка «назад» кита закрывает вкладку — тем же путём, что Esc */
  onBack: () => void
}

type ReactScreenTabClass = (new (...args: ConstructorParameters<typeof SliderSuperTab>) => SliderSuperTab & {
  init(): Promise<void>
})

export function scaffoldReactScreenTab({
  getComponentModule,
}: {
  getComponentModule: () => Promise<{ default: ComponentType<ReactScreenTabProps> }>
}): ReactScreenTabClass {
  return class extends SliderSuperTab {
    private root?: Root

    public async init() {
      const { default: Screen } = await getComponentModule()

      const host = document.createElement('div')
      host.classList.add(s.host)
      this.container.replaceChildren(host)

      this.root = createRoot(host)
      // Синхронно — как `mountSolid` у Solid-вкладки: слайдер начинает въезд
      // сразу после `init`, и вкладка не должна въехать пустой.
      flushSync(() => {
        this.root!.render(
          <ManagersProvider managers={this.managers!}>
            <InSliderContext.Provider value>
              <Screen tab={this} onBack={() => this.close()} />
            </InSliderContext.Provider>
          </ManagersProvider>,
        )
      })
    }

    protected onCloseAfterTimeout() {
      this.root?.unmount()
      this.root = undefined
      super.onCloseAfterTimeout()
    }
  }
}
