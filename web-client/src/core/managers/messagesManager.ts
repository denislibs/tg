// src/core/managers/messagesManager.ts
import { HttpError, type RestClient } from '../net/restClient'

/** День месяца с медиа — превью в ячейке пикера даты (tweb getSearchResultsCalendar). */
export interface CalendarDay {
  /** полночь дня, unix-секунды (UTC) */
  day: number
  msg_id: number
  seq: number
  media_id: number
  type: string
  /** есть сгенерированная миниатюра; без неё нужен оригинал (?v=thumb вернёт 404) */
  has_thumb: boolean
}
import { mapMessage, mapScheduled, mapGeo, mapWebPage, mapFactCheck, fromNewMessageEvt, type Message, type MessageEntity, type RawMessage, type RawScheduled, type Scheduled, type SecretMedia } from '../models'
import { mapReplyMarkup } from './botsManager'
import type { NewMessageEvt, EditMessageEvt, DeleteMessageEvt, GeoLiveUpdateEvt, WebPageUpdateEvt, FactCheckUpdateEvt, MediaReadEvt } from '../realtime/events'
import { RT } from '../realtime/events'
import type { MessageOp } from '../realtime/messageOps'
import SlicedArray, { SliceEnd } from '../history/slicedArray'
import { saveMessages, loadMessages, deletePersistedMessage } from '../store/persist'
import { newPollMethods } from './messages/pollMethods'
import { newTranslationMethods } from './messages/translationMethods'
import { newReactionMethods } from './messages/reactionMethods'
// Реакционные типы переехали в reactionMethods — реэкспорт для стабильности
// импортов (StarReactionPopup, SavedTagsPanel и др. берут их отсюда).
export type { ReactionUser, SavedTag, StarSender, StarReactionInfo, StarReactionResult } from './messages/reactionMethods'

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

export interface MessagesDeps {
  rest: RestClient
  /** Расшифровка ciphertext секретного чата (ключи живут в secretManager воркера). */
  decryptSecret?: (chatId: number, encBody: string) => Promise<{ text: string; entities?: unknown[]; media?: SecretMedia } | null>
  /** id текущего пользователя — воркеру нужен, чтобы кэшировать `mine` реакций
   * (событие reaction несёт user_id реагирующего, а не флаг «моё»). Разрешается
   * лениво (воркер зовёт /me), поэтому геттер, а не значение. */
  getMeId?: () => number | null
  /** Эхо операций остальным вкладкам для RPC-путей, у которых нет WS-эха с тем же
   * эффектом (напр. deleteMessage: вкладка-инициатор чинит своё окно сама через
   * applyDelete, а остальным вкладкам операции нужно разослать отсюда). Опционален —
   * тесты кэш-методов (cacheX) его не используют. */
  broadcast?: (event: string, payload: unknown) => void
}

export function newMessagesManager({ rest, decryptSecret, getMeId, broadcast }: MessagesDeps) {
  // История секретного чата приходит с REST как encBody+пустой text — расшифровываем
  // страницу до отдачи в UI. Без ключа text остаётся пустым, но secret:true проставлен
  // (UI покажет плейсхолдер). Живые сообщения дешифруются в workerCore.ts.
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
  // Ключи ВСЕХ окон чата (основное + треды), где сообщение сейчас видно (его seq
  // есть в срезе) — нужно операциям patch/remove (Stage 1B.3, Task 3). Важный
  // нюанс: patchMsg выше мутирует ОДНУ копию в единой SSOT-Map чата и
  // останавливается на первом совпадении, а сторный patchChat переигрывает
  // мутацию по ВСЕМ окнам чата (основному и тредам) — без этого перечисления
  // операция дошла бы только до окна из первого совпавшего среза, и окно треда
  // осталось бы со старыми данными до следующей перезагрузки.
  const opWindowsFor = (chatId: number, msgId: number): string[] => {
    const c = msgsByChat.get(chatId)
    if (!c) return []
    let seq: number | undefined
    for (const [s, m] of c) if (m.id === msgId) { seq = s; break }
    if (seq === undefined) return []
    return winKeysOf(chatId).filter((k) => slices.get(k)?.findSlice(seq!))
  }
  // Удаление сообщения → remove-операции по всем окнам, где оно было видно.
  // Общая точка входа для WS-пути (cacheDelete, funnel воркера) и RPC-пути
  // (deleteMessage, эта же вкладка удалила): обе обязаны вычислить ключи окон ДО
  // evictMsg — после эвикции seq уже выкинут из срезов, opWindowsFor не найдёт
  // ничего (Regression 2, финальное ревью feat/remaining-ops: deleteMessage звал
  // evictMsg напрямую и терял ops для остальных вкладок).
  const evictAndBuildRemoveOps = (chatId: number, msgId: number): MessageOp[] => {
    const keys = opWindowsFor(chatId, msgId)
    evictMsg(chatId, msgId)
    return keys.map((key): MessageOp => ({ op: 'remove', key, msgId }))
  }

  // Оптимистика в SSOT воркера (для переоткрытия чата до серверного эха): apply-хелперы
  // реакций/чек-листов живут в под-модулях. main-стор двигают клиентские вызыватели/
  // хуки, серверные WS-эхо приходят через funnel и реконсилят абсолютно.

  // Под-модули God-объекта (P1-6): опросы/чек-листы/розыгрыши, перевод/транскрипция и
  // реакции/теги/⭐ выделены в отдельные файлы, спредятся сюда — публичный API
  // messages.* не меняется.
  const ctx = { rest, patchMsg, getMeId, opWindowsFor }

  return {
    ...newReactionMethods(ctx),
    ...newPollMethods(ctx),
    ...newTranslationMethods(ctx),
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

    // Delete a message. revoke=true → for everyone; false → only for me. Deleted
    // messages are never shown, so evict from the SSOT (+ all window slices) too,
    // or a later cache hit would resurrect it.
    async deleteMessage(chatId: number, msgId: number, revoke: boolean): Promise<{ ok: boolean }> {
      // После УСПЕХА сети: eviction из SSOT + рассылка remove-операций остальным
      // вкладкам (Regression 2, финальное ревью feat/remaining-ops: [RT.deleteMessage]
      // убран из реестра APPLY проектора — окно правит только applyOps, а WS
      // delete_message придёт по уже опустевшему SSOT воркера и cacheDelete отдаст
      // пустой список, если не разослать ops здесь). Вкладка-инициатор чинит своё
      // окно сама (useMessageActions → applyDelete), поэтому себе не шлём. Не
      // оптимистично до REST: сервер может отклонить удаление (напр. «для всех»
      // после окна времени), а откат eviction+persist сложен и рисковен —
      // мгновенность удаления тут не критична (tweb-компромисс).
      const r = await rest.del<{ ok: boolean }>(`/chats/${chatId}/messages/${msgId}?revoke=${revoke ? 'true' : 'false'}`)
      const ops = evictAndBuildRemoveOps(chatId, msgId)
      if (ops.length) broadcast?.(RT.messageOp, { ops })
      return r
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

    // Медиа-превью по дням месяца для пикера даты (tweb
    // getSearchResultsCalendar): по одному сообщению на день, дни без медиа
    // просто отсутствуют. month — любой unix-момент внутри нужного месяца.
    async calendarMonth(chatId: number, month: number): Promise<CalendarDay[]> {
      try {
        return await rest.get<CalendarDay[]>(`/chats/${chatId}/calendar`, { month })
      } catch {
        return [] // календарь работает и без миниатюр
      }
    },

    // Глобальный поиск по сообщениям всех чатов (сайдбар-поиск): q — текст,
    // filter сужает по типу шаред-медиа ('' — любой тип, q обязателен).
    async searchGlobal(q: string, filter: '' | 'media' | 'files' | 'links' | 'music' | 'voice' = '', offset = 0, limit = 20): Promise<{ messages: Message[]; count: number }> {
      const r = await rest.get<{ messages: RawMessage[]; count: number }>('/search/messages', { q, filter, offset, limit })
      return { messages: (r.messages ?? []).map(mapMessage), count: r.count }
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

    // Live-фрейм new_message → кэш истории (в чат-ключ и, для тред-сообщения,
    // в ключ треда). Без этого переоткрытие чата/треда попадало в устаревший
    // кэш-срез без свежих сообщений (свои комментарии «пропадали» до F5).
    // Помимо мутации SSOT возвращает MessageOp[] — по одной операции 'insert' на
    // затронутое окно (Stage 1B.2, Task 3): воркер зеркалит их проектору главного
    // потока (routeNewMessage → RT.messageOp), тот переигрывает поверх стора вместо
    // самостоятельного разбора кадра.
    cacheLive(evt: NewMessageEvt): MessageOp[] {
      // Fix (пост-ревью Task 4): раньше здесь жил собственный литерал mapMessage(),
      // независимый от fromNewMessageEvt (единый маппер live-кадра, models.ts) — он
      // отставал полями (не было fwd_from_*/gift/reply_markup/effect/media_title/
      // media_performer/reply_to). Пока вставку в окно на главном потоке делал
      // applyIncoming(fromNewMessageEvt(...)), расхождение было не видно —
      // рендерился полный вариант. После Task 4 (проектор переигрывает ОПЕРАЦИЮ,
      // а не разбирает кадр сам) обеднённый вариант стал единственным источником
      // вставки — расхождение сделалось бы молчаливой регрессией данных на
      // горячем пути. Переиспользуем fromNewMessageEvt напрямую: один маппер вместо
      // двух, расхождение невозможно by construction. `replyTo` не передаём (второй
      // параметр) — резолв превью ответа нужен уже загруженное окно (main-thread
      // забота, см. storeProjection.ts), у воркера его нет; сама fromNewMessageEvt
      // уже делает то же, что раньше делал этот метод вручную: инжект secretMedia/
      // secret расшифрованного E2E-медиа и clientId эха своей отправки.
      const m = fromNewMessageEvt(evt)
      const keys = m.threadRootId ? [hkey(m.chatId), hkey(m.chatId, m.threadRootId)] : [hkey(m.chatId)]
      const ops: MessageOp[] = []
      for (const key of keys) {
        // Только в срез, уже державший низ истории — иначе позиция неизвестна.
        // Тот же гейт решает, породится ли операция: пропущенное здесь окно не
        // должно получить вставку и на главном потоке — иначе представления
        // разъедутся (ради устранения этого расхождения и вводится replay).
        const sa = slices.get(key)
        if (!sa || !sa.first.isEnd(SliceEnd.Bottom)) continue
        put(key, [m])
        if (!sa.findSlice(m.seq)) sa.unshift(m.seq)
        ops.push({ op: 'insert', key, msg: m })
      }
      return ops
    },

    // Live-правка от любого участника → единый объект в SSOT.
    // Stage 1B.3 (Task 3): НЕ переведено на операции — но уже не из-за пробела в
    // cacheEdit (тот чинили отдельно: reply_markup теперь мапится сюда же тем же
    // правилом, что и витрина — mapReplyMarkup при наличии поля, снятие клавиатуры
    // при его отсутствии, backend/internal/usecase/chat/frame.go:243 шлёт поле
    // абсолютным значением). Других обогащений у edit_message нет, так что
    // структурных препятствий к переводу на patch не осталось — перевод остаётся
    // отдельной задачей (вне объёма этой), а не решением проблемы с данными.
    cacheEdit(evt: EditMessageEvt): void {
      patchMsg(evt.chat_id, (m) => m.id === evt.msg_id,
        (m) => ({
          ...m,
          text: evt.text,
          entities: evt.entities ?? undefined,
          editedAt: evt.edited_at,
          replyMarkup: evt.reply_markup ? mapReplyMarkup(evt.reply_markup) : undefined,
        }))
    },

    // Live-обновление координат гео-трансляции → SSOT.
    // Stage 1B.3 (Task 3): НЕ переведено на операции — сознательно. geo_live_update
    // классифицирован в eventCatalog.ts как 'ephemeral' (без pts), поэтому идёт
    // мимо funnel/APPLY воркера напрямую в PASS_THROUGH — cacheGeoLive НИКОГДА не
    // вызывается (мёртвый код уже сегодня, независимо от этой задачи). Единственный
    // применяющий путь — сырой кадр в storeProjection (RT.geoLiveUpdate → applyGeoLive).
    // Перевод на операции потребовал бы структурного решения за рамками этой
    // задачи (переклассифицировать тип в 'logged', завести pts на бэке) — оставлено
    // как есть; и cache, и проекция не тронуты.
    cacheGeoLive(evt: GeoLiveUpdateEvt): void {
      const geo = mapGeo(evt.geo)
      patchMsg(evt.chat_id, (m) => m.id === evt.msg_id, (m) => ({ ...m, geo }))
    },

    // Догоняющее серверное превью ссылки → SSOT. Возвращает MessageOp[] — по одной
    // операции 'patch' на каждое окно чата, где сообщение видно (Stage 1B.3, Task 3).
    cacheWebPage(evt: WebPageUpdateEvt): MessageOp[] {
      const webPage = mapWebPage(evt.web_page)
      patchMsg(evt.chat_id, (m) => m.id === evt.msg_id, (m) => ({ ...m, webPage }))
      return opWindowsFor(evt.chat_id, evt.msg_id).map((key): MessageOp => ({ op: 'patch', key, msgId: evt.msg_id, fields: { webPage } }))
    },

    // «Проверка фактов» прикреплена/изменена/снята → SSOT + операции по всем окнам.
    cacheFactCheck(evt: FactCheckUpdateEvt): MessageOp[] {
      const factCheck = evt.factcheck ? mapFactCheck(evt.factcheck) : undefined
      patchMsg(evt.chat_id, (m) => m.id === evt.msg_id, (m) => ({ ...m, factCheck }))
      return opWindowsFor(evt.chat_id, evt.msg_id).map((key): MessageOp => ({ op: 'patch', key, msgId: evt.msg_id, fields: { factCheck } }))
    },

    // Платное медиа разблокировано: раскрываем баббл в SSOT — возвращаем ссылку на
    // контент + метаданные и снимаем флаг locked. Операции несут только эти поля
    // (не полный объект — см. карту обогащений); сторный applyPaidUnlock, резавший
    // те же поля вручную, стал недостижим и удалён (Task 6).
    cachePaidUnlock(evt: NewMessageEvt): MessageOp[] {
      const fields: Partial<Message> = {
        mediaId: evt.media_id ?? null,
        mediaWidth: evt.media_w, mediaHeight: evt.media_h,
        mediaMime: evt.media_mime, mediaBlur: evt.media_blur,
        mediaHasThumb: evt.media_has_thumb, mediaDuration: evt.media_duration,
        mediaSize: evt.media_size, mediaName: evt.media_name,
        paidMedia: evt.paid_media ? { price: evt.paid_media.price, locked: evt.paid_media.locked } : undefined,
      }
      patchMsg(evt.chat_id, (m) => m.id === evt.msg_id, (m) => ({ ...m, ...fields }))
      return opWindowsFor(evt.chat_id, evt.msg_id).map((key): MessageOp => ({ op: 'patch', key, msgId: evt.msg_id, fields }))
    },

    cacheDelete(evt: DeleteMessageEvt): MessageOp[] {
      return evictAndBuildRemoveOps(evt.chat_id, evt.msg_id)
    },

    // Голосовое/кружок прослушано → точка media_unread гаснет. Без кэша переоткрытие
    // чата из кэша возвращало точку (P0-1). matched — тот же гейт, что у patchMsg
    // (уже прочитанное сообщение не патчим и операцию на него не порождаем).
    cacheMediaRead(evt: MediaReadEvt): MessageOp[] {
      let matched = false
      patchMsg(evt.chat_id, (m) => m.id === evt.msg_id && !!m.mediaUnread, (m) => { matched = true; return { ...m, mediaUnread: false } })
      if (!matched) return []
      return opWindowsFor(evt.chat_id, evt.msg_id).map((key): MessageOp => ({ op: 'patch', key, msgId: evt.msg_id, fields: { mediaUnread: false } }))
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

  }
}

export type MessagesManager = ReturnType<typeof newMessagesManager>
