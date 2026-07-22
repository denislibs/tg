// src/core/managers/messagesManager.ts
import type { RestClient } from '../net/restClient'
import { mapMessage, mapPoll, mapChecklist, mapScheduled, mapGeo, mapWebPage, type Message, type MessageEntity, type Poll, type Checklist, type RawMessage, type RawPoll, type RawChecklist, type RawScheduled, type Scheduled, type SecretMedia } from '../models'
import type { NewMessageEvt, EditMessageEvt, DeleteMessageEvt, GeoLiveUpdateEvt, WebPageUpdateEvt } from '../realtime/events'
import SlicedArray, { SliceEnd } from '../history/slicedArray'

export interface HistoryArgs {
  chatId: number
  offsetSeq?: number // reference seq; 0 = newest
  addOffset?: number // >0 older (inclusive), <=0 newer
  limit?: number
  /** окно треда (форум-топик / комментарии): id корневого сообщения */
  threadRoot?: number
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

/** Кто отреагировал (для попапа who-reacted). */
export interface ReactionUser {
  userId: number
  name: string
  username: string
  avatarUrl: string
  emoji: string
}

interface RawReactionUser {
  user_id: number
  name: string
  username: string
  avatar_url: string
  emoji: string
}

export interface MessagesDeps {
  rest: RestClient
  /** Расшифровка ciphertext секретного чата (ключи живут в secretManager воркера). */
  decryptSecret?: (chatId: number, encBody: string) => Promise<{ text: string; entities?: unknown[]; media?: SecretMedia } | null>
}

export function newMessagesManager({ rest, decryptSecret }: MessagesDeps) {
  // История секретного чата приходит с REST как encBody+пустой text — расшифровываем
  // страницу до отдачи в UI. Без ключа text остаётся пустым, но secret:true проставлен
  // (UI покажет плейсхолдер). Живые сообщения дешифруются в worker.ts.
  async function decryptPage(list: Message[]): Promise<Message[]> {
    if (!decryptSecret) return list
    return Promise.all(list.map(async (m) => {
      if (!m.encBody) return m
      const dec = await decryptSecret(m.chatId, m.encBody)
      return dec
        ? { ...m, text: dec.text, entities: (dec.entities as Message['entities']) ?? m.entities, secret: true, secretMedia: dec.media ?? m.secretMedia }
        : { ...m, secret: true }
    }))
  }
  // Кэш истории ключуется чатом ИЛИ тредом чата ("chatId" / "chatId:root") —
  // окно топика/комментариев живёт отдельным срезом (tweb: history по threadId).
  const slices = new Map<string, SlicedArray<number>>()
  const cache = new Map<string, Map<number, Message>>()
  const hkey = (chatId: number, threadRoot?: number | null): string =>
    threadRoot ? `${chatId}:${threadRoot}` : String(chatId)
  // Все ключи чата (основное окно + его треды) — для инвалидации по chatId.
  const keysOf = (chatId: number): string[] =>
    [...new Set([...slices.keys(), ...cache.keys()])].filter(
      (k) => k === String(chatId) || k.startsWith(`${chatId}:`),
    )

  const sliceFor = (key: string): SlicedArray<number> => {
    let sa = slices.get(key)
    if (!sa) { sa = new SlicedArray<number>(); slices.set(key, sa) }
    return sa
  }
  const cacheFor = (key: string): Map<number, Message> => {
    let c = cache.get(key)
    if (!c) { c = new Map(); cache.set(key, c) }
    return c
  }
  const put = (key: string, msgs: Message[]) => {
    const c = cacheFor(key)
    for (const m of msgs) c.set(m.seq, m)
  }

  return {
    async getHistory(args: HistoryArgs): Promise<HistoryResult> {
      const { chatId, offsetSeq = 0, addOffset = 0, limit = 40, threadRoot } = args
      const key = hkey(chatId, threadRoot)
      const sa = sliceFor(key)
      const c = cacheFor(key)

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
        { offset_id: offsetSeq, add_offset: addOffset, limit, ...(threadRoot ? { thread_root: threadRoot } : {}) },
      )
      const fetched = await decryptPage((r.messages ?? []).map(mapMessage))
      put(key, fetched)

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
      // Кладём и в основное окно чата, и в окно треда (если это тред-сообщение).
      for (const key of m.threadRootId ? [hkey(args.chatId), hkey(args.chatId, m.threadRootId)] : [hkey(args.chatId)]) {
        put(key, [m])
        const sa = sliceFor(key)
        // a sent message is the newest — push to the bottom end if we hold it
        if (sa.first.isEnd(SliceEnd.Bottom) && !sa.findSlice(m.seq)) sa.unshift(m.seq)
      }
      return m
    },

    // Edit a message's text (author only, server-enforced). Returns the updated
    // message and refreshes the cache entry.
    async editMessage(chatId: number, msgId: number, text: string, entities?: MessageEntity[]): Promise<Message> {
      const updated = await rest.patch<RawMessage>(`/chats/${chatId}/messages/${msgId}`, { text, entities: entities ?? null })
      const m = mapMessage(updated)
      for (const key of keysOf(chatId)) if (cache.get(key)?.has(m.seq)) put(key, [m])
      put(hkey(chatId, m.threadRootId), [m])
      return m
    },

    // Delete a message. revoke=true → for everyone; false → only for me. Deleted
    // messages are never shown, so evict from the cache (seq + slice) too, or a
    // later cache hit would resurrect it.
    async deleteMessage(chatId: number, msgId: number, revoke: boolean): Promise<{ ok: boolean }> {
      const r = await rest.del<{ ok: boolean }>(`/chats/${chatId}/messages/${msgId}?revoke=${revoke ? 'true' : 'false'}`)
      // Вычистить из основного окна и всех тред-окон этого чата.
      for (const key of keysOf(chatId)) {
        const c = cacheFor(key)
        for (const [seq, m] of c) {
          if (m.id === msgId) {
            c.delete(seq)
            sliceFor(key).delete(seq)
            break
          }
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
      put(hkey(toChatId), msgs)
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
      return decryptPage((r.messages ?? []).map(mapMessage))
    },

    // Jump-to-message: load a window centered on centerSeq and RESET this chat's
    // slice/cache to it (so loadOlder/loadNewer continue from the jumped spot).
    async getAround(chatId: number, centerSeq: number, limit = 40, threadRoot?: number): Promise<{ messages: Message[]; reachedTop: boolean; reachedBottom: boolean }> {
      const r = await rest.get<{ messages: RawMessage[]; reached_top: boolean; reached_bottom: boolean }>(
        `/chats/${chatId}/history`, { around: centerSeq, limit, ...(threadRoot ? { thread_root: threadRoot } : {}) },
      )
      const asc = await decryptPage((r.messages ?? []).map(mapMessage))
      const key = hkey(chatId, threadRoot)
      const sa = new SlicedArray<number>()
      slices.set(key, sa)
      const c = cacheFor(key)
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

    // ── Чек-листы (Telegram todo list) ──
    async sendChecklist(chatId: number, c: { title: string; items: string[]; othersCanAdd: boolean; othersCanMark: boolean; clientMsgId?: string }): Promise<Message> {
      const r = await rest.post<RawMessage>(`/chats/${chatId}/checklists`, {
        title: c.title, items: c.items,
        others_can_add: c.othersCanAdd, others_can_mark: c.othersCanMark,
        client_msg_id: c.clientMsgId ?? '',
      })
      return mapMessage(r)
    },
    // Отметить/снять отметку «выполнено» на пункте; возвращает обновлённый чек-лист.
    async toggleChecklistItem(checklistId: number, itemId: number): Promise<Checklist> {
      const r = await rest.post<{ checklist: RawChecklist }>(`/checklists/${checklistId}/items/${itemId}/toggle`, {})
      return mapChecklist(r.checklist)
    },
    // Добавить пункты; возвращает обновлённый чек-лист.
    async addChecklistItems(checklistId: number, items: string[]): Promise<Checklist> {
      const r = await rest.post<{ checklist: RawChecklist }>(`/checklists/${checklistId}/items`, { items })
      return mapChecklist(r.checklist)
    },

    // Сообщения треда (форум-топика) по возрастанию + total.
    async threadMessages(chatId: number, rootId: number, offset = 0, limit = 50): Promise<{ messages: Message[]; count: number }> {
      const r = await rest.get<{ messages: RawMessage[]; count: number }>(`/chats/${chatId}/threads/${rootId}`, { offset, limit })
      return { messages: await decryptPage((r.messages ?? []).map(mapMessage)), count: r.count }
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

    // Кто отреагировал и каким эмодзи (попап who-reacted).
    async reactionUsers(chatId: number, msgId: number): Promise<ReactionUser[]> {
      const r = await rest.get<{ users: RawReactionUser[] }>(`/chats/${chatId}/messages/${msgId}/reactions/users`)
      return (r.users ?? []).map((u) => ({
        userId: u.user_id,
        name: u.name,
        username: u.username,
        avatarUrl: u.avatar_url,
        emoji: u.emoji,
      }))
    },

    // Live-фрейм new_message → кэш истории (в чат-ключ и, для тред-сообщения,
    // в ключ треда). Без этого переоткрытие чата/треда попадало в устаревший
    // кэш-срез без свежих сообщений (свои комментарии «пропадали» до F5).
    cacheLive(evt: NewMessageEvt): void {
      const m = mapMessage({
        id: evt.msg_id, chat_id: evt.chat_id, seq: evt.seq, sender_id: evt.sender_id,
        type: evt.type, text: evt.text, entities: evt.entities ?? null,
        reply_to_id: evt.reply_to_id ?? null, media_id: evt.media_id ?? null,
        created_at: evt.created_at, thread_root_id: evt.thread_root_id ?? null,
        grouped_id: evt.grouped_id ?? null, media_unread: evt.media_unread,
        geo: evt.geo ?? null, contact: evt.contact ?? null,
        media_w: evt.media_w, media_h: evt.media_h, media_mime: evt.media_mime,
        media_blur: evt.media_blur, media_has_thumb: evt.media_has_thumb,
        media_duration: evt.media_duration, media_size: evt.media_size, media_name: evt.media_name,
        paid_media: evt.paid_media ?? null,
      })
      // E2E-медиа секретного чата: воркер уже расшифровал enc_body и положил
      // secret_media на фрейм (не проводное поле) — переносим в кэш-модель, чтобы
      // переоткрытие чата из кэша тоже отдавало расшифровываемое медиа.
      if (evt.secret_media) { m.secretMedia = evt.secret_media; m.secret = true }
      const keys = m.threadRootId ? [hkey(m.chatId), hkey(m.chatId, m.threadRootId)] : [hkey(m.chatId)]
      for (const key of keys) {
        // Только в срез, уже державший низ истории — иначе позиция неизвестна.
        const sa = slices.get(key)
        if (!sa || !sa.first.isEnd(SliceEnd.Bottom)) continue
        put(key, [m])
        if (!sa.findSlice(m.seq)) sa.unshift(m.seq)
      }
    },

    // Live-правка/удаление от любого участника → кэш всех окон этого чата.
    cacheEdit(evt: EditMessageEvt): void {
      for (const key of keysOf(evt.chat_id)) {
        const c = cache.get(key)
        if (!c) continue
        for (const [seq, m] of c) {
          if (m.id === evt.msg_id) {
            c.set(seq, { ...m, text: evt.text, entities: evt.entities ?? undefined, editedAt: evt.edited_at })
            break
          }
        }
      }
    },

    // Live-обновление координат гео-трансляции → кэш всех окон чата.
    cacheGeoLive(evt: GeoLiveUpdateEvt): void {
      const geo = mapGeo(evt.geo)
      for (const key of keysOf(evt.chat_id)) {
        const c = cache.get(key)
        if (!c) continue
        for (const [seq, m] of c) {
          if (m.id === evt.msg_id) {
            c.set(seq, { ...m, geo })
            break
          }
        }
      }
    },

    // Догоняющее серверное превью ссылки → кэш всех окон чата.
    cacheWebPage(evt: WebPageUpdateEvt): void {
      const webPage = mapWebPage(evt.web_page)
      for (const key of keysOf(evt.chat_id)) {
        const c = cache.get(key)
        if (!c) continue
        for (const [seq, m] of c) {
          if (m.id === evt.msg_id) {
            c.set(seq, { ...m, webPage })
            break
          }
        }
      }
    },

    // Платное медиа разблокировано: раскрываем баббл в кэше всех окон чата —
    // возвращаем ссылку на контент + метаданные и снимаем флаг locked.
    cachePaidUnlock(evt: NewMessageEvt): void {
      for (const key of keysOf(evt.chat_id)) {
        const c = cache.get(key)
        if (!c) continue
        for (const [seq, m] of c) {
          if (m.id === evt.msg_id) {
            c.set(seq, {
              ...m,
              mediaId: evt.media_id ?? null,
              mediaWidth: evt.media_w, mediaHeight: evt.media_h,
              mediaMime: evt.media_mime, mediaBlur: evt.media_blur,
              mediaHasThumb: evt.media_has_thumb, mediaDuration: evt.media_duration,
              mediaSize: evt.media_size, mediaName: evt.media_name,
              paidMedia: evt.paid_media ? { price: evt.paid_media.price, locked: evt.paid_media.locked } : undefined,
            })
            break
          }
        }
      }
    },

    cacheDelete(evt: DeleteMessageEvt): void {
      for (const key of keysOf(evt.chat_id)) {
        const c = cache.get(key)
        if (!c) continue
        for (const [seq, m] of c) {
          if (m.id === evt.msg_id) {
            c.delete(seq)
            slices.get(key)?.delete(seq)
            break
          }
        }
      }
    },

    // Реакции: поставить/снять свою (агрегаты приходят realtime-фреймом reaction).
    async react(chatId: number, msgId: number, emoji: string): Promise<void> {
      await rest.post(`/chats/${chatId}/messages/${msgId}/reactions`, { emoji })
    },

    async unreact(chatId: number, msgId: number, emoji: string): Promise<void> {
      await rest.del(`/chats/${chatId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`)
    },

    // Live location: отправить начальную точку трансляции по REST (нужен msgId,
    // чтобы затем слать обновления). Бабл появится WS-эхом new_message.
    async sendGeoLive(chatId: number, lat: number, lng: number, livePeriod: number, heading?: number): Promise<Message> {
      const created = await rest.post<RawMessage>(`/chats/${chatId}/messages`, {
        type: 'geo', text: '', geo_lat: lat, geo_lng: lng,
        geo_live_period: livePeriod, geo_heading: heading ?? null, client_msg_id: '',
      })
      const m = mapMessage(created)
      put(hkey(chatId), [m])
      const sa = sliceFor(hkey(chatId))
      if (sa.first.isEnd(SliceEnd.Bottom) && !sa.findSlice(m.seq)) sa.unshift(m.seq)
      return m
    },

    // Live location: обновить координаты (или остановить трансляцию stopped=true).
    async updateGeoLive(chatId: number, msgId: number, lat: number, lng: number, opts?: { heading?: number; stopped?: boolean }): Promise<Message> {
      const r = await rest.post<RawMessage>(`/chats/${chatId}/messages/${msgId}/geo_live`, {
        lat, lng, heading: opts?.heading ?? null, stopped: opts?.stopped ?? false,
      })
      const m = mapMessage(r)
      for (const key of keysOf(chatId)) if (cache.get(key)?.has(m.seq)) put(key, [m])
      return m
    },

    // Перевод произвольного текста на toLang (ISO-код). source — определённый
    // сервером исходный язык. 503 при отключённом провайдере (пробрасывается).
    async translate(text: string, toLang: string): Promise<{ text: string; source: string }> {
      return rest.post<{ text: string; source: string }>('/translate', { text, to_lang: toLang })
    },
  }
}

export type MessagesManager = ReturnType<typeof newMessagesManager>
