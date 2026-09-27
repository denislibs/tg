// src/stores/chatsStore.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  useChatsStore, loadChats,
  degradeExpiredPresence, startPresenceDegradation, PRESENCE_DEGRADE_INTERVAL_MS,
} from './chatsStore'
import rootScope from '@lib/rootScope'

const ME = {
  user: { _: 'user' as const, pFlags: { self: true as const }, id: 7, phone: '+1', first_name: 'Me' },
  fullUser: { _: 'userFull' as const, id: 7 },
  canMessage: true,
}

function fakeManagers(over: Partial<{ me: unknown }> = {}) {
  return {
    auth: { me: async () => over.me ?? ME },
  }
}

// Task 3 (перенос владения диалогами): applyNewMessage/applyRead/bumpUnreadReactions
// отсюда убраны — их тела переехали в core/managers/dialogsManager.ts, тесты на них —
// в dialogsManager.test.ts (describe «realtime-кадры применяет владелец»).
// Task 4 (действия без оптимистики): setDialogMuted (и setDialogPinned/
// setDialogTheme/setDialogArchived) отсюда тоже убраны — тела переехали во
// владельца (dialogsManager.applyMute/applyPinned/applyTheme/applyArchived),
// тесты на них — dialogsManager.test.ts (describe «действия без оптимистики»).
// Task 6: диалоговая половина `loadChats` тоже ушла владельцу — здесь остаётся
// только `me`, тесты на диалоги — dialogsManager.test.ts.
describe('chatsStore', () => {
  beforeEach(() => useChatsStore.setState({ me: null, meId: null }))

  it('loadChats populates me/meId', async () => {
    await loadChats(fakeManagers() as never)
    const s = useChatsStore.getState()
    expect(s.meId).toBe(7)
    expect(s.me).toEqual(ME)
  })

  // Два зеркала одного факта — `meId` для React-витрины и `rootScope.myId`
  // для ленты (`chat/bubbles.ts` решает по нему `needName`/`isOurMessage`) —
  // обязаны совпадать ВСЕГДА, в том числе когда `me` пришёл не кадром rt:me,
  // а ответом RPC холодного старта/входа. Кадр до вкладки может не доехать
  // вовсе: `SuperMessagePort` не буферизует, а насос поднимается ПОСЛЕ
  // первого рендера. Тогда лента видела `myId === 0`, и каждое своё
  // сообщение в группе считалось «от кого-то другого» — с именем автора.
  it('loadChats выставляет и rootScope.myId — зеркала не расходятся', async () => {
    rootScope.myId = 0
    await loadChats(fakeManagers() as never)
    expect(rootScope.myId).toBe(7)
  })

  it('setMe(null) гасит оба зеркала', () => {
    useChatsStore.getState().setMe(ME as never)
    useChatsStore.getState().setMe(null)
    expect(useChatsStore.getState().meId).toBeNull()
    expect(rootScope.myId).toBe(0)
  })
})

// Порт `appUsersManager.updateUsersStatuses` (`appUsersManager.ts:872-889`).
// Дефект, который эта пара строк закрывает: кадр «ушёл в оффлайн» может не
// доехать (вкладка спала, сокет рвался, difference пропустил эфемерный
// апдейт) — и человек висит онлайн ВЕЧНО. Ради этого `expires` и появился на
// проводе; гасит его клиент.
describe('деградация присутствия по expires', () => {
  beforeEach(() => useChatsStore.setState({ presence: {} }))

  it('истёкший userStatusOnline становится userStatusOffline с was_online = expires', () => {
    useChatsStore.setState({ presence: { 5: { _: 'userStatusOnline', expires: 1_000 } } })

    degradeExpiredPresence(1_001)

    expect(useChatsStore.getState().presence[5]).toEqual({ _: 'userStatusOffline', was_online: 1_000 })
  })

  it('ещё не истёкший онлайн не трогается, и ссылка на карту не меняется', () => {
    const presence = { 5: { _: 'userStatusOnline' as const, expires: 2_000 } }
    useChatsStore.setState({ presence })

    degradeExpiredPresence(1_999)

    expect(useChatsStore.getState().presence).toBe(presence)
  })

  it('прочие конструкторы статуса не трогаются', () => {
    useChatsStore.setState({ presence: { 5: { _: 'userStatusRecently' }, 6: { _: 'userStatusOffline', was_online: 1 } } })

    degradeExpiredPresence(9_999)

    expect(useChatsStore.getState().presence).toEqual({
      5: { _: 'userStatusRecently' }, 6: { _: 'userStatusOffline', was_online: 1 },
    })
  })

  it('интервал гасит статус без единого вызова руками (60 с, как в оригинале)', () => {
    vi.useFakeTimers()
    useChatsStore.setState({ presence: { 5: { _: 'userStatusOnline', expires: Math.floor(Date.now() / 1000) - 1 } } })
    const stop = startPresenceDegradation()

    vi.advanceTimersByTime(PRESENCE_DEGRADE_INTERVAL_MS)

    expect(useChatsStore.getState().presence[5]._).toBe('userStatusOffline')
    stop()
    vi.useRealTimers()
  })
})
