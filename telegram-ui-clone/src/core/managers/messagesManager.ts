// src/core/managers/messagesManager.ts
import type { RestClient } from '../net/restClient'
import { mapMessage, mapPoll, mapScheduled, type Message, type MessageEntity, type Poll, type RawMessage, type RawPoll, type RawScheduled, type Scheduled } from '../models'
import SlicedArray, { SliceEnd } from '../history/slicedArray'

export interface HistoryArgs {
  chatId: number
  offsetSeq?: number // reference seq; 0 = newest
  addOffset?: number // >0 older (inclusive), <=0 newer
  limit?: number
}

export interface HistoryResult {
  messages: Message[] // ascending (oldest-first) for top→bottom rendering
  count: number // rows returned by the last fetch (or cached count)
  reachedTop: boolean
  reachedBottom: boolean
  cached?: boolean // served synchronously from the in-memory cache (no network)
}

export interface SendArgs {
  chatId: number
  text: string
  entities?: MessageEntity[] | null
  clientMsgId: string
  replyToId?: number | null
  mediaId?: number | null
  /** сообщение в тред (форум-топик): id корневого сообщения темы */
  threadRootId?: number | null
}

export interface MessagesDeps { rest: RestClient }

export function newMessagesManager({ rest }: MessagesDeps) {
  const slices = new Map<number, SlicedArray<number>>()
  const cache = new Map<number, Map<number, Message>>()

  const sliceFor = (chatId: number): SlicedArray<number> => {
    let sa = slices.get(chatId)
    if (!sa) { sa = new SlicedArray<number>(); slices.set(chatId, sa) }
    return sa
  }
  const cacheFor = (chatId: number): Map<number, Message> => {
    let c = cache.get(chatId)
    if (!c) { c = new Map(); cache.set(chatId, c) }
    return c
  }
  const put = (chatId: number, msgs: Message[]) => {
    const c = cacheFor(chatId)
    for (const m of msgs) c.set(m.seq, m)
  }

  return {
    async getHistory(args: HistoryArgs): Promise<HistoryResult> {
      const { chatId, offsetSeq = 0, addOffset = 0, limit = 40 } = args
      const sa = sliceFor(chatId)
      const c = cacheFor(chatId)

      // --- cache check (mirrors tweb appMessagesManager.getHistory) ---
      const have = sa.sliceMe(offsetSeq, addOffset, limit)
      const pagingOlder = addOffset > 0
      const pagingNewer = addOffset <= 0 && offsetSeq !== 0
      const cacheHit =
        have &&
        (have.slice.length >= limit ||
          (have.fulfilled & SliceEnd.Both) === SliceEnd.Both ||
          (pagingOlder && (have.fulfilled & SliceEnd.Top) === SliceEnd.Top) ||
          ((pagingNewer || offsetSeq === 0) && (have.fulfilled & SliceEnd.Bottom) === SliceEnd.Bottom))

      if (cacheHit && have) {
        const seqsDesc = Array.from(have.slice) // descending
        const msgs = seqsDesc.map((s) => c.get(s)).filter((m): m is Message => !!m)
        const asc = msgs.slice().reverse()
        // reachedTop/Bottom must reflect the REAL ends of history, not `fulfilled`
        // (which only means the requested page had enough cached rows). Using
        // `fulfilled` here made a re-opened chat report reachedTop=true whenever
        // ≥limit messages were cached, which disabled scroll-up paging.
        return {
          messages: asc,
          count: asc.length,
          reachedTop: have.slice.isEnd(SliceEnd.Top),
          reachedBottom: have.slice.isEnd(SliceEnd.Bottom),
          cached: true,
        }
      }

      // --- network fetch ---
      const r = await rest.get<{ messages: RawMessage[]; count: number }>(
        `/chats/${chatId}/history`,
        { offset_id: offsetSeq, add_offset: addOffset, limit },
      )
      const fetched = (r.messages ?? []).map(mapMessage)
      put(chatId, fetched)

      // normalize to descending seqs for the SlicedArray
      const seqsDesc = fetched.map((m) => m.seq).sort((a, b) => b - a)
      const inserted = seqsDesc.length ? sa.insertSlice(seqsDesc) : sa.first

      // end detection: a short page means we hit the end in the paging direction.
      // NOTE: the backend's `count` is the chat TOTAL, not the page size — so end
      // detection must use the number of rows actually returned, not r.count.
      const short = fetched.length < limit
      let reachedTop = false
      let reachedBottom = false
      if (inserted) {
        if (offsetSeq === 0) {
          inserted.setEnd(SliceEnd.Bottom) // newest page always includes the bottom
          reachedBottom = true
          if (short) { inserted.setEnd(SliceEnd.Top); reachedTop = true }
        } else if (pagingOlder && short) {
          inserted.setEnd(SliceEnd.Top); reachedTop = true
        } else if (pagingNewer && short) {
          inserted.setEnd(SliceEnd.Bottom); reachedBottom = true
        }
      }

      // return ascending; for an older fetch we filter out the inclusive overlap
      // (caller passes offsetSeq=oldestLoaded with addOffset=1)
      let asc = fetched.slice().sort((a, b) => a.seq - b.seq)
      if (pagingOlder) asc = asc.filter((m) => m.seq < offsetSeq)

      return { messages: asc, count: r.count, reachedTop, reachedBottom, cached: false }
    },

    async sendMessage(args: SendArgs): Promise<Message> {
      const created = await rest.post<RawMessage>(`/chats/${args.chatId}/messages`, {
        type: 'text',
        text: args.text,
        entities: args.entities ?? null,
        client_msg_id: args.clientMsgId,
        reply_to_id: args.replyToId ?? null,
        media_id: args.mediaId ?? null,
        thread_root_id: args.threadRootId ?? null,
      })
      const m = mapMessage(created)
      put(args.chatId, [m])
      const sa = sliceFor(args.chatId)
      // a sent message is the newest — push to the bottom end if we hold it
      if (sa.first.isEnd(SliceEnd.Bottom) && !sa.findSlice(m.seq)) sa.unshift(m.seq)
      return m
    },

    // Edit a message's text (author only, server-enforced). Returns the updated
    // message and refreshes the cache entry.
    async editMessage(chatId: number, msgId: number, text: string, entities?: MessageEntity[]): Promise<Message> {
      const updated = await rest.patch<RawMessage>(`/chats/${chatId}/messages/${msgId}`, { text, entities: entities ?? null })
      const m = mapMessage(updated)
      put(chatId, [m])
      return m
    },

    // Delete a message. revoke=true → for everyone; false → only for me. Deleted
    // messages are never shown, so evict from the cache (seq + slice) too, or a
    // later cache hit would resurrect it.
    async deleteMessage(chatId: number, msgId: number, revoke: boolean): Promise<{ ok: boolean }> {
      const r = await rest.del<{ ok: boolean }>(`/chats/${chatId}/messages/${msgId}?revoke=${revoke ? 'true' : 'false'}`)
      const c = cacheFor(chatId)
      for (const [seq, m] of c) {
        if (m.id === msgId) {
          c.delete(seq)
          sliceFor(chatId).delete(seq)
          break
        }
      }
      return r
    },

    // Forward messages from one chat into another; returns the created copies.
    async forwardMessages(toChatId: number, fromChatId: number, msgIds: number[]): Promise<Message[]> {
      const r = await rest.post<{ messages: RawMessage[] }>(`/chats/${toChatId}/forward`, {
        from_chat_id: fromChatId,
        msg_ids: msgIds,
      })
      const msgs = (r.messages ?? []).map(mapMessage)
      put(toChatId, msgs)
      return msgs
    },

    async pin(chatId: number, msgId: number): Promise<{ ok: boolean }> {
      return rest.post<{ ok: boolean }>(`/chats/${chatId}/messages/${msgId}/pin`, {})
    },

    async unpin(chatId: number, msgId: number): Promise<{ ok: boolean }> {
      return rest.del<{ ok: boolean }>(`/chats/${chatId}/messages/${msgId}/pin`)
    },

    async listPins(chatId: number): Promise<Message[]> {
      const r = await rest.get<{ messages: RawMessage[] }>(`/chats/${chatId}/pins`)
      return (r.messages ?? []).map(mapMessage)
    },

    // Jump-to-message: load a window centered on centerSeq and RESET this chat's
    // slice/cache to it (so loadOlder/loadNewer continue from the jumped spot).
    async getAround(chatId: number, centerSeq: number, limit = 40): Promise<{ messages: Message[]; reachedTop: boolean; reachedBottom: boolean }> {
      const r = await rest.get<{ messages: RawMessage[]; reached_top: boolean; reached_bottom: boolean }>(
        `/chats/${chatId}/history`, { around: centerSeq, limit },
      )
      const asc = (r.messages ?? []).map(mapMessage)
      const sa = new SlicedArray<number>()
      slices.set(chatId, sa)
      const c = cacheFor(chatId)
      for (const m of asc) c.set(m.seq, m)
      const seqsDesc = asc.map((m) => m.seq).sort((a, b) => b - a)
      const inserted = seqsDesc.length ? sa.insertSlice(seqsDesc) : sa.first
      if (inserted) {
        if (r.reached_top) inserted.setEnd(SliceEnd.Top)
        if (r.reached_bottom) inserted.setEnd(SliceEnd.Bottom)
      }
      return { messages: asc, reachedTop: !!r.reached_top, reachedBottom: !!r.reached_bottom }
    },

    // Search messages in a chat by text (newest first) + total match count.
    // Шаред-медиа профиля (табы Media/Files/Links/Music/Voice) — история чата
    // одного типа, новые сверху (tweb inputMessagesFilter*).
    async mediaHistory(chatId: number, filter: 'media' | 'files' | 'links' | 'music' | 'voice', offset = 0, limit = 30): Promise<{ messages: Message[]; count: number }> {
      const r = await rest.get<{ messages: RawMessage[]; count: number }>(`/chats/${chatId}/media`, { filter, offset, limit })
      return { messages: (r.messages ?? []).map(mapMessage), count: r.count }
    },

    async searchMessages(chatId: number, q: string, offset = 0, limit = 20): Promise<{ messages: Message[]; count: number }> {
      const r = await rest.get<{ messages: RawMessage[]; count: number }>(`/chats/${chatId}/search`, { q, offset, limit })
      return { messages: (r.messages ?? []).map(mapMessage), count: r.count }
    },

    // Глобальный поиск по сообщениям всех чатов (сайдбар-поиск): q — текст,
    // filter сужает по типу шаред-медиа ('' — любой тип, q обязателен).
    async searchGlobal(q: string, filter: '' | 'media' | 'files' | 'links' | 'music' | 'voice' = '', offset = 0, limit = 20): Promise<{ messages: Message[]; count: number }> {
      const r = await rest.get<{ messages: RawMessage[]; count: number }>('/search/messages', { q, filter, offset, limit })
      return { messages: (r.messages ?? []).map(mapMessage), count: r.count }
    },

    // ── Опросы (Telegram Poll) ──
    async sendPoll(chatId: number, p: { question: string; options: string[]; anonymous: boolean; multiple: boolean; quiz: boolean; correctOption?: number; clientMsgId?: string }): Promise<Message> {
      const r = await rest.post<RawMessage>(`/chats/${chatId}/polls`, {
        question: p.question, options: p.options, anonymous: p.anonymous,
        multiple: p.multiple, quiz: p.quiz, correct_option: p.correctOption ?? null,
        client_msg_id: p.clientMsgId ?? '',
      })
      return mapMessage(r)
    },
    // Голос (пустой список — отзыв); возвращает обновлённый опрос для зрителя.
    async votePoll(pollId: number, options: number[]): Promise<Poll> {
      const r = await rest.post<{ poll: RawPoll }>(`/polls/${pollId}/vote`, { options })
      return mapPoll(r.poll)
    },
    async closePoll(pollId: number): Promise<void> {
      await rest.post(`/polls/${pollId}/close`, {})
    },

    // Сообщения треда (форум-топика) по возрастанию + total.
    async threadMessages(chatId: number, rootId: number, offset = 0, limit = 50): Promise<{ messages: Message[]; count: number }> {
      const r = await rest.get<{ messages: RawMessage[]; count: number }>(`/chats/${chatId}/threads/${rootId}`, { offset, limit })
      return { messages: (r.messages ?? []).map(mapMessage), count: r.count }
    },

    // ── Запланированные сообщения (Telegram scheduled) ──
    async scheduleMessage(chatId: number, p: { text: string; entities?: MessageEntity[]; sendAt: number; replyToId?: number }): Promise<Scheduled> {
      const r = await rest.post<RawScheduled>(`/chats/${chatId}/scheduled`, {
        type: 'text', text: p.text, entities: p.entities ?? null,
        reply_to_id: p.replyToId ?? null, send_at: p.sendAt,
      })
      return mapScheduled(r)
    },
    async listScheduled(chatId: number): Promise<Scheduled[]> {
      const r = await rest.get<{ scheduled: RawScheduled[] }>(`/chats/${chatId}/scheduled`)
      return (r.scheduled ?? []).map(mapScheduled)
    },
    async deleteScheduled(chatId: number, id: number): Promise<void> {
      await rest.del(`/chats/${chatId}/scheduled/${id}`)
    },
    // Отправить запланированное немедленно; возвращает созданное сообщение.
    async sendScheduledNow(chatId: number, id: number): Promise<Message> {
      const r = await rest.post<RawMessage>(`/chats/${chatId}/scheduled/${id}/send_now`, {})
      return mapMessage(r)
    },

    // Кто сейчас в видеочате группы (для баннера Join).
    async groupCallParticipants(chatId: number): Promise<number[]> {
      const r = await rest.get<{ participants: number[] }>(`/chats/${chatId}/group_call`)
      return r.participants ?? []
    },

    async viewers(chatId: number, msgId: number): Promise<number[]> {
      const r = await rest.get<{ user_ids: number[] }>(`/chats/${chatId}/messages/${msgId}/viewers`)
      return r.user_ids ?? []
    },

    // Реакции: поставить/снять свою (агрегаты приходят realtime-фреймом reaction).
    async react(chatId: number, msgId: number, emoji: string): Promise<void> {
      await rest.post(`/chats/${chatId}/messages/${msgId}/reactions`, { emoji })
    },

    async unreact(chatId: number, msgId: number, emoji: string): Promise<void> {
      await rest.del(`/chats/${chatId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`)
    },
  }
}

export type MessagesManager = ReturnType<typeof newMessagesManager>
