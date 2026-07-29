// src/core/managers/messagesManager.ts
import { HttpError, type RestClient } from '../net/restClient'
import { mapMessage, mapPoll, mapChecklist, mapGiveaway, mapScheduled, mapGeo, mapWebPage, mapFactCheck, type Message, type MessageEntity, type Poll, type Checklist, type Giveaway, type RawMessage, type RawPoll, type RawChecklist, type RawGiveaway, type RawScheduled, type Scheduled, type SecretMedia } from '../models'
import type { NewMessageEvt, EditMessageEvt, DeleteMessageEvt, GeoLiveUpdateEvt, WebPageUpdateEvt, FactCheckUpdateEvt, MediaReadEvt, ReactionEvt, StarReactionEvt } from '../realtime/events'
import SlicedArray, { SliceEnd } from '../history/slicedArray'
import { saveMessages, loadMessages, deletePersistedMessage } from '../store/persist'
import { reactionDelta } from '../reactionDelta'

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
  /** кросс-чат ответ (tweb ReplyToAnotherChat): id исходного чата оригинала */
  replyToPeerId?: number | null
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

/** Тег-реакция «Избранного»: реакция (эмодзи/id кастом-эмодзи), имя и счётчик. */
export interface SavedTag {
  reaction: string
  title: string
  count: number
}

interface RawSavedTag {
  reaction: string
  title?: string
  count: number
}

interface RawReactionUser {
  user_id: number
  name: string
  username: string
  avatar_url: string
  emoji: string
}

/** Один отправитель платной ⭐-реакции (топ-отправители попапа). Анонимный —
 * без личности (userId 0, пустое имя): рисуется как «Anonymous». */
export interface StarSender {
  userId: number
  name: string
  avatarUrl: string
  stars: number
  anonymous: boolean
}

interface RawStarSender {
  user_id: number
  name: string
  username: string
  avatar_url: string
  stars: number
  anonymous: boolean
}

/** Агрегат платной ⭐-реакции сообщения: сумма звёзд, мой вклад, топ-отправители. */
export interface StarReactionInfo {
  total: number
  mine: number
  top: StarSender[]
}

/** Результат отправки платной ⭐-реакции: новый агрегат + мой новый баланс. */
export interface StarReactionResult extends StarReactionInfo {
  balance: number
}

function mapStarSenders(rows: RawStarSender[] | undefined): StarSender[] {
  return (rows ?? []).map((s) => ({
    userId: s.user_id,
    name: s.name,
    avatarUrl: s.avatar_url,
    stars: s.stars,
    anonymous: s.anonymous,
  }))
}

export interface MessagesDeps {
  rest: RestClient
  /** Расшифровка ciphertext секретного чата (ключи живут в secretManager воркера). */
  decryptSecret?: (chatId: number, encBody: string) => Promise<{ text: string; entities?: unknown[]; media?: SecretMedia } | null>
  /** id текущего пользователя — воркеру нужен, чтобы кэшировать `mine` реакций
   * (событие reaction несёт user_id реагирующего, а не флаг «моё»). Разрешается
   * лениво (воркер зовёт /me), поэтому геттер, а не значение. */
  getMeId?: () => number | null
}

export function newMessagesManager({ rest, decryptSecret, getMeId }: MessagesDeps) {
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
  // SSOT сообщений воркера: ОДНА копия сообщения на (чат, seq). Окна/треды —
  // это списки seq в `slices`, ссылающиеся в эту единую Map (как в tweb:
  // messagesStorageByPeerId + history: SlicedArray<mid>). Раньше кэш ключевался
  // по окну, и тред-сообщение дублировало объект между основным окном и окном
  // треда; живые апдейты приходилось раскатывать по всем окнам (keysOf).
  const slices = new Map<string, SlicedArray<number>>()
  const msgsByChat = new Map<number, Map<number, Message>>()
  const hkey = (chatId: number, threadRoot?: number | null): string =>
    threadRoot ? `${chatId}:${threadRoot}` : String(chatId)
  // Ключи-ОКНА чата (основное + треды) — для операций над срезами (slices).
  const winKeysOf = (chatId: number): string[] =>
    [...slices.keys()].filter((k) => k === String(chatId) || k.startsWith(`${chatId}:`))

  const sliceFor = (key: string): SlicedArray<number> => {
    let sa = slices.get(key)
    if (!sa) { sa = new SlicedArray<number>(); slices.set(key, sa) }
    return sa
  }
  // chatId из ключа истории ("chatId" / "chatId:root") — для персиста по чату.
  const chatIdOf = (key: string): number => parseInt(key, 10)
  // Единая по чату Map сообщений (SSOT воркера). Все окна чата читают/пишут сюда.
  const msgsFor = (chatId: number): Map<number, Message> => {
    let c = msgsByChat.get(chatId)
    if (!c) { c = new Map(); msgsByChat.set(chatId, c) }
    return c
  }
  // Совместимость: сайты истории оперируют «кэшем окна» — теперь это единая
  // по чату Map (окно определяется срезом `slices`, а не отдельной Map).
  const cacheFor = (key: string): Map<number, Message> => msgsFor(chatIdOf(key))
  const put = (key: string, msgs: Message[]) => {
    const c = msgsFor(chatIdOf(key))
    for (const m of msgs) c.set(m.seq, m)
    // Write-through в офлайн-стор: put — единственный путь входа/обновления
    // сообщений в SSOT (страницы истории, отправка, live, пересылка, правки),
    // поэтому персист здесь покрывает их все.
    if (msgs.length) void saveMessages(chatIdOf(key), msgs)
  }
  // Точечно обновить одно сообщение чата в SSOT + персист. match — по id/вложенному
  // объекту (события реакций/опросов/read несут msg_id, а не seq). upd строит новую
  // версию. Идемпотентно, единый проход по одной Map (раньше — по всем окнам).
  const patchMsg = (chatId: number, match: (m: Message) => boolean, upd: (m: Message) => Message | null): void => {
    const c = msgsByChat.get(chatId)
    if (!c) return
    for (const [seq, m] of c) {
      if (!match(m)) continue
      const n = upd(m) // null — применять нечего (идемпотентное эхо своего действия)
      if (n === null) return
      c.set(seq, n)
      void saveMessages(chatId, [n])
      return
    }
  }
  // Удалить сообщение из SSOT + снять его seq из всех окон-срезов чата + персист.
  const evictMsg = (chatId: number, msgId: number): void => {
    const c = msgsByChat.get(chatId)
    let seq: number | undefined
    if (c) for (const [s, m] of c) if (m.id === msgId) { seq = s; c.delete(s); break }
    if (seq === undefined) return
    for (const k of winKeysOf(chatId)) slices.get(k)?.delete(seq)
    void deletePersistedMessage(chatId, seq)
  }

  // Дельта реакции (count±1 по emoji) → SSOT. `mine` = моё ли действие
  // (user_id === meId); та же чистая reactionDelta, что и в сторе. null из дельты —
  // эхо своего уже применённого действия, no-op. Общая для live-кадра (cacheReaction)
  // и оптимистичной записи в SSOT из react/unreact.
  const applyReactionToCache = (evt: ReactionEvt): void => {
    const mine = evt.user_id === (getMeId?.() ?? null)
    patchMsg(evt.chat_id, (m) => m.id === evt.msg_id, (m) => {
      const next = reactionDelta(m.reactions, evt.emoji, evt.action, mine)
      return next === null ? null : { ...m, reactions: next }
    })
  }
  // Wave 3: АБСОЛЮТНЫЙ агрегат (серверное эхо с counts) → SSOT. counts ставим
  // verbatim; `mine` деривим — сохраняем прежний для не затронутых emoji, ставим/
  // снимаем для emoji своего действия (только когда user_id===meId). Идемпотентно
  // на реплей (catch-up), поэтому дедуп по pts тут не нужен.
  const applyAbsoluteReactionToCache = (evt: ReactionEvt): void => {
    const counts = evt.counts ?? []
    const isMine = evt.user_id === (getMeId?.() ?? null)
    patchMsg(evt.chat_id, (m) => m.id === evt.msg_id, (m) => {
      const prevMine = new Set((m.reactions ?? []).filter((r) => r.mine).map((r) => r.emoji))
      const next = counts.map((c) => {
        let mine = prevMine.has(c.emoji)
        if (isMine && c.emoji === evt.emoji) mine = evt.action === 'add'
        return { emoji: c.emoji, count: c.count, mine }
      })
      return { ...m, reactions: next.length ? next : undefined }
    })
  }
  // Платная ⭐-реакция → SSOT: total авторитетен, свой вклад (mine) — только для
  // собственного действия (sender_id === meId), иначе сохраняем кэшированный.
  const applyStarToCache = (evt: StarReactionEvt): void => {
    const isMine = evt.sender_id === (getMeId?.() ?? null)
    patchMsg(evt.chat_id, (m) => m.id === evt.msg_id,
      (m) => ({ ...m, starReaction: { total: evt.total, mine: isMine ? evt.mine : (m.starReaction?.mine ?? 0) } }))
  }
  // Чек-лист → SSOT: отметки глобальны (нет локального состояния), полная замена.
  const applyChecklistToCache = (chatId: number, raw: RawChecklist): void => {
    const checklist = mapChecklist(raw)
    patchMsg(chatId, (m) => m.checklist?.id === checklist.id, (m) => ({ ...m, checklist }))
  }
  // Оптимистика в SSOT воркера (для переоткрытия чата до серверного эха): applyX
  // ToCache-хелперы выше. main-стор двигают клиентские вызыватели/хуки, а серверные
  // WS-эхо (reaction/star_reaction/checklist_update) приходят через funnel и
  // реконсилят абсолютно — broadcast'ов из менеджера больше нет.

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
      let r: { messages: RawMessage[]; count: number }
      try {
        r = await rest.get<{ messages: RawMessage[]; count: number }>(
          `/chats/${chatId}/history`,
          { offset_id: offsetSeq, add_offset: addOffset, limit, ...(threadRoot ? { thread_root: threadRoot } : {}) },
        )
      } catch (e) {
        // Сеть недоступна (fetch reject, не HttpError): отдаём персистнутую историю
        // основного окна чата (тред офлайн не поднимаем — его срез не хранится
        // отдельно). Сидим кэш+срез напрямую (минуя put, чтобы не перезаписывать).
        if (!(e instanceof HttpError) && !threadRoot) {
          const persisted = await loadMessages(chatId)
          if (persisted.length) {
            for (const m of persisted) c.set(m.seq, m)
            const seqsDesc = persisted.map((m) => m.seq).sort((a, b) => b - a)
            const inserted = sa.insertSlice(seqsDesc)
            if (inserted) inserted.setEnd(SliceEnd.Bottom) // низ = последнее известное
            return { messages: persisted.slice(), count: persisted.length, reachedTop: false, reachedBottom: true, cached: true }
          }
        }
        throw e
      }
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
        reply_to_peer_id: args.replyToPeerId ?? null,
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
      // upsert правки в SSOT (только если сообщение уже загружено в чат).
      if (msgsFor(chatId).has(m.seq)) put(hkey(chatId), [m])
      return m
    },

    // «Проверка фактов» (Telegram editFactCheck): прикрепить/изменить блок на
    // сообщении канала (право проверяет бэк — автор/админ канала). Возвращает
    // обновлённое сообщение и патчит SSOT.
    async setFactCheck(chatId: number, msgId: number, text: string, entities?: MessageEntity[], country?: string): Promise<Message> {
      const updated = await rest.post<RawMessage>(`/chats/${chatId}/messages/${msgId}/factcheck`, {
        text, entities: entities ?? null, country: country ?? '',
      })
      const m = mapMessage(updated)
      if (msgsFor(chatId).has(m.seq)) put(hkey(chatId), [m])
      // main-стор обновит вызыватель (applyFactCheck); WS factcheck_update реконсилит.
      return m
    },

    // Снять «проверку фактов» (Telegram deleteFactCheck). Патчит SSOT + эхо.
    async removeFactCheck(chatId: number, msgId: number): Promise<{ ok: boolean }> {
      const r = await rest.del<{ ok: boolean }>(`/chats/${chatId}/messages/${msgId}/factcheck`)
      patchMsg(chatId, (m) => m.id === msgId, (m) => ({ ...m, factCheck: undefined }))
      // main-стор обновит вызыватель (applyFactCheck); WS factcheck_update реконсилит.
      return r
    },

    // Расшифровка голосового/видео-кружка (Telegram transcribeAudio). Реального STT
    // на бэке нет — возвращается детерминированный стаб и кэшируется в SSOT, чтобы
    // блок остался развёрнутым при перерисовке.
    async transcribe(chatId: number, msgId: number): Promise<{ text: string; pending: boolean }> {
      const r = await rest.post<{ text: string; pending: boolean }>(`/chats/${chatId}/messages/${msgId}/transcribe`, {})
      patchMsg(chatId, (m) => m.id === msgId, (m) => ({ ...m, transcription: r.text }))
      return r
    },

    // Delete a message. revoke=true → for everyone; false → only for me. Deleted
    // messages are never shown, so evict from the SSOT (+ all window slices) too,
    // or a later cache hit would resurrect it.
    async deleteMessage(chatId: number, msgId: number, revoke: boolean): Promise<{ ok: boolean }> {
      // После УСПЕХА сети: эхо всем вкладкам + eviction из SSOT (storeProjection —
      // единственный писатель). Не оптимистично до REST: сервер может отклонить
      // удаление (напр. «для всех» после окна времени), а откат eviction+persist
      // сложен и рисковен — мгновенность удаления тут не критична (tweb-компромисс).
      const r = await rest.del<{ ok: boolean }>(`/chats/${chatId}/messages/${msgId}?revoke=${revoke ? 'true' : 'false'}`)
      evictMsg(chatId, msgId) // eviction из SSOT воркера; main-стор обновит вызыватель
      return r                // (applyDelete), а WS delete_message реконсилит.
    },

    // Forward messages from one chat into another; returns the created copies.
    // dropAuthor — скрыть отправителя (копия как своё сообщение), dropCaption —
    // убрать подпись у пересылаемого медиа (tweb dropAuthor/dropCaptions).
    async forwardMessages(
      toChatId: number,
      fromChatId: number,
      msgIds: number[],
      opts?: { dropAuthor?: boolean; dropCaption?: boolean },
    ): Promise<Message[]> {
      const r = await rest.post<{ messages: RawMessage[] }>(`/chats/${toChatId}/forward`, {
        from_chat_id: fromChatId,
        msg_ids: msgIds,
        drop_author: opts?.dropAuthor ?? false,
        drop_caption: opts?.dropCaption ?? false,
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
      void saveMessages(chatId, asc) // офлайн-персист окна jump-to-message
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

    // Поиск в чате: текст + необязательные фильтры (tweb topbarSearch) —
    // senderId (в группах), mediaType (photo/video/voice/roundvideo/file/link/music),
    // reaction (эмодзи). Пустой q при заданном фильтре допустим.
    async searchMessages(
      chatId: number,
      q: string,
      opts: { senderId?: number; mediaType?: string; reaction?: string; offset?: number; limit?: number } = {},
    ): Promise<{ messages: Message[]; count: number }> {
      const query: Record<string, string | number> = { q, offset: opts.offset ?? 0, limit: opts.limit ?? 20 }
      if (opts.senderId) query.sender_id = opts.senderId
      if (opts.mediaType) query.media_type = opts.mediaType
      if (opts.reaction) query.reaction = opts.reaction
      const r = await rest.get<{ messages: RawMessage[]; count: number }>(`/chats/${chatId}/search`, query)
      return { messages: (r.messages ?? []).map(mapMessage), count: r.count }
    },

    // Jump-to-date: seq ближайшего сообщения на/после даты (unix, сек). null, если
    // сообщений в чате нет (404).
    async messageByDate(chatId: number, date: number): Promise<number | null> {
      try {
        const r = await rest.get<{ seq: number }>(`/chats/${chatId}/message_by_date`, { date })
        return r.seq
      } catch {
        return null
      }
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
    // Голос (пустой список — отзыв); ответ авторитетен и несёт МОЙ выбор (myVotes),
    // которого нет в общем WS-событии poll_update. Ставим опрос ПОЛНОСТЬЮ в SSOT
    // воркера; main-стор обновляет вызыватель результатом (setPoll, не merge), иначе
    // WS-merge потерял бы myVotes. WS poll_update затем реконсилит агрегат.
    async votePoll(chatId: number, pollId: number, options: number[]): Promise<Poll> {
      const r = await rest.post<{ poll: RawPoll }>(`/polls/${pollId}/vote`, { options })
      const poll = mapPoll(r.poll)
      patchMsg(chatId, (m) => m.poll?.id === poll.id, (m) => ({ ...m, poll }))
      return poll
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
    // Отметить/снять отметку «выполнено» на пункте. Ответ авторитетен (несёт мою
    // отметку) → пушим в SSOT и бродкастим (storeProjection единственный писатель).
    async toggleChecklistItem(chatId: number, checklistId: number, itemId: number): Promise<Checklist> {
      const r = await rest.post<{ checklist: RawChecklist }>(`/checklists/${checklistId}/items/${itemId}/toggle`, {})
      applyChecklistToCache(chatId, r.checklist)
      return mapChecklist(r.checklist)
    },
    // Добавить пункты; ответ авторитетен → пуш в SSOT + broadcast.
    async addChecklistItems(chatId: number, checklistId: number, items: string[]): Promise<Checklist> {
      const r = await rest.post<{ checklist: RawChecklist }>(`/checklists/${checklistId}/items`, { items })
      applyChecklistToCache(chatId, r.checklist)
      return mapChecklist(r.checklist)
    },

    // Участвовать в розыгрыше. Ответ несёт МОЁ participating/iWon, которого нет в
    // общем WS giveaway_update → ставим розыгрыш ПОЛНОСТЬЮ в SSOT воркера; main-стор
    // обновляет вызыватель результатом (setGiveaway, не merge). WS реконсилит агрегат.
    async participateGiveaway(chatId: number, giveawayId: number): Promise<Giveaway> {
      const r = await rest.post<{ giveaway: RawGiveaway }>(`/giveaways/${giveawayId}/participate`, {})
      const giveaway = mapGiveaway(r.giveaway)
      patchMsg(chatId, (m) => m.giveaway?.id === giveaway.id, (m) => ({ ...m, giveaway }))
      return giveaway
    },

    // Сообщения треда (форум-топика) по возрастанию + total.
    async threadMessages(chatId: number, rootId: number, offset = 0, limit = 50): Promise<{ messages: Message[]; count: number }> {
      const r = await rest.get<{ messages: RawMessage[]; count: number }>(`/chats/${chatId}/threads/${rootId}`, { offset, limit })
      return { messages: await decryptPage((r.messages ?? []).map(mapMessage)), count: r.count }
    },

    // ── Запланированные сообщения (Telegram scheduled) ──
    // whenOnline (tweb Schedule.SendWhenOnline): очередь ждёт появления собеседника
    // в сети — send_at игнорируется бэком (только приватный чат, иначе 403).
    async scheduleMessage(chatId: number, p: { text: string; entities?: MessageEntity[]; sendAt: number; replyToId?: number; whenOnline?: boolean }): Promise<Scheduled> {
      const r = await rest.post<RawScheduled>(`/chats/${chatId}/scheduled`, {
        type: 'text', text: p.text, entities: p.entities ?? null,
        reply_to_id: p.replyToId ?? null, send_at: p.sendAt,
        when_online: p.whenOnline ?? false,
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
    // Перепланировать (tweb MessageScheduleEditTime): сменить время отправки.
    // Сброс when_online делает бэк (появляется конкретная дата).
    async editScheduled(chatId: number, id: number, sendAt: number): Promise<Scheduled> {
      const r = await rest.patch<RawScheduled>(`/chats/${chatId}/scheduled/${id}`, { send_at: sendAt })
      return mapScheduled(r)
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
        // Кросс-чат-ответ: снимок превью (имя автора + текст/лейбл) — иначе при
        // переоткрытии чата из кэша превью кросс-чат-reply не восстанавливается.
        reply_to_peer_id: evt.reply_to_peer_id ?? null,
        reply_snapshot_name: evt.reply_snapshot_name, reply_snapshot_text: evt.reply_snapshot_text,
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

    // Live-правка от любого участника → единый объект в SSOT.
    cacheEdit(evt: EditMessageEvt): void {
      patchMsg(evt.chat_id, (m) => m.id === evt.msg_id,
        (m) => ({ ...m, text: evt.text, entities: evt.entities ?? undefined, editedAt: evt.edited_at }))
    },

    // Live-обновление координат гео-трансляции → SSOT.
    cacheGeoLive(evt: GeoLiveUpdateEvt): void {
      const geo = mapGeo(evt.geo)
      patchMsg(evt.chat_id, (m) => m.id === evt.msg_id, (m) => ({ ...m, geo }))
    },

    // Догоняющее серверное превью ссылки → SSOT.
    cacheWebPage(evt: WebPageUpdateEvt): void {
      const webPage = mapWebPage(evt.web_page)
      patchMsg(evt.chat_id, (m) => m.id === evt.msg_id, (m) => ({ ...m, webPage }))
    },

    // «Проверка фактов» прикреплена/изменена/снята → SSOT.
    cacheFactCheck(evt: FactCheckUpdateEvt): void {
      const factCheck = evt.factcheck ? mapFactCheck(evt.factcheck) : undefined
      patchMsg(evt.chat_id, (m) => m.id === evt.msg_id, (m) => ({ ...m, factCheck }))
    },

    // Платное медиа разблокировано: раскрываем баббл в SSOT — возвращаем ссылку на
    // контент + метаданные и снимаем флаг locked.
    cachePaidUnlock(evt: NewMessageEvt): void {
      patchMsg(evt.chat_id, (m) => m.id === evt.msg_id, (m) => ({
        ...m,
        mediaId: evt.media_id ?? null,
        mediaWidth: evt.media_w, mediaHeight: evt.media_h,
        mediaMime: evt.media_mime, mediaBlur: evt.media_blur,
        mediaHasThumb: evt.media_has_thumb, mediaDuration: evt.media_duration,
        mediaSize: evt.media_size, mediaName: evt.media_name,
        paidMedia: evt.paid_media ? { price: evt.paid_media.price, locked: evt.paid_media.locked } : undefined,
      }))
    },

    cacheDelete(evt: DeleteMessageEvt): void {
      evictMsg(evt.chat_id, evt.msg_id)
    },

    // Голосовое/кружок прослушано → точка media_unread гаснет. Без кэша переоткрытие
    // чата из кэша возвращало точку (P0-1).
    cacheMediaRead(evt: MediaReadEvt): void {
      patchMsg(evt.chat_id, (m) => m.id === evt.msg_id && !!m.mediaUnread, (m) => ({ ...m, mediaUnread: false }))
    },

    // Live-агрегат опроса (poll_update) → SSOT; свой выбор (myVotes) — локальный,
    // сохраняем (серверный broadcast его не несёт).
    cachePoll(evt: { chat_id: number; poll: RawPoll }): void {
      const poll = mapPoll(evt.poll)
      patchMsg(evt.chat_id, (m) => m.poll?.id === poll.id, (m) => ({ ...m, poll: { ...poll, myVotes: m.poll!.myVotes } }))
    },

    // Live-кадр checklist_update → SSOT (broadcast делает worker.ts отдельно).
    cacheChecklist(evt: { chat_id: number; checklist: RawChecklist }): void {
      applyChecklistToCache(evt.chat_id, evt.checklist)
    },

    // Live-статус розыгрыша (giveaway_update) → SSOT; своё участие
    // (participating/iWon) — локальное, сохраняем.
    cacheGiveaway(evt: { chat_id: number; giveaway: RawGiveaway }): void {
      const giveaway = mapGiveaway(evt.giveaway)
      patchMsg(evt.chat_id, (m) => m.giveaway?.id === giveaway.id, (m) => ({ ...m, giveaway: { ...giveaway, participating: m.giveaway!.participating, iWon: m.giveaway!.iWon } }))
    },

    // Reaction → SSOT. С counts (серверное эхо/catch-up) — АБСОЛЮТНЫЙ set; без
    // counts (оптимистичный клик до эха) — дельта. broadcast делает worker.ts.
    cacheReaction(evt: ReactionEvt): void {
      if (evt.counts) applyAbsoluteReactionToCache(evt)
      else applyReactionToCache(evt)
    },

    // Live-кадр star_reaction (server echo) → SSOT (broadcast делает worker.ts).
    cacheStarReaction(evt: StarReactionEvt): void {
      applyStarToCache(evt)
    },

    // Реакции: поставить/снять свою. Оптимистика в воркере (tweb sendReaction) —
    // применяем локально и бродкастим эхо ДО сети, storeProjection единственный
    // писатель. На ошибке сети — откат обратной дельтой. meId обязателен для верной
    // деривации `mine`; пока не разрешён (старт) — без оптимистики, ждём эхо сервера.
    async react(chatId: number, msgId: number, emoji: string): Promise<void> {
      const me = getMeId?.() ?? null
      if (me != null) applyReactionToCache({ chat_id: chatId, msg_id: msgId, user_id: me, emoji, action: 'add' })
      try {
        await rest.post(`/chats/${chatId}/messages/${msgId}/reactions`, { emoji })
      } catch (e) {
        if (me != null) applyReactionToCache({ chat_id: chatId, msg_id: msgId, user_id: me, emoji, action: 'remove' })
        throw e
      }
    },

    async unreact(chatId: number, msgId: number, emoji: string): Promise<void> {
      const me = getMeId?.() ?? null
      if (me != null) applyReactionToCache({ chat_id: chatId, msg_id: msgId, user_id: me, emoji, action: 'remove' })
      try {
        await rest.del(`/chats/${chatId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`)
      } catch (e) {
        if (me != null) applyReactionToCache({ chat_id: chatId, msg_id: msgId, user_id: me, emoji, action: 'add' })
        throw e
      }
    },

    // Теги-реакции «Избранного» (Telegram saved reaction tags). Пометка/снятие
    // тега — это react/unreact в самочате; здесь — список тегов и их имена.
    async getSavedTags(): Promise<SavedTag[]> {
      const r = await rest.get<{ tags: RawSavedTag[] }>('/saved/tags')
      return (r.tags ?? []).map((t) => ({ reaction: t.reaction, title: t.title ?? '', count: t.count }))
    },

    // Задать/переименовать/очистить (пустой title) имя тега (updateSavedReactionTag).
    async renameSavedTag(reaction: string, title: string): Promise<void> {
      await rest.put(`/saved/tags/${encodeURIComponent(reaction)}`, { title })
    },

    // Платная ⭐-реакция: списать count звёзд у себя, начислить автору, накопить
    // вклад. Возвращает новый агрегат + топ-отправителей + мой баланс. Live-эхо
    // star_reaction тоже придёт (идемпотентно правит total в сторе).
    async sendStarReaction(chatId: number, msgId: number, count: number, anonymous: boolean): Promise<StarReactionResult> {
      const r = await rest.post<{ star_reaction: { total: number; mine: number }; top: RawStarSender[]; balance: number }>(
        `/chats/${chatId}/messages/${msgId}/star_reaction`, { count, anonymous })
      // Агрегат сообщения (total/mine) → SSOT + эхо всем вкладкам; баланс/топ отдаём
      // вызывающему попапу отдельно (это не про сообщение).
      applyStarToCache({ chat_id: chatId, msg_id: msgId, sender_id: getMeId?.() ?? 0, total: r.star_reaction.total, mine: r.star_reaction.mine })
      return { total: r.star_reaction.total, mine: r.star_reaction.mine, balance: r.balance, top: mapStarSenders(r.top) }
    },

    // Агрегат платной ⭐-реакции сообщения (total + мой вклад + топ-отправители).
    async getStarReaction(chatId: number, msgId: number): Promise<StarReactionInfo> {
      const r = await rest.get<{ star_reaction: { total: number; mine: number }; top: RawStarSender[] }>(
        `/chats/${chatId}/messages/${msgId}/star_reaction`)
      return { total: r.star_reaction.total, mine: r.star_reaction.mine, top: mapStarSenders(r.top) }
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
      if (msgsFor(chatId).has(m.seq)) put(hkey(chatId), [m])
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
