// Тема оформления чата после решения Р7: её место в схеме — ПОЛНАЯ карточка
// (`chatFull`/`userFull.theme_emoticon`), в строке `dialog` поля нет вовсе.
//
// Пин на то, что зеркало карточек и есть её единственный дом: кадр
// `chat_theme_update` патчит ТУ ЖЕ карточку, а не заводит рядом второе
// хранилище тем (прежде тема жила плоским `Dialog.themeId`, и владелец диалогов
// был вторым источником того же факта).
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyChatTheme,
  cachedPeerFull,
  cachedPeerTheme,
  chatFullMirrorVersion,
  resetChatFullMirror,
  saveChatFull,
  subscribeChatFullMirror,
} from './chatFullCache'
import type { ChannelFull, UserFull } from './peers/peer'

const channelFull = (id: number, theme?: string): ChannelFull => ({
  _: 'channelFull', id, about: '',
  read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null,
  ...(theme ? { theme_emoticon: theme } : {}),
})

const userFull = (id: number, theme?: string): UserFull => ({
  _: 'userFull', id, ...(theme ? { theme_emoticon: theme } : {}),
})

beforeEach(() => { resetChatFullMirror() })

describe('chatFullCache: зеркало полных карточек', () => {
  it('карточки ещё нет — темы нет (а не пустая строка молча)', () => {
    expect(cachedPeerFull(-9)).toBeUndefined()
    expect(cachedPeerTheme(-9)).toBeUndefined()
  })

  it('тема группы приезжает в channelFull.theme_emoticon', () => {
    saveChatFull(-9, channelFull(9, 'sunset'))
    expect(cachedPeerTheme(-9)).toBe('sunset')
  })

  it('тема приватного чата — в userFull.theme_emoticon (у нас это id пресета)', () => {
    saveChatFull(7, userFull(7, 'night'))
    expect(cachedPeerTheme(7)).toBe('night')
  })

  it('пустая строка — «темы нет», как и отсутствие карточки', () => {
    saveChatFull(-9, channelFull(9, ''))
    expect(cachedPeerTheme(-9)).toBeUndefined()
  })

  it('кадр chat_theme_update патчит ТУ ЖЕ карточку и будит подписчиков', () => {
    saveChatFull(-9, channelFull(9, 'sunset'))
    let woken = 0
    const stop = subscribeChatFullMirror(() => { woken++ })

    applyChatTheme(-9, 'night')

    expect(cachedPeerTheme(-9)).toBe('night')
    // Карточка одна: остальные её поля патч не потерял.
    expect(cachedPeerFull(-9)).toMatchObject({ _: 'channelFull', id: 9 })
    expect(woken).toBe(1)
    stop()
  })

  it('та же тема повторно — подписчиков не будит (версия не двигается)', () => {
    saveChatFull(-9, channelFull(9, 'sunset'))
    const before = chatFullMirrorVersion()

    applyChatTheme(-9, 'sunset')
    saveChatFull(-9, channelFull(9, 'sunset'))

    expect(chatFullMirrorVersion()).toBe(before)
  })

  it('карточки ещё нет — патчить нечего, тема приедет вместе с ней', () => {
    applyChatTheme(-9, 'night')
    expect(cachedPeerFull(-9)).toBeUndefined()
  })

  it('смена аккаунта очищает зеркало — карточки прошлой сессии чужие', () => {
    saveChatFull(-9, channelFull(9, 'sunset'))
    resetChatFullMirror()
    expect(cachedPeerTheme(-9)).toBeUndefined()
  })
})
