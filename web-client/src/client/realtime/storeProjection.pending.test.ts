// Пины пути «неотправленное сообщение → экран» ПОСЛЕ переноса жизненного цикла в
// менеджер воркера. Пяти кадров rt:pending_* больше нет: бабл появляется,
// патчится и исчезает теми же MessageOp, что и любое другое изменение окна,
// поэтому здесь гоняется НАСТОЯЩАЯ механика воркера (newPendingMethods) и её
// операции переигрываются проектором — раньше эти же гарантии держались на
// пяти отдельных обработчиках APPLY.
//
// Гейт-паттерн (registerStoreProjection один раз в beforeAll +
// dispatchEventSingle) — как в soundSubscriber.test.ts/notificationSubscriber.test.ts.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT, type PendingNewEvt } from '../../core/realtime/events'
import { newPendingMethods } from '../../core/managers/messages/pending'
import SlicedArray, { SliceEnd } from '../../core/history/slicedArray'
import { useMessagesStore, winKey } from '../../stores/messagesStore'
import type { Message } from '../../core/models'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

const CHAT = 30
const THREAD = 40
const SENDER = 7

function bubbles(key: string) {
  return useMessagesStore.getState().byKey[key]?.msgs ?? []
}

/** Воркерная сторона: SSOT + срезы окон, как в messagesManager. */
function worker(keys: string[]) {
  const slices = new Map<string, SlicedArray<number>>()
  const msgsByChat = new Map<number, Map<number, Message>>()
  for (const key of keys) {
    const sa = new SlicedArray<number>()
    sa.first.setEnd(SliceEnd.Bottom) // окно держит низ истории — иначе бабл не вставляется
    slices.set(key, sa)
  }
  return newPendingMethods({
    hkey: (chatId, threadRoot) => (threadRoot ? `${chatId}:${threadRoot}` : String(chatId)),
    slices,
    msgsFor: (chatId) => {
      let c = msgsByChat.get(chatId)
      if (!c) { c = new Map(); msgsByChat.set(chatId, c) }
      return c
    },
    // `out` бабла (порт tweb pFlags.out) выводит владелец — здесь это тот же
    // отправитель, что у всех сообщений стенда (SENDER).
    getMeId: () => SENDER,
    // Предмет этого файла — путь «операция → окно», поэтому веер и транспорт
    // здесь заглушены: операции emit'ятся вручную (см. emit ниже), а отправка/
    // аплоад покрыты у владельца (managers/messages/pending.test.ts).
    emit: () => {},
    send: () => {},
    upload: () => Promise.resolve(0),
    cancelUpload: () => {},
    sendTyping: () => {},
    uploadProgress: () => {},
  })
}

/** Кадр воркера с операциями — ровно то, что рассылает владелец окна. */
function emit(ops: ReturnType<ReturnType<typeof worker>['beforeMessageSending']>) {
  rootScope.dispatchEventSingle(RT.messageOp, { ops })
}

const evt = (over: Partial<PendingNewEvt> = {}): PendingNewEvt => ({
  chat_id: CHAT, client_msg_id: 'c1', sender_id: SENDER, text: 'hi', ...over,
})

describe('storeProjection — жизненный цикл неотправленного бабла приезжает операциями', () => {
  // Managers обработчикам этих кадров не нужны (только chatsReload/refresh
  // в других ветках APPLY) — как в cacheFirst.test.ts.
  beforeAll(() => registerStoreProjection({} as unknown as Managers))

  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
    useMessagesStore.getState().setWindow(winKey(CHAT), { msgs: [], reachedTop: true, reachedBottom: true })
  })

  // Что ломается, если гарантия нарушена: если бы insert-операция бабла не
  // доезжала до окна (или ехала без clientId), оптимистичный бабл своей же
  // отправки не появился бы на экране до серверного эха — пользователь не видел
  // бы своё сообщение сразу после отправки.
  it('бабл появился в окне, clientId === client_msg_id, failed не выставлен', () => {
    const w = worker([winKey(CHAT)])

    emit(w.beforeMessageSending(evt()))

    const msgs = bubbles(winKey(CHAT))
    expect(msgs).toHaveLength(1)
    expect(msgs[0].clientId).toBe('c1')
    expect(msgs[0].failed).toBeUndefined()
  })

  // Что ломается: если бы операция ехала с ключом основного окна вместо ключа
  // треда, бабл ответа в форум-топике/комментариях попал бы в основную ленту
  // чата — либо продублировался бы там, где его быть не должно.
  it('бабл треда попадает в окно треда (и в основное — оба ключа несёт сама операция)', () => {
    useMessagesStore.getState().setWindow(winKey(CHAT, THREAD), { msgs: [], reachedTop: true, reachedBottom: true })
    const w = worker([winKey(CHAT), winKey(CHAT, THREAD)])

    emit(w.beforeMessageSending(evt({ client_msg_id: 'c2', thread_root_id: THREAD })))

    expect(bubbles(winKey(CHAT, THREAD)).map((m) => m.clientId)).toEqual(['c2'])
    expect(bubbles(winKey(CHAT)).map((m) => m.clientId)).toEqual(['c2'])
  })

  // Что ломается: если бы patch аплоада не находил бабл по id (или подменял весь
  // объект вместо точечного слияния), у бабла после завершения аплоада либо не
  // проставилось бы превью (mediaId), либо съехали остальные поля.
  it('аплоад завершился → у бабла mediaId, остальные поля не тронуты', () => {
    const w = worker([winKey(CHAT)])
    emit(w.beforeMessageSending(evt({ client_msg_id: 'c3', text: 'photo caption', type: 'photo' })))

    emit(w.attachPendingMedia('c3', 555))

    const msgs = bubbles(winKey(CHAT))
    expect(msgs).toHaveLength(1)
    expect(msgs[0].mediaId).toBe(555)
    expect(msgs[0].text).toBe('photo caption')
    expect(msgs[0].clientId).toBe('c3')
  })

  // Что ломается: если бы ошибка не проставляла failed (или, хуже, убирала бабл
  // из окна), пользователь либо не увидел бы красной отметки, либо потерял бы
  // черновик — UX требует оставить бабл для retry/delete.
  it('ошибка отправки → failed: true, бабл остался в окне; ретрай снимает пометку', () => {
    const w = worker([winKey(CHAT)])
    emit(w.beforeMessageSending(evt({ client_msg_id: 'c4', text: 'oops' })))

    emit(w.failPendingMessage('c4'))
    expect(bubbles(winKey(CHAT))).toHaveLength(1)
    expect(bubbles(winKey(CHAT))[0].failed).toBe(true)

    emit(w.retryPendingMessage('c4'))
    expect(bubbles(winKey(CHAT))[0].failed).toBeUndefined()
  })

  // Что ломается: если бы remove не находил бабл по id, кнопка «удалить» на
  // упавшем сообщении (и отмена аплоада) оставляла бы призрачный бабл навсегда.
  it('отмена → бабла нет', () => {
    const w = worker([winKey(CHAT)])
    emit(w.beforeMessageSending(evt({ client_msg_id: 'c6', text: 'delete me' })))
    expect(bubbles(winKey(CHAT))).toHaveLength(1)

    emit(w.cancelPendingMessage('c6'))

    expect(bubbles(winKey(CHAT))).toHaveLength(0)
  })

  // Что ломается: ack переставляет id/seq/дату — без применения этой операции
  // бабл навсегда остался бы «отправляется…» (часы вместо галочки).
  it('ack → у бабла серверные id/seq, clientId сохранён (React-ключ стабилен)', () => {
    const w = worker([winKey(CHAT)])
    emit(w.beforeMessageSending(evt({ client_msg_id: 'c8' })))

    emit(w.ackPendingMessage({ client_msg_id: 'c8', msg_id: 900, seq: 50, created_at: '2026-08-16T10:00:00Z' }))

    const msgs = bubbles(winKey(CHAT))
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe(900)
    expect(msgs[0].seq).toBe(50)
    expect(msgs[0].clientId).toBe('c8')
  })
})

// localUrl больше НЕ вкладочное обогащение: blob-URL минтит воркер внутри
// messages.sendFile, поэтому он лежит в SSOT и приезжает обычным полем
// операции — одинаково во все вкладки. Раньше здесь проверялось обратное
// (своя вкладка накладывает превью, чужая — нет) и жил модуль localPreview.ts.
describe('storeProjection — локальное превью приезжает полем операции воркера', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))

  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
    useMessagesStore.getState().setWindow(winKey(CHAT), { msgs: [], reachedTop: true, reachedBottom: true })
  })

  // Что ломается: не доедь превью до окна — мгновенного показа отправляемого
  // фото/видео (единственная причина существования поля) не было бы вовсе,
  // бабл ждал бы конца аплоада и серверной картинки.
  it('local_url заявки становится localUrl бабла', () => {
    const w = worker([winKey(CHAT)])

    emit(w.beforeMessageSending(evt({ client_msg_id: 'c7a', type: 'photo', local_url: 'blob:worker-minted' })))

    expect(bubbles(winKey(CHAT))[0].localUrl).toBe('blob:worker-minted')
  })

  // Что ломается: пришло настоящее сообщение (положительный id) — его localUrl
  // переносится слиянием по clientId (messageOps.insert), иначе картинка
  // моргнула бы на подложку, пока грузится серверная.
  it('пришло настоящее сообщение → localUrl перенесён слиянием', () => {
    const w = worker([winKey(CHAT)])
    emit(w.beforeMessageSending(evt({ client_msg_id: 'c7c', type: 'photo', local_url: 'blob:worker-minted' })))

    emit(w.ackPendingMessage({ client_msg_id: 'c7c', msg_id: 901, seq: 51, created_at: 'now' }))

    const msgs = bubbles(winKey(CHAT))
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe(901)
    expect(msgs[0].localUrl).toBe('blob:worker-minted')
  })
})
