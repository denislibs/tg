// Разрешение ОРИГИНАЛА ответа в ленте — порт `MessageRender.setReply`
// (tweb messageRender.ts:443-620) вместе с догрузкой отсутствующего оригинала
// (`appMessagesManager.fetchMessageReplyTo` → `reloadMessage` →
// `fetchSingleMessages`, appMessagesManager.ts:13609-13826) и перерисовкой
// шапки по её приезду (`ChatBubbles.updateMessageReply`, bubbles.ts:3049-3120).
//
// Стенд — НАСТОЯЩИЕ звенья: воркерный `messagesManager` (SSOT + срезы окна),
// зеркало вкладки (`applyOpsToMirror`, `peerCache`) и императивная лента. Между
// ними в проде веер портов и `realtimeBridge`, здесь — прямой вызов, как в
// `bubbles.sequential.test.ts`. Подделан только REST, и кормят его ответы
// стенда: группа «Дизайн-ревью» (`peerChannel 7`, ключ −7), сообщение
// Дарьи Смирновой №7 — ответ на №5 Полины Крыловой (первое фото альбома).
// Номера и тексты — из `GET /api/chats/-7/history` и `…/messages?ids=`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyOpsToMirror, resetMessagesMirror } from '@core/history/messagesMirror'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { newMessagesManager } from '@core/managers/messagesManager'
import type { RestClient } from '@core/net/restClient'
import type { RawMessage } from '@core/models'
import type { UserReal } from '@core/peers/peer'
import type { MessageOp } from '@core/realtime/messageOps'
import { RT } from '@core/realtime/events'
import { generateMessageId } from '@core/history/messageId'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

const CHAT = -7
const PEER = { _: 'peerChannel' as const, channel_id: 7 }
const DARIA = 777004
const POLINA = 777015
const ALICE = 777001

const USERS: UserReal[] = [
  { _: 'user', id: DARIA, first_name: 'Дарья', last_name: 'Смирнова' } as UserReal,
  { _: 'user', id: POLINA, first_name: 'Полина', last_name: 'Крылова' } as UserReal,
  { _: 'user', id: ALICE, first_name: 'Алиса', last_name: 'Иванова' } as UserReal,
]

const from = (userId: number) => ({ _: 'peerUser' as const, user_id: userId })
const DATE = 1788799668

// ── Ответы стенда (серверные номера), урезанные до значимых полей ──────────
const MSG_5 = {
  _: 'message', id: 5, from_id: from(POLINA), peer_id: PEER, date: DATE,
  message: 'Два варианта набора: слева — единая толщина, справа — с акцентными.',
  grouped_id: 1099511627778,
  media: { _: 'messageMediaPhoto', photo: { _: 'photo', id: 13, sizes: [{ _: 'photoSize', type: 'w', w: 1280, h: 720, size: 25727 }] } },
} as unknown as RawMessage
const MSG_6 = {
  _: 'message', id: 6, from_id: from(POLINA), peer_id: PEER, date: DATE, message: '',
  grouped_id: 1099511627778,
  media: { _: 'messageMediaPhoto', photo: { _: 'photo', id: 14, sizes: [{ _: 'photoSize', type: 'w', w: 1280, h: 720, size: 25575 }] } },
} as unknown as RawMessage
const MSG_7 = {
  _: 'message', id: 7, from_id: from(DARIA), peer_id: PEER, date: DATE,
  reply_to: { _: 'messageReplyHeader', reply_to_msg_id: 5 },
  message: 'Левый. Акцент лучше давать цветом, а не толщиной, иначе в мелком размере всё слипается.',
} as unknown as RawMessage
const MSG_8 = {
  _: 'message', id: 8, from_id: from(ALICE), peer_id: PEER, date: DATE,
  message: 'Вопрос от разработки: сколько состояний у кнопки? Нужны все, включая загрузку и ошибку.',
} as unknown as RawMessage
const MSG_9 = {
  _: 'message', id: 9, from_id: from(POLINA), peer_id: PEER, date: DATE,
  reply_to: { _: 'messageReplyHeader', reply_to_msg_id: 8 },
  message: 'Пять: обычное, наведение, нажатие, загрузка, недоступна.',
} as unknown as RawMessage

const ALL: RawMessage[] = [MSG_5, MSG_6, MSG_7, MSG_8, MSG_9]

/**
 * REST стенда. `page` — что отдаёт `/history` (срез окна, как при первой
 * странице высотой в N строк), `known` — что вообще есть в чате: по нему
 * отвечает ручка адресов, отсутствующее — дырой `messageEmpty`, как бэкенд.
 */
function standRest(page: RawMessage[], known: RawMessage[] = ALL) {
  const byId = new Map(known.map((m) => [m.id, m]))
  const calls: string[] = []
  const rest = {
    get: vi.fn(async (path: string, query: Record<string, string | number> = {}) => {
      calls.push(`${path}?${new URLSearchParams(query as Record<string, string>).toString()}`)
      if (path === `/chats/${CHAT}/history`) {
        return { _: 'messages.messagesSlice', count: 29, messages: [...page].reverse(), users: USERS, chats: [] }
      }
      if (path === `/chats/${CHAT}/messages`) {
        const ids = String(query.ids).split(',').map(Number)
        return {
          _: 'messages.messages',
          messages: ids.map((id) => byId.get(id) ?? { _: 'messageEmpty', id, peer_id: PEER }),
          users: USERS,
          chats: [],
        }
      }
      throw new Error(`unexpected GET ${path}`)
    }),
  } as unknown as RestClient
  return { rest, calls }
}

/** Владелец (воркер) + лента поверх него. `coldPeers` — зеркало карточек
 *  пустое и пополняется только объявленным пробелом (`fillMirror`), как после
 *  перезагрузки страницы, когда история пришла из кэша воркера. */
function stand(page: RawMessage[], opts: { known?: RawMessage[]; coldPeers?: boolean } = {}) {
  const { rest, calls } = standRest(page, opts.known)
  const ops: MessageOp[][] = []
  const mgr = newMessagesManager({
    rest,
    peers: {
      saveApiPeers: ({ users }) => {
        if (!opts.coldPeers && users?.length) applyPeerOps([{ op: 'upsert', peers: users }])
      },
    },
    broadcast: (event, payload) => {
      if (event !== RT.messageOp) return
      const batch = (payload as { ops: MessageOp[] }).ops
      ops.push(batch)
      applyOpsToMirror(batch)
    },
  })
  // Ответ владельца на пробел — асинхронный, как RPC в проде: карточка
  // приезжает ПОСЛЕ того, как узел имени встал на учёт.
  const fillMirror = vi.fn(async (ids: number[]) => {
    await Promise.resolve()
    applyPeerOps([{ op: 'upsert', peers: USERS.filter((u) => ids.includes(u.id)) }])
  })
  const managers: BubblesManagers = {
    messages: {
      getHistory: (args) => mgr.getHistory(args),
      getAround: async () => ({ messages: [], reachedTop: true, reachedBottom: true }),
      messageByDate: async () => null,
      fetchMessageReplyTo: (peerId, mid) => mgr.fetchMessageReplyTo(peerId, mid),
    },
    peers: { fillMirror },
    dialogs: { getReadMaxSeqIfUnread: async () => 0, getHistoryMaxSeq: async () => 0, getDialogReadState: async () => undefined },
    realtime: { markRead: async () => ({ ok: true }) },
  }
  const chat: ChatContext = {
    peerId: CHAT,
    messagesStorageKey: String(CHAT),
    container: document.createElement('div'),
    bubblesViewport: document.createElement('div'),
    isMegagroup: true,
  }
  return { mgr, managers, chat, calls, ops, fillMirror }
}

async function settle() {
  for (let i = 0; i < 8; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

const cid = generateMessageId
const replyOf = (b: ChatBubbles, serverId: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${cid(serverId)}"] .reply`)!
const idsCalls = (calls: string[]) => calls.filter((c) => c.startsWith(`/chats/${CHAT}/messages?`))

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
})

describe('ChatBubbles — оригинал ответа вне окна (стенд, чат −7)', () => {
  it('пока оригинал едет — «Загрузка», а не «Удалённое сообщение» (tweb messageRender.ts:527-531)', async () => {
    const s = stand([MSG_7, MSG_8, MSG_9])
    // Ответ ручки адресов придерживаем: смотрим на шапку ДО приезда оригинала.
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    s.managers.messages.fetchMessageReplyTo = async (peerId, mid) => { await gate; return s.mgr.fetchMessageReplyTo(peerId, mid) }
    bubbles = new ChatBubbles(s.chat, s.managers)

    await (await bubbles.setPeer())?.promise
    await settle()

    const reply = replyOf(bubbles, 7)
    expect(reply.querySelector('.reply-title')!.textContent).toBe('Loading...')
    // Подзаголовка нет вовсе — `wrapReply` снимает его без сообщения
    // (tweb wrappers/reply.ts:66-69).
    expect(reply.querySelector('.reply-subtitle')).toBeNull()
    expect(reply.classList.contains('reply-no-subtitle')).toBe(true)
    expect(reply.textContent).not.toContain('Deleted message')

    release()
    await settle()
  })

  it('оригинал догружается ручкой адресов, и шапка перерисовывается автором и текстом', async () => {
    const s = stand([MSG_7, MSG_8, MSG_9])
    bubbles = new ChatBubbles(s.chat, s.managers)
    await (await bubbles.setPeer())?.promise
    await settle()

    // Ровно один запрос оригинала — серверным номером (tweb
    // `inputMessageID {id: getServerMessageId(mid)}`, :13627-13632).
    expect(idsCalls(s.calls)).toEqual([`/chats/${CHAT}/messages?ids=5`])

    const reply = replyOf(bubbles, 7)
    expect(reply.querySelector('.reply-title')!.textContent).toBe('Полина Крылова')
    expect(reply.querySelector('.reply-subtitle')!.textContent).toContain('Два варианта набора')
    expect(reply.classList.contains('reply-no-subtitle')).toBe(false)
    // Догруженный оригинал ложится в хранилище владельца, но НЕ в окно: бабла
    // у него нет (tweb `saveApiResult` пишет в messagesStorage, а не в
    // historyStorage).
    expect(s.mgr.getMessageByPeer(CHAT, cid(5))).toBeDefined()
    expect(bubbles.chatInner.querySelector(`.bubble[data-mid="${cid(5)}"]`)).toBeNull()
  })

  it('оригинала нет и на сервере — «Удалённое сообщение» ОДИН раз, в заголовке (tweb :522-523)', async () => {
    const s = stand([MSG_7, MSG_8, MSG_9], { known: [MSG_7, MSG_8, MSG_9] })
    bubbles = new ChatBubbles(s.chat, s.managers)
    await (await bubbles.setPeer())?.promise
    await settle()

    const reply = replyOf(bubbles, 7)
    expect(reply.querySelector('.reply-title')!.textContent).toBe('Deleted message')
    expect(reply.querySelector('.reply-subtitle')).toBeNull()
    // Владелец помечает ссылку (`clearMessageReplyTo` → `reply_to_msg_deleted`,
    // :13813-13824) и объявляет правку окну, чтобы следующий рендер бабла не
    // спрашивал сервер заново.
    expect(s.mgr.getMessageByPeer(CHAT, cid(7))?.reply_to?.reply_to_msg_deleted).toBe(true)
    expect(s.ops.flat()).toContainEqual(expect.objectContaining({ op: 'patch', key: String(CHAT), msgId: cid(7) }))
  })

  it('оригинал в окне — сети нет, шапка сразу с автором', async () => {
    const s = stand([MSG_5, MSG_6, MSG_7, MSG_8, MSG_9])
    bubbles = new ChatBubbles(s.chat, s.managers)
    await (await bubbles.setPeer())?.promise
    await settle()

    expect(idsCalls(s.calls)).toEqual([])
    const reply = replyOf(bubbles, 7)
    expect(reply.querySelector('.reply-title')!.textContent).toBe('Полина Крылова')
    expect(reply.querySelector('.reply-subtitle')!.textContent).toContain('Два варианта набора')
  })
})

describe('ChatBubbles — автор цитаты при холодном зеркале пиров (K3)', () => {
  it('после перезагрузки шапка подхватывает карточку автора, а не застывает «Удалённым аккаунтом»', async () => {
    const s = stand([MSG_8, MSG_9], { coldPeers: true })
    bubbles = new ChatBubbles(s.chat, s.managers)
    await (await bubbles.setPeer())?.promise
    await settle()

    // Заголовок — живой `PeerTitle` (tweb messageRender.ts:545-551): узел сам
    // объявляет пробел зеркала и перерисовывается приехавшей карточкой.
    expect(s.fillMirror).toHaveBeenCalledWith([ALICE])
    const title = replyOf(bubbles, 9).querySelector('.reply-title')!
    expect(title.querySelector(`.peer-title[data-peer-id="${ALICE}"]`)).not.toBeNull()
    expect(title.textContent).toBe('Алиса Иванова')
  })
})
