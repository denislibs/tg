// Сущность чата колонки для пира БЕЗ диалога (`core/chatEntity.ts`).
//
// Регресс со стенда: новый аккаунт находит человека глобальным поиском и
// открывает — лента крутит лоадер вечно, а бэкенд видит `GET /chats/NaN/history`,
// `/chats/NaN/card`, `/users/NaN/gifts`. Корень: сущность «черновика» носила id
// `draft:<peerId>`, а колонка чата и её дети (лента, профиль, шапка) берут ключ
// пира как `Number(chat.id)` — и получали NaN. У оригинала такого пространства
// имён нет вовсе: пир без диалога открывается тем же `setInnerPeer({peerId})`
// (tweb appImManager.ts:3392), `chat.peerId` — число.
//
// Путь в тесте — настоящий: строка поиска (`addDialogNew` +
// `setListClickListener`, ровно то, что вешает `createSearchGroup`) →
// `openPeer` → стек → резолв сущности для инстанса, как его делает `App.tsx`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getMiddleware } from '@helpers/middleware'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { useNavigationStore } from '@stores/navigationStore'
import { useChatStackStore, selectActive } from '@stores/chatStackStore'
import { useChatsStore } from '@stores/chatsStore'
import { addDialogNew, createChatList, setListClickListener } from '@components/dialogRow'
import type { Chat } from '@/data'
import { chatPeerId, isDialogChat, resolveChatEntity } from './chatEntity'

const ME: PeerId = 1
const ALICE: PeerId = 777001

const managers = { peers: { fillMirror: async () => {} }, presence: { get: async () => [] } }

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: ALICE, first_name: 'Алиса', last_name: 'Иванова', username: 'alice_ivanova', pFlags: {} },
  ] }])
  useChatsStore.setState({ meId: ME, dialogs: [] })
  useNavigationStore.setState({ selectedId: null, draftPeer: null })
  useChatStackStore.setState({ stack: [] }, false)
})
afterEach(() => document.body.replaceChildren())

/** Клик по строке результата глобального поиска (у нового аккаунта диалогов нет). */
function clickSearchResult(peerId: PeerId) {
  const list = createChatList()
  document.body.append(list)
  const row = addDialogNew({
    peerId,
    container: list,
    avatarSize: 'abitbigger',
    wrapOptions: { middleware: getMiddleware().get() },
    managers,
  })
  setListClickListener({ list, autonomous: true, managers })
  row.container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
}

/** Сущность верхнего инстанса стека — то, что `App.tsx` отдаёт `<Chat>`. */
function openedChat(chatList: Chat[] = []): Chat {
  const desc = selectActive(useChatStackStore.getState())
  expect(desc).toBeDefined()
  return resolveChatEntity(desc!, chatList, useNavigationStore.getState().draftPeer)
}

describe('чат с пиром без диалога: ключ сущности — число', () => {
  it('результат глобального поиска без диалога открывается сущностью с ключом пира, а не NaN', () => {
    clickSearchResult(ALICE)

    const chat = openedChat()
    // Все дети колонки берут ключ так: лента (`VanillaFeed peerId`), профиль
    // (`/users/{id}/gifts`, `/chats/{id}/search_counters`), шапка.
    expect(Number(chat.id)).toBe(ALICE)
    expect(chatPeerId(chat)).toBe(ALICE)
    expect(chat.type).toBe('private')
    expect(chat.name).toBe('Алиса Иванова')
    // Диалога ещё нет — «диалоговые» пути (пины, отложенные, черновик поля)
    // по-прежнему выключены до первого сообщения.
    expect(isDialogChat(chat)).toBe(false)
  })

  it('диалог появился (первое сообщение) — тот же ключ, уже диалоговая сущность', () => {
    clickSearchResult(ALICE)
    const draft = openedChat()

    const dialog: Chat = { id: String(ALICE), name: 'Алиса Иванова', avatar: '', preview: 'привет', type: 'private' }
    const real = openedChat([dialog])

    expect(real).toBe(dialog)
    expect(chatPeerId(real)).toBe(chatPeerId(draft))
    expect(isDialogChat(real)).toBe(true)
  })

  it('ключ сущности — всегда число: пустой/нечисловой id не даёт NaN', () => {
    const bad = { id: 'draft:777001', name: '', avatar: '', preview: '', type: 'private' } as Chat
    expect(chatPeerId(bad)).toBe(0)
    expect(isDialogChat(bad)).toBe(false)
  })
})
