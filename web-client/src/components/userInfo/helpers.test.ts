// Задача 5 (docs/superpowers/plans/2026-09-05-profile-avatars-class.md):
// `shouldForceFold` — гейт «нет фото → держать свёрнутым» (tweb
// `peerProfileAvatars.ts:341-344`), вынесенный чистой функцией именно для
// того, чтобы его можно было протестировать напрямую — эффект-потребитель
// (`UserInfoPanel.tsx`, `folded → avatars.setCollapsed(folded)`) сам
// нерендерибелен в vitest (см. `UserInfoPanel.shell.test.ts`). Норма проводки
// брифа задачи 5: «Гейт обязателен к покрытию тестом: пир без фото не
// разворачивается колесом» — здесь это и покрыто, на уровне булевой логики.
import { describe, expect, it } from 'vitest'
import { ADDITIONAL_OFFSET, BODY_PADDING, HEADER_H, isSharedMediaReached, shouldForceFold } from './helpers'

describe('shouldForceFold (tweb :341-344)', () => {
  it('нет фото и уже развёрнуто (folded=false) → форсировать fold', () => {
    expect(shouldForceFold(false, false)).toBe(true)
  })

  it('нет фото, но и так свёрнуто (folded=true) → форсировать нечего (условие оригинала — !folded())', () => {
    expect(shouldForceFold(false, true)).toBe(false)
  })

  it('есть фото — гейт не форсирует fold ни в развёрнутом, ни в свёрнутом состоянии', () => {
    expect(shouldForceFold(true, false)).toBe(false)
    expect(shouldForceFold(true, true)).toBe(false)
  })
})

// Задача 13 плана shared media: порог «доехали до шаред-медиа» — порт tweb
// `sharedMedia.tsx:487-492` в чистой функции, потому что сам обработчик
// `scrollable.onAdditionalScroll` живёт в нерендерибельной панели. Меряется
// РЯД вкладок (`nav`), а при единственной вкладке (`is-single`, ряд схлопнут
// в ноль) — контейнер подсистемы; узел без ширины (панель скрыта) — не судим.
describe('isSharedMediaReached (tweb sharedMedia.tsx:484-493)', () => {
  const OFFSET_PLUS_PADDING = 56 + 16 + 16
  const node = (top: number, width = 300) => {
    const el = document.createElement('div')
    el.getBoundingClientRect = () => ({ top, width }) as DOMRect
    return el
  }
  const build = (navTop: number, containerTop: number, isSingle = false, width = 300) => {
    const navScrollableContainer = document.createElement('div')
    navScrollableContainer.classList.toggle('is-single', isSingle)
    return { navScrollableContainer, nav: node(navTop, width), container: node(containerTop, width) }
  }

  it('меряет ряд вкладок: top - 1 <= OFFSET + BODY_PADDING (88px)', () => {
    expect(isSharedMediaReached(build(89, 0))).toBe(true)
    expect(isSharedMediaReached(build(90, 0))).toBe(false)
  })

  it('при is-single меряет контейнер подсистемы, а не ряд', () => {
    expect(isSharedMediaReached(build(500, 80, true))).toBe(true)
    expect(isSharedMediaReached(build(10, 500, true))).toBe(false)
  })

  it('узел без ширины (панель не видна) — undefined, режим не меняется', () => {
    expect(isSharedMediaReached(build(0, 0, false, 0))).toBeUndefined()
  })

  it('порог сложен из констант шапки', () => {
    expect(HEADER_H + ADDITIONAL_OFFSET + BODY_PADDING).toBe(OFFSET_PLUS_PADDING)
  })
})
