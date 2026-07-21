// src/core/managers/chatsManager.ts
import type { RestClient } from '../net/restClient'
import { mapDialog, type Dialog, type RawDialog } from '../models'

export interface ChatsDeps { rest: RestClient }

export function newChatsManager({ rest }: ChatsDeps) {
  return {
    async listDialogs(): Promise<Dialog[]> {
      const r = await rest.get<{ chats?: RawDialog[] }>('/chats')
      return (r.chats ?? []).map(mapDialog)
    },

    // Resolve (creating if needed) the private chat with a user; returns its id.
    // Idempotent server-side — repeated calls return the same chat.
    async createPrivate(userId: number): Promise<number> {
      const r = await rest.post<{ chat_id: number }>('/chats', { user_id: userId })
      return r.chat_id
    },

    // Resolve (creating on first access) the "Saved Messages" self-chat; returns its id.
    async saved(): Promise<number> {
      const r = await rest.post<{ chat_id: number }>('/saved', {})
      return r.chat_id
    },

    // «Очистить историю» у себя (Telegram deleteHistory just_clear): сообщения
    // скрываются только для меня, у остальных участников остаются.
    async clearHistory(chatId: number): Promise<void> {
      await rest.post(`/chats/${chatId}/clear`, {})
    },

    // «Избранное» → таб «Чаты»: сохранённые сообщения, сгруппированные по
    // источнику пересылки (tweb saved dialogs); 'self' — «Мои заметки».
    async savedDialogs(): Promise<SavedDialog[]> {
      const r = await rest.get<{ dialogs: RawSavedDialog[] }>('/saved/dialogs')
      return (r.dialogs ?? []).map((d) => ({
        kind: d.kind,
        peerId: d.peer_id,
        title: d.title,
        photoUrl: d.photo_url || undefined,
        count: d.count,
        last: {
          type: d.last_message.type,
          text: d.last_message.text,
          mediaId: d.last_message.media_id || undefined,
          at: d.last_message.at,
        },
      }))
    },
  }
}

interface RawSavedDialog {
  kind: 'self' | 'user' | 'chat'
  peer_id: number
  title: string
  photo_url: string
  count: number
  last_message: { type: string; text: string; media_id: number; at: string }
}

// One grouped row of Saved Messages (source peer + its newest saved message).
export interface SavedDialog {
  kind: 'self' | 'user' | 'chat'
  peerId: number
  title: string
  photoUrl?: string
  count: number
  last: { type: string; text: string; mediaId?: number; at: string }
}

export type ChatsManager = ReturnType<typeof newChatsManager>
