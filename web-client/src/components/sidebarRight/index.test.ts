// AppSidebarRight — класс правой колонки (порт tweb `sidebarRight/index.ts`,
// задача 0б-0 волны 7). Реальный DOM (happy-dom), реальный
// `appNavigationController`, реальная вкладка №0 (`AppReactProfileTab`);
// замоканного здесь нет ничего — предмет тестов как раз проводка класса к
// контроллеру навигации, `body` и слайдеру.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import appNavigationController from '@core/navigation/appNavigationController'
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import rootScope from '@lib/rootScope'
import appImManager from '@lib/appImManager'
import { NAVIGATION_TRANSITION_TIME } from '@components/transition'
import SliderSuperTab from '@components/sliderTab'
import type { Managers } from '../../client/bootstrap'
import appSidebarRight, { createAppSidebarRight, RIGHT_COLUMN_ACTIVE_CLASSNAME, type AppSidebarRight } from './index'

/** Разметка tweb `index.html:110-112` — та же, что рисует `App.tsx`. */
function mountColumn() {
  const column = document.createElement('div')
  column.id = 'column-right'
  column.className = 'tabs-tab sidebar sidebar-right main-column'
  const slider = document.createElement('div')
  slider.className = 'sidebar-content sidebar-slider tabs-container'
  column.append(slider)
  document.body.append(column)
  return { column, slider }
}

/** Записей `'right'` в общей очереди навигации. */
function rightItems() {
  let n = 0
  appNavigationController.findItem((item) => {
    if(item.type === 'right') ++n
    return false
  })
  return n
}

const shown = () => document.body.classList.contains(RIGHT_COLUMN_ACTIVE_CLASSNAME)
const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
/** Переход (250) + отложенные хуки вкладки (280) + очередь истории контроллера. */
const settle = () => vi.advanceTimersByTime(NAVIGATION_TRANSITION_TIME * 3 + 600)

let sidebar: AppSidebarRight
let dom: ReturnType<typeof mountColumn>

beforeEach(() => {
  vi.useFakeTimers()
  // переход вкладок центра — предмет `lib/appImManager.test.ts`; ядро здесь не сконструировано
  vi.spyOn(appImManager, 'selectTab').mockResolvedValue(undefined)
  dom = mountColumn()
  sidebar = createAppSidebarRight()
  sidebar.construct({} as Managers)
})

afterEach(() => {
  sidebar.destroy()
  settle()
  appNavigationController.spliceItems(0, Infinity)
  settle()
  vi.useRealTimers()
  document.body.className = ''
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('AppSidebarRight — синглтон на статичном #column-right', () => {
  it('экспорт по умолчанию — живая привязка к созданному экземпляру; узел — #column-right, закрытая колонка inert', () => {
    expect(appSidebarRight).toBe(sidebar)
    expect(sidebar.sidebarEl).toBe(dom.column)
    expect(dom.column.inert).toBe(true)
  })
})

describe('AppSidebarRight.toggleSidebar', () => {
  function withProfileTab() {
    const tab = sidebar.createSharedMediaTab()
    sidebar.replaceSharedMediaTab(tab)
    return tab
  }

  it('(а) открытие: класс на body, колонка не inert, одна запись `right`, вкладка №0 открыта', () => {
    const tab = withProfileTab()
    void sidebar.toggleSidebar(true)
    expect(shown()).toBe(true)
    expect(dom.column.inert).toBe(false)
    expect(rightItems()).toBe(1)
    expect(sidebar.getHistory()).toEqual([tab])
    expect(tab.container.classList.contains('active')).toBe(true)
  })

  it('(б) повторное открытие — no-op: запись по-прежнему одна', () => {
    withProfileTab()
    void sidebar.toggleSidebar(true)
    void sidebar.toggleSidebar(true)
    expect(rightItems()).toBe(1)
  })

  it('(б′) открытие после hide(): вкладка остаётся в истории, запись `right` заводится заново — одна', () => {
    withProfileTab()
    void sidebar.toggleSidebar(true)
    void sidebar.toggleSidebar(false)
    settle()
    expect(rightItems()).toBe(0)
    void sidebar.toggleSidebar(true)
    expect(rightItems()).toBe(1)
  })

  it('(в) закрытие: класс снят, inert, записей нет, событие right_sidebar_toggle(false)', () => {
    withProfileTab()
    void sidebar.toggleSidebar(true)
    const events: boolean[] = []
    const listener = (v: boolean) => events.push(v)
    rootScope.addEventListener('right_sidebar_toggle', listener)
    void sidebar.toggleSidebar(false)
    rootScope.removeEventListener('right_sidebar_toggle', listener)
    expect(shown()).toBe(false)
    expect(dom.column.inert).toBe(true)
    expect(rightItems()).toBe(0)
    expect(events).toEqual([false])
  })

  it('(г) Esc при открытой колонке закрывает её — через контроллер навигации', () => {
    withProfileTab()
    void sidebar.toggleSidebar(true)
    esc()
    settle()
    expect(shown()).toBe(false)
    expect(rightItems()).toBe(0)
    expect(sidebar.getHistory()).toEqual([])
  })

  it('(з) закрытие последней вкладки (крестик → onCloseBtnClick) закрывает колонку', () => {
    withProfileTab()
    void sidebar.toggleSidebar(true)
    sidebar.onCloseBtnClick()
    settle()
    expect(shown()).toBe(false)
  })

  it('(з′) вкладка поверх профиля: первый Esc снимает её, колонка открыта; второй — закрывает колонку', () => {
    withProfileTab()
    void sidebar.toggleSidebar(true)
    const sub = sidebar.createTab(SliderSuperTab)
    void sub.open()
    expect(rightItems()).toBe(2)
    esc()
    settle()
    expect(shown()).toBe(true)
    expect(rightItems()).toBe(1)
    esc()
    settle()
    expect(shown()).toBe(false)
  })

  it('мост для вкладок: createTab(X).open() + toggleSidebar(true) открывает X, а не профиль поверх неё', () => {
    const profile = withProfileTab()
    const sub = sidebar.createTab(SliderSuperTab)
    void sub.open()
    void sidebar.toggleSidebar(true)
    expect(shown()).toBe(true)
    expect(sidebar.getHistory()).toEqual([sub])
    expect(profile.container.classList.contains('active')).toBe(false)
    expect(rightItems()).toBe(1)
  })
})

describe('AppSidebarRight.replaceSharedMediaTab', () => {
  it('(д) b на месте активной a: b в DOM с `active`, a из DOM ушла, история указывает на b', () => {
    const a = sidebar.createSharedMediaTab()
    sidebar.replaceSharedMediaTab(a)
    void sidebar.toggleSidebar(true)
    const b = sidebar.createSharedMediaTab()
    sidebar.replaceSharedMediaTab(b)
    expect(b.container.parentElement).toBe(dom.slider)
    expect(b.container.classList.contains('active')).toBe(true)
    expect(a.container.isConnected).toBe(false)
    expect(sidebar.getHistory()).toEqual([b])
    expect(sidebar.sharedMediaTab).toBe(b)
  })

  it('(е) без предыдущей и без новой — не бросает и ничего не монтирует (tweb :78-80)', () => {
    expect(() => sidebar.replaceSharedMediaTab(undefined)).not.toThrow()
    expect(dom.slider.children.length).toBe(0)
  })

  it('без предыдущей — новая встаёт первой в слайдер', () => {
    const a = sidebar.createSharedMediaTab()
    sidebar.replaceSharedMediaTab(a)
    expect(dom.slider.firstElementChild).toBe(a.container)
  })

  it('снятие (undefined) при открытой: узел ушёл, из истории вычеркнут', () => {
    const a = sidebar.createSharedMediaTab()
    sidebar.replaceSharedMediaTab(a)
    void sidebar.toggleSidebar(true)
    sidebar.replaceSharedMediaTab()
    expect(a.container.isConnected).toBe(false)
    expect(sidebar.getHistory()).toEqual([])
    expect(sidebar.sharedMediaTab).toBeUndefined()
  })
})

describe('AppSidebarRight.construct', () => {
  it('(ж) смена экрана large → medium закрывает колонку; mobile → medium — нет', () => {
    sidebar.replaceSharedMediaTab(sidebar.createSharedMediaTab())
    void sidebar.toggleSidebar(true)
    mediaSizes.dispatchEvent('changeScreen', ScreenSize.mobile, ScreenSize.medium)
    expect(shown()).toBe(true)
    mediaSizes.dispatchEvent('changeScreen', ScreenSize.large, ScreenSize.medium)
    expect(shown()).toBe(false)
  })

  it('ручка ресайза правой колонки — в колонке', () => {
    expect(dom.column.querySelector(':scope > .sidebar-resize-handle.sidebar-resize-handle-right')).not.toBeNull()
  })

  it('destroy(): колонка закрыта, ручки нет, слушатель экрана снят', () => {
    sidebar.replaceSharedMediaTab(sidebar.createSharedMediaTab())
    void sidebar.toggleSidebar(true)
    sidebar.destroy()
    expect(shown()).toBe(false)
    expect(rightItems()).toBe(0)
    expect(dom.column.querySelector('.sidebar-resize-handle')).toBeNull()
    const spy = vi.spyOn(sidebar, 'toggleSidebar')
    mediaSizes.dispatchEvent('changeScreen', ScreenSize.large, ScreenSize.medium)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('один писатель `is-right-column-shown`', () => {
  // tweb: класс ставит `toggleSidebar` (:128), снимает `hide` (:96) — и больше
  // никто. Второй писатель (прежний счётчик `useRightColumnShown`) разводил
  // состояние колонки с её записью навигации.
  const SRC = join(__dirname, '../..')
  const OWNER = 'components/sidebarRight/index.ts'

  function walk(dir: string, acc: string[] = []): string[] {
    for(const name of readdirSync(dir)) {
      const p = join(dir, name)
      if(statSync(p).isDirectory()) walk(p, acc)
      else if(/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
    }
    return acc
  }

  // Строковый литерал имени класса в коде — это и есть заготовка писателя
  // (прежний счётчик держал его в `const CLASS = '…'` и писал `add(CLASS)`);
  // константу класса вне владельца можно только читать.
  it('литерал класса и classList-запись константой — только в sidebarRight/index.ts', () => {
    const writers = walk(SRC).filter((p) => {
      const src = readFileSync(p, 'utf8')
      return /['"]is-right-column-shown['"]/.test(src) ||
        /classList\.(add|remove|toggle)\([^)]*RIGHT_COLUMN_ACTIVE_CLASSNAME/.test(src)
    }).map((p) => relative(SRC, p))
    expect(writers).toEqual([OWNER])
  })

  // Узел колонки один и статичный (tweb `index.html:110-112`): его рисует
  // шелл, а не портал каждой панели профиля, как раньше `UserInfoPanel`.
  it('`id="column-right"` в разметке — ровно один, в App.tsx', () => {
    const hosts = walk(SRC).flatMap((p) => {
      const n = readFileSync(p, 'utf8').match(/id="column-right"/g)?.length ?? 0
      return n ? [`${relative(SRC, p)}:${n}`] : []
    })
    expect(hosts).toEqual(['App.tsx:1'])
  })
})
