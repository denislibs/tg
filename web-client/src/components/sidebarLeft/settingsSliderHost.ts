/**
 * Хост слайдера вкладок левой колонки: заводит `SidebarSlider`
 * (`components/slider.ts`, порт tweb `components/slider.ts`) над разметкой
 * `#column-left` и отдаёт наружу ровно две ручки — открыть вкладку и умереть.
 *
 * ── ШОВ С REACT (временный, объявлен явно) ─────────────────────────────────
 *
 * В tweb корень настроек — ТАКАЯ ЖЕ вкладка того же слайдера
 * (`AppSettingsTab`, `solidJsTabs/tabs.ts`), поэтому «Устройства» открываются
 * прямо из неё: `tab.slider.createTab(AppActiveSessionsTab)` →
 * `subTab.open({authorizations})` (`sidebarLeft/tabs/settings.tsx:183`, `:188`).
 * У нас корень настроек — ещё React-экран (`components/SettingsView.tsx`),
 * лежащий поверх колонки отдельным слоем; он и открывает УЖЕ портированные
 * вкладки через этот хост. По мере портирования остальных вкладок настроек шов
 * исчезает вместе с `SettingsView`: слайдер тогда переедет на существующую
 * разметку колонки, а корень настроек станет его вкладкой №0 — как в
 * оригинале.
 *
 * Из шва вытекает всё, чего нет у tweb, и больше ничего:
 *  • СВОЯ разметка `.sidebar-slider.tabs-container` вместо колоночной. В tweb
 *    `AppSidebarLeft` берёт готовую (`index.ts:142`, `sidebarEl:
 *    #column-left`); нам туда нельзя — тот `.sidebar-slider` принадлежит React
 *    (`components/Sidebar.tsx:236`) и лежит ПОД экраном настроек. Приём взят у
 *    самого tweb: `sidebarLeft/settingsSliderPopup.ts:29-42` точно так же
 *    строит себе пару `element` > `div.sidebar-slider.tabs-container` и отдаёт
 *    её слайдеру как `sidebarEl`.
 *  • ЗАГЛУШКА на месте вкладки-корня — пустой `div.tabs-tab` первым ребёнком.
 *    Слайдер выбирает вкладку №0 в конструкторе (`slider.ts:186`, tweb :47), а переход
 *    `navigation` двигает ОБЕ вкладки сразу (`slideNavigation`,
 *    `core/dom/navigationTransition.ts`): без соседа `from` не существует, и
 *    первая же вкладка появлялась бы мгновенно, без въезда справа. Заглушка —
 *    и есть тот сосед: в оригинале его роль играет вкладка настроек, у нас она
 *    живёт в React-слое ровно под этим прозрачным узлом.
 *  • СЛОЙ над колонкой (`settingsSliderHost.module.scss`) — вкладке нужно
 *    перекрыть React-экран, который в оригинале ей просто соседняя вкладка.
 *
 * Слайдер ОДИН на колонку, а не по слайдеру на открытие: слайдер владеет
 * историей вкладок, а история одна. Поэтому модуль держит текущий хост
 * синглтоном — той же формы, что `appSidebarLeft` в оригинале
 * (`sidebarLeft/index.ts`, экспорт единственного экземпляра): открывающая
 * сторона берёт хост по месту (`getSettingsSliderHost`), а не протаскивает его
 * пропами через дерево.
 *
 * ── Что хост НЕ делает, хотя `AppSidebarLeft` делает ───────────────────────
 *  • не трогает `has-open-tabs`/`setOpenTabsLeftSidebar` (tweb :618-620,
 *    `onTabsCountChange → onSomethingOpenInsideChange`): у нас признак уже
 *    взведён React'ом на всё время жизни экрана настроек
 *    (`Sidebar.tsx:162,189` — `screen !== null`), и второй писатель того же
 *    класса спорил бы с ним. Хук `onTabsCountChange` занят другим — слоем шва;
 *  • не заводит `destroy()` на самом `SidebarSlider`: его нет и в оригинале
 *    (слайдеры tweb живут вечно, `SettingsSliderPopup` тоже лишь закрывает
 *    вкладки — `settingsSliderPopup.ts:23-27`).
 *
 * ДОЛГ (задача 5, не закрыт и здесь): способа снять ВСЕ слои навигации
 * слайдера разом у нас нет — в оригинале это делают снаружи по типу записи
 * (`sidebarRight/index.ts:95` — `removeByType('right')` в `hide()`, :128 —
 * `findItemByType`). Хосту он не понадобился: `closeAllTabs()` закрывает
 * вкладки по одной, и каждая снимает свой слой сама (`slider.ts::onCloseTab`).
 */
import SidebarSlider from '@components/slider'
import type SliderSuperTab from '@components/sliderTab'
import type { SliderSuperTabConstructable } from '@components/sliderTab'
import { AppActiveSessionsTab } from '@components/solidJsTabs/tabs'
import type { Managers } from '@/client/bootstrap'
import s from './settingsSliderHost.module.scss'

export interface SettingsSliderHost {
  /**
   * `createTab` + `open` одним вызовом — та же пара, что в оригинале
   * (`settings.tsx:183` и `:188`; между ними, на `:184-187`, оригинал вешает
   * подписку на `destroy` — её предмета у нас нет, см. `openActiveSessionsTab`).
   * Промис разрешается, когда содержимое вкладки
   * готово (`scaffoldSolidJSTab.init` ждёт `promiseCollector`), то есть когда
   * вкладка действительно поехала, а не когда её попросили поехать.
   */
  openTab<T extends SliderSuperTab>(
    ctor: SliderSuperTabConstructable<T>,
    ...args: Parameters<T['init']>
  ): Promise<T>
  /** Экран-владелец умирает — вкладки обязаны умереть с ним. */
  destroy(): void
}

let currentHost: SettingsSliderHost | undefined

/**
 * @param columnEl — `#column-left`; хост вешает свой слой ему в дети.
 * @param managers — реестр ручек к воркеру; слайдер раздаёт его вкладкам
 *   (`slider.ts::createTab`, tweb :270), из него вкладка «Устройства» и зовёт
 *   `sessions.terminate`.
 */
export function createSettingsSliderHost(columnEl: HTMLElement, managers: Managers): SettingsSliderHost {
  // Один слайдер на колонку: если прежний хост не убрали за собой, он умирает
  // здесь, а не остаётся вторым владельцем истории вкладок.
  currentHost?.destroy()

  const element = document.createElement('div')
  element.classList.add(s.host)

  const sliderEl = document.createElement('div')
  sliderEl.classList.add('sidebar-slider', 'tabs-container')

  // Заглушка-корень — см. шапку файла. Без `sidebar-slider-item` намеренно:
  // этот класс носит фон вкладки, а заглушка обязана оставаться прозрачной.
  const mainEl = document.createElement('div')
  mainEl.classList.add('tabs-tab')

  sliderEl.append(mainEl)
  element.append(sliderEl)
  columnEl.append(element)

  const slider = new SidebarSlider({ sidebarEl: element, managers })

  slider.onTabsCountChange = () => {
    element.classList.toggle(s.withTabs, slider.hasTabsInNavigation())
  }

  const host: SettingsSliderHost = {
    async openTab(ctor, ...args) {
      const tab = slider.createTab(ctor)
      await tab.open(...args)
      return tab
    },

    destroy() {
      // Закрываем силой, а не `closeAllTabsNaturally`: экран-владелец уже
      // уходит, спрашивать подтверждение не у кого и некогда. Тот же выбор в
      // оригинале — `settingsSliderPopup.ts:25` (`closeAllTabs` на разрушении
      // попапа).
      slider.closeAllTabs()
      element.remove()
      if(currentHost === host) {
        currentHost = undefined
      }
    },
  }

  currentHost = host
  return host
}

/**
 * Хост для открывающей стороны. Бросает, а не молчит: обе строки, которые
 * открывают вкладки, живут внутри экрана настроек, то есть при живом хосте —
 * пустой ответ означал бы мёртвую строку меню, а не законное «нечего делать».
 * Тот же приём, что у `useManagers` (`core/hooks/useManagers.tsx`).
 */
export function getSettingsSliderHost(): SettingsSliderHost {
  if(!currentHost) {
    throw new Error('settingsSliderHost: вкладку открывают вне экрана настроек — хост не заведён')
  }

  return currentHost
}

/**
 * Открыть «Устройства» — порт `openActiveSessions` (tweb
 * `sidebarLeft/newAuthorization.tsx:116-121`): список сессий забирает
 * ОТКРЫВАЮЩИЙ и отдаёт вкладке готовым, чтобы та не въезжала пустой. Тем же
 * порядком идёт и второй вызыватель оригинала — `onDevicesClick`
 * (`sidebarLeft/tabs/settings.tsx:178-189`).
 *
 * Функция живёт здесь, а не у вызывающих, по той же причине, по какой в
 * оригинале она одна на два входа: у нас входов тоже два («Устройства» в корне
 * настроек и «Активные сессии» в разделе конфиденциальности), и оба —
 * React-строки шва.
 *
 * `eventListener('destroy')` вкладки (tweb `settings.tsx:184-187` перечитывает счётчик
 * устройств в строке настроек) не подписан намеренно: счётчика в нашей строке
 * нет — он приедет вместе с портом самой вкладки настроек.
 */
export async function openActiveSessionsTab(managers: Managers): Promise<void> {
  const authorizations = await managers.sessions.list()
  await getSettingsSliderHost().openTab(AppActiveSessionsTab, { authorizations })
}
