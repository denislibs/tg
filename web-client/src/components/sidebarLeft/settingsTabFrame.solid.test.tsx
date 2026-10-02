/** @jsxImportSource solid-js */
/**
 * Каркас экрана настроек = вкладка слайдера (задача 3 плана волны 2D). Пины на
 * то, что видит пользователь, на НАСТОЯЩЕЙ вкладке «Язык» (`AppLanguageTab`),
 * открытой на колоночном слайдере (`sidebarLeft/index.ts`) — тем же путём, что
 * строка корня настроек (`tab.slider.createTab(AppLanguageTab).open()`):
 *
 *  (1) ШАПКА. У верхнего края шапка без плашки и линии: вкладка несёт
 *      `scrolled-start scrolled-end scrollable-y-bordered`
 *      (tweb `sliderTab.ts:84` → `scrollable.ts:456-465`), и правило
 *      `.scrollable-y-bordered:not(.scrolled-start) .sidebar-header`
 *      (tweb `_sidebar.scss:95-100`) не горит. Прокрутили — `scrolled-start`
 *      снят, плашка и линия появились; вернулись — снова без них.
 *  (2) ПЕРЕХОД. `TransitionSlider({type: 'navigation'})` (tweb `slider.ts:41-45`,
 *      `transition.ts:23-42`): контейнер `.animating`, приходящая — из
 *      `translate3d(W,0,0)`, уходящая — в `-W/4` с `brightness(80%)`; назад —
 *      `.backwards` и зеркально; классы снимает настоящий `transitionend`
 *      уходящей, `active` у неё — по концу перехода.
 *
 * Зависимости настоящие: слайдер, вкладка, `Scrollable`, Solid-остров. Стаб —
 * только геометрия (happy-dom не считает layout: ширина — ЗНАЧЕНИЕМ, как в
 * `appSearchSuper.scroll.test.ts:14-26`) и граница с воркером (менеджер языков).
 * Конец перехода приходит НАСТОЯЩИМ событием `transitionend` на узле вкладки.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LangPackLanguage } from '@layer'
import type { Managers } from '@/client/bootstrap'
import I18n from '@lib/langPack'
import type SliderSuperTab from '@components/sliderTab'
import { AppLanguageTab } from '@components/solidJsTabs/tabs'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'

/** ширина колонки, которую happy-dom сам не посчитает */
const WIDTH = 420

const rest = { plural_code: '', strings_count: 0, translated_count: 0, translations_url: '' }
const LANGS: LangPackLanguage[] = [
  { _: 'langPackLanguage', name: 'English', native_name: 'English', lang_code: 'en', pFlags: {}, ...rest },
  { _: 'langPackLanguage', name: 'Russian', native_name: 'Русский', lang_code: 'ru', pFlags: {}, ...rest },
]

const managers = { langPack: { getLanguages: async () => LANGS } } as unknown as Managers

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/**
 * Замер скроллера: `throttleMeasurement` — кадр либо `SCROLL_THROTTLE` = 24мс
 * (`scrollable.ts`, tweb тот же), в зависимости от оверлейного скроллбара.
 */
const measured = () => pause(50)

/** Инлайн вкладок в момент reflow `slideNavigation` — стартовый кадр перехода. */
type StartFrame = { transform: string, filter: string }
let startFrames: Map<Element, StartFrame>

let host: InstalledSidebarLeft
let sliderEl: HTMLElement

beforeEach(() => {
  vi.spyOn(I18n, 'getCacheLangPackAndApply')
    .mockResolvedValue({ _: 'langPackDifference', lang_code: 'ru', from_version: 0, version: 1, strings: [] })
  vi.spyOn(I18n, 'getLangPackAndApply').mockResolvedValue(undefined)

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: WIDTH } as DOMRect)

  // `slideNavigation` разводит вкладки инлайном и сразу после reflow
  // (`void tabContent.offsetWidth`, tweb `transition.ts:32`) снимает инлайн с
  // приходящей — дальше её везёт CSS-переход. Стартовый кадр существует ровно
  // до этого чтения, поэтому снимается в нём: значение обеих вкладок-соседей.
  startFrames = new Map()
  const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function(this: HTMLElement) {
    if(this.classList.contains('tabs-tab') && this.parentElement) {
      for(const tab of this.parentElement.children) {
        const el = tab as HTMLElement
        startFrames.set(el, { transform: el.style.transform, filter: el.style.filter })
      }
    }

    return offsetWidth.get!.call(this) as number
  })

  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = installSidebarLeft(managers, columnEl)
  sliderEl = host.sliderEl
})

afterEach(async() => {
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

/** `.item-main` колонки — вкладка №0 (tweb `index.html:93`) */
const rootTab = () => host.mainEl

/**
 * Переход целиком: `transitionend` обеих вкладок (в браузере их шлют обе — у
 * обеих едет `transform`) + уборка закрытой вкладки (250 + 30).
 */
async function finishTransition(from: HTMLElement, to: HTMLElement) {
  from.dispatchEvent(new Event('transitionend', { bubbles: true }))
  to.dispatchEvent(new Event('transitionend', { bubbles: true }))
  await pause(400)
}

async function openLanguage(): Promise<SliderSuperTab> {
  const tab = await host.openTab(AppLanguageTab)
  return tab
}

describe('каркас вкладки настроек — шапка (жалоба «шапка на плашке с линией»)', () => {
  it('у верхнего края: scrolled-start + scrollable-y-bordered, шапка вне правила плашки', async() => {
    const tab = await openLanguage()
    await finishTransition(rootTab(), tab.container)

    const container = tab.container
    expect(container.classList.contains('scrollable-y-bordered')).toBe(true)
    expect(container.classList.contains('scrolled-start')).toBe(true)
    expect(container.classList.contains('scrolled-end')).toBe(true)

    // Селектор правила плашки и линии — дословно `_sidebar.scss:89` (tweb :95).
    const header = container.querySelector('.sidebar-header')!
    expect(header.closest('.scrollable-y-bordered:not(.scrolled-start)')).toBeNull()
  })

  it('прокрутка на 10px снимает scrolled-start (плашка и линия), возврат к 0 — ставит обратно', async() => {
    const tab = await openLanguage()
    await finishTransition(rootTab(), tab.container)

    const scroller = tab.scrollable.container
    const header = tab.container.querySelector('.sidebar-header')!

    scroller.scrollTop = 10
    scroller.dispatchEvent(new Event('scroll'))
    await measured()
    expect(tab.container.classList.contains('scrolled-start')).toBe(false)
    expect(header.closest('.scrollable-y-bordered:not(.scrolled-start)')).toBe(tab.container)

    scroller.scrollTop = 0
    scroller.dispatchEvent(new Event('scroll'))
    await measured()
    expect(tab.container.classList.contains('scrolled-start')).toBe(true)
  })
})

describe('каркас вкладки настроек — переход (жалоба «нет въезда/выезда»)', () => {
  it('въезд: .animating, приходящая из translate3d(W), уходящая в -W/4 с brightness(80%)', async() => {
    const tab = await openLanguage()
    const incoming = tab.container
    const outgoing = rootTab()

    expect(sliderEl.dataset.animation).toBe('navigation')
    expect(sliderEl.classList.contains('animating')).toBe(true)
    expect(sliderEl.classList.contains('backwards')).toBe(false)

    expect(startFrames.get(incoming)?.transform).toMatch(new RegExp(`^translate3d\\(${WIDTH}px, 0(px)?, 0(px)?\\)$`))
    expect(startFrames.get(incoming)?.filter).toBe('')
    // Приходящую дальше везёт CSS-переход — инлайна на ней уже нет.
    expect(incoming.style.transform).toBe('')

    expect(outgoing.style.transform).toMatch(new RegExp(`^translate3d\\(-${WIDTH / 4}px, 0(px)?, 0(px)?\\)$`))
    expect(outgoing.style.filter).toBe('brightness(80%)')

    expect([...incoming.classList]).toEqual(expect.arrayContaining(['active', 'to']))
    expect([...outgoing.classList]).toEqual(expect.arrayContaining(['active', 'from']))
  })

  it('конец въезда: transitionend уходящей снимает с неё active и инлайн, приходящей — .animating и to', async() => {
    const tab = await openLanguage()
    const incoming = tab.container
    const outgoing = rootTab()

    // Уходящая: колбэк уборки на её узле (tweb `transition.ts:337-345`).
    outgoing.dispatchEvent(new Event('transitionend', { bubbles: true }))
    expect(outgoing.classList.contains('active')).toBe(false)
    expect(outgoing.classList.contains('from')).toBe(false)
    expect(outgoing.style.transform).toBe('')
    expect(outgoing.style.filter).toBe('')
    // Контейнер ждёт ПРИХОДЯЩУЮ: к концу `selectTab` `from = to`
    // (tweb `transition.ts:372`), и `onEndEvent` сверяет цель с ней (:212).
    expect(sliderEl.classList.contains('animating')).toBe(true)

    incoming.dispatchEvent(new Event('transitionend', { bubbles: true }))
    expect(sliderEl.classList.contains('animating')).toBe(false)
    expect(incoming.classList.contains('to')).toBe(false)
    expect(incoming.classList.contains('active')).toBe(true)
  })

  it('выезд назад: .animating.backwards, корень из -W/4 с brightness(80%), вкладка уезжает в W и снимается', async() => {
    const tab = await openLanguage()
    await finishTransition(rootTab(), tab.container)

    startFrames.clear()
    tab.close()

    const outgoing = tab.container
    const incoming = rootTab()

    expect(sliderEl.classList.contains('animating')).toBe(true)
    expect(sliderEl.classList.contains('backwards')).toBe(true)

    expect(startFrames.get(incoming)?.transform).toMatch(new RegExp(`^translate3d\\(-${WIDTH / 4}px, 0(px)?, 0(px)?\\)$`))
    expect(startFrames.get(incoming)?.filter).toBe('brightness(80%)')
    expect(incoming.style.transform).toBe('')
    expect(incoming.style.filter).toBe('')

    expect(outgoing.style.transform).toMatch(new RegExp(`^translate3d\\(${WIDTH}px, 0(px)?, 0(px)?\\)$`))
    expect([...outgoing.classList]).toEqual(expect.arrayContaining(['active', 'from']))
    expect([...incoming.classList]).toEqual(expect.arrayContaining(['active', 'to']))

    await finishTransition(outgoing, incoming)
    expect(sliderEl.classList.contains('animating')).toBe(false)
    expect(sliderEl.classList.contains('backwards')).toBe(false)
    // Ушедшую вкладку разбирает `onCloseAfterTimeout` (tweb `sliderTab.ts:105-113`).
    expect(outgoing.isConnected).toBe(false)
    expect(sliderEl.children).toHaveLength(1)
    expect(incoming.classList.contains('active')).toBe(true)
  })
})
