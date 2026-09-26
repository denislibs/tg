/** @jsxImportSource solid-js */
/**
 * Тесты вкладки «Быстрая реакция» (`quickReaction.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/quickReaction.tsx`, 812502980).
 *
 * Вкладка гоняется НАСТОЯЩАЯ — `AppQuickReactionTab` из `solidJsTabs/tabs.ts`,
 * открытая через хост (`settingsSliderHost.ts`) тем же путём, что её открывает
 * строка «Quick Reaction» экрана «Стикеры и эмодзи». Стабы — только границы:
 * каталог реакций (воркер, `GET /reactions`), `wrapSticker` (загрузка файла и
 * плеер — не предмет вкладки) и геометрия (happy-dom её не считает).
 *
 * Предмет проверок:
 *  • разметка HEAD — `form` в секции без имени, строка = `Row havePadding` +
 *    радио СПРАВА (`alignRight` → `radio-field-right` в правой части заголовка)
 *    с `disable-hover` + `Row.Title.quick-reaction-title` + превью
 *    `Row.Media size="small"` со статичной иконкой 32×32 (tweb `:33-59`,
 *    `reactionStickerPreview.tsx`);
 *  • в списке только активные реакции каталога, в его порядке (tweb `:28`);
 *  • открытие ЖДЁТ каталог (сбор в `promiseCollector`), а не въезжает пустым;
 *  • каталог общий с лентой (кэш `chat/reactions.ts::getAvailableReactions`),
 *    второе открытие в сеть не ходит;
 *  • выбор переносит отметку; записи на сервер НЕТ (О-30 — ручки нет);
 *  • на закрытии Solid-остров снят (DoD 5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type { AvailableReaction } from '@core/managers/reactionsManager'
import type SliderSuperTab from '@components/sliderTab'
import wrapSticker from '@components/wrappers/sticker'
import lang from '@/lang'
import { AppQuickReactionTab } from '@components/solidJsTabs/tabs'
import { createSettingsSliderHost, type SettingsSliderHost } from '../settingsSliderHost'
import { installSpecLabelActivation } from '@/test/specLabelActivation'

vi.mock('@components/wrappers/sticker', () => ({ default: vi.fn() }))
const wrapStickerMock = vi.mocked(wrapSticker)

const reaction = (emoji: string, title: string, staticMediaId: number, extra: Partial<AvailableReaction> = {}): AvailableReaction => ({
  emoji,
  title,
  position: 0,
  premium: false,
  inactive: false,
  staticMediaId,
  ...extra,
})

const CATALOG: AvailableReaction[] = [
  reaction('👍', 'Thumbs Up', 101),
  reaction('❤', 'Red Heart', 102),
  // Неактивная реакция каталога (tweb `pFlags.inactive`) в список не попадает.
  reaction('🦄', 'Unicorn', 103, { inactive: true }),
  reaction('🔥', 'Fire', 104),
]
const ACTIVE_TITLES = ['Thumbs Up', 'Red Heart', 'Fire']

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let host: SettingsSliderHost
let uninstallLabelActivation: () => void
let list: ReturnType<typeof vi.fn>

beforeEach(() => {
  uninstallLabelActivation = installSpecLabelActivation()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  wrapStickerMock.mockReset()
  wrapStickerMock.mockImplementation((options) => ({
    render: Promise.resolve(document.createElement('img')),
    width: options.width,
    height: options.height,
    destroy: () => {},
  }))

  list = vi.fn(async() => CATALOG)
  // Новый объект-менеджер на каждый тест: кэш каталога (`getAvailableReactions`)
  // держится за него, и соседние тесты не должны делить один ответ.
  const managers = { reactions: { list } } as unknown as Managers
  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = createSettingsSliderHost(columnEl, managers)
})

afterEach(async() => {
  uninstallLabelActivation()
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const open = () => host.openTab(AppQuickReactionTab)

const radios = (tab: SliderSuperTab) =>
  [...tab.scrollable.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')]

const checkedValues = (tab: SliderSuperTab) => radios(tab).filter((input) => input.checked).map((input) => input.value)

function row(tab: SliderSuperTab, title: string) {
  const el = [...tab.scrollable.container.querySelectorAll('.row')]
    .find((r) => r.querySelector('.row-title')?.textContent === title)
  if(!el) throw new Error('no row ' + title)
  return el as HTMLElement
}

describe('вкладка «Быстрая реакция» — разметка HEAD', () => {
  it('одна секция без имени: строки — прямые дети form в карточке', async() => {
    const tab = await open()

    const containers = tab.scrollable.container.querySelectorAll('.sidebar-left-section-container')
    expect(containers).toHaveLength(1)
    expect(containers[0].querySelector('.sidebar-left-section-name')).toBeNull()

    const form = containers[0].querySelector('.sidebar-left-section-content > form')!
    expect(form).not.toBeNull()
    expect([...form.children].map((child) => child.classList.contains('row'))).toEqual([true, true, true])
  })

  it('только активные реакции каталога и в его порядке', async() => {
    const tab = await open()
    const titles = [...tab.scrollable.container.querySelectorAll('.row-title:not(.row-title-right)')].map((el) => el.textContent)
    expect(titles).toEqual(ACTIVE_TITLES)
    expect(radios(tab).map((input) => input.value)).toEqual(['👍', '❤', '🔥'])
  })

  it('строка: label с отступом, заголовок quick-reaction-title, радио СПРАВА с disable-hover', async() => {
    const tab = await open()

    const fire = row(tab, 'Fire')
    expect(fire.tagName).toBe('LABEL')
    expect(fire.classList.contains('row-with-padding')).toBe(true)
    expect(fire.querySelector('.row-title')!.classList.contains('quick-reaction-title')).toBe(true)

    const field = fire.querySelector('.radio-field')!
    expect([...field.classList].sort())
      .toEqual(['disable-hover', 'radio-field', 'radio-field-right', 'row-radio-field'])
    // Справа — в правой части заголовка (`radioFieldRight`), а не ребёнком строки.
    expect(field.parentElement!.classList.contains('row-title-right')).toBe(true)
    expect(field.parentElement!.parentElement!.classList.contains('row-title-row')).toBe(true)
  })

  it('превью — Row.Media small со статичной иконкой реакции 32×32', async() => {
    const tab = await open()

    const media = row(tab, 'Red Heart').querySelector('.row-media')!
    expect([...media.classList].sort()).toEqual(['row-media', 'row-media-small'])

    const call = wrapStickerMock.mock.calls.find(([options]) => options.mediaId === 102)!
    expect(call).toBeDefined()
    expect(call[0]).toMatchObject({ width: 32, height: 32 })
    // Контейнер показа — ребёнок превью (tweb `StickerTsx` → `div` в `Row.Media`).
    expect(call[0].div.parentElement).toBe(media)
    // Иконка неактивной реакции не грузится вовсе.
    expect(wrapStickerMock.mock.calls.some(([options]) => options.mediaId === 103)).toBe(false)
  })
})

describe('вкладка «Быстрая реакция» — данные', () => {
  it('открытие ЖДЁТ каталог, а не показывает пустую секцию', async() => {
    let release!: (reactions: AvailableReaction[]) => void
    list.mockImplementation(() => new Promise<AvailableReaction[]>((r) => { release = r }))

    const opened = vi.fn()
    const p = open()
    void p.then(opened)

    await pause(0)
    expect(opened).not.toHaveBeenCalled()

    release(CATALOG)
    const tab = await p
    expect(opened).toHaveBeenCalled()
    expect(tab.scrollable.container.querySelectorAll('.row')).toHaveLength(ACTIVE_TITLES.length)
  })

  it('каталог общий с лентой: второе открытие в сеть не ходит', async() => {
    const first = await open()
    first.close()
    await pause(400)
    await open()
    expect(list).toHaveBeenCalledTimes(1)
  })
})

describe('вкладка «Быстрая реакция» — выбор', () => {
  it('быстрой реакции у нас нет (О-30): на открытии не отмечено ничего', async() => {
    const tab = await open()
    expect(checkedValues(tab)).toEqual([])
  })

  it('клик по заголовку строки отмечает реакцию; в сеть — только каталог', async() => {
    const tab = await open()

    row(tab, 'Red Heart').querySelector<HTMLElement>('.row-title')!.click()
    expect(checkedValues(tab)).toEqual(['❤'])

    row(tab, 'Fire').querySelector<HTMLInputElement>('input[type="radio"]')!.click()
    expect(checkedValues(tab)).toEqual(['🔥'])

    // Ручки записи нет (О-30): единственный сетевой вызов вкладки — каталог.
    expect(list).toHaveBeenCalledTimes(1)
  })
})

describe('вкладка «Быстрая реакция» — каркас', () => {
  it('шапка — DoubleTapSetting; контейнер quick-reaction-container', async() => {
    const tab = await open()
    expect(tab.container.querySelector('.sidebar-header__title')!.textContent).toBe(lang.DoubleTapSetting)
    expect(tab.container.classList.contains('quick-reaction-container')).toBe(true)
  })

  it('после закрытия Solid-остров снят: строк в DOM нет (DoD 5)', async() => {
    const tab = await open()
    expect(document.querySelectorAll('.row').length).toBeGreaterThan(0)

    tab.close()
    await pause(400)

    expect(document.querySelectorAll('.row')).toHaveLength(0)
    expect(tab.container.isConnected).toBe(false)
  })
})
