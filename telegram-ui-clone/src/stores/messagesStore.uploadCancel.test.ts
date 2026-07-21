// Отмена аплоада с бабла: оптимистичное сообщение файла появляется сразу с
// метой (имя/размер/mime), removeOptimisticByClient убирает его по одному
// clientMsgId (окно ищется через clientToWin, как fail/reconcile).
import { describe, it, expect, beforeEach } from 'vitest'
import { useMessagesStore, winKey } from './messagesStore'

const KEY = winKey(5)

describe('messagesStore: оптимистичный файл + отмена аплоада', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
    useMessagesStore.getState().setWindow(KEY, { msgs: [], reachedTop: true, reachedBottom: true })
  })

  it('appendOptimistic для документа несёт имя/размер/mime до аплоада', () => {
    useMessagesStore.getState().appendOptimistic(KEY, '', 1, 'c-1', undefined, 'document', undefined, undefined, {
      mime: 'application/pdf', size: 1234, name: 'оферта.pdf',
    })
    const m = useMessagesStore.getState().byKey[KEY].msgs[0]
    expect(m.mediaName).toBe('оферта.pdf')
    expect(m.mediaSize).toBe(1234)
    expect(m.mediaMime).toBe('application/pdf')
    expect(m.mediaId).toBeNull() // аплоад ещё не завершён
  })

  it('removeOptimisticByClient удаляет бабл по clientMsgId', () => {
    useMessagesStore.getState().appendOptimistic(KEY, '', 1, 'c-2', undefined, 'document', undefined, undefined, {
      mime: 'application/zip', size: 9, name: 'a.zip',
    })
    expect(useMessagesStore.getState().byKey[KEY].msgs).toHaveLength(1)
    useMessagesStore.getState().removeOptimisticByClient('c-2')
    expect(useMessagesStore.getState().byKey[KEY].msgs).toHaveLength(0)
  })

  it('removeOptimisticByClient по неизвестному clientMsgId — no-op', () => {
    useMessagesStore.getState().appendOptimistic(KEY, '', 1, 'c-3', undefined, 'document')
    useMessagesStore.getState().removeOptimisticByClient('nope')
    expect(useMessagesStore.getState().byKey[KEY].msgs).toHaveLength(1)
  })

  it('после отмены поздний failOptimisticByClient не воскрешает бабл', () => {
    useMessagesStore.getState().appendOptimistic(KEY, '', 1, 'c-4', undefined, 'document')
    useMessagesStore.getState().removeOptimisticByClient('c-4')
    // upload() кинет 'aborted' → catch вызовет fail — должен быть no-op
    useMessagesStore.getState().failOptimisticByClient('c-4')
    expect(useMessagesStore.getState().byKey[KEY].msgs).toHaveLength(0)
  })
})
