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
  }
}

export type ChatsManager = ReturnType<typeof newChatsManager>
