// Подписчик браузерных уведомлений на входящее сообщение.
//
// Гейт — порт tweb 1dc32d889 («Hold notifications back until the difference
// that could cancel them lands»). Раньше кадр catch-up (meta.catchUp) глушился
// целиком, то есть мы были жёстче оригинала: бэклог при скрытой вкладке
// молчал. Теперь уведомление ПРИДЕРЖИВАЕТСЯ, пока воркер не скажет, что
// difference, который мог бы его отменить (прочтение, заглушение), догнан
// (`managers.realtime.waitForSync`), и уже тогда проходит обычный гейт.
// Бэклог ПЕРВОГО difference после старта молчит только при активной вкладке.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT, type NewMessageEvt } from '../../core/realtime/events'
import { mapMessage, type Dialog } from '../../core/models'
import { makeRawMessage } from '../../core/messages/testMessage'
import { useChatsStore } from '../../stores/chatsStore'

const notifyIncomingMessage = vi.fn()
vi.mock('../uiNotifications', () => ({
  notifyIncomingMessage: (...args: unknown[]) => notifyIncomingMessage(...args),
}))

// Ответ воркера «догнали» — управляется тестом.
const waitForSync = vi.fn<(args: { peerId: number }) => Promise<void>>()
vi.mock('../bootstrap', () => ({
  startClient: () => ({ managers: { realtime: { waitForSync } } }),
}))

import { registerNotificationSubscriber } from './notificationSubscriber'

const raw = (id: number, text = 'привет') => makeRawMessage({ id, peerId: 5, fromId: 2, text })
const frame = (id: number): NewMessageEvt => ({ _: 'updateNewMessage', message: raw(id) })

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('notificationSubscriber — уведомление ждёт difference (tweb 1dc32d889)', () => {
  beforeAll(() => registerNotificationSubscriber())

  let hidden = true
  beforeEach(() => {
    notifyIncomingMessage.mockClear()
    waitForSync.mockReset().mockResolvedValue(undefined)
    useChatsStore.setState({ dialogs: [] })
    hidden = true
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('живой кадр без идущего difference — уведомление уходит', async () => {
    rootScope.dispatchEventSingle(RT.newMessage, frame(1), { catchUp: false })
    await flush()

    expect(waitForSync).toHaveBeenCalledWith({ peerId: 5 })
    expect(notifyIncomingMessage).toHaveBeenCalledTimes(1)
    expect(notifyIncomingMessage).toHaveBeenCalledWith(mapMessage(raw(1)))
  })

  it('кадр catch-up придерживается до конца difference, а потом уведомляет', async () => {
    const sync = deferred()
    waitForSync.mockReturnValue(sync.promise)

    rootScope.dispatchEventSingle(RT.newMessage, frame(1), { catchUp: true })
    await flush()
    expect(notifyIncomingMessage).not.toHaveBeenCalled()

    sync.resolve()
    await flush()
    expect(notifyIncomingMessage).toHaveBeenCalledTimes(1)
  })

  it('сообщение, прочитанное тем же difference, не уведомляет', async () => {
    const sync = deferred()
    waitForSync.mockReturnValue(sync.promise)

    rootScope.dispatchEventSingle(RT.newMessage, frame(1), { catchUp: true })
    await flush()
    // Прочтение с другого устройства приехало следующей страницей difference.
    const id = mapMessage(raw(1)).id
    useChatsStore.setState({ dialogs: [{ peerId: 5, read_inbox_max_id: id } as Dialog] })

    sync.resolve()
    await flush()
    expect(notifyIncomingMessage).not.toHaveBeenCalled()
  })

  it('пачка сообщений одного чата за время ожидания — одно уведомление о последнем', async () => {
    const sync = deferred()
    waitForSync.mockReturnValue(sync.promise)

    rootScope.dispatchEventSingle(RT.newMessage, frame(1), { catchUp: true })
    rootScope.dispatchEventSingle(RT.newMessage, frame(2), { catchUp: true })
    rootScope.dispatchEventSingle(RT.newMessage, frame(3), { catchUp: true })
    await flush()
    expect(waitForSync).toHaveBeenCalledTimes(1)

    sync.resolve()
    await flush()
    expect(notifyIncomingMessage).toHaveBeenCalledTimes(1)
    expect(notifyIncomingMessage).toHaveBeenCalledWith(mapMessage(raw(3)))
  })

  it('бэклог первого difference после старта при АКТИВНОЙ вкладке молчит', async () => {
    hidden = false

    rootScope.dispatchEventSingle(RT.newMessage, frame(1), { catchUp: true, initialSync: true })
    await flush()

    expect(notifyIncomingMessage).not.toHaveBeenCalled()
  })

  it('бэклог первого difference при СКРЫТОЙ вкладке уведомляет, как раньше', async () => {
    hidden = true

    rootScope.dispatchEventSingle(RT.newMessage, frame(1), { catchUp: true, initialSync: true })
    await flush()

    expect(notifyIncomingMessage).toHaveBeenCalledTimes(1)
  })

  it('признак начальной синхронизации берётся с ПЕРВОГО придержанного кадра', async () => {
    // tweb: запись очереди заводится `??=` вместе с isInitialSync и дальше
    // меняет только topMessage — поздний кадр признак не перебивает.
    hidden = false
    const sync = deferred()
    waitForSync.mockReturnValue(sync.promise)

    rootScope.dispatchEventSingle(RT.newMessage, frame(1), { catchUp: true, initialSync: true })
    rootScope.dispatchEventSingle(RT.newMessage, frame(2), { catchUp: false })
    sync.resolve()
    await flush()

    expect(notifyIncomingMessage).not.toHaveBeenCalled()
  })

  it('воркер не ответил на ожидание — уведомление не теряется', async () => {
    waitForSync.mockRejectedValue(new Error('no manager method: realtime.waitForSync'))

    rootScope.dispatchEventSingle(RT.newMessage, frame(1), { catchUp: true })
    await flush()

    expect(notifyIncomingMessage).toHaveBeenCalledTimes(1)
  })
})
