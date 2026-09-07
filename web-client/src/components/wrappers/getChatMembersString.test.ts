// Подпись «N подписчиков / N участников, N онлайн» — порт tweb
// `getChatMembersString.ts:9-22` + хвоста `appImManager.ts:3096-3110`.
//
// Пинуется РЕЗУЛЬТАТ — текст, который увидит пользователь, — на настоящем ядре
// локализации (`applyLang` подаёт словарь), а не форма вызова. Ровно на этом
// дефект и держался: шапка чата писала `${members} подписчиков` литералом,
// поэтому на английском пакете оставалась русской, не склоняла («1
// подписчиков») и показывала ноль.
import { beforeAll, describe, expect, it } from 'vitest'
import I18n from '@lib/langPack'
import type { LangPackKey } from '@/lang'
import type { Chat } from '@core/peers/peer'
import { applyLang } from '../../test/lang'
import { getChatMembersString, getChatStatusString, getParticipantsCount } from './getChatMembersString'

/** Форматтер ядра — тот же, что отдаёт `useI18nStore().tArgs`. */
const tArgs = (key: LangPackKey, args: (string | number)[]) => I18n.format(key, true, args)

const channel = (over: Partial<Chat & { _: 'channel' }> = {}): Chat => ({
  _: 'channel',
  id: 1,
  title: 'Канал',
  pFlags: { broadcast: true },
  participants_count: 8,
  ...over,
} as Chat)

const megagroup = (participants: number): Chat => channel({
  pFlags: { megagroup: true },
  participants_count: participants,
} as Partial<Chat & { _: 'channel' }>)

describe('подпись числа участников', () => {
  describe('английский пакет', () => {
    beforeAll(async () => { await applyLang('en') })

    it('канал — «N subscribers», группа — «N members»', () => {
      expect(getChatMembersString(channel(), tArgs)).toBe('8 subscribers')
      expect(getChatMembersString(megagroup(8), tArgs)).toBe('8 members')
    })

    it('единица даёт единственное число, а не общую форму', () => {
      expect(getChatMembersString(channel({ participants_count: 1 }), tArgs)).toBe('1 subscriber')
    })
  })

  describe('русский пакет', () => {
    beforeAll(async () => { await applyLang('ru') })

    it('строка приходит из словаря, а не литералом', () => {
      expect(getChatMembersString(channel(), tArgs)).toBe('8 подписчиков')
      expect(getChatMembersString(megagroup(8), tArgs)).toBe('8 участников')
    })

    it('склоняется по правилу языка: 1 / 2 / 5 / 21', () => {
      const forms = [1, 2, 5, 21].map((n) => getChatMembersString(channel({ participants_count: n }), tArgs))
      expect(forms).toEqual(['1 подписчик', '2 подписчика', '5 подписчиков', '21 подписчик'])
    })

    it('нуля участников не бывает: пустой счётчик даёт единицу (tweb :18)', () => {
      // Ровно тот «0 подписчиков», который висел в шапке: ноль в
      // `participants_count` значит «поле ещё не приехало», а не «никого нет».
      expect(getChatMembersString(channel({ participants_count: 0 }), tArgs)).toBe('1 подписчик')
      expect(getChatMembersString(channel({ participants_count: undefined }), tArgs)).toBe('1 подписчик')
    })

    it('число разбито по тысячам (tweb :21)', () => {
      expect(getChatMembersString(channel({ participants_count: 12345 }), tArgs)).toBe('12 345 подписчиков')
    })

    it('«N онлайн» приписывается только при onlines > 1 (tweb :3103)', () => {
      // Единица — это ты сам: «1 онлайн» в открытом тобою чате — константа.
      expect(getChatStatusString(megagroup(8), 0, tArgs)).toBe('8 участников')
      expect(getChatStatusString(megagroup(8), 1, tArgs)).toBe('8 участников')
      expect(getChatStatusString(megagroup(8), 3, tArgs)).toBe('8 участников, 3 онлайн')
    })
  })

  it('счётчика нет у *Forbidden — там его нет ПО СХЕМЕ', () => {
    expect(getParticipantsCount({ _: 'channelForbidden', id: 1, title: 'x' } as Chat)).toBe(0)
    expect(getParticipantsCount(undefined)).toBe(0)
  })
})
