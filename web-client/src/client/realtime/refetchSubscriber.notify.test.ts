// rt:resync (журнал вычищен, differenceTooLong): глобальные настройки уведомлений
// перечитываются, иначе тумблеры «Уведомления» остались бы старыми до перезагрузки.
import { describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import type { Managers } from '../bootstrap'
import { registerRefetchSubscriber } from './refetchSubscriber'

describe('rt:resync → notifyStore', () => {
  it('перечитывает настройки по типам', async () => {
    const getNotifyPeerTypeSettings = vi.fn(async () => ({
      notifyUsers: { _: 'peerNotifySettings' as const }, notifyChats: { _: 'peerNotifySettings' as const }, notifyBroadcasts: { _: 'peerNotifySettings' as const },
    }))
    registerRefetchSubscriber({ dialogs: { refresh: vi.fn().mockResolvedValue(undefined) }, notify: { getNotifyPeerTypeSettings } } as unknown as Managers)

    ;(rootScope.dispatchEventSingle as (event: string) => void)('rt:resync')

    await vi.waitFor(() => expect(getNotifyPeerTypeSettings).toHaveBeenCalledTimes(1))
  })
})
