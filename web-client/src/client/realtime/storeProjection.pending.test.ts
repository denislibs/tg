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
import { setLocalPreview, dropLocalPreview } from '../../core/media/localPreview'
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
  })
}

/** Кадр воркера с операциями — ровно то, что рассылает realtime.sendMessage. */
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

// localUrl — вкладочное обогащение (core/media/localPreview.ts): в SSOT воркера
// его нет by construction, поэтому «чужая вкладка» здесь = вкладка, которая
// setLocalPreview не звала. Раньше ту же задачу решал origin_tab в кадре
// pending_new, и вырезание чужого localUrl было обязанностью проектора.
describe('storeProjection — локальное превью накладывает только вкладка-инициатор', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))

  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
    useMessagesStore.getState().setWindow(winKey(CHAT), { msgs: [], reachedTop: true, reachedBottom: true })
  })

  // Что ломается: не наложи вкладка своё превью — мгновенного показа
  // отправляемого фото/видео (единственная причина существования поля) не было
  // бы вовсе, бабл ждал бы конца аплоада и серверной картинки.
  it('своя вкладка (setLocalPreview звался) → localUrl на бабле', () => {
    const w = worker([winKey(CHAT)])
    setLocalPreview('c7a', 'blob:own-tab')

    emit(w.beforeMessageSending(evt({ client_msg_id: 'c7a', type: 'photo' })))

    expect(bubbles(winKey(CHAT))[0].localUrl).toBe('blob:own-tab')
    dropLocalPreview('c7a')
  })

  // Что ломается: попади blob-URL в операцию (т.е. в SSOT воркера), остальные
  // вкладки получили бы ссылку, которая в их контексте не резолвится никогда, —
  // «битый превью навсегда» (localUrl приоритетнее mediaId и не очищается).
  it('чужая вкладка (своего превью нет) → localUrl не появляется', () => {
    const w = worker([winKey(CHAT)])

    emit(w.beforeMessageSending(evt({ client_msg_id: 'c7b', type: 'photo' })))

    expect(bubbles(winKey(CHAT))[0].localUrl).toBeUndefined()
  })

  // Что ломается: держи вкладка запись вечно — превью накладывалось бы и на
  // ПОСЛЕДУЮЩИЕ сообщения того же clientMsgId... но важнее другое: настоящее
  // сообщение приходит с положительным id, и его localUrl уже перенесён слиянием
  // по clientId (messageOps.insert) — накладывать заново не на что.
  it('пришло настоящее сообщение → localUrl перенесён слиянием, запись снята', () => {
    const w = worker([winKey(CHAT)])
    setLocalPreview('c7c', 'blob:own-tab')
    emit(w.beforeMessageSending(evt({ client_msg_id: 'c7c', type: 'photo' })))

    emit(w.ackPendingMessage({ client_msg_id: 'c7c', msg_id: 901, seq: 51, created_at: 'now' }))

    const msgs = bubbles(winKey(CHAT))
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe(901)
    expect(msgs[0].localUrl).toBe('blob:own-tab')
  })
})
