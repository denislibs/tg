import type { RestClient } from '../net/restClient'
import { mapMessage, type Message, type RawMessage } from '../models'
import { idbGet, idbSet } from '../store/idbKv'

export interface SearchResult {
  chats: { id: number; type: string; title: string; username: string; memberCount: number }[]
  users: { id: number; username: string; displayName: string; avatarUrl: string }[]
}

export function newChannelsManager({ rest }: { rest: Pick<RestClient, 'post' | 'get'> }) {
  return {
    async createChannel(args: { title: string; about?: string; username?: string; isPublic?: boolean }): Promise<number> {
      const r = await rest.post<{ chat_id: number }>('/channels', {
        title: args.title, about: args.about ?? '', username: args.username ?? '', is_public: args.isPublic ?? false,
      })
      return r.chat_id
    },
    async post(chatId: number, text: string, clientMsgId: string): Promise<Message> {
      const r = await rest.post<RawMessage>(`/channels/${chatId}/messages`, { text, client_msg_id: clientMsgId })
      return mapMessage(r)
    },
    // Fetch posts newer than the stored pts; returns them ascending + advances stored pts.
    async getDifference(chatId: number): Promise<Message[]> {
      const pts = (await idbGet<number>(`chpts:${chatId}`)) ?? 0
      const r = await rest.get<{ updates: RawMessage[]; pts: number }>(`/channels/${chatId}/difference`, { pts })
      const msgs = (r.updates ?? []).map(mapMessage).sort((a, b) => a.seq - b.seq)
      if (r.pts != null) await idbSet(`chpts:${chatId}`, r.pts)
      return msgs
    },
    async setPts(chatId: number, pts: number): Promise<void> { await idbSet(`chpts:${chatId}`, pts) },
    async join(username: string): Promise<void> { await rest.post('/channels/join', { username }) },
    async enableDiscussion(channelId: number): Promise<number> {
      const r = await rest.post<{ discussion_chat_id: number }>(`/channels/${channelId}/discussion`, {})
      return r.discussion_chat_id
    },
    async postComment(channelId: number, postId: number, text: string, clientMsgId: string): Promise<Message> {
      const r = await rest.post<RawMessage>(`/channels/${channelId}/posts/${postId}/comments`, { text, client_msg_id: clientMsgId })
      return mapMessage(r)
    },
    async listComments(channelId: number, postId: number, offset = 0, limit = 50): Promise<{ messages: Message[]; count: number }> {
      const r = await rest.get<{ messages: RawMessage[]; count: number }>(`/channels/${channelId}/posts/${postId}/comments`, { offset, limit })
      return { messages: (r.messages ?? []).map(mapMessage), count: r.count }
    },
    async commentCounts(channelId: number, postIds: number[]): Promise<Record<number, number>> {
      if (!postIds.length) return {}
      const r = await rest.get<{ counts: Record<string, number> }>(`/channels/${channelId}/comment_counts`, { ids: postIds.join(',') })
      const out: Record<number, number> = {}
      for (const k in r.counts) out[+k] = r.counts[k]
      return out
    },
    // Current view counts per channel post ("9.2K 👁"), fetched per open to stay
    // fresh (mirrors commentCounts — channel posts are cached by pts, so a snapshot
    // field would go stale).
    async viewCounts(channelId: number, postIds: number[]): Promise<Record<number, number>> {
      if (!postIds.length) return {}
      const r = await rest.get<{ counts: Record<string, number> }>(`/channels/${channelId}/view_counts`, { ids: postIds.join(',') })
      const out: Record<number, number> = {}
      for (const k in r.counts) out[+k] = r.counts[k]
      return out
    },
    async search(q: string): Promise<SearchResult> {
      // Allow "@username" queries: usernames are stored without the @, so strip
      // a leading one before hitting the directory search.
      const query = q.trim().replace(/^@+/, '')
      if (!query) return { chats: [], users: [] }
      const r = await rest.get<{ chats: { id: number; type: string; title: string; username: string; member_count: number }[]; users: { id: number; username: string; display_name: string; avatar_url: string }[] }>('/search', { q: query })
      return {
        chats: (r.chats ?? []).map((c) => ({ id: c.id, type: c.type, title: c.title, username: c.username, memberCount: c.member_count })),
        users: (r.users ?? []).map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, avatarUrl: u.avatar_url })),
      }
    },
  }
}
export type ChannelsManager = ReturnType<typeof newChannelsManager>
