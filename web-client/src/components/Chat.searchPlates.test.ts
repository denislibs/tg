// src/components/Chat.searchPlates.test.ts
//
// Пин tweb 6ce2cafba (topbar.ts::setFloating, 812502980 :1676-1682): пока идёт
// поиск по тегам (`.chat.is-search-active` — строка тегов-реакций раздвигает
// ленту своей распоркой, _chat.scss), резерв под плавающие плашки топбара
// равен НУЛЮ — и в `--pinned-floating-height`, и в распорке ленты
// (`chat.updatePinnedFloatingHeight`). Без этого лента получала обе распорки
// сразу — лишний отступ сверху на высоту закрепа.
//
// Почему СКАН ИСХОДНИКА: `Chat.tsx` — заявленное в web-client/CLAUDE.md
// («Тесты») исключение, её не рендерит ни один тест; приём тот же, что у
// соседних `Chat.feedMount.test.ts` / `Chat.clearHistory.test.ts`.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CHAT_TSX = readFileSync(join(__dirname, 'Chat.tsx'), 'utf8')

describe('Chat.tsx — резерв под плашки при поиске по тегам (tweb 6ce2cafba)', () => {
  it('резерв обнуляется ровно тем же признаком, что ставит `.is-search-active`', () => {
    expect(CHAT_TSX).toMatch(/const reservedPlatesHeight = searchReactionsShown \? 0 : platesHeight/)
    expect(CHAT_TSX).toMatch(/searchReactionsShown \? 'is-search-active' : ''/)
  })

  it('распорка ленты считается от резерва, а не от измеренной высоты стека', () => {
    expect(CHAT_TSX).toMatch(/const floatingHeight = reservedPlatesHeight \+/)
  })

  it('`--pinned-floating-height` считается от резерва', () => {
    expect(CHAT_TSX).toContain('`calc(${reservedPlatesHeight}px + var(--topbar-floating-call-height) + var(--topbar-floating-audio-height))`')
    expect(CHAT_TSX).not.toContain('`calc(${platesHeight}px + var(--topbar-floating-call-height)')
  })
})
