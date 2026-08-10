// Пины жизненного цикла pending-кадров (storeProjection.ts:73-83) — единственного
// пути появления оптимистичного бабла на экране (воркер бродкастит
// pendingNew/pendingMedia/pendingFail/pendingRetry/pendingRemove, storeProjection
// применяет их к messagesStore). Этот путь был совсем не покрыт тестами; страховка
// нужна ДО переезда домена сообщений на replay операций из воркера. Гейт-паттерн
// (registerXxxSubscriber один раз в beforeAll + dispatchEventSingle) — как в
// soundSubscriber.test.ts/notificationSubscriber.test.ts.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT, type PendingNewEvt, type PendingMediaEvt, type PendingRouteEvt } from '../../core/realtime/events'
import { useMessagesStore, winKey } from '../../stores/messagesStore'
import tabId from '../../config/tabId'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

const CHAT = 30
const THREAD = 40
const SENDER = 7

function bubbles(key: string) {
  return useMessagesStore.getState().byKey[key]?.msgs ?? []
}

describe('storeProjection — пины жизненного цикла pending-кадров', () => {
  // Managers обработчикам pending*-кадров не нужны (только chatsReload/refresh
  // в других ветках APPLY) — как в cacheFirst.test.ts.
  beforeAll(() => registerStoreProjection({} as unknown as Managers))

  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
  })

  // Что ломается, если гарантия нарушена: если бы pendingNew перестал писать в
  // стор (или писал без clientId), оптимистичный бабл своей же отправки не
  // появился бы на экране до серверного эха — пользователь не увидел бы своё
  // сообщение сразу после отправки (единственный путь появления бабла — этот кадр).
  it('pendingNew → бабл появился в окне, clientId === client_msg_id, failed не выставлен', () => {
    const evt: PendingNewEvt = { chat_id: CHAT, client_msg_id: 'c1', sender_id: SENDER, text: 'hi' }
    rootScope.dispatchEventSingle(RT.pendingNew, evt)
    const msgs = bubbles(winKey(CHAT))
    expect(msgs).toHaveLength(1)
    expect(msgs[0].clientId).toBe('c1')
    expect(msgs[0].failed).toBeUndefined()
  })

  // Что ломается, если гарантия нарушена: если бы pendingNew резолвил окно по
  // winKey(chat_id) вместо winKey(chat_id, thread_root_id) (напр. при рефакторе
  // «унифицировали» с applyIncoming, которая пишет в ОБА окна), бабл ответа в
  // форум-топике/комментариях попал бы в основную ленту чата — либо продублировался
  // бы там, где его быть не должно.
  it('pendingNew с thread_root_id → бабл попал в окно треда, а не в основное', () => {
    const evt: PendingNewEvt = { chat_id: CHAT, thread_root_id: THREAD, client_msg_id: 'c2', sender_id: SENDER, text: 'hi-thread' }
    rootScope.dispatchEventSingle(RT.pendingNew, evt)
    const threadMsgs = bubbles(winKey(CHAT, THREAD))
    expect(threadMsgs).toHaveLength(1)
    expect(threadMsgs[0].clientId).toBe('c2')
    // Основное окно вообще не тронуто (pendingNew пишет в ОДНО окно по winKey, в
    // отличие от applyIncoming, которая заводит запись и в основном, и в треде).
    expect(useMessagesStore.getState().byKey[winKey(CHAT)]).toBeUndefined()
  })

  // Что ломается, если гарантия нарушена: если бы pendingMedia не находил бабл по
  // clientId (напр. сломался матч по client_msg_id) или перетирал текст/другие
  // поля вместо точечного patch mediaId, у бабла после завершения аплоада либо не
  // проставилось превью (mediaId), либо съехали остальные поля бабла.
  it('pendingMedia → у бабла проставлен mediaId, остальные поля не тронуты', () => {
    const newEvt: PendingNewEvt = { chat_id: CHAT, client_msg_id: 'c3', sender_id: SENDER, text: 'photo caption' }
    rootScope.dispatchEventSingle(RT.pendingNew, newEvt)
    const mediaEvt: PendingMediaEvt = { chat_id: CHAT, client_msg_id: 'c3', media_id: 555 }
    rootScope.dispatchEventSingle(RT.pendingMedia, mediaEvt)
    const msgs = bubbles(winKey(CHAT))
    expect(msgs).toHaveLength(1)
    expect(msgs[0].mediaId).toBe(555)
    expect(msgs[0].text).toBe('photo caption')
    expect(msgs[0].clientId).toBe('c3')
  })

  // Что ломается, если гарантия нарушена: если бы pendingFail не проставлял
  // failed (или, хуже, убирал бабл из окна), пользователь либо не увидел бы
  // красную отметку ошибки отправки, либо (при удалении) потерял бы черновик —
  // хотя UX требует оставить бабл для retry/delete (см. комментарий у failOptimistic).
  it('pendingFail → failed: true, бабл остался в окне (не удалён)', () => {
    const newEvt: PendingNewEvt = { chat_id: CHAT, client_msg_id: 'c4', sender_id: SENDER, text: 'oops' }
    rootScope.dispatchEventSingle(RT.pendingNew, newEvt)
    const failEvt: PendingRouteEvt = { chat_id: CHAT, client_msg_id: 'c4' }
    rootScope.dispatchEventSingle(RT.pendingFail, failEvt)
    const msgs = bubbles(winKey(CHAT))
    expect(msgs).toHaveLength(1)
    expect(msgs[0].failed).toBe(true)
  })

  // Что ломается, если гарантия нарушена: если бы pendingRetry не снимал failed
  // (или снимал его у неверного бабла), кнопка «повторить отправку» не убрала бы
  // красную отметку ошибки — бабл выглядел бы отправленным заново, но с состоянием
  // ошибки, что путает пользователя.
  it('pendingRetry после pendingFail → failed снят', () => {
    const newEvt: PendingNewEvt = { chat_id: CHAT, client_msg_id: 'c5', sender_id: SENDER, text: 'retry me' }
    rootScope.dispatchEventSingle(RT.pendingNew, newEvt)
    rootScope.dispatchEventSingle(RT.pendingFail, { chat_id: CHAT, client_msg_id: 'c5' } as PendingRouteEvt)
    expect(bubbles(winKey(CHAT))[0].failed).toBe(true)
    rootScope.dispatchEventSingle(RT.pendingRetry, { chat_id: CHAT, client_msg_id: 'c5' } as PendingRouteEvt)
    expect(bubbles(winKey(CHAT))[0].failed).toBeUndefined()
  })

  // Что ломается, если гарантия нарушена: если бы pendingRemove не фильтровал
  // бабл из окна (напр. сравнивал по неверному id), кнопка «удалить» на упавшем
  // сообщении оставляла бы призрачный бабл на экране навсегда.
  it('pendingRemove → бабла нет', () => {
    const newEvt: PendingNewEvt = { chat_id: CHAT, client_msg_id: 'c6', sender_id: SENDER, text: 'delete me' }
    rootScope.dispatchEventSingle(RT.pendingNew, newEvt)
    expect(bubbles(winKey(CHAT))).toHaveLength(1)
    rootScope.dispatchEventSingle(RT.pendingRemove, { chat_id: CHAT, client_msg_id: 'c6' } as PendingRouteEvt)
    expect(bubbles(winKey(CHAT))).toHaveLength(0)
  })

  // Что ломается, если гарантия нарушена: если бы проверка `e.origin_tab !== tabId`
  // (storeProjection.ts:73-77) была снята или инвертирована, кадр СВОЕЙ вкладки
  // потерял бы localUrl — мгновенное превью до аплоада (единственная причина
  // существования этого поля) не показывалось бы вовсе, хотя blob-URL в своей
  // вкладке валиден.
  it('localUrl своей вкладки (origin_tab === наш tabId) — сохраняется', () => {
    const evt: PendingNewEvt = {
      chat_id: CHAT, client_msg_id: 'c7a', sender_id: SENDER, text: 'photo',
      origin_tab: tabId, media: { localUrl: 'blob:own-tab' },
    }
    rootScope.dispatchEventSingle(RT.pendingNew, evt)
    expect(bubbles(winKey(CHAT))[0].localUrl).toBe('blob:own-tab')
  })

  // Что ломается, если гарантия нарушена: если бы проверку `e.origin_tab !== tabId`
  // убрали, кадр из ЧУЖОЙ вкладки нёс бы в бабл blob-URL, который в этой вкладке
  // никогда не резолвится (создан в другом браузерном контексте) — «битый превью
  // навсегда» (localUrl приоритетнее mediaId в рендере и не очищается позже).
  it('localUrl чужой вкладки (origin_tab !== наш tabId) — вырезается', () => {
    const evt: PendingNewEvt = {
      chat_id: CHAT, client_msg_id: 'c7b', sender_id: SENDER, text: 'photo',
      origin_tab: tabId + 1, media: { localUrl: 'blob:foreign-tab' },
    }
    rootScope.dispatchEventSingle(RT.pendingNew, evt)
    expect(bubbles(winKey(CHAT))[0].localUrl).toBeUndefined()
  })
})
