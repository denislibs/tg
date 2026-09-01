/**
 * Хост слайдера вкладок левой колонки: заводит `SidebarSlider`
 * (`components/slider.ts`, порт tweb `components/slider.ts`) над разметкой
 * `#column-left` и отдаёт наружу ровно две ручки — открыть вкладку и умереть.
 *
 * ── ШОВ С REACT (временный, снимается задачей #112) ────────────────────────
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
 *    её слайдеру как `sidebarEl`. Сам `SettingsSliderPopup` (настройки
 *    попапом поверх чата — форма оригинала для узкой колонки) не портирован
 *    (#112): у нас нет ни его вызывающего, ни экрана, который его открывает.
 *  • ЗАГЛУШКА на месте вкладки-корня — пустой `div.tabs-tab` первым ребёнком.
 *    Слайдер выбирает вкладку №0 в конструкторе (`slider.ts::constructor`,
 *    tweb :46-48), а переход `navigation` двигает ОБЕ вкладки сразу (`slideNavigation`,
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
 *    класса спорил бы с ним. Хук `onTabsCountChange` занят другим — слоем шва.
 *
 * ── Что хост делает СВЕРХ оригинала (#112) ─────────────────────────────────
 * `SidebarSlider.destroy()` — метода нет в tweb, и это следствие ровно того же
 * шва: слайдеры оригинала живут столько же, сколько приложение
 * (`SettingsSliderPopup` тоже лишь закрывает вкладки —
 * `settingsSliderPopup.ts:23-27`, потому что и он переживает своё содержимое),
 * а наш заводится и умирает вместе с React-экраном настроек. Пока экран
 * умирает, вкладка может лететь за своим чанком — см. комментарий у
 * `destroy()` ниже. С переездом корня настроек во вкладку слайдер снова станет
 * вечным, и `destroy()` уйдёт вместе со швом.
 *
 * ДОЛГ (#112, не закрыт и здесь): способа снять ВСЕ слои навигации слайдера
 * разом у нас нет — в оригинале это делают снаружи по типу записи
 * (`sidebarRight/index.ts:95` — `removeByType('right')` в `hide()`, :128 —
 * `findItemByType`). Хосту он не понадобился: `closeAllTabs()` закрывает
 * вкладки по одной, и каждая снимает свой слой сама (`slider.ts::onCloseTab`).
 */
import SidebarSlider from '@components/slider'
import type SliderSuperTab from '@components/sliderTab'
import type { SliderSuperTabConstructable } from '@components/sliderTab'
import { AppActiveSessionsTab } from '@components/solidJsTabs/tabs'
import type { Authorization } from '@layer'
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
      // `slider.destroy()` = `closeAllTabs()` + гашение миддлвари слайдера.
      // Закрываем силой, а не `closeAllTabsNaturally`: экран-владелец уже
      // уходит, спрашивать подтверждение не у кого и некогда. Тот же выбор в
      // оригинале — `settingsSliderPopup.ts:25` (`closeAllTabs` на разрушении
      // попапа). Гашение миддлвари — сверх оригинала (#112): `closeAllTabs`
      // ходит по `historyTabIds`, а вкладка попадает туда только в `selectTab`,
      // то есть ПОСЛЕ `await init()`; вкладка, уходящая в этот момент за своим
      // чанком, оказалась бы вне досягаемости и открылась бы уже на мёртвом
      // слайдере — со своим слоем навигации, Esc-обработчиком и неразобранным
      // Solid-островом.
      slider.destroy()
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
 * порядком идёт и ВТОРОЙ вход оригинала — `onDevicesClick`
 * (`sidebarLeft/tabs/settings.tsx:178-189`), но это ОТДЕЛЬНАЯ реализация: сам
 * `openActiveSessions` в tweb ровно с одним вызывающим (`newAuthorization
 * .tsx:126`), общего места на два входа у оригинала нет.
 *
 * Общее место завели МЫ, и мотивировка своя: у нас входов тоже два
 * («Устройства» в корне настроек и «Активные сессии» в разделе
 * конфиденциальности), но оба — React-строки шва (#112), которым нечего
 * наследовать друг у друга, а последовательность «сначала список, потом
 * вкладка» обязана быть одна на оба: разъехавшись, второй вход открыл бы
 * вкладку пустой. Когда корень настроек станет вкладкой, эта функция
 * растворится в её `onDevicesClick`, как в оригинале.
 *
 * `authorizations` МОЖНО ОТДАТЬ ГОТОВЫМИ, и это тоже порт: у оригинала список
 * лежит у корня настроек (`settings.tsx:149`, наполняет `updateActiveSessions`),
 * а `onDevicesClick` перезапрашивает его ТОЛЬКО если списка ещё нет (:179-181).
 * Без этого счётчик устройств в строке и открытие вкладки давали бы ДВА запроса
 * подряд на одну и ту же ручку.
 *
 * `onDestroy` — порт подписки `subTab.eventListener('destroy')` (:184-187): у
 * оригинала она сбрасывает список и перечитывает счётчик, потому что во вкладке
 * сессию могли завершить. До появления счётчика (#112, пункт 5) подписывать её
 * было не на что; теперь есть.
 */
export async function openActiveSessionsTab(
  managers: Managers,
  options: {
    /** уже полученный список — если есть, ручка не дёргается второй раз */
    authorizations?: Authorization.authorization[]
    /** вкладка закрыта: список протух, счётчик перечитать (tweb :185-186) */
    onDestroy?: () => void
  } = {},
): Promise<void> {
  // Хост берётся ДО запроса, а не после: в оригинале на его месте модульный
  // синглтон `appSidebarLeft` (`newAuthorization.tsx:118`), который никогда не
  // умирает, — снимок ссылки и есть ближайший аналог. Практическая разница
  // ровно одна и она нужна: если экран настроек закроют, пока летит
  // `sessions.list()`, `getSettingsSliderHost()` по факту ответа уже бросил бы,
  // и вызывающий показал бы всплывашку об ошибке на ЧУЖОМ экране, хотя ничего
  // не сломалось. Со снимком запрос доезжает до мёртвого хоста и тихо гаснет о
  // предохранитель `slider.selectTab`.
  const host = getSettingsSliderHost()
  const authorizations = options.authorizations ?? await managers.sessions.list()
  const tab = await host.openTab(AppActiveSessionsTab, { authorizations })
  if(options.onDestroy) {
    tab.eventListener.addEventListener('destroy', options.onDestroy, { once: true })
  }
}
