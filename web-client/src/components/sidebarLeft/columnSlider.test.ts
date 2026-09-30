/**
 * Тесты колоночного слайдера (`columnSlider.ts`). Гоняют НАСТОЯЩИЙ
 * `SidebarSlider` на разметке колонки tweb (`index.html:91-99`) с НАСТОЯЩЕЙ
 * вкладкой «Устройства» на реальном DOM (happy-dom): замокан ровно один шов —
 * менеджеры, то есть граница с воркером.
 *
 * Почему вкладка настоящая, а не пустышка: главный вопрос этих тестов — «когда
 * умирает колонка, умирает ли ВСЁ, что вкладка успела развесить». Часть
 * этого «всего» лежит ВНЕ колонки: минутный опрос списка сессий вкладка
 * заводит на монтировании и снимает в `onCleanup` своего Solid-острова
 * (`activeSessions.solid.tsx`). Пустышка про этот путь ничего не скажет, а
 * проверка «узел вкладки исчез из колонки» одинаково зелена и когда вкладку
 * разрушили, и когда просто выкинули поддеревом — ровно на этом в волне 0
 * оказался пустым тест того же класса.
 *
 * Таймеры настоящие: закрытие вкладки идёт по цепочке отложенных шагов
 * (переход 250мс → `onCloseAfterTimeout` 280мс), а внутри ещё живёт Solid со
 * своими микрозадачами. `settle()` ниже ждёт всю цепочку целиком.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Здесь строятся узлы `i18n()`. Строки в ядро кладёт холодный старт (`main.tsx` →
// `client/boot.ts` дожидается пакета до первого рендера), а в прогоне — общий сетап
// (`src/test/setup.ts`); на пустом ядре узел напечатал бы имя ключа.
import type { Authorization } from '@layer'
import type { Managers } from '@/client/bootstrap'
import appNavigationController from '@core/navigation/appNavigationController'
import type SidebarSlider from '@components/slider'
import { AppActiveSessionsTab } from '@components/solidJsTabs/tabs'
import {
  createColumnSlider,
  destroyColumnSlider,
  getColumnSlider,
  openActiveSessionsTab,
} from './columnSlider'

type Auth = Authorization.authorization

// Те же конструкторы, что шлёт бэкенд (`internal/domain/mtaccount.go`): даты в
// секундах, `pFlags` объектом у каждой строки, адрес текущей сессии — ноль.
const baseAuth = {
  _: 'authorization',
  device_model: 'Chrome',
  platform: 'browser',
  system_version: 'macOS',
  api_id: 0,
  app_name: 'Telegram Web',
  app_version: '1.0',
  date_created: 1_700_000_000,
  date_active: 1_700_000_100,
  ip: '1.2.3.4',
  country: 'Germany',
  region: '',
} as Omit<Auth, 'pFlags' | 'hash'>

const current = { ...baseAuth, hash: 0, pFlags: { current: true } } as Auth
const other = { ...baseAuth, hash: 2, pFlags: {}, app_name: 'Telegram Android' } as Auth

function makeManagers(authorizations: Auth[] = [current, other]) {
  const list = vi.fn<() => Promise<Auth[]>>(async() => authorizations)
  return {
    list,
    managers: {
      sessions: { list, terminate: vi.fn(), terminateOthers: vi.fn() },
    } as unknown as Managers,
  }
}

/** Разметка колонки tweb: `.sidebar-slider.tabs-container > .item-main.active`. */
function createColumn() {
  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  const sliderEl = document.createElement('div')
  sliderEl.classList.add('sidebar-slider', 'tabs-container')
  const mainEl = document.createElement('div')
  mainEl.classList.add('tabs-tab', 'sidebar-slider-item', 'item-main', 'active')
  sliderEl.append(mainEl)
  columnEl.append(sliderEl)
  document.body.append(columnEl)
  return columnEl
}

const sliderElOf = (columnEl: HTMLElement) => columnEl.querySelector<HTMLElement>('.sidebar-slider')!

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Переход (250) + разрушение вкладки (280) + запас. */
const settle = () => pause(400)

/**
 * Опрос списка сессий, который вкладка заводит ВНЕ колонки — минутный
 * `setInterval` (tweb `activeSessions.tsx:110-111`). Снять его может только
 * `onCleanup` Solid-острова, то есть фактический `dispose()` из
 * `onCloseAfterTimeout`. Шпионы — сквозные: таймеры остаются настоящими.
 */
function trackPoll() {
  const set = vi.spyOn(globalThis, 'setInterval')
  const clear = vi.spyOn(globalThis, 'clearInterval')
  const pollId = () => {
    const index = set.mock.calls.findIndex(([, ms]) => ms === 60e3)
    return index === -1 ? undefined : set.mock.results[index].value
  }
  return {
    started: () => pollId() !== undefined,
    stopped: () => clear.mock.calls.some(([id]) => id === pollId()),
  }
}

let columnEl: HTMLElement
let sliders: SidebarSlider[]

beforeEach(() => {
  sliders = []
  columnEl = createColumn()
})

afterEach(async() => {
  // Слои навигации и Esc — модульные синглтоны: недобитый слайдер достался бы
  // следующему тесту вместе со своими записями.
  for(const slider of sliders) {
    destroyColumnSlider(slider)
  }

  await settle()
  document.body.replaceChildren()
  // шпионы таймеров `trackPoll` — сквозные, но их счёт не должен перетекать в следующий тест
  vi.restoreAllMocks()
})

function createSlider(managers: Managers, onTabsCountChange?: () => void) {
  const slider = createColumnSlider(columnEl, managers, onTabsCountChange)
  sliders.push(slider)
  return slider
}

/** `createTab` + `open` — как строки колонки и вкладок. */
async function openSessions(slider: SidebarSlider) {
  const tab = slider.createTab(AppActiveSessionsTab)
  await tab.open({ authorizations: [current, other] })
  return tab
}

describe('columnSlider — слайдер на разметке левой колонки', () => {
  it('вкладка встаёт соседом .item-main в колоночный .sidebar-slider, с item-secondary и записью навигации left', async() => {
    const { managers } = makeManagers()
    const slider = createSlider(managers)
    const sliderEl = sliderElOf(columnEl)
    const mainEl = sliderEl.querySelector('.item-main')!

    // Вкладка №0 — список чатов колонки (tweb `slider.ts:46-48`).
    expect(mainEl.classList.contains('active')).toBe(true)
    expect(slider.hasTabsInNavigation()).toBe(false)

    const tab = await openSessions(slider)

    expect(tab.container.parentElement).toBe(sliderEl)
    expect(tab.container.previousElementSibling).toBe(mainEl)
    // tweb `AppSidebarLeft.addTab` (:1748-1753)
    expect(tab.container.classList.contains('item-secondary')).toBe(true)
    expect(mainEl.classList.contains('item-secondary')).toBe(false)
    expect(tab.container.classList.contains('active')).toBe(true)
    // `navigationType: 'left'` — как колонка tweb (`sidebarLeft/index.ts:150`)
    expect(appNavigationController.findItemByType('left')).toBeDefined()
    expect(slider.hasTabsInNavigation()).toBe(true)
  })

  it('onTabsCountChange зовётся на открытии и закрытии — колонка пересчитывает has-open-tabs', async() => {
    const { managers } = makeManagers()
    const counts: boolean[] = []
    const slider: SidebarSlider = createSlider(managers, () => counts.push(slider.hasTabsInNavigation()))

    const tab = await openSessions(slider)
    expect(counts[counts.length - 1]).toBe(true)

    tab.close()
    expect(counts[counts.length - 1]).toBe(false)
  })

  it('размонтирование колонки уничтожает открытые вкладки', async() => {
    const { managers } = makeManagers()
    const slider = createSlider(managers)
    const poll = trackPoll()

    const tab = await openSessions(slider)
    const middleware = tab.middlewareHelper.get()
    // Вкладка успела развесить своё ВНЕ колонки — иначе проверка ниже
    // проходила бы и на неразобранном Solid-острове.
    expect(poll.started()).toBe(true)
    expect(poll.stopped()).toBe(false)
    expect(middleware()).toBe(true)

    destroyColumnSlider(slider)
    await settle()

    // Узел вкладки снят ЕЮ САМОЙ (`SliderSuperTab.onCloseAfterTimeout`), а не
    // выброшен вместе с поддеревом: у него нет родителя вовсе.
    expect(tab.container.parentElement).toBeNull()
    // Solid-остров разобран: `onCleanup` вкладки погасил её опрос.
    expect(poll.stopped()).toBe(true)
    // Миддлварь вкладки погашена — поздний ответ воркера в мёртвую вкладку не пишет.
    expect(middleware()).toBe(false)
    // Разметка колонки — React'а: слайдер её не трогает, остаётся одна `.item-main`.
    expect(sliderElOf(columnEl).children).toHaveLength(1)
  })

  it('вкладка, уходившая за своим чанком, не переживает свой экран', async() => {
    // Боевой дефект финального ревью волны 2: `closeAllTabs()` ходит по
    // `historyTabIds`, а вкладка попадает туда только в `selectTab`, то есть
    // ПОСЛЕ `await init()`. Между `createTab` и `selectTab` лежат динамический
    // импорт чанка вкладки и ожидание данных — уйти успевают. Сценарий:
    // настройки → «Устройства» → выход из аккаунта до того, как доехал чанк.
    const { managers } = makeManagers()
    const slider = createSlider(managers)
    const poll = trackPoll()

    // Ждать НЕЛЬЗЯ: весь смысл в том, что колонка уходит ВНУТРИ этого промиса.
    const tab = slider.createTab(AppActiveSessionsTab)
    const opening = tab.open({ authorizations: [current, other] })
    destroyColumnSlider(slider)

    await opening
    await settle()

    // Solid-остров разобран: если он успел смонтироваться, `onCleanup` погасил опрос.
    expect(!poll.started() || poll.stopped()).toBe(true)
    expect(tab.container.parentElement).toBeNull()
    expect(sliderElOf(columnEl).children).toHaveLength(1)

    // Esc не съеден осиротевшим обработчиком мёртвой вкладки: запись контроллера
    // снята вместе с ней, событию некому гасить `defaultPrevented`
    // (задача chat-navigation-im-3 сняла прежний прокси-сигнал через `escFallback`
    // хоткеев — наблюдаем напрямую факт `cancelEvent` контроллера).
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)

    // И Back тоже: записи истории у ненайденной вкладки быть не должно, иначе
    // первое нажатие «назад» после этого уходит в никуда.
    let backsToApp = 0
    appNavigationController.pushItem({ type: 'chat', onPop: () => { ++backsToApp } })
    await pause(20) // запись истории доезжает очередью мутаций
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(backsToApp).toBe(1)
  })

  it('destroy отпускает Esc: следующее нажатие достаётся приложению, а не мёртвой вкладке', async() => {
    const { managers } = makeManagers()
    const slider = createSlider(managers)

    await openSessions(slider)

    destroyColumnSlider(slider)
    await settle()

    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(e)
    // Запись `esg` мёртвой вкладки снята — гасить событие в фазе захвата некому.
    expect(e.defaultPrevented).toBe(false)
  })

  it('Escape закрывает вкладку и НЕ проваливается дальше по стеку', async() => {
    const { managers } = makeManagers()
    const slider = createSlider(managers)

    const tab = await openSessions(slider)

    const first = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(first)
    await settle()

    expect(first.defaultPrevented).toBe(true)
    expect(tab.container.parentElement).toBeNull()
    // Под вкладкой — список чатов колонки, слайдер жив и пуст.
    expect(slider.hasTabsInNavigation()).toBe(false)
    expect(sliderElOf(columnEl).querySelector('.item-main')!.classList.contains('active')).toBe(true)

    // Закрытая вкладка обязана ОТПУСТИТЬ клавишу: следующее нажатие в контроллере
    // уже не находит её запись, событие не гасится. Осиротевший Esc-обработчик
    // закрытой вкладки съедал бы нажатия молча и навсегда.
    const second = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
  })

  it('слайдер один на колонку: второй уносит вкладки первого', async() => {
    const { managers } = makeManagers()
    const first = createSlider(managers)
    const tab = await openSessions(first)

    const second = createSlider(managers)
    await settle()

    expect(tab.container.parentElement).toBeNull()
    expect(getColumnSlider()).toBe(second)
  })

  it('вне колонки слайдер не выдумывается — вызов падает, а не молчит', () => {
    const { managers } = makeManagers()
    const slider = createSlider(managers)
    expect(getColumnSlider()).toBe(slider)

    destroyColumnSlider(slider)
    expect(() => getColumnSlider()).toThrow(/слайдер не заведён/)
  })

  it('openActiveSessionsTab отдаёт вкладке УЖЕ загруженный список, а не пустой', async() => {
    const { managers, list } = makeManagers([current, other])
    createSlider(managers)

    await openActiveSessionsTab(managers)

    expect(list).toHaveBeenCalledTimes(1)
    // Обе секции на месте — значит список доехал до вкладки: у пустого списка
    // вкладка не построила бы даже секцию текущей сессии.
    const sections = columnEl.querySelectorAll('.sidebar-left-section')
    expect(sections).toHaveLength(2)
    expect(sections[1].querySelector('.session-row .row-title')!.textContent).toBe('Telegram Android 1.0')
  })
})
