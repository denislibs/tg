// Ссылка на сообщение: сборка (пункт меню «Copy Message Link») и прыжок к
// сообщению при открытии чата.
import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_TME_ORIGIN } from '@config/app'
import { buildMessageLink, requestMessageJump } from './messageLink'
import { useSearchStore } from '@stores/searchStore'

describe('buildMessageLink — как tweb getUrlToMessage, на своём хосте ссылок', () => {
  it('у канала с юзернеймом — t.me/<username>/<mid>', () => {
    expect(buildMessageLink({ peerId: -42, username: 'durov', seq: 7 })).toBe(`${DEFAULT_TME_ORIGIN}/durov/7`)
  })

  it('без юзернейма — t.me/c/<chatId>/<mid>', () => {
    expect(buildMessageLink({ peerId: -42, username: undefined, seq: 7 })).toBe(`${DEFAULT_TME_ORIGIN}/c/42/7`)
  })

  it('пустой юзернейм — тоже /c/', () => {
    expect(buildMessageLink({ peerId: -42, username: '', seq: 7 })).toBe(`${DEFAULT_TME_ORIGIN}/c/42/7`)
  })
})

describe('requestMessageJump', () => {
  beforeEach(() => useSearchStore.getState().clearPendingJump())

  it('ставит тот же pendingJump, что и переход из поиска', () => {
    requestMessageJump(42, 7)
    expect(useSearchStore.getState().pendingJump).toEqual({ peerId: 42, seq: 7 })
  })
})
