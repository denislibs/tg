// Ссылка на сообщение: сборка (пункт меню «Copy Message Link») и разбор
// (навигация по хэшу). Формат общий для обеих сторон — если он разъедется,
// скопированная ссылка перестанет открывать сообщение.
import { describe, it, expect, beforeEach } from 'vitest'
import { buildMessageLink, parseNavHash, requestMessageJump } from './messageLink'
import { useSearchStore } from '@stores/searchStore'

describe('buildMessageLink', () => {
  const base = { origin: 'https://msgr.local', pathname: '/' }

  it('у канала с юзернеймом ссылка читаемая — по @username', () => {
    expect(buildMessageLink({ ...base, chatId: 42, username: 'durov', seq: 7 }))
      .toBe('https://msgr.local/#@durov/7')
  })

  it('без юзернейма — по числовому id чата', () => {
    expect(buildMessageLink({ ...base, chatId: 42, username: undefined, seq: 7 }))
      .toBe('https://msgr.local/#42/7')
  })

  it('пустой юзернейм не даёт ссылку вида #@/7', () => {
    expect(buildMessageLink({ ...base, chatId: 42, username: '', seq: 7 }))
      .toBe('https://msgr.local/#42/7')
  })

  it('подпуть приложения сохраняется', () => {
    expect(buildMessageLink({ origin: 'https://msgr.local', pathname: '/k/', chatId: 42, seq: 1 }))
      .toBe('https://msgr.local/k/#42/1')
  })
})

describe('parseNavHash', () => {
  it('собранную ссылку разбирает обратно (round-trip)', () => {
    const link = buildMessageLink({ origin: 'https://msgr.local', pathname: '/', chatId: 42, username: 'durov', seq: 7 })
    expect(parseNavHash(link.slice(link.indexOf('#')))).toEqual({ target: '@durov', seq: 7 })
  })

  it('чат без якоря — как было до ссылок на сообщение', () => {
    expect(parseNavHash('#42')).toEqual({ target: '42', seq: undefined, threadRoot: undefined })
    expect(parseNavHash('#@durov')).toEqual({ target: '@durov', seq: undefined })
  })

  it('тред остаётся разбираемым', () => {
    expect(parseNavHash('#42_777')).toEqual({ target: '42', seq: undefined, threadRoot: 777 })
  })

  it('якорь у числового чата', () => {
    expect(parseNavHash('#42/7')).toEqual({ target: '42', seq: 7, threadRoot: undefined })
  })

  it('мусор не разбирается — навигация не трогается', () => {
    expect(parseNavHash('')).toBeUndefined()
    expect(parseNavHash('#')).toBeUndefined()
    expect(parseNavHash('#@')).toBeUndefined()
    expect(parseNavHash('#не-хэш')).toBeUndefined()
    expect(parseNavHash('#42/abc')).toBeUndefined() // хвост не число → и целиком не чат
  })

  it('юзернейм со слэшем в имени невозможен, но хвост-не-число не съедает цель', () => {
    expect(parseNavHash('#@durov/abc')).toEqual({ target: '@durov/abc', seq: undefined })
  })
})

describe('requestMessageJump', () => {
  beforeEach(() => useSearchStore.getState().clearPendingJump())

  it('ставит тот же pendingJump, что и переход из поиска', () => {
    requestMessageJump(42, 7)
    expect(useSearchStore.getState().pendingJump).toEqual({ chatId: 42, seq: 7 })
  })
})
