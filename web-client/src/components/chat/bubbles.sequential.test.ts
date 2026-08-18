// src/components/chat/bubbles.sequential.test.ts
//
// ПРОВОДКА признака `sequential` целиком — от места, где заводится pending, до
// ветки в ленте. Стенд склеивает настоящие звенья тем же каналом, что и прод:
//
//   messages.sendText (владелец, воркер)              core/managers/messages/pending.ts
//     → beforeMessageSending({sequential: true}) → PendingDetails.sequential
//   ack сервера → finalizePendingMessage                     → MessageOp insert{sequential}
//     → (в проде: rt:message_op → веер портов → realtimeBridge)
//   applyOpsToMirror (зеркало окон вкладки)                  → history_update{sequential}
//     → ChatBubbles (императивная лента)                     → ветка tweb bubbles.ts:802-819
//
// Проверять звенья по отдельности бессмысленно: предмет — что признак ДОЕЗЖАЕТ.
// Ровно поэтому здесь настоящий менеджер, настоящее зеркало и настоящая лента,
// а не заранее собранное событие.
//
// ЧТО ЗНАЧИТ `sequential` — см. докблоки `PendingNewEvt.sequential`
// (`core/realtime/events.ts`) и подписки `history_update` в `bubbles.ts`.
// Коротко: «кадр отправки ушёл тем же ходом, что и появление бабла», поэтому
// бабл уже стоит там, где встанет и настоящее сообщение, — перекладывать его не
// надо, достаточно подменить сообщение.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import SlicedArray, { SliceEnd } from '@core/history/slicedArray'
import { applyOpsToMirror, resetMessagesMirror } from '@core/history/messagesMirror'
import { newPendingMethods } from '@core/managers/messages/pending'
import { resetPeerMirror } from '@core/peerCache'
import type { Message } from '@core/models'
import type { MessageOp } from '@core/realtime/messageOps'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { makeFullMid, type BubblesManagers } from './bubbles'

const CHAT = 50
const ME = 42
const KEY = String(CHAT)

/** Владелец: SSOT воркера + срез окна + публикация операций ПРЯМО В ЗЕРКАЛО
 *  вкладки (в проде между ними веер портов и `realtimeBridge`, здесь — прямой
 *  вызов, как в `storeProjection.*.test.ts`). */
function owner() {
  const slices = new Map<string, SlicedArray<number>>()
  const msgsByChat = new Map<number, Map<number, Message>>()
  const msgsFor = (chatId: number) => {
    let c = msgsByChat.get(chatId)
    if (!c) { c = new Map(); msgsByChat.set(chatId, c) }
    return c
  }

  const sa = new SlicedArray<number>()
  sa.first.setEnd(SliceEnd.Bottom)
  slices.set(KEY, sa)

  const ops: MessageOp[][] = []
  const emit = (batch: MessageOp[]) => {
    if (!batch.length) return
    ops.push(batch)
    applyOpsToMirror(batch)
  }
  const pending = newPendingMethods({
    hkey: (chatId: number, threadRoot?: number | null) => (threadRoot ? `${chatId}:${threadRoot}` : String(chatId)),
    slices,
    msgsFor,
    getMeId: () => ME,
    emit,
    send: () => {},
    upload: async () => 1,
    cancelUpload: () => {},
    sendTyping: () => {},
    uploadProgress: () => {},
  })

  /** Кадр `message_ack`: в проде его перехватывает `workerCore.ts::onFrame` —
   *  зовёт владельца и публикует ЕГО операции (сам менеджер их только
   *  возвращает). Здесь тот же порядок. */
  const ack = (clientMsgId: string, msgId: number, seq: number, createdAt: string) =>
    emit(pending.ackPendingMessage({ client_msg_id: clientMsgId, msg_id: msgId, seq, created_at: createdAt }))

  return { pending, ops, ack }
}

const emptyHistory: HistoryResult = { messages: [], count: 0, reachedTop: true, reachedBottom: true }
const managers: BubblesManagers = {
  messages: { getHistory: async () => emptyHistory },
  peers: { fillMirror: async () => {} },
  dialogs: { getReadMaxSeqIfUnread: async () => 0, getHistoryMaxSeq: async () => 0 },
}

async function settle() {
  for (let i = 0; i < 5; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

let bubbles: ChatBubbles | undefined

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  rootScope.myId = ME
})

afterEach(() => {
  bubbles?.destroy()
  bubbles = undefined
})

/** Отправить текст владельцем и дождаться, пока лента нарисует бабл. */
async function sendAndRender(pending: ReturnType<typeof owner>['pending'], clientMsgId: string, text: string) {
  await pending.sendText({
    chatId: CHAT, text, clientMsgId, type: 'text', entities: null,
    threadRootId: null, groupedId: undefined, paidMediaPrice: null,
    optimistic: { senderId: ME },
  })
  await settle()
}

describe('sequential: признак доезжает от владельца бабла до ленты', () => {
  it('sendText объявляет sequential, и он приезжает в history_update', async () => {
    const { pending, ops, ack } = owner()
    const seen: (boolean | undefined)[] = []
    const off = rootScope.addEventListener('history_update', ({ sequential }) => { seen.push(sequential) })

    try {
      await sendAndRender(pending, 'c1', 'привет')
      const temp = (ops[0][0] as { msg: Message }).msg

      // ack сервера → finalizePendingMessage → insert финального
      ack('c1', 900, temp.seq, temp.createdAt)

      // Операция владельца несёт признак...
      expect(ops[1][0]).toMatchObject({ op: 'insert', sequential: true })
      // ...и он же доехал событием до подписчиков ленты.
      expect(seen).toEqual([true])
    } finally {
      rootScope.removeEventListener('history_update', off as never)
    }
  })

  it('sendFile объявляет бабл БЕЗ sequential (между баблом и кадром стоит аплоад)', async () => {
    const { pending, ops, ack } = owner()
    const seen: (boolean | undefined)[] = []
    const off = rootScope.addEventListener('history_update', ({ sequential }) => { seen.push(sequential) })

    try {
      await pending.sendFile({
        chatId: CHAT, clientMsgId: 'c2', senderId: ME,
        file: new Blob(['x'], { type: 'image/png' }), type: 'photo', mime: 'image/png',
      })
      await settle()
      const temp = (ops[0][0] as { msg: Message }).msg

      ack('c2', 901, temp.seq, temp.createdAt)

      expect(seen).toEqual([undefined])
    } finally {
      rootScope.removeEventListener('history_update', off as never)
    }
  })
})

describe('sequential: ветка ленты (порт tweb bubbles.ts:802-819)', () => {
  // Бабл своей отправки стоит внизу окна один; ack не меняет ни автора, ни день,
  // ни позицию — значит перекладывать нечего. Признак того, что ветка сработала,
  // — отсутствие повторной группировки: общий путь снял бы бабл из серии и
  // разложил заново (`removeAndUnmountBubble` + `groupBubbles`).
  it('с признаком: бабл НЕ перекладывается, сообщение подменяется на месте', async () => {
    const { pending, ops, ack } = owner()
    bubbles = new ChatBubbles({ peerId: CHAT, messagesStorageKey: KEY, container: document.createElement('div'), bubblesViewport: document.createElement('div') }, managers)
    await bubbles.loadFirstHistory()

    await sendAndRender(pending, 'c1', 'привет')
    const temp = (ops[0][0] as { msg: Message }).msg
    const bubble = bubbles.getBubble(makeFullMid(CHAT, temp.id))
    expect(bubble).toBeDefined()

    const groupBubbles = vi.spyOn(bubbles, 'groupBubbles')
    ack('c1', 900, temp.seq, temp.createdAt)
    await settle()

    expect(groupBubbles).not.toHaveBeenCalled()
    // тот же УЗЕЛ под новым адресом, и порядок в сериях уже по новому id
    expect(bubbles.getBubble(makeFullMid(CHAT, 900))).toBe(bubble)
    expect(bubble!.dataset.mid).toBe('900')
    expect(bubbles.chatInner.querySelectorAll('.bubble:not(.service)')).toHaveLength(1)
  })

  // Тот же ack, но без признака (путь `sendFile`): лента обязана пойти общим
  // путём — снять бабл и разложить заново.
  it('без признака: тот же ack идёт общим путём (перегруппировка)', async () => {
    const { pending, ops, ack } = owner()
    bubbles = new ChatBubbles({ peerId: CHAT, messagesStorageKey: KEY, container: document.createElement('div'), bubblesViewport: document.createElement('div') }, managers)
    await bubbles.loadFirstHistory()

    await pending.sendFile({
      chatId: CHAT, clientMsgId: 'c2', senderId: ME,
      file: new Blob(['x'], { type: 'image/png' }), type: 'photo', mime: 'image/png',
    })
    await settle()
    const temp = (ops[0][0] as { msg: Message }).msg

    const groupBubbles = vi.spyOn(bubbles, 'groupBubbles')
    ack('c2', 901, temp.seq, temp.createdAt)
    await settle()

    expect(groupBubbles).toHaveBeenCalledTimes(1)
    expect(bubbles.getBubble(makeFullMid(CHAT, 901))).toBeDefined()
    expect(bubbles.chatInner.querySelectorAll('.bubble:not(.service)')).toHaveLength(1)
  })

  // Догадка `sequential` проверяется, а не принимается на веру: если по новому
  // идентификатору бабл встаёт в ДРУГУЮ серию (сосед по времени/автору не
  // совпал), ветка обязана пропустить его на общий путь.
  it('признак есть, но позиция изменилась — ветка отдаёт бабл общему пути', async () => {
    const { pending, ops, ack } = owner()
    bubbles = new ChatBubbles({ peerId: CHAT, messagesStorageKey: KEY, container: document.createElement('div'), bubblesViewport: document.createElement('div') }, managers)
    await bubbles.loadFirstHistory()

    await sendAndRender(pending, 'c1', 'привет')
    const temp = (ops[0][0] as { msg: Message }).msg

    // Чужое сообщение НИЖЕ бабла: своя серия, и бабл больше не последний.
    rootScope.dispatchEventSingle('history_append', {
      storageKey: KEY,
      message: {
        id: 800, chatId: CHAT, seq: temp.seq + 1, senderId: 7, type: 'text', text: 'чужое',
        replyToId: null, mediaId: null, createdAt: temp.createdAt, threadRootId: null,
      },
    })
    await settle()

    const groupBubbles = vi.spyOn(bubbles, 'groupBubbles')
    // ack переносит бабл ПОД чужое сообщение (seq больше) — значит его серия
    // меняется, и короткий путь неприменим.
    ack('c1', 900, temp.seq + 2, temp.createdAt)
    await settle()

    expect(groupBubbles).toHaveBeenCalledTimes(1)
    expect(Array.from(bubbles.chatInner.querySelectorAll('.bubble:not(.service)')).map((el) => el.getAttribute('data-mid')))
      .toEqual(['800', '900'])
  })
})
