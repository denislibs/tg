/** @jsxImportSource solid-js */
/**
 * Пины порта `tabs.solid.tsx` (tweb `src/components/tabs.tsx`).
 *
 * Эталон — не «как у нас получилось», а ЖИВОЙ ДАМП Telegram
 * `docs/tweb/dom/dumps/14-left-01-chatlist.json:46-56`: ряд папок над списком
 * чатов (градиент + карточка вкладок). Дамп читается из файла и сравнивается
 * с отрисованным деревом по тем же правилам, что у `tools/tweb-parity/dom-parity.mjs`:
 * тег, классы, вложенность. Дамп — одна JSON-строка, нумерация — по
 * РАЗВЁРНУТОМУ тексту (`json.load(...).split('\n')`), первая строка — первая.
 *
 * Дерево в тесте собрано ровно как у потребителя в оригинале —
 * `tweb/src/components/foldersTabs.tsx:51-59` с пропами владельца
 * `appDialogsManager.ts:654-686` (градиент `surface`/`smaller`, класс
 * `folders-tabs-scrollable`, `id="folders-tabs"`). Сам `foldersTabs` — задача 4,
 * здесь его разметку повторяет тест.
 *
 * Отдельно — два способа вызвать `Tabs.MenuGradient`: JSX (`foldersTabs.tsx:53`)
 * и прямой вызов функции с приведением к узлу (`appSearchSuper.ts:597`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from 'solid-js/web'
import Tabs from './tabs.solid'
import Badge from './badge.solid'
import { horizontalMenu, type CreateSelectTab, type SelectTab } from './horizontalMenu'
import type { ScrollableContextValue } from './scrollable2.solid'

/** Строки дампа `from..to` включительно (1-based), приведённые к `тег.классы` с отступом. */
function dumpLines(file: string, from: number, to: number) {
  const text = JSON.parse(readFileSync(resolve(__dirname, '../../../docs/tweb/dom/dumps', file), 'utf8')) as string
  const lines = text.split('\n').slice(from - 1, to)
  const base = lines[0].search(/\S/)
  return lines.map((line) => {
    const indent = (line.search(/\S/) - base) / 2
    const descriptor = line.trim().split(/[\s[]/)[0]
    return '  '.repeat(indent) + descriptor
  })
}

/** То же представление для живого поддерева — формат `snapshot-dom.js` без атрибутов и текста. */
function snapshot(root: Element) {
  const out: string[] = []
  const visit = (el: Element, level: number) => {
    const classes = Array.from(el.classList)
    out.push('  '.repeat(level) + [el.tagName.toLowerCase(), ...classes].join('.'))
    Array.from(el.children).forEach((child) => visit(child, level + 1))
  }
  Array.from(root.children).forEach((child) => visit(child, 0))
  return out
}

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

function mount(component: () => unknown) {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(component as () => never, host)
  return host
}

/** Кадры под ручным управлением: `fastRaf` полосы берёт rAF из глобала. */
let frames: FrameRequestCallback[] = []
function flushFrame() {
  const current = frames
  frames = []
  current.forEach((cb) => cb(0))
}

beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb)
    return frames.length
  })
})

afterEach(() => {
  // Очередь `fastRaf` модульная — недоигранный кадр съел бы кадры следующего теста.
  for (let guard = 10; frames.length && guard; --guard) flushFrame()
  vi.unstubAllGlobals()
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
})

describe('tabs.solid: разметка ряда совпадает с живым дампом', () => {
  it('MenuGradient + MenuScrollable > Menu > MenuTab = 14-left-01-chatlist.json:46-56', () => {
    const el = mount(() => (
      <Tabs>
        <Tabs.MenuGradient color="surface" smaller className="folders-tabs-gradient" />
        <Tabs.MenuScrollable class="folders-tabs-scrollable">
          <Tabs.Menu id="folders-tabs">
            <Tabs.MenuTab>
              <span class="text-super"><span class="i18n">All</span></span>
              <Badge tag="div" size={20} color="primary">{3}</Badge>
            </Tabs.MenuTab>
          </Tabs.Menu>
        </Tabs.MenuScrollable>
      </Tabs>
    ))

    // `active` на вкладке (дамп :51) ставит полоса `horizontalMenu`, а не
    // разметка `Tabs` — в статическом дереве его быть не должно.
    const expected = dumpLines('14-left-01-chatlist.json', 46, 56).map((line) => line.replace('.active', ''))
    expect(snapshot(el)).toEqual(expected)
    expect(el.querySelector('.menu-horizontal-div')!.id).toBe('folders-tabs')
  })
})

describe('tabs.solid: ручки наружу', () => {
  it('contextRef отдаёт container — тот самый .scrollable.scrollable-x; ref-ы — свои узлы', () => {
    let ctx: ScrollableContextValue | undefined
    let scrollableRef: HTMLDivElement | undefined
    let menuRef: HTMLDivElement | undefined
    let tabRef: HTMLDivElement | undefined
    const el = mount(() => (
      <Tabs.MenuScrollable ref={(node) => { scrollableRef = node }} scrollableProps={{ contextRef: (value) => { ctx = value } }}>
        <Tabs.Menu ref={(node) => { menuRef = node }}>
          <Tabs.MenuTab ref={(node) => { tabRef = node }}>x</Tabs.MenuTab>
        </Tabs.Menu>
      </Tabs.MenuScrollable>
    ))

    expect(scrollableRef).toBe(el.querySelector('.menu-horizontal-scrollable'))
    expect(ctx!.container).toBe(el.querySelector('.menu-horizontal-scrollable > .scrollable.scrollable-x'))
    expect(menuRef).toBe(el.querySelector('.menu-horizontal-div'))
    expect(tabRef).toBe(el.querySelector('.menu-horizontal-div-item'))
  })

  it('ref вкладки кладёт data-filter-id в DOM — так метит вкладки foldersTabs.tsx:34-36', () => {
    const el = mount(() => (
      <Tabs.Menu>
        <Tabs.MenuTab ref={(node) => { node.dataset.filterId = '5' }}>x</Tabs.MenuTab>
      </Tabs.Menu>
    ))

    expect((el.querySelector('.menu-horizontal-div-item') as HTMLElement).dataset.filterId).toBe('5')
  })

  it('onClick Menu получает клик по вкладке, class дописывается к базовому', () => {
    const onClick = vi.fn()
    const el = mount(() => (
      <Tabs.Menu class="extra" onClick={onClick}>
        <Tabs.MenuTab class="tab-extra">x</Tabs.MenuTab>
      </Tabs.Menu>
    ))

    const menu = el.querySelector('.menu-horizontal-div') as HTMLElement
    expect(menu.className).toBe('menu-horizontal-div extra')
    expect(menu.firstElementChild!.className).toBe('menu-horizontal-div-item tab-extra')
    ;(el.querySelector('.menu-horizontal-div-item-span') as HTMLElement).click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('tabs.solid: полоса horizontalMenu находит подчёркивание в разметке MenuTab', () => {
  it('переезд «полоски Jolly Cobra» (horizontalMenu.ts:190-211) идёт по i.menu-horizontal-div-item-background', () => {
    let ctx: ScrollableContextValue | undefined
    let menu: HTMLDivElement | undefined
    const el = mount(() => (
      <Tabs.MenuScrollable scrollableProps={{ contextRef: (value) => { ctx = value } }}>
        <Tabs.Menu ref={(node) => { menu = node }}>
          <Tabs.MenuTab>первая</Tabs.MenuTab>
          <Tabs.MenuTab>вторая</Tabs.MenuTab>
        </Tabs.Menu>
      </Tabs.MenuScrollable>
    ))

    const items = Array.from(menu!.children) as HTMLElement[]
    const define = (node: Element | null, prop: string, value: number) => {
      if (node) Object.defineProperty(node, prop, { value, configurable: true })
    }
    define(items[0], 'offsetLeft', 0)
    define(items[1], 'offsetLeft', 120)
    define(items[0].querySelector('i'), 'clientWidth', 100)
    define(items[1].querySelector('i'), 'clientWidth', 80)

    // Слайдер содержимого подменён швом `createSelectTab` (отступление 1 в
    // шапке `horizontalMenu.ts`): здесь проверяется полоса, а не содержимое.
    const content = document.createElement('div')
    content.append(document.createElement('div'), document.createElement('div'))
    let prev = -1
    const createSelectTab: CreateSelectTab = () => {
      const selectTab = ((id: number) => { prev = id }) as SelectTab
      selectTab.prevId = () => prev
      return selectTab
    }
    const selectTab = horizontalMenu({ tabs: menu!, content, createSelectTab, scrollableX: ctx })

    selectTab(0)
    flushFrame()
    selectTab(1)
    flushFrame()

    const indicator = items[1].querySelector<HTMLElement>('.menu-horizontal-div-item-background')!
    expect(indicator.style.transform).toBe('translate3d(-120px, 0, 0)')
    expect(indicator.style.width).toBe('100px')

    flushFrame()
    expect(indicator.classList.contains('animate')).toBe(true)
    expect(items[1].classList.contains('active')).toBe(true)
    expect(el.querySelectorAll('.menu-horizontal-div-item.active')).toHaveLength(1)
  })
})

describe('tabs.solid: MenuGradient двумя путями', () => {
  it('прямой вызов функцией (appSearchSuper.ts:597) отдаёт готовый узел', () => {
    const node = Tabs.MenuGradient({ color: 'background', className: 'search-super-tabs-gradient' }) as HTMLElement

    expect(node).toBeInstanceOf(HTMLDivElement)
    expect(node.className).toBe('menu-horizontal-gradient-container search-super-tabs-gradient-container')
    expect(node.children).toHaveLength(1)
    expect(node.firstElementChild!.className)
      .toBe('menu-horizontal-gradient menu-horizontal-gradient-color-background search-super-tabs-gradient')
  })

  it('JSX (foldersTabs.tsx:53) даёт surface/smaller и отдаёт ref контейнера', () => {
    let ref: HTMLDivElement | undefined
    const el = mount(() => (
      <Tabs.MenuGradient ref={(node) => { ref = node }} color="surface" smaller className="folders-tabs-gradient" />
    ))

    const container = el.firstElementChild as HTMLElement
    expect(ref).toBe(container)
    expect(container.className).toBe('menu-horizontal-gradient-container folders-tabs-gradient-container')
    expect(container.firstElementChild!.className).toBe(
      'menu-horizontal-gradient menu-horizontal-gradient-color-surface menu-horizontal-gradient-smaller folders-tabs-gradient',
    )
  })

  it('без className — только базовые классы, без «undefined-container»', () => {
    const node = Tabs.MenuGradient({ color: 'surface' }) as HTMLElement

    expect(node.className).toBe('menu-horizontal-gradient-container')
    expect(node.firstElementChild!.className).toBe('menu-horizontal-gradient menu-horizontal-gradient-color-surface')
  })
})
