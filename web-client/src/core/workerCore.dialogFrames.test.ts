// Task 3 (realtime-кадры применяет владелец): проверяет, что createWorkerCore()
// РЕАЛЬНО зовёт dialogs.applyNewMessage/applyRead/applyRemoved/
// modifyUnreadReactions из dispatch()/routeNewMessage() — не только что сам
// dialogsManager умеет считать patch/remove из этих же кадров (это отдельно
// покрыто dialogsManager.test.ts), а что workerCore.ts реально подключает
// вызов владельца к живому WS-кадру.
//
// Приём — тот же, что в workerCore.connectionStatus.test.ts: мокаем
// newConnectionManager ЧАСТИЧНО (importOriginal), перехватываем переданный ему
// onFrame и зовём его НАПРЯМУЮ, как реальный WS-транспорт передал бы кадр —
// сама connectionManager (ws/reconnect) не участвует. Кадры БЕЗ `pts` проходят
// funnel безусловно (globalFunnel.ts: «без pts — эфемерный/устаревший бэк,
// транслируем как есть, не гейтим»), поэтому cursorReady/core.start() здесь не
// нужны — только core.bind().
//
// Файл — НЕ правка workerCore.dialogs.test.ts (Task 1, другой предмет: RPC
// fillMirror/setStateKey, не WS-кадры) и НЕ workerCore.test.ts — отдельный
// набор, чтобы module-scoped vi.mock не задевал уже существующие кейсы (тот же
// приём и то же обоснование, что в workerCore.connectionStatus.test.ts).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'
import { saveDialogs } from './store/persist'
import type { Dialog } from './models'
import type { DialogOp } from './dialogs/dialogOps'

let capturedConnDeps: CMDeps | null = null
vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: CMDeps) => {
      capturedConnDeps = deps
      return actual.newConnectionManager(deps)
    },
  }
})

import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { makeDialog, makeLastMessage } from './dialogs/testDialog'
import { makeRawMessage } from './messages/testMessage'
import { generateMessageId } from './history/messageId'

// Тот же приём, что и в workerCore.test.ts/workerCore.dialogs.test.ts —
// синхронная пара эндпоинтов.
function pair(): [Endpoint, Endpoint] {
  const listenersA: Array<(ev: MessageEvent) => void> = []
  const listenersB: Array<(ev: MessageEvent) => void> = []
  const epA: Endpoint = {
    postMessage: (m) => { for (const l of listenersB) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersA.push(l) },
  }
  const epB: Endpoint = {
    postMessage: (m) => { for (const l of listenersA) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersB.push(l) },
  }
  return [epA, epB]
}

const dialog = (peerId: number, at: string): Dialog => makeDialog({ peerId, lastMessage: makeLastMessage({ peerId, id: 1, fromId: 1, text: 'x', createdAt: at }) })

beforeEach(() => {
  // vi.stubGlobal (не прямое присваивание indexedDB=...) — та же замена, что и в
  // workerCore.test.ts/workerCore.dialogs.test.ts, без нового eslint(no-global-assign).
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
})

/** Поднимает воркер с диалогом peerId=1 уже в кэше dialogsManager (через fillMirror). */
async function bootWithSeededDialog(): Promise<{ dialogOps: DialogOp[]; core: ReturnType<typeof createWorkerCore> }> {
  await saveDialogs([dialog(1, '2026-08-01T00:00:00Z')])
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  const tab = new SuperMessagePort(epTab)
  const dialogOps: DialogOp[] = []
  tab.on('rt:dialog_op', (p) => dialogOps.push(...(p as { ops: DialogOp[] }).ops))
  await tab.invoke('manager', { name: 'dialogs', method: 'fillMirror', args: [] })
  dialogOps.length = 0 // интересуют только операции от самого кадра, не reset из fillMirror
  expect(capturedConnDeps).not.toBeNull()
  return { dialogOps, core }
}

/** История чата в SSOT воркера: бейдж непрочитанных реакций считает владелец
 *  окна, поэтому сообщение должно быть ему известно.
 *
 *  `core.start()` здесь обязателен: историю менеджер отдаёт только после
 *  гидрации личности (гейт `meReady`), а без неё промис не резолвится вовсе —
 *  тот же приём, что в workerCore.meHydration.test.ts. */
async function seedHistory(core: ReturnType<typeof createWorkerCore>, messages: unknown[]): Promise<void> {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    if (String(url).includes('/chats/1/history')) {
      return new Response(JSON.stringify({ messages, count: messages.length }), { status: 200 })
    }
    throw new Error('unexpected fetch ' + String(url))
  }))
  core.start()
  await core.registry.messages.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
}

describe('createWorkerCore(): realtime-кадры применяет владелец (Task 3)', () => {
  it('new_message (без pts) → dialogs.applyNewMessage → rt:dialog_op upsert пачкой', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    // Кадр несёт сообщение ЦЕЛИКОМ под ключом `message` — форма
    // `updateNewMessage` (решение Р5), плоских полей рядом больше нет.
    capturedConnDeps!.onFrame('new_message', {
      _: 'updateNewMessage',
      message: makeRawMessage({ id: 2, peerId: 1, fromId: 9, text: 'привет', createdAt: '2026-08-01T00:00:01Z' }),
    })

    // Строка с новым сообщением объявляется пачкой через `pause(0)` (tweb
    // `scheduleHandleNewDialogs`, appMessagesManager.ts:8946-8976).
    await new Promise((r) => setTimeout(r, 0))
    expect(dialogOps).toHaveLength(1)
    const op = dialogOps[0] as Extract<DialogOp, { op: 'upsert' }>
    expect(op.op).toBe('upsert')
    expect(op.items.map((i) => i.dialog.peerId)).toEqual([1])
    expect((op.items[0].dialog.lastMessage as { message?: string } | undefined)?.message).toBe('привет')
  })

  // `core.start()` здесь не звался (см. докблок выше) — `me` в воркере null,
  // поэтому applyRead(e, meId) идёт веткой «чужое прочтение» (meId=null !==
  // user_id=7); ветка «моё прочтение» и её идемпотентность — предмет
  // dialogsManager.test.ts, здесь важен сам факт вызова владельца из dispatch.
  it('read (без pts) → dialogs.applyRead → rt:dialog_op patch', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    // «Прочитали меня» — отдельный конструктор: горизонт собеседника без
    // моего счётчика непрочитанного.
    capturedConnDeps!.onFrame('read', {
      _: 'updateReadHistoryOutbox',
      peer: { _: 'peerUser', user_id: 1 },
      max_id: 1,
    })

    // Горизонт на проводе СЕРВЕРНЫЙ, в строке диалога — уже клиентский.
    expect(dialogOps).toEqual([{ op: 'patch', peerId: 1, fields: { read_outbox_max_id: generateMessageId(1) } }])
  })

  // Строка диалога кадром `chat_update` БОЛЬШЕ НЕ ТРОГАЕТСЯ: title/username/
  // photo/forum уехали из неё в карточку чата (вектор `chats` контейнера), и
  // перекладывать их обратно значило бы держать тот же факт в двух местах.
  // Единственный получатель снимка — зеркало пиров (следующий кейс).
  it('chat_update (без pts) — строку диалога не патчит вовсе', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('chat_update', {
      _: 'updateChatFullSnapshot',
      peer: { _: 'peerUser', user_id: 1 },
      chat_full: {
        _: 'messages.chatFull',
        full_chat: { _: 'channelFull', id: 1, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null },
        chats: [{ _: 'channel', id: 1, title: 'Новое имя', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true } }],
        users: [],
      },
    })

    expect(dialogOps).toEqual([])
  })

  // Пин пробела D2.5 №1 на втором его пути. Кадр `chat_update` несёт
  // АБСОЛЮТНЫЙ снимок карточки, из которого строке диалога нужны четыре поля;
  // весь остальной чат (`pFlags`, права, `default_banned_rights`) живёт в
  // зеркале пиров и попадает туда ТОЛЬКО через `peers.saveApiPeers` в
  // `dispatch` (порт `apiUpdatesManager.processUpdateMessage:239-240`).
  // Удаление той строки красит этот кейс: `rt:peer_op` не уйдёт вовсе.
  it('chat_update → peers.saveApiPeers → rt:peer_op с конструктором чата', async () => {
    await saveDialogs([dialog(1, '2026-08-01T00:00:00Z')])
    const core = createWorkerCore()
    const [epWorker, epTab] = pair()
    core.bind(epWorker)
    const tab = new SuperMessagePort(epTab)
    const peerOps: { op: string; peers: unknown[] }[] = []
    tab.on('rt:peer_op', (p) => peerOps.push(...(p as { ops: { op: string; peers: unknown[] }[] }).ops))
    await tab.invoke('manager', { name: 'dialogs', method: 'fillMirror', args: [] })

    // Заголовок УНИКАЛЬНЫЙ на весь файл: офлайн-стор карточек (v4 схемы) живёт
    // одним memoized-подключением на модуль, и карточка, записанная соседним
    // кейсом, поднялась бы гидратацией — владелец счёл бы её неизменившейся и
    // ничего бы не объявил.
    const chat = { _: 'channel', id: 1, title: 'Имя только этого кейса', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true } }
    capturedConnDeps!.onFrame('chat_update', {
      _: 'updateChatFullSnapshot',
      peer: { _: 'peerUser', user_id: 1 },
      chat_full: {
        _: 'messages.chatFull',
        full_chat: { _: 'channelFull', id: 1, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null },
        chats: [chat],
        users: [],
      },
    })

    expect(peerOps).toEqual([{ op: 'upsert', peers: [chat] }])
  })

  it('chat_removed (без pts) → dialogs.applyRemoved → rt:dialog_op remove', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    // Поле `removed: true` было константой и ушло: вид кадра несёт дискриминатор.
    capturedConnDeps!.onFrame('chat_removed', { _: 'updateChatRemoved', peer: { _: 'peerUser', user_id: 1 } })

    expect(dialogOps).toEqual([{ op: 'remove', peerId: 1 }])
  })

  // Черновик — ПОЛЕ диалога, поэтому кадр применяет тот же владелец, что и
  // остальные: от даты черновика зависит МЕСТО строки в списке, и второй
  // (main-side) вывод того же факта держал бы порядок в двух местах. Раньше
  // кадр слушала витрина (`storeProjection` → свой `draftsStore`) — этой
  // подписки больше нет, и удаление ветки в `dispatch` красит этот кейс.
  it('draft_update (без pts) → dialogs.applyDraft → rt:dialog_op patch', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('draft_update', {
      _: 'updateDraftMessage',
      peer: { _: 'peerUser', user_id: 1 },
      draft: { _: 'draftMessage', message: 'набросок', reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: 3 }, date: 1785578400 },
    })

    // Номер, на который отвечает черновик, приезжает СЕРВЕРНЫЙ, а в строке
    // диалога он уже клиентский — тем же переводом, что и горизонты чтения.
    expect(dialogOps).toEqual([{
      op: 'patch',
      peerId: 1,
      fields: {
        draft: {
          _: 'draftMessage',
          message: 'набросок',
          reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: generateMessageId(3) },
          date: 1785578400,
        },
      },
      // Черновик СВЕЖЕЕ последнего сообщения, поэтому дата активности строки —
      // его: индекс считается по ней (`dialogIndex`, младшие 16 бит — peerId).
      index: 1785578400 * 0x10000 + 1,
    }])
  })

  // «Черновик сняли» приезжает ДРУГИМ конструктором (`draftMessageEmpty`), и
  // владелец обязан СНЯТЬ ключ, а не положить его со значением: у конструктора
  // схемы «выключено» — это отсутствие параметра.
  it('draftMessageEmpty снимает черновик со строки', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('draft_update', {
      _: 'updateDraftMessage',
      peer: { _: 'peerUser', user_id: 1 },
      draft: { _: 'draftMessage', message: 'набросок', date: 1785578400 },
    })
    dialogOps.length = 0

    capturedConnDeps!.onFrame('draft_update', {
      _: 'updateDraftMessage',
      peer: { _: 'peerUser', user_id: 1 },
      draft: { _: 'draftMessageEmpty' },
    })

    expect(dialogOps).toHaveLength(1)
    const op = dialogOps[0] as Extract<DialogOp, { op: 'patch' }>
    expect(op.fields.draft).toBeUndefined()
  })

  // Бейдж ❤ — порт tweb onUpdateMessageReactions (:10552-10604): автору
  // сервер шлёт агрегат ЕГО глазами (без `min`), где непрочитанная реакция
  // помечена `recent_reactions[].pFlags.unread`. Смена «есть непрочитанная» у
  // МОЕГО сообщения — ±1; ответ даёт окно ДО применения кадра.
  const reactionFrame = (unread: boolean) => ({
    _: 'updateMessageReactions',
    peer: { _: 'peerUser', user_id: 1 },
    msg_id: 5,
    reactions: {
      _: 'messageReactions',
      results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1 }],
      recent_reactions: [{
        _: 'messagePeerReaction',
        ...(unread ? { pFlags: { unread: true } } : {}),
        peer_id: { _: 'peerUser', user_id: 9 }, date: 0, reaction: { _: 'reactionEmoji', emoticon: '👍' },
      }],
    },
  })

  it('непрочитанная реакция на МОЁМ сообщении → +1, её прочтение → −1', async () => {
    const { dialogOps, core } = await bootWithSeededDialog()
    await seedHistory(core, [makeRawMessage({ id: 5, peerId: 1, fromId: 1, out: true, text: 'моё', createdAt: '2026-08-01T00:00:01Z' })])
    dialogOps.length = 0

    capturedConnDeps!.onFrame('reaction', reactionFrame(true))
    expect(dialogOps).toEqual([{ op: 'patch', peerId: 1, fields: { unread_reactions_count: 1 } }])

    // Прочтение реакций: сервер шлёт тот же агрегат уже без `unread`.
    dialogOps.length = 0
    capturedConnDeps!.onFrame('reaction', reactionFrame(false))
    expect(dialogOps).toEqual([{ op: 'patch', peerId: 1, fields: { unread_reactions_count: 0 } }])
  })

  // Бейдж «@»: прочтение содержимого упоминания (updateReadPeerMessagesContents)
  // снимает его, но решение «было ли упоминание непрочитанным» принимает окно
  // ДО снятия media_unread (tweb onUpdateReadMessagesContents :11009-11016).
  it('прочтение содержимого непрочитанного упоминания → dialogs.applyMentionsRead', async () => {
    const { dialogOps, core } = await bootWithSeededDialog()
    const mention = (id: number) => ({
      ...makeRawMessage({ id, peerId: 1, fromId: 9, text: '@me', createdAt: `2026-08-01T00:00:0${id}Z` }),
      pFlags: { mentioned: true, media_unread: true },
    })
    await seedHistory(core, [mention(5)])
    capturedConnDeps!.onFrame('new_message', { _: 'updateNewMessage', message: mention(6) })
    await new Promise((r) => setTimeout(r, 0)) // пачка строк — через `pause(0)`
    expect((dialogOps[dialogOps.length - 1] as Extract<DialogOp, { op: 'upsert' }>).items[0].dialog.unread_mentions_count).toBe(1)
    dialogOps.length = 0

    capturedConnDeps!.onFrame('media_read', {
      _: 'updateReadPeerMessagesContents', peer: { _: 'peerUser', user_id: 1 }, messages: [5],
    })
    expect(dialogOps).toEqual([{ op: 'patch', peerId: 1, fields: { unread_mentions_count: 0 } }])

    // Повтор того же кадра: media_unread уже снят — упоминания нет, бейдж не трогаем.
    dialogOps.length = 0
    capturedConnDeps!.onFrame('media_read', {
      _: 'updateReadPeerMessagesContents', peer: { _: 'peerUser', user_id: 1 }, messages: [5],
    })
    expect(dialogOps).toEqual([])
  })

  // Курсор кадра реакций едет в КОНВЕРТЕ: у конструктора updateMessageReactions
  // параметра pts в схеме нет вовсе. Воронка обязана его увидеть — иначе кадр
  // пройдёт как «беспцовый», курсор не сдвинется, и следующий кадр окажется
  // дырой.
  //
  // Виден он здесь по гейту гидратации: курсор из IDB не поднят (core.start()
  // тут не зовут), поэтому кадр С курсором воронка НЕ применяет, а уходит в
  // догон. Тот же кадр без курсора применяется — это соседний тест выше.
  it('курсор из КОНВЕРТА доходит до воронки: кадр гейтится, а не проходит насквозь', async () => {
    const { dialogOps, core } = await bootWithSeededDialog()
    await seedHistory(core, [makeRawMessage({ id: 5, peerId: 1, fromId: 1, out: true, text: 'моё', createdAt: '2026-08-01T00:00:01Z' })])
    dialogOps.length = 0

    capturedConnDeps!.onFrame('reaction', {
      _: 'updateMessageReactions',
      peer: { _: 'peerUser', user_id: 1 },
      msg_id: 5,
      reactions: {
        _: 'messageReactions',
        pFlags: { min: true },
        results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1 }],
      },
    }, 7)

    expect(dialogOps).toEqual([])
  })

  // Повторный кадр с ТЕМ ЖЕ агрегатом (реплей из догона) бейдж не трогает:
  // непрочитанность не сменилась.
  it('повтор того же агрегата — бейдж не трогается', async () => {
    const { dialogOps, core } = await bootWithSeededDialog()
    await seedHistory(core, [makeRawMessage({ id: 5, peerId: 1, fromId: 1, out: true, text: 'моё', createdAt: '2026-08-01T00:00:01Z' })])
    capturedConnDeps!.onFrame('reaction', reactionFrame(true))
    dialogOps.length = 0

    capturedConnDeps!.onFrame('reaction', reactionFrame(true))

    expect(dialogOps).toEqual([])
  })

  // Сообщения в памяти нет — счёт локально не вывести, строка перечитывается
  // (tweb fixDialogUnreadMentionsIfNoMessage({force: true})).
  it('реакция на сообщение вне памяти → строка перечитывается у сервера', async () => {
    await bootWithSeededDialog()
    const fetch = vi.fn(async () => new Response(JSON.stringify({ _: 'messages.peerDialogs', dialogs: [], messages: [], chats: [], users: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    capturedConnDeps!.onFrame('reaction', reactionFrame(true))

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toContain('/peer_dialogs')
  })

  // min-кадр (общее тело всем участникам группы) флага `unread` не несёт и
  // бейджа не двигает — перечитывать строку ради него значило бы запрос
  // `/peer_dialogs` на каждого участника, у кого сообщения нет в памяти.
  it('min-кадр реакции на сообщение вне памяти → строку НЕ перечитывать', async () => {
    await bootWithSeededDialog()
    const fetch = vi.fn(async () => new Response(JSON.stringify({ _: 'messages.peerDialogs', dialogs: [], messages: [], chats: [], users: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    const frame = reactionFrame(false)
    capturedConnDeps!.onFrame('reaction', { ...frame, reactions: { ...frame.reactions, pFlags: { min: true } } })

    // Перечитывание идёт пачкой через `pause(0)` и асинхронный REST — ждём с
    // запасом, иначе отсутствие запроса доказывалось бы раньше, чем он ушёл бы.
    await new Promise((r) => setTimeout(r, 50))
    expect(fetch).not.toHaveBeenCalled()
  })

  // Порт tweb `readMessages` (appMessagesManager.ts:9566, :9607-9609): лента
  // увидела моё сообщение с непрочитанной реакцией — сброс ❤ на сервере, но
  // только пока бейдж горит (`hadUnreadReactions`). Гейт читает владелец строки
  // — проводка `getUnreadReactionsCount` в workerCore.
  it('увиденная непрочитанная реакция → POST reactions/read, пока горит ❤', async () => {
    const { core } = await bootWithSeededDialog()
    await seedHistory(core, [makeRawMessage({ id: 5, peerId: 1, fromId: 1, out: true, text: 'моё', createdAt: '2026-08-01T00:00:01Z' })])
    capturedConnDeps!.onFrame('reaction', reactionFrame(true))
    const fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    await core.registry.messages.readMessages(1, [generateMessageId(5)])

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toContain('/chats/1/reactions/read')
  })

  // Удаление сообщения, которого нет в памяти, при ненулевом ❤ — строку
  // перечитать (tweb handleDeletedMessages → fixDialogUnreadMentionsIfNoMessage):
  // счёт `missing` доезжает от владельца окна до владельца строки.
  it('удаление неизвестного сообщения при ненулевом ❤ → строка перечитывается', async () => {
    const { core } = await bootWithSeededDialog()
    await seedHistory(core, [makeRawMessage({ id: 5, peerId: 1, fromId: 1, out: true, text: 'моё', createdAt: '2026-08-01T00:00:01Z' })])
    capturedConnDeps!.onFrame('reaction', reactionFrame(true))
    const fetch = vi.fn(async () => new Response(JSON.stringify({ _: 'messages.peerDialogs', dialogs: [], messages: [], chats: [], users: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    capturedConnDeps!.onFrame('delete_message', { _: 'updateDeletePeerMessages', peer: { _: 'peerUser', user_id: 1 }, messages: [999] })

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toContain('/peer_dialogs')
  })

  // Прочтение истории снимает «@» по окну (tweb onUpdateReadHistory): владелец
  // строки спрашивает владельца окна — проводка `countReadMentions` в
  // workerCore. Без неё бейдж остался бы как был.
  it('прочтение истории снимает только упоминания под горизонтом', async () => {
    const { dialogOps, core } = await bootWithSeededDialog()
    const mention = (id: number) => ({
      ...makeRawMessage({ id, peerId: 1, fromId: 9, text: '@me', createdAt: `2026-08-01T00:00:0${id}Z` }),
      pFlags: { mentioned: true, media_unread: true },
    })
    await seedHistory(core, [mention(5)])
    capturedConnDeps!.onFrame('new_message', { _: 'updateNewMessage', message: mention(6) })
    await new Promise((r) => setTimeout(r, 0))
    dialogOps.length = 0

    capturedConnDeps!.onFrame('read', {
      _: 'updateReadHistoryInbox', peer: { _: 'peerUser', user_id: 1 }, max_id: 5, still_unread_count: 1,
    })

    expect(dialogOps).toEqual([{ op: 'patch', peerId: 1, fields: { unread_count: 1, unread_mentions_count: 0, read_inbox_max_id: generateMessageId(5) } }])
  })

  // Закреп с другого устройства/участника — бит `pinned` у сообщения окна
  // (tweb onUpdatePinnedMessages); проводка — строка реестра CACHE.
  it('pin_message → операция окна patch {pFlags.pinned}', async () => {
    const { core } = await bootWithSeededDialog()
    await seedHistory(core, [makeRawMessage({ id: 5, peerId: 1, fromId: 9, text: 'важное', createdAt: '2026-08-01T00:00:01Z' })])
    const ops: unknown[] = []
    const [epWorker, epTab] = pair()
    core.bind(epWorker)
    new SuperMessagePort(epTab).on('rt:message_op', (p) => ops.push(...(p as { ops: unknown[] }).ops))

    capturedConnDeps!.onFrame('pin_message', {
      _: 'updatePinnedMessages', peer: { _: 'peerUser', user_id: 1 }, messages: [5], pFlags: { pinned: true },
    })

    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: generateMessageId(5), fields: { pFlags: { pinned: true } } }])
  })
})

// Task 4 (действия без оптимистики): то же действие с ДРУГОГО устройства/вкладки
// доезжает этими 4 кадрами (backend logAndPublish на все устройства владельца/
// участников) — проверяем, что workerCore.ts::dispatch реально зовёт применялку
// владельца (не только что dialogsManager сам умеет считать patch из этих
// аргументов — это отдельно покрыто dialogsManager.test.ts), и что применение
// происходит РОВНО ОДИН РАЗ (ops длиной 1, не 2 — раньше эти же 4 кадра ЕЩЁ и
// разбирала витрина напрямую через storeProjection.ts/chatsStore-мутаторы;
// тот путь убран вместе с мутаторами — второго применения быть не может).
describe('createWorkerCore(): realtime-эхо действий (mute/pin/archive) применяет владелец РОВНО ОДИН РАЗ (Task 4)', () => {
  // Кадр несёт КОНСТРУКТОР настроек целиком: срок мьюта обязан дойти до
  // владельца, а не потеряться на границе (из-за чего «на час» работало как
  // «навсегда»). Мутация «взять из кадра булево» красит именно этот кейс.
  it('dialog_mute (без pts) → dialogs.applyNotifySettings → ровно один patch СО СРОКОМ', async () => {
    const { dialogOps } = await bootWithSeededDialog()
    const until = Math.floor(Date.now() / 1000) + 3600

    capturedConnDeps!.onFrame('dialog_mute', {
      _: 'updateNotifySettings',
      peer: { _: 'notifyPeer', peer: { _: 'peerUser', user_id: 1 } },
      notify_settings: { _: 'peerNotifySettings', mute_until: until },
    })

    expect(dialogOps).toEqual([
      { op: 'patch', peerId: 1, fields: { notify_settings: { _: 'peerNotifySettings', mute_until: until } } },
    ])
  })

  // Архив — ПАПКА: кадр несёт вектор пиров с НОМЕРОМ папки, а не признак
  // `archived`. «Вернуть из архива» — тот же кадр с folder_id = 0.
  it('dialog_archive (без pts) → dialogs.applyFolder → ровно один rt:dialog_op patch (сбрасывает pinned)', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('dialog_archive', {
      _: 'updateFolderPeers',
      folder_peers: [{ _: 'folderPeer', peer: { _: 'peerUser', user_id: 1 }, folder_id: 1 }],
      pts_count: 1,
    })

    expect(dialogOps).toEqual([{ op: 'patch', peerId: 1, fields: { folder_id: 1, pFlags: undefined } }])
  })

  it('dialog_archive с папкой 0 → возврат в общий список', async () => {
    const { dialogOps } = await bootWithSeededDialog()
    capturedConnDeps!.onFrame('dialog_archive', {
      _: 'updateFolderPeers',
      folder_peers: [{ _: 'folderPeer', peer: { _: 'peerUser', user_id: 1 }, folder_id: 1 }],
      pts_count: 1,
    })
    dialogOps.length = 0

    capturedConnDeps!.onFrame('dialog_archive', {
      _: 'updateFolderPeers',
      folder_peers: [{ _: 'folderPeer', peer: { _: 'peerUser', user_id: 1 }, folder_id: 0 }],
      pts_count: 1,
    })

    expect(dialogOps).toEqual([{ op: 'patch', peerId: 1, fields: { folder_id: undefined, pFlags: undefined } }])
  })

  // `chat_theme_update` строку диалога больше не трогает: тема живёт в ПОЛНОЙ
  // карточке пира (решение Р7), её зеркало — `core/chatFullCache.ts` на главном
  // потоке, и применяет кадр проектор (`storeProjection.ts`), а не владелец
  // диалогов.
  it('chat_theme_update (без pts) — строку диалога не патчит вовсе', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('chat_theme_update',
      { _: 'updateChatTheme', peer: { _: 'peerUser', user_id: 1 }, theme_id: 'sunset' })

    expect(dialogOps).toEqual([])
  })

  it('dialog_pin (без pts) → dialogs.applyPinned → ровно один патч + reindex, не двойное применение', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('dialog_pin', {
      _: 'updateDialogPinned',
      peer: { _: 'dialogPeer', peer: { _: 'peerUser', user_id: 1 } },
      pFlags: { pinned: true },
    })

    // patch (поле pinned) + reindex (порядок закреплённых) — обе от ОДНОГО
    // вызова applyPinned, не два независимых применения одного и того же факта.
    expect(dialogOps).toHaveLength(2)
    expect(dialogOps[0]).toMatchObject({ op: 'patch', peerId: 1, fields: { pFlags: { pinned: true } } })
    expect(dialogOps[1]).toMatchObject({ op: 'reindex' })
  })

  // «Открепили» — ТОТ ЖЕ конструктор с опущенным битом: поля `pinned: false` в
  // кадре нет и быть не может.
  it('dialog_pin без бита pinned → открепление', async () => {
    const { dialogOps } = await bootWithSeededDialog()
    capturedConnDeps!.onFrame('dialog_pin', {
      _: 'updateDialogPinned',
      peer: { _: 'dialogPeer', peer: { _: 'peerUser', user_id: 1 } },
      pFlags: { pinned: true },
    })
    dialogOps.length = 0

    capturedConnDeps!.onFrame('dialog_pin', {
      _: 'updateDialogPinned',
      peer: { _: 'dialogPeer', peer: { _: 'peerUser', user_id: 1 } },
    })

    expect(dialogOps[0]).toMatchObject({ op: 'patch', peerId: 1, fields: { pFlags: {} } })
  })
})
