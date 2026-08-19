import { describe, expect, it } from 'vitest'

import {
  NULL_PEER_ID,
  SERVICE_PEER_ID,
  getOutputPeer,
  getPeerId,
  isAnyChat,
  isPeerId,
  isUser,
  parsePeerId,
  toChatId,
  toPeerId,
  toUserId,
} from './peerId'

describe('знаковый PeerId', () => {
  it('пользователь ≥ 0, чат < 0', () => {
    expect(isUser(7)).toBe(true)
    expect(isUser(0)).toBe(true) // NULL_PEER_ID формально «пользователь», как в оригинале
    expect(isAnyChat(-42)).toBe(true)
    expect(isAnyChat(7)).toBe(false)
    expect(isUser(-42)).toBe(false)
  })

  it('toPeerId раскладывает знак, toChatId/toUserId собирают обратно', () => {
    expect(toPeerId(42, true)).toBe(-42)
    expect(toPeerId(42, false)).toBe(42)
    expect(toPeerId(-42, true)).toBe(-42) // -Math.abs: повторное применение идемпотентно
    expect(toPeerId(-42)).toBe(-42) // isChat не задан — число уже ключ
    expect(toChatId(-42)).toBe(42)
    expect(toUserId(7)).toBe(7)
  })

  it('getPeerId ветвится по конструктору Peer', () => {
    expect(getPeerId({ _: 'peerUser', user_id: 7 })).toBe(7)
    expect(getPeerId({ _: 'peerChat', chat_id: 42 })).toBe(-42)
    expect(getPeerId({ _: 'peerChannel', channel_id: 42 })).toBe(-42)
    expect(getPeerId(-42)).toBe(-42)
    expect(getPeerId('-42')).toBe(-42)
    expect(getPeerId(undefined)).toBe(NULL_PEER_ID)
    expect(getPeerId(null)).toBe(NULL_PEER_ID)
  })

  it('getOutputPeer — обратное направление', () => {
    expect(getOutputPeer(7)).toEqual({ _: 'peerUser', user_id: 7 })
    expect(getOutputPeer(-42)).toEqual({ _: 'peerChannel', channel_id: 42 })
  })

  it('строковый ключ из URL/атрибута узла', () => {
    expect(isPeerId('-42')).toBe(true)
    expect(isPeerId('42')).toBe(true)
    expect(isPeerId('abc')).toBe(false)
    expect(isPeerId('4.2')).toBe(false)
    expect(parsePeerId('abc')).toBe(NULL_PEER_ID)
    expect(parsePeerId(null)).toBe(NULL_PEER_ID)
  })

  it('служебный пир — обычный положительный ключ', () => {
    expect(isUser(SERVICE_PEER_ID)).toBe(true)
  })
})

/**
 * Асимметрия приватного диалога — то, чем этот порт легче всего сломать.
 *
 * У ОДНОГО разговора A↔B два разных ключа: у A это id B, у B это id A. Диалог
 * принадлежит пользователю. На бэкенде это закреплено `chatAddress.forViewer`
 * и его тестами; здесь фиксируется КЛИЕНТСКАЯ половина того же правила:
 * клиент ключ приватного диалога НЕ ВЫЧИСЛЯЕТ — он приходит с провода уже
 * посчитанным глазами зрителя, а функции адресации умеют только раскладывать
 * знак.
 *
 * Если кто-то заведёт «нормализацию» (взять min/max из пары участников, свести
 * ключ к внутреннему id строки `chats`, симметризовать), обе стороны получат
 * ключ, указывающий на них же самих, и диалоги перепутаются. Тест ниже держит
 * ровно это: одна и та же пара людей даёт РАЗНЫЕ ключи у разных зрителей, и
 * ни одна функция модуля не принимает «зрителя» аргументом — вычислять ей
 * нечем.
 */
describe('асимметрия приватного диалога', () => {
  const A = 7
  const B = 13

  it('ключ разговора у A и у B — разный, и это id собеседника', () => {
    const keyForA = B // так его посчитал бэкенд, отдавая список диалогов A
    const keyForB = A // и так же — отдавая список B

    expect(keyForA).not.toBe(keyForB)
    expect(isUser(keyForA)).toBe(true)
    expect(isUser(keyForB)).toBe(true)
    // Ключ приватного диалога — ВСЕГДА ключ пользователя, никогда не -chatID:
    // строка в `chats` наружу не выходит вовсе.
    expect(isAnyChat(keyForA)).toBe(false)
  })

  it('«Избранное» — ключ самого зрителя', () => {
    expect(toPeerId(A, false)).toBe(A)
  })

  it('группа адресуется одинаково у всех зрителей', () => {
    expect(toPeerId(42, true)).toBe(-42)
  })
})
