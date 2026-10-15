// Событие `privacy_update` (tweb rootScope.ts:166, `Update.updatePrivacy`) пишет
// правило одного ключа в стор правил — тот же кэш, который читают хаб
// «Конфиденциальность» и профиль (роль `appPrivacyManager.privacy[key]`).
//
// Пин держит: ключ-КОНСТРУКТОР схемы переводится в наш ключ; вектор правил
// превращается в экранную форму (значение + два списка исключений); неизвестный
// конструктор ключа стор не портит.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import rootScope from '@lib/rootScope'
import { usePrivacyStore } from '../../stores/privacyStore'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

describe('storeProjection — privacy_update', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))
  beforeEach(() => usePrivacyStore.setState({ loaded: false }))

  it('правило ключа-конструктора ложится в стор экранной формой', () => {
    rootScope.dispatchEventSingle('privacy_update', {
      _: 'updatePrivacy',
      key: { _: 'privacyKeyStatusTimestamp' },
      rules: [
        { _: 'privacyValueAllowUsers', users: [7] },
        { _: 'privacyValueDisallowUsers', users: [8] },
        { _: 'privacyValueDisallowAll' },
      ],
    })

    expect(usePrivacyStore.getState().rules.last_seen).toEqual({
      key: 'last_seen', value: 'nobody', allowUserIds: [7], denyUserIds: [8],
    })
  })

  it('наш собственный ключ (privacyKeyReadTime) тоже узнаётся', () => {
    rootScope.dispatchEventSingle('privacy_update', {
      _: 'updatePrivacy', key: { _: 'privacyKeyReadTime' }, rules: [{ _: 'privacyValueAllowContacts' }],
    })

    expect(usePrivacyStore.getState().rules.read_time.value).toBe('contacts')
  })

  it('неизвестный конструктор ключа стор не трогает', () => {
    const before = usePrivacyStore.getState().rules
    rootScope.dispatchEventSingle('privacy_update', {
      _: 'updatePrivacy', key: { _: 'privacyKeyВыдуманный' }, rules: [{ _: 'privacyValueDisallowAll' }],
    })

    expect(usePrivacyStore.getState().rules).toBe(before)
  })
})
