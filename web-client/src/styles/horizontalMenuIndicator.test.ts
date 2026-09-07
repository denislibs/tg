// Подчёркивание активной вкладки живёт ТОЛЬКО в CSS — JS про его вид не знает.
//
// `components/horizontalMenu.ts` (порт `tweb/src/components/horizontalMenu.ts`)
// делает ровно две вещи: вешает на вкладку класс `active` и на два кадра
// подменяет подчёркиванию инлайновые `transform`/`width`, добавляя класс
// `animate`. Всё остальное — правила партиала `styles/tweb/_slider.scss:104-124`
// (= `tweb/src/scss/partials/_slider.scss`, файлы совпадают строка в строку):
//   • `.menu-horizontal-div-item-background` — абсолютный слой на всю вкладку с
//     `opacity: 0` и `transform-origin: left`;
//   • `.menu-horizontal-div-item.active .menu-horizontal-div-item-background`
//     → `opacity: 1` — ЕДИНСТВЕННОЕ, что делает подчёркивание видимым;
//   • `.animate` → `transition: transform …, width …` — единственное, что
//     превращает подмену инлайна в переезд, а не в прыжок.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СТИЛЕВОЙ ПИН. Поведенческие пины
// (`components/horizontalMenu.test.ts`) сверяют классы и инлайн — и останутся
// зелёными, если правила выше вынести из партиала или переименовать: классы на
// месте, а подчёркивание при этом либо невидимо совсем, либо телепортируется.
// Поэтому здесь — НАСТОЯЩИЙ скомпилированный `styles/index.scss` поверх
// НАСТОЯЩЕЙ разметки полосы (`appSearchSuper.ts:474-495`), тем же способом, что
// `timePart.test.ts` и `pollClickableArea.test.ts`.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'
import { horizontalMenu, type CreateSelectTab, type SelectTab } from '@components/horizontalMenu'

let css: string

beforeAll(() => {
  css = sass.compile(join(__dirname, 'index.scss'), {
    loadPaths: [__dirname, join(__dirname, '..', '..', 'node_modules')],
    // Предупреждения вендорного tweb-SCSS к предмету теста отношения не имеют.
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
    quietDeps: true,
  }).css
})

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

/** Слайдер содержимого здесь не предмет теста — нужен только чтобы полоса собралась. */
const stubSlider: CreateSelectTab = () => {
  const selectTab = (() => {}) as unknown as SelectTab
  selectTab.prevId = () => -1
  return selectTab
}

/** Полоса вкладок под настоящей таблицей стилей. */
function mountTabs(count: number) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)

  const tabs = document.createElement('nav')
  tabs.className = 'search-super-tabs menu-horizontal-div'
  const content = document.createElement('div')
  content.className = 'search-super-tabs-container tabs-container'

  for (let i = 0; i < count; ++i) {
    const item = document.createElement('div')
    item.className = 'menu-horizontal-div-item'
    const indicator = document.createElement('i')
    indicator.className = 'menu-horizontal-div-item-background'
    const span = document.createElement('span')
    span.className = 'menu-horizontal-div-item-span'
    span.textContent = `вкладка ${i}`
    item.append(indicator, span)
    tabs.append(item)
    content.append(document.createElement('div'))
  }

  document.body.append(tabs, content)

  const selectTab = horizontalMenu({ tabs, content, createSelectTab: stubSlider })
  return { tabs, selectTab }
}

const indicatorOf = (tabs: HTMLElement, index: number) =>
  (tabs.children[index] as HTMLElement).querySelector<HTMLElement>('.menu-horizontal-div-item-background')!

describe('подчёркивание активной вкладки', () => {
  it('видимым его делает класс `active`, который ставит полоса вкладок', () => {
    const { tabs, selectTab } = mountTabs(3)

    expect(getComputedStyle(indicatorOf(tabs, 1)).opacity).toBe('0')

    // Без анимации переключение синхронно (`horizontalMenu.ts`, ветка
    // `mutateCallback` при `animate: false`).
    selectTab(1, false)

    expect(tabs.children[1].classList.contains('active')).toBe(true)
    expect(getComputedStyle(indicatorOf(tabs, 1)).opacity).toBe('1')
    // Соседние вкладки остаются без подчёркивания — иначе их было бы две.
    expect(getComputedStyle(indicatorOf(tabs, 0)).opacity).toBe('0')
  })

  it('подчёркивание накрывает вкладку целиком и масштабируется от её левого края', () => {
    const { tabs } = mountTabs(3)
    const style = getComputedStyle(indicatorOf(tabs, 0))

    // Габариты — от вкладки: JS подменяет ТОЛЬКО ширину и сдвиг, всё остальное
    // (высота, привязка к левому краю) обязано приезжать из CSS, иначе переезд
    // считается от другой точки и полоска уезжает мимо.
    expect(style.position).toBe('absolute')
    expect(style.left).toBe('0px')
    expect(style.width).toBe('100%')
    expect(style.height).toBe('100%')
    expect(style.transformOrigin).toBe('left')
  })

  it('класс `animate` даёт переход по сдвигу и ширине — иначе полоска прыгает', () => {
    const { tabs } = mountTabs(3)
    const indicator = indicatorOf(tabs, 0)

    expect(getComputedStyle(indicator).transition).toBe('')

    indicator.classList.add('animate')
    const transition = getComputedStyle(indicator).transition

    expect(transition).toContain('transform')
    expect(transition).toContain('width')
  })
})
