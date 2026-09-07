// Пин ВЛАДЕНИЯ СКРОЛЛЕРОМ на шве с панелью профиля (задача 13 плана
// `docs/superpowers/plans/2026-09-07-solid-wave-3-shared-media.md`, расхождение 7
// в шапке `appSearchSuper.ts`).
//
// У tweb скроллер создаёт вкладка-хозяин (`sliderTab.ts:66`) и она же его
// роняет (`sliderTab.ts:109`); `AppSearchSuper.destroy()` (`tweb:2831`) роняет
// его ВТОРОЙ раз — там это безвредно, потому что класс и вкладка умирают
// вместе. У нас скроллер общий с шапкой профиля и ПЕРЕЖИВАЕТ подсистему:
// правило «уничтожается только если создан и принадлежит классу» решает
// развилку в пользу хозяина — класс снимает ТОЛЬКО то, что повесил сам
// (`onScrolledBottom`), а слушатели и `onAdditionalScroll` хозяина живут дальше.
//
// Отказ при регрессе ТИХИЙ: `Scrollable.destroy()` лишь снимает слушателей и
// обнуляет колбэки (`scrollable.ts:227-232`) — панель просто перестала бы
// реагировать на прокрутку. Поэтому проверяется РЕЗУЛЬТАТ: настоящее событие
// `scroll` на контейнере после `destroy()` подсистемы доходит до колбэка хозяина.
// Мутация «вернуть безусловный `this.scrollable.destroy()`» обязана красить
// оба теста ниже.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import type { LangPackKey } from '@lib/langPack'

const IDLE_MANAGERS = {
  messages: {
    mediaHistory: () => { throw new Error('шов скроллера данных не грузит') },
    searchCounters: () => { throw new Error('шов скроллера данных не грузит') },
  },
} as unknown as SearchSuperManagers

const mediaTabs = (): SearchSuperMediaTab[] => [
  { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey },
  { type: 'files', inputFilter: 'inputMessagesFilterDocument', name: 'SharedFilesTab2' as LangPackKey },
]

// Замер `onScroll` у скроллера троттлится (`scrollable.ts:96-101`): кадром при
// overlay-скролле, таймером — иначе. В happy-dom стабим оба и прокручиваем
// синхронно — предмет теста не троттлинг, а факт доставки.
const realRaf = globalThis.requestAnimationFrame
beforeEach(() => {
  vi.useFakeTimers()
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame
})

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf
  vi.useRealTimers()
  document.body.replaceChildren()
})

function build() {
  const bodyEl = document.createElement('div')
  document.body.append(bodyEl)
  // Скроллер ХОЗЯИНА — поверх готового узла, без обёртки (пятый аргумент —
  // `container`), ровно как его заведёт панель профиля.
  const scrollable = new Scrollable(undefined, undefined, undefined, undefined, bodyEl)
  const hostScroll = vi.fn()
  scrollable.onAdditionalScroll = hostScroll

  const searchSuper = new AppSearchSuper({ mediaTabs: mediaTabs(), scrollable, managers: IDLE_MANAGERS, hideEmptyTabs: false })
  bodyEl.append(searchSuper.container)
  return { scrollable, hostScroll, searchSuper, bodyEl }
}

function scroll(el: HTMLElement) {
  el.dispatchEvent(new Event('scroll'))
  vi.runAllTimers()
}

describe('AppSearchSuper.destroy() — чужой скроллер переживает подсистему', () => {
  it('до destroy(): класс повесил свой onScrolledBottom, прокрутка доходит до колбэка хозяина', () => {
    const { scrollable, hostScroll, bodyEl } = build()
    expect(scrollable.onScrolledBottom, 'класс ставит onScrolledBottom в конструкторе (tweb :616-621)').toBeTypeOf('function')
    scroll(bodyEl)
    expect(hostScroll).toHaveBeenCalledTimes(1)
  })

  it('после destroy(): слушатели скроллера живы — событие scroll по-прежнему доходит до onAdditionalScroll хозяина', () => {
    const { scrollable, hostScroll, searchSuper, bodyEl } = build()
    searchSuper.destroy()

    expect(scrollable.onAdditionalScroll, 'колбэк хозяина не обнулён').toBe(hostScroll)
    scroll(bodyEl)
    expect(hostScroll, 'мутация «вернуть this.scrollable.destroy()» снимает слушатель — колбэк не позовётся').toHaveBeenCalledTimes(1)
  })

  it('после destroy(): класс снял ТОЛЬКО свой onScrolledBottom (владелец снимает то, что создал)', () => {
    const { scrollable, searchSuper } = build()
    searchSuper.destroy()
    expect(scrollable.onScrolledBottom).toBeUndefined()
  })

  it('destroy() не трогает чужой onScrolledBottom, если хозяин переназначил его после конструктора', () => {
    const { scrollable, searchSuper } = build()
    const foreign = vi.fn()
    scrollable.onScrolledBottom = foreign
    searchSuper.destroy()
    expect(scrollable.onScrolledBottom).toBe(foreign)
  })
})
