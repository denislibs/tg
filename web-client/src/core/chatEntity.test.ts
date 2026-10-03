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
// Резолв — тот, что делают острова инстанса чата (композер, вкладка №0 профиля):
// пир, открытый `appImManager.setInnerPeer({peerId})`, + список диалогов.
import { beforeEach, describe, expect, it } from 'vitest'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import type { Chat } from '@/data'
import { chatPeerId, isDialogChat, resolveChatEntity } from './chatEntity'

const ALICE: PeerId = 777001

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: ALICE, first_name: 'Алиса', last_name: 'Иванова', username: 'alice_ivanova', pFlags: {} },
  ] }])
})

describe('чат с пиром без диалога: ключ сущности — число', () => {
  it('человек без диалога открывается сущностью с ключом пира из карточки зеркала, а не NaN', () => {
    const chat = resolveChatEntity({ peerId: ALICE }, [])
    // Все дети колонки берут ключ так: лента (`chat.peerId`), профиль
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
    const draft = resolveChatEntity({ peerId: ALICE }, [])

    const dialog: Chat = { id: String(ALICE), name: 'Алиса Иванова', avatar: '', preview: 'привет', type: 'private' }
    const real = resolveChatEntity({ peerId: ALICE }, [dialog])

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
