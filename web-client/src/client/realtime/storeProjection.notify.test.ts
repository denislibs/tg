// `notify_settings` воркера (updateNotifySettings{notifyUsers|notifyChats|notifyBroadcasts})
// → notifyStore. Пер-чатные настройки сюда не едут: их владелец — диалоги (rt:dialog_op).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import rootScope from '@lib/rootScope'
import { MUTE_UNTIL_FOREVER } from '../../core/dialogs/notifySettings'
import { isTypeMuted, useNotifyStore } from '../../stores/notifyStore'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

describe('storeProjection — notify_settings применяется к notifyStore', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))
  beforeEach(() => useNotifyStore.setState({ settings: useNotifyStore.getInitialState().settings }))

  it('глобальный мьют «Личные чаты» с другого устройства переключает тип', () => {
    rootScope.dispatchEventSingle('notify_settings', {
      _: 'updateNotifySettings',
      peer: { _: 'notifyUsers' },
      notify_settings: { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER, show_previews: true },
    })
    const s = useNotifyStore.getState().settings
    expect(isTypeMuted(s, 'notifyUsers')).toBe(true)
    expect(isTypeMuted(s, 'notifyChats')).toBe(false)
  })
})
