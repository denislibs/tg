// Вид чата — предикаты вместо 84 инлайновых сравнений `type === '…'` в 25
// файлах. Порт `appChatsManager.isChannel/isMegagroup/isForum/isBroadcast/
// isInChat` (`appChatsManager.ts:298-343`) и `appPeersManager.isAnyGroup`
// (`appPeersManager.ts:117-119`).
//
// Проверяется главное следствие модели: супергруппа — это `channel` С ФЛАГОМ
// `megagroup`, то есть на вопрос «канал?» она отвечает ДА, а на «вещательный?»
// — НЕТ. Из строки `type` этот ответ было не вывести, поэтому в каждом файле
// отвечали заново и по-разному.
import { describe, expect, it } from 'vitest'

import type { Chat } from './peer'
import { getChatTitle, isAnyGroup, isBroadcast, isChannel, isForum, isInChat, isMegagroup, isPublic } from './predicates'

const channel = (over: Partial<Extract<Chat, { _: 'channel' }>> = {}): Chat => ({
  _: 'channel', id: 42, title: 'Чат', photo: { _: 'chatPhotoEmpty' }, date: 0, ...over,
})

const BROADCAST = channel({ pFlags: { broadcast: true } })
const MEGAGROUP = channel({ pFlags: { megagroup: true } })
const FORUM = channel({ pFlags: { megagroup: true, forum: true } })

describe('вид чата', () => {
  it('супергруппа — это канал, но НЕ вещательный', () => {
    expect(isChannel(MEGAGROUP)).toBe(true)
    expect(isMegagroup(MEGAGROUP)).toBe(true)
    expect(isBroadcast(MEGAGROUP)).toBe(false)
  })

  it('канал — вещательный и не супергруппа', () => {
    expect(isChannel(BROADCAST)).toBe(true)
    expect(isMegagroup(BROADCAST)).toBe(false)
    expect(isBroadcast(BROADCAST)).toBe(true)
  })

  it('channelForbidden — тоже канал (порт :300)', () => {
    expect(isChannel({ _: 'channelForbidden', id: 42, title: 'x' })).toBe(true)
    expect(isMegagroup({ _: 'channelForbidden', id: 42, title: 'x', pFlags: { megagroup: true } })).toBe(true)
  })

  it('базовая группа каналом не считается', () => {
    const chat: Chat = { _: 'chat', id: 42, title: 'x', photo: { _: 'chatPhotoEmpty' }, participants_count: 2, date: 0 }
    expect(isChannel(chat)).toBe(false)
    expect(isBroadcast(chat)).toBe(false)
  })

  it('форум — флаг на канале, а не отдельный вид', () => {
    expect(isForum(FORUM)).toBe(true)
    expect(isForum(MEGAGROUP)).toBe(false)
  })

  it('карточки нет — все предикаты вида отвечают «нет»', () => {
    expect(isChannel(undefined)).toBe(false)
    expect(isMegagroup(undefined)).toBe(false)
    expect(isForum(undefined)).toBe(false)
    expect(isBroadcast(undefined)).toBe(false)
  })
})

describe('isAnyGroup — вопрос про ПИРА, а не про чат', () => {
  it('пользователь группой не является ни при какой карточке', () => {
    expect(isAnyGroup(7, undefined)).toBe(false)
  })

  it('супергруппа и базовая группа — да, вещательный канал — нет', () => {
    expect(isAnyGroup(-42, MEGAGROUP)).toBe(true)
    expect(isAnyGroup(-42, BROADCAST)).toBe(false)
  })

  // Порт оригинала буквально: `!isUser(peerId) && !isBroadcast(chatId)`.
  // Карточки ещё нет → `isBroadcast` даёт false → чат считается группой. Это
  // поведение ОРИГИНАЛА, а не наша неточность: до приезда карточки composer
  // показывают, а не прячут.
  it('карточки ещё нет — чат считается группой (как в оригинале)', () => {
    expect(isAnyGroup(-42, undefined)).toBe(true)
  })
})

describe('isInChat', () => {
  it('вышедший/деактивированный/forbidden — не в чате', () => {
    expect(isInChat(channel({ pFlags: { left: true } }))).toBe(false)
    expect(isInChat({ _: 'channelForbidden', id: 1, title: 'x' })).toBe(false)
    expect(isInChat({ _: 'chatForbidden', id: 1, title: 'x' })).toBe(false)
    expect(isInChat({ _: 'chatEmpty', id: 1 })).toBe(false)
    expect(isInChat({ _: 'chat', id: 1, title: 'x', photo: { _: 'chatPhotoEmpty' }, participants_count: 0, date: 0, pFlags: { deactivated: true } })).toBe(false)
  })

  it('обычный участник — в чате', () => {
    expect(isInChat(MEGAGROUP)).toBe(true)
  })
})

describe('isPublic — наличие имени, а не отдельное булево поле', () => {
  it('username есть — публичный', () => {
    expect(isPublic(channel({ username: 'team' }))).toBe(true)
    expect(isPublic(MEGAGROUP)).toBe(false)
  })
})

describe('getChatTitle', () => {
  it('у chatEmpty заголовка в схеме нет', () => {
    expect(getChatTitle({ _: 'chatEmpty', id: 1 })).toBe('')
    expect(getChatTitle(channel({ title: 'Наш чат' }))).toBe('Наш чат')
  })
})
