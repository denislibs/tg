/**
 * Тесты хоста слайдера вкладок (`settingsSliderHost.ts`). Гоняют НАСТОЯЩИЙ
 * `SidebarSlider` с НАСТОЯЩЕЙ вкладкой «Устройства» на реальном DOM
 * (happy-dom): замокан ровно один шов — менеджеры, то есть граница с воркером.
 *
 * Почему вкладка настоящая, а не пустышка: главный вопрос этих тестов — «когда
 * умирает экран настроек, умирает ли ВСЁ, что вкладка успела развесить». Часть
 * этого «всего» лежит ВНЕ колонки: контекстное меню сессии вкладка кладёт в
 * `document.body` и снимает в `onCleanup` своего Solid-острова
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
import { initHotkeys } from '@core/hotkeys'
import { setBaseHandler } from '@core/navigation/navigationStack'
import { AppActiveSessionsTab } from '@components/solidJsTabs/tabs'
import s from './settingsSliderHost.module.scss'
import {
  createSettingsSliderHost,
  getSettingsSliderHost,
  openActiveSessionsTab,
  type SettingsSliderHost,
} from './settingsSliderHost'

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

/** Разметка колонки: хост вешает свой слой ребёнком `#column-left`. */
function createColumn() {
  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  return columnEl
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Переход (250) + разрушение вкладки (280) + запас. */
const settle = () => pause(400)

/** Узел, который вкладка кладёт в `document.body` мимо колонки. */
const tabMenu = () => document.getElementById('active-sessions-contextmenu')

let columnEl: HTMLElement
let hosts: SettingsSliderHost[]

beforeEach(() => {
  hosts = []
  columnEl = createColumn()
})

afterEach(async() => {
  // Слои навигации и Esc — модульные синглтоны: недобитый хост достался бы
  // следующему тесту вместе со своим слоем.
  for(const host of hosts) {
    host.destroy()
  }

  await settle()
  document.body.replaceChildren()
})

function createHost(managers: Managers) {
  const host = createSettingsSliderHost(columnEl, managers)
  hosts.push(host)
  return host
}

describe('settingsSliderHost — заведение слайдера в левую колонку', () => {
  it('вкладка въезжает в СВОЙ слой колонки, поверх React-экрана настроек', async() => {
    const { managers } = makeManagers()
    const host = createHost(managers)

    const layer = columnEl.firstElementChild!
    const sliderEl = layer.querySelector('.sidebar-slider.tabs-container')!
    // Заглушка-корень: без соседа переходу не от чего ехать (см. шапку хоста).
    expect(sliderEl.children).toHaveLength(1)
    expect(sliderEl.firstElementChild!.classList.contains('tabs-tab')).toBe(true)
    expect(layer.classList.contains(s.withTabs)).toBe(false)

    const tab = await host.openTab(AppActiveSessionsTab, { authorizations: [current, other] })

    expect(tab.container.parentElement).toBe(sliderEl)
    expect(tab.container.classList.contains('active')).toBe(true)
    // Слой перестаёт быть сквозным для кликов ровно пока вкладки открыты.
    expect(layer.classList.contains(s.withTabs)).toBe(true)
  })

  it('размонтирование экрана настроек уничтожает открытые вкладки', async() => {
    const { managers } = makeManagers()
    const host = createHost(managers)

    const tab = await host.openTab(AppActiveSessionsTab, { authorizations: [current, other] })
    const middleware = tab.middlewareHelper.get()
    // Вкладка успела развесить своё ВНЕ колонки — иначе проверка ниже
    // проходила бы и на неразобранном Solid-острове.
    expect(tabMenu()).not.toBeNull()
    expect(middleware()).toBe(true)

    host.destroy()
    await settle()

    // Узел вкладки снят ЕЮ САМОЙ (`SliderSuperTab.onCloseAfterTimeout`), а не
    // выброшен вместе с поддеревом: у него нет родителя вовсе.
    expect(tab.container.parentElement).toBeNull()
    // Solid-остров разобран: `onCleanup` вкладки снял её меню из `document.body`.
    expect(tabMenu()).toBeNull()
    // Миддлварь вкладки погашена — поздний ответ воркера в мёртвую вкладку не пишет.
    expect(middleware()).toBe(false)
    // И сам слой хоста ушёл из колонки: клики снова достаются React-экрану.
    expect(columnEl.children).toHaveLength(0)
  })

  it('вкладка, уходившая за своим чанком, не переживает свой экран', async() => {
    // Боевой дефект финального ревью волны 2: `closeAllTabs()` ходит по
    // `historyTabIds`, а вкладка попадает туда только в `selectTab`, то есть
    // ПОСЛЕ `await init()`. Между `createTab` и `selectTab` лежат динамический
    // импорт чанка вкладки и ожидание данных — уйти успевают. Сценарий:
    // настройки → «Устройства» → Back до того, как доехал чанк.
    const escFallback = vi.fn()
    const deactivate = initHotkeys({ escFallback })
    const { managers } = makeManagers()
    const host = createHost(managers)

    // Ждать НЕЛЬЗЯ: весь смысл в том, что экран уходит ВНУТРИ этого промиса.
    const opening = host.openTab(AppActiveSessionsTab, { authorizations: [current, other] })
    host.destroy()

    const tab = await opening
    await settle()

    // Solid-остров разобран: `onCleanup` снял меню, положенное в `document.body`.
    expect(tabMenu()).toBeNull()
    expect(tab.container.parentElement).toBeNull()
    expect(columnEl.children).toHaveLength(0)

    // Esc не съеден осиротевшим обработчиком мёртвой вкладки.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await pause(20)
    expect(escFallback).toHaveBeenCalledTimes(1)

    // И Back тоже: записи истории у ненайденной вкладки быть не должно, иначе
    // первое нажатие «назад» ПОСЛЕ выхода из настроек уходит в никуда.
    let backsToApp = 0
    setBaseHandler(() => { ++backsToApp })
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(backsToApp).toBe(1)

    deactivate()
  })

  it('destroy отпускает Esc: следующее нажатие достаётся приложению, а не мёртвой вкладке', async() => {
    const escFallback = vi.fn()
    const deactivate = initHotkeys({ escFallback })
    const { managers } = makeManagers()
    const host = createHost(managers)

    await host.openTab(AppActiveSessionsTab, { authorizations: [current, other] })

    host.destroy()
    await settle()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    // Фолбэк планируется таймером — только если Esc-стек пуст (`core/hotkeys.ts`).
    await pause(20)
    expect(escFallback).toHaveBeenCalledTimes(1)

    deactivate()
  })

  it('Escape закрывает вкладку и НЕ проваливается в фолбэк «закрыть чат»', async() => {
    const escFallback = vi.fn()
    const deactivate = initHotkeys({ escFallback })
    const { managers } = makeManagers()
    const host = createHost(managers)

    const tab = await host.openTab(AppActiveSessionsTab, { authorizations: [current, other] })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await settle()

    expect(escFallback).not.toHaveBeenCalled()
    expect(tab.container.parentElement).toBeNull()
    // Экран настроек ПОД вкладкой остаётся: хост жив, снят только его слой-признак.
    expect(columnEl.firstElementChild!.classList.contains(s.withTabs)).toBe(false)
    expect(columnEl.children).toHaveLength(1)

    // Закрытая вкладка обязана ОТПУСТИТЬ клавишу: следующее нажатие идёт
    // приложению. Осиротевший Esc-обработчик закрытой вкладки съедал бы
    // нажатия молча и навсегда.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await pause(20)
    expect(escFallback).toHaveBeenCalledTimes(1)

    deactivate()
  })

  it('слайдер один на колонку: второй хост уносит вкладки первого', async() => {
    const { managers } = makeManagers()
    const first = createHost(managers)
    const tab = await first.openTab(AppActiveSessionsTab, { authorizations: [current, other] })

    const second = createHost(managers)
    await settle()

    expect(tab.container.parentElement).toBeNull()
    expect(columnEl.children).toHaveLength(1)
    expect(getSettingsSliderHost()).toBe(second)
  })

  it('вне экрана настроек хост не выдумывается — вызов падает, а не молчит', () => {
    const { managers } = makeManagers()
    const host = createHost(managers)
    expect(getSettingsSliderHost()).toBe(host)

    host.destroy()
    expect(() => getSettingsSliderHost()).toThrow(/хост не заведён/)
  })

  it('openActiveSessionsTab отдаёт вкладке УЖЕ загруженный список, а не пустой', async() => {
    const { managers, list } = makeManagers([current, other])
    createHost(managers)

    await openActiveSessionsTab(managers)

    expect(list).toHaveBeenCalledTimes(1)
    // Обе секции на месте — значит список доехал до вкладки: у пустого списка
    // вкладка не построила бы даже секцию текущей сессии.
    const sections = columnEl.querySelectorAll('.sidebar-left-section')
    expect(sections).toHaveLength(2)
    expect(sections[1].querySelector('.row[data-hash="2"]')).not.toBeNull()
  })
})
