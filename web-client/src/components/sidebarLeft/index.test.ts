// AppSidebarLeft — класс левой колонки (порт tweb `sidebarLeft/index.ts`,
// задача 2-1 волны 7). Реальный DOM (happy-dom) на разметке tweb
// `index.html:89-107` (`test/sidebarLeft.ts`), реальный
// `appNavigationController`, реальные вкладки (`SliderSuperTab`, «Устройства»).
// Замокана ровно граница с воркером — менеджеры — и владелец списка
// (`AppDialogsManager`): классу от него нужен лишь `xd` для бейджей аватаров.
//
// Таймеры настоящие: закрытие вкладки идёт по цепочке отложенных шагов
// (переход 250мс → `onCloseAfterTimeout` 280мс), внутри живёт Solid со своими
// микрозадачами. `settle()` ждёт всю цепочку целиком.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Authorization } from '@layer'
import type { Managers } from '@/client/bootstrap'
import appNavigationController from '@core/navigation/appNavigationController'
import SliderSuperTab from '@components/sliderTab'
import { AppActiveSessionsTab, AppSettingsTab } from '@components/solidJsTabs/tabs'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import type { AppDialogsManager } from '@lib/appDialogsManager'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'
import appSidebarLeft, { type AppSidebarLeft } from './index'

type Auth = Authorization.authorization

// Те же конструкторы, что шлёт бэкенд (`internal/domain/mtaccount.go`).
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

const managers = {
  sessions: { list: vi.fn(async() => [current, other]), terminate: vi.fn(), terminateOthers: vi.fn() },
} as unknown as Managers

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Переход (250) + разрушение вкладки (280) + запас. */
const settle = () => pause(400)
const esc = () => {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  window.dispatchEvent(e)
  return e
}

/** Записей `'left'` в общей очереди навигации. */
function leftItems() {
  let n = 0
  appNavigationController.findItem((item) => {
    if(item.type === 'left') ++n
    return false
  })
  return n
}

/** Владелец списка — классу нужен лишь `xd` (бейджи аватаров, `onCollapsedChange`). */
const toggleAvatarUnreadBadges = vi.fn()
const dialogsManager = { xd: { toggleAvatarUnreadBadges } } as unknown as AppDialogsManager

let column: InstalledSidebarLeft
const sidebar: AppSidebarLeft = appSidebarLeft

// Синглтон вечен (К-2), `construct` у него — один раз, как в приложении.
beforeAll(() => {
  sidebar.construct(managers, dialogsManager)
})

beforeEach(() => {
  column = installSidebarLeft(managers, undefined, { full: true })
  // запись `global-search-focus` из `construct` снимает очистка очереди после теста
  sidebar.initNavigation()
})

afterEach(async() => {
  if(sidebar.isSearchActive) sidebar.closeSearch()
  column.column.classList.remove('is-collapsed')
  column.destroy()
  await settle()
  appNavigationController.spliceItems(0, Infinity)
  document.body.className = ''
  document.body.replaceChildren()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('AppSidebarLeft — синглтон на #column-left', () => {
  it('экспорт по умолчанию — живая привязка к созданному экземпляру; узел — #column-left, вкладка №0 — .item-main', () => {
    expect(appSidebarLeft).toBe(sidebar)
    expect(sidebar.sidebarEl).toBe(column.column)
    expect(column.mainEl.classList.contains('active')).toBe(true)
    expect(sidebar.hasTabsInNavigation()).toBe(false)
  })

  it('construct: поле поиска `old-style` в шапке после бургера (tweb :158-160), автомат соединения пишет в него', () => {
    const field = column.header.querySelector<HTMLElement>(':scope > .input-search')!
    expect(field.classList.contains('old-style')).toBe(true)
    expect(field.previousElementSibling).toBe(column.header.querySelector('.left-sidebar-burger'))
    expect(sidebar.inputSearch.container).toBe(field)
    expect(field.querySelector('.input-search-placeholder')!.textContent).toBe('Search')

    sidebar.inputSearch.toggleLoading(true)
    expect(sidebar.inputSearch.isLoading()).toBe(true)
    expect(field.querySelector('.preloader-container')).not.toBeNull()
    sidebar.inputSearch.setPlaceholder('Search')
    expect(field.querySelectorAll('.input-search-placeholder')).toHaveLength(1) // тот же ключ — без кросс-фейда
  })
})

describe('(а) has-open-tabs — один писатель, класс колонки', () => {
  it('открытие любой вкладки взводит has-open-tabs и has-real-tabs, закрытие последней — снимает', async() => {
    const first = sidebar.createTab(SliderSuperTab)
    await first.open()
    expect(column.column.classList.contains('has-open-tabs')).toBe(true)
    expect(column.column.classList.contains('has-real-tabs')).toBe(true)

    const second = sidebar.createTab(SliderSuperTab)
    await second.open()
    second.close()
    expect(column.column.classList.contains('has-open-tabs')).toBe(true)

    first.close()
    expect(column.column.classList.contains('has-open-tabs')).toBe(false)
    expect(column.column.classList.contains('has-real-tabs')).toBe(false)
  })

  it('открытый поиск — тоже «открыто внутри» (tweb :519), закрытый — нет', () => {
    sidebar.isSearchActive = true
    sidebar.onSomethingOpenInsideChange()
    expect(column.column.classList.contains('has-open-tabs')).toBe(true)

    sidebar.isSearchActive = false
    sidebar.onSomethingOpenInsideChange()
    expect(column.column.classList.contains('has-open-tabs')).toBe(false)
  })

  // tweb: `has-open-tabs` пишет `onSomethingOpenInsideChange` (:553), а
  // `setOpenTabsLeftSidebar` зовёт он же (:568) — и больше никто. Второй
  // писатель (React-колонка `Sidebar.tsx` className + эффект) разводил класс
  // с числом вкладок в навигации.
  const SRC = join(__dirname, '../..')
  const OWNER = 'components/sidebarLeft/index.ts'

  function walk(dir: string, acc: string[] = []): string[] {
    for(const name of readdirSync(dir)) {
      const p = join(dir, name)
      if(statSync(p).isDirectory()) walk(p, acc)
      else if(/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
    }
    return acc
  }

  it('литерал has-open-tabs и вызов setOpenTabsLeftSidebar — только в sidebarLeft/index.ts', () => {
    const literal = walk(SRC).filter((p) => /['"]has-open-tabs['"]/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(SRC, p))
    expect(literal).toEqual([OWNER])

    const callers = walk(SRC).filter((p) => /(?<!function )setOpenTabsLeftSidebar\(/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(SRC, p))
    expect(callers).toEqual([OWNER])
  })
})

describe('(б) closeEverythingInside', () => {
  it('закрывает вкладки и отвечает true, если было что закрыть; пустая колонка — false', async() => {
    expect(sidebar.closeEverythingInside()).toBe(false)

    const tab = sidebar.createTab(SliderSuperTab)
    await tab.open()
    expect(sidebar.closeEverythingInside()).toBe(true)
    await settle()
    expect(sidebar.getHistory()).toEqual([])
    expect(column.column.classList.contains('has-open-tabs')).toBe(false)
  })

  it('закрывает поиск — кликом по стрелке «назад» (tweb `closeSearch` :1722-1728)', () => {
    const onBack = vi.fn()
    column.backBtn.addEventListener(CLICK_EVENT_NAME, onBack)

    sidebar.closeEverythingInside()
    expect(onBack).not.toHaveBeenCalled()

    sidebar.isSearchActive = true
    sidebar.closeEverythingInside()
    expect(onBack).toHaveBeenCalledTimes(1)
    sidebar.isSearchActive = false
  })

  it('closeTabsBefore: закрыв открытое, ждёт ухода вкладки и зовёт колбэк (tweb :1755-1758)', async() => {
    const tab = sidebar.createTab(SliderSuperTab)
    await tab.open()
    const clb = vi.fn()

    const done = sidebar.closeTabsBefore(clb)
    expect(clb).not.toHaveBeenCalled()
    await done
    expect(clb).toHaveBeenCalledTimes(1)
    expect(sidebar.getHistory()).toEqual([])
  })
})

describe('(в) свёрнутая колонка на medium — плавающая', () => {
  // happy-dom: окно 1024 — `medium`, вне плавающего диапазона (<= 925).
  // `is-collapsed` ставит зеркало сигнала у хоста (`Sidebar.tsx`, расхождение 5).
  it('вкладка всплывает колонку (has-open-tabs + force-*), клик по .sidebar-left-overlay закрывает всё', async() => {
    column.column.classList.add('is-collapsed')
    expect(sidebar.isCollapsed()).toBe(true)

    const tab = sidebar.createTab(SliderSuperTab)
    await tab.open()
    expect(column.column.classList.contains('has-open-tabs')).toBe(true)
    expect(column.column.classList.contains('force-hide-large-content')).toBe(true)
    // бейджи аватаров свёрнутой колонки гаснут, пока она всплыла (tweb :606-607)
    expect(toggleAvatarUnreadBadges).toHaveBeenLastCalledWith(false)

    ;(column.overlay as HTMLElement).click()
    await settle()

    expect(sidebar.getHistory()).toEqual([])
    expect(column.column.classList.contains('has-open-tabs')).toBe(false)
    expect(leftItems()).toBe(0)
  })

  it('onCollapsedChange: fade у .sidebar-content вместо zoom-fade и бейджи на аватарах (tweb :503-506)', () => {
    column.column.classList.add('is-collapsed')
    sidebar.onCollapsedChange()
    const content = column.chatlistContainer.parentElement!
    expect(content.classList.contains('fade')).toBe(true)
    expect(content.classList.contains('zoom-fade')).toBe(false)
    expect(toggleAvatarUnreadBadges).toHaveBeenLastCalledWith(true)

    column.column.classList.remove('is-collapsed')
    sidebar.onCollapsedChange()
    expect(content.classList.contains('fade')).toBe(false)
    expect(content.classList.contains('zoom-fade')).toBe(true)
  })
})

describe('(г) createTab при свёрнутой колонке', () => {
  // tweb (:1735-1739) открывает настройки/папки попапом `showSettingsSliderPopup`;
  // у нас попапа-слайдера нет — О-27 плана 2D, расхождение 4 шапки класса.
  it('AppSettingsTab открывается вкладкой ЭТОЙ колонки, а не попапом (О-27 2D)', () => {
    column.column.classList.add('is-collapsed')
    const tab = sidebar.createTab(AppSettingsTab)
    expect(tab.slider).toBe(sidebar)
  })
})

describe('(д) Back/Esc закрывают верхнюю вкладку — записи `left`', () => {
  it('каждая вкладка — своя запись `left`; Esc снимает верхнюю, затем следующую', async() => {
    const first = sidebar.createTab(SliderSuperTab)
    await first.open()
    const second = sidebar.createTab(SliderSuperTab)
    await second.open()
    expect(leftItems()).toBe(2)

    expect(esc().defaultPrevented).toBe(true)
    await settle()
    expect(sidebar.getHistory()).toEqual([first])
    expect(leftItems()).toBe(1)

    esc()
    await settle()
    expect(sidebar.getHistory()).toEqual([])
    expect(leftItems()).toBe(0)
    expect(column.mainEl.classList.contains('active')).toBe(true)
  })

  it('Back браузера снимает верхнюю вкладку', async() => {
    const tab = sidebar.createTab(SliderSuperTab)
    await tab.open()
    await pause(20) // запись истории доезжает очередью мутаций

    window.dispatchEvent(new PopStateEvent('popstate'))
    await settle()
    expect(sidebar.getHistory()).toEqual([])
    expect(leftItems()).toBe(0)
  })

  it('initNavigation: на дне очереди — `global-search-focus`; Esc при пустой колонке открывает поиск (tweb :474-489)', async() => {
    const open = vi.fn()
    vi.spyOn(sidebar, 'initSearch').mockReturnValue({ open, openWithPeerId: vi.fn(), close: vi.fn() })

    esc()
    await pause(0)
    expect(open).toHaveBeenCalledTimes(1)
    // запись остаётся (onPop → false): следующий Esc снова её
    expect(appNavigationController.findItemByType('global-search-focus')).toBeDefined()
  })
})

describe('вкладки на колоночном слайдере', () => {
  it('вкладка встаёт соседом .item-main с item-secondary (tweb `addTab` :1748-1753)', async() => {
    const tab = await column.openTab(AppActiveSessionsTab, { authorizations: [current, other] })

    expect(tab.container.parentElement).toBe(column.sliderEl)
    expect(tab.container.previousElementSibling).toBe(column.mainEl)
    expect(tab.container.classList.contains('item-secondary')).toBe(true)
    expect(column.mainEl.classList.contains('item-secondary')).toBe(false)
  })
})
