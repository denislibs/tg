// Stage 1C.2 (Task 1): `me`/`meId` — воркер единственный владелец
// (workerCore.ts::setMe), публикует rt:me на старте и на каждой RPC-мутации
// профиля/премиума/логаута. Проектор — канонический писатель chatsStore.setMe
// (см. stores/noDuplicateMe.test.ts на отсутствие вторых мест мимо allow-list).
// Гейт-паттерн (registerStoreProjection один раз в beforeAll +
// dispatchEventSingle) — как в storeProjection.pending.test.ts.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { useChatsStore } from '../../stores/chatsStore'
import type { Managers } from '../bootstrap'
import type { User } from '../../core/managers/authManager'

import { registerStoreProjection } from './storeProjection'

const ME: User = {
  id: 7, phone: '+79990000001', username: 'denis_m', firstName: 'Денис', lastName: '',
  displayName: 'Денис', bio: '', birthday: null, avatarUrl: '', avatarPreview: '', phoneVisibility: 'contacts',
  premium: false, emojiStatus: '',
}

describe('storeProjection — rt:me применяется к chatsStore (единственный владелец — воркер)', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))

  beforeEach(() => {
    useChatsStore.setState({ me: null, meId: null })
  })

  // Что ломается: если бы APPLY[RT.me] не звал chatsStore.setMe (или звал не
  // тот стор), опубликованный воркером профиль не попал бы на витрину — meId
  // остался бы null, и все читатели meId в компонентах сломались бы разом.
  it('rt:me с пользователем → me и meId в сторе обновились', () => {
    rootScope.dispatchEventSingle(RT.me, ME)
    const s = useChatsStore.getState()
    expect(s.me).toEqual(ME)
    expect(s.meId).toBe(7)
  })

  // Логаут: воркер публикует null — meId выводится из me тем же единым
  // писателем (chatsStore.ts::setMe), см. докблок там же.
  it('rt:me с null → me и meId сброшены', () => {
    useChatsStore.setState({ me: ME, meId: ME.id })
    rootScope.dispatchEventSingle(RT.me, null)
    const s = useChatsStore.getState()
    expect(s.me).toBeNull()
    expect(s.meId).toBeNull()
  })

  // Смена профиля (rt:me с обновлённым снимком) перезаписывает предыдущий —
  // не мерджит частично, ровно как чтение реального RPC-ответа.
  it('повторный rt:me с изменённым полем полностью заменяет me', () => {
    rootScope.dispatchEventSingle(RT.me, ME)
    const updated: User = { ...ME, displayName: 'Денис 2', avatarUrl: '/media/1/content' }
    rootScope.dispatchEventSingle(RT.me, updated)
    expect(useChatsStore.getState().me).toEqual(updated)
  })

  // Второе зеркало того же факта — `rootScope.myId` (порт tweb rootScope.ts:253),
  // его читает императивная лента (`components/chat/bubbles.ts`), которой нельзя
  // знать про zustand. Писатель обязан быть ОДИН (этот проектор) — иначе два
  // зеркала разъедутся; пин на «нет второго писателя» — stores/noDuplicateMe.test.ts.
  // Что ломается без строки `rootScope.myId = ...`: лента считает себя
  // неавторизованной (myId === 0) и, например, подписывает превью ответа на своё
  // же сообщение чужим именем вместо «Вы».
  it('rt:me пишет и второе зеркало — rootScope.myId (для императивной ленты)', () => {
    rootScope.myId = 0
    rootScope.dispatchEventSingle(RT.me, ME)
    expect(rootScope.myId).toBe(7)

    // Логаут: зеркало обязано вернуться в «никого» (у tweb — NULL_PEER_ID),
    // иначе следующий пользователь получил бы чужой id до первого rt:me.
    rootScope.dispatchEventSingle(RT.me, null)
    expect(rootScope.myId).toBe(0)
  })
})
