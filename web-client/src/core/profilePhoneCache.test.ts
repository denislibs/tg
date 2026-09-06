// Пин на `core/profilePhoneCache.ts` — единственный дом приватность-применённого
// телефона (см. докблок файла: телефон реально считает ТОЛЬКО `privacy.profile()`,
// общее зеркало пиров его никогда не несёт). Механика зеркала — снимок +
// подписка + версия, тот же приём, что у `chatFullCache.ts`/`peerCache.ts`.
import { beforeEach, describe, expect, it } from 'vitest'
import { beginPeerFullFetch } from './chatFullCache'
import {
  cachedProfilePhone,
  profilePhoneMirrorVersion,
  resetProfilePhoneMirror,
  saveProfilePhone,
  subscribeProfilePhoneMirror,
} from './profilePhoneCache'

beforeEach(() => resetProfilePhoneMirror())

describe('profilePhoneCache', () => {
  it('нет записи — undefined (не пустая строка, не отличить «нет» от «скрыт»)', () => {
    expect(cachedProfilePhone(7)).toBeUndefined()
  })

  it('saveProfilePhone кладёт значение, cachedProfilePhone читает его синхронно', () => {
    saveProfilePhone(7, '+79991234567')
    expect(cachedProfilePhone(7)).toBe('+79991234567')
  })

  it('пустая строка (скрыт приватностью/номера нет) — валидное записанное значение, отличимое от "нет записи"', () => {
    saveProfilePhone(7, '')
    expect(cachedProfilePhone(7)).toBe('')
  })

  it('подписчик будится ТОЛЬКО на изменение значения', () => {
    let calls = 0
    const unsubscribe = subscribeProfilePhoneMirror(() => { calls++ })
    saveProfilePhone(7, '+1')
    expect(calls).toBe(1)
    saveProfilePhone(7, '+1') // то же значение — идемпотентный реплей не будит
    expect(calls).toBe(1)
    saveProfilePhone(7, '+2')
    expect(calls).toBe(2)
    unsubscribe()
  })

  it('версия растёт вместе с реальными изменениями', () => {
    const v0 = profilePhoneMirrorVersion()
    saveProfilePhone(7, '+1')
    expect(profilePhoneMirrorVersion()).toBe(v0 + 1)
    saveProfilePhone(7, '+1')
    expect(profilePhoneMirrorVersion()).toBe(v0 + 1) // без изменений — без бампа
  })

  it('устаревший тикет (перекрыт более новым походом за тем же peerId) отбрасывается молча', () => {
    const first = beginPeerFullFetch(7) // тикет 1
    beginPeerFullFetch(7) // тикет 2 — уже последний
    saveProfilePhone(7, '+1-stale', first)
    expect(cachedProfilePhone(7)).toBeUndefined()
  })

  it('без тикета пишет безусловно (источники без гонки — прямые вызовы, тесты)', () => {
    beginPeerFullFetch(7) // взводит "последний тикет" на что-то отличное от undefined
    saveProfilePhone(7, '+1')
    expect(cachedProfilePhone(7)).toBe('+1')
  })

  it('resetProfilePhoneMirror чистит зеркало и не будит подписчиков, если он и так пуст', () => {
    let calls = 0
    const unsubscribe = subscribeProfilePhoneMirror(() => { calls++ })
    resetProfilePhoneMirror() // пусто — не должен бампать
    expect(calls).toBe(0)

    saveProfilePhone(7, '+1') // будит (calls: 1)
    resetProfilePhoneMirror() // непустой — тоже будит (calls: 2)
    expect(cachedProfilePhone(7)).toBeUndefined()
    expect(calls).toBe(2)
    unsubscribe()
  })
})
