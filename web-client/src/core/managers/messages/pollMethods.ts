// src/core/managers/messages/pollMethods.ts
//
// Опросы + чек-листы + розыгрыши (порт tweb appPolls). Выделено из God-объекта
// messagesManager: зависит только от rest и точечного патча SSOT (patchMsg через
// ctx). Публичный API не меняется — методы спредятся в объект messagesManager.
//
// Все три подсистемы — КОНСТРУКТОРЫ объединения `MessageMedia`, а не собственные
// поля сообщения, поэтому маппера у них больше нет вовсе: ручки и кадры несут
// `{media}` в той же форме, в какой вложение лежит в сообщении. Сообщение
// адресуется не номером, а идентификатором внутри вложения — так его и находят
// (`byPollId`/`byTodoId`/`byGiveawayId`).
import { mapMyMessage, type MyMessage, type MessageReal, type RawMyMessage, type GiveawayState } from '../../models'
import type { MessageMedia, MessageMediaPoll, MessageMediaToDo } from '../../media/messageMedia'
import type { MessageOp } from '../../realtime/messageOps'
import type { MessagesCtx } from './ctx'
import { sendingParamsToWire, type MessageSendingParams } from './sendingParams'

/** Вложение сообщения — опрос с этим идентификатором. */
const byPollId = (id: number) => (m: MyMessage): boolean =>
  m._ === 'message' && m.media?._ === 'messageMediaPoll' && m.media.poll.id === id

/** Вложение сообщения — чек-лист с этим идентификатором. */
const byTodoId = (id: number) => (m: MyMessage): boolean =>
  m._ === 'message' && m.media?._ === 'messageMediaToDo' && m.media.todo.id === id

/** Вложение сообщения — розыгрыш с этим идентификатором, в любой из двух
 *  стадий: идущий и состоявшийся — РАЗНЫЕ конструкторы одного розыгрыша. */
const byGiveawayId = (id: number) => (m: MyMessage): boolean =>
  m._ === 'message'
  && (m.media?._ === 'messageMediaGiveaway' || m.media?._ === 'messageMediaGiveawayResults')
  && m.media.id === id

/** Идентификатор розыгрыша внутри вложения; `undefined` — вложение не розыгрыш. */
function giveawayIdOf(media: MessageMedia): number | undefined {
  return media._ === 'messageMediaGiveaway' || media._ === 'messageMediaGiveawayResults' ? media.id : undefined
}

export function newPollMethods({ rest, patchMsg, getMeId, opWindowsFor }: MessagesCtx) {
  // Та же граница маппинга, что в messagesManager: `pFlags.out` производит
  // сервер, здесь остаются перевод номеров и уточнение служебного действия.
  const mapOne = (r: RawMyMessage): MyMessage => mapMyMessage(r, getMeId?.() ?? null)

  /** Заменить вложение сообщения, найденного предикатом; вернуть его номер. */
  const setMedia = (peerId: number, match: (m: MyMessage) => boolean, media: MessageMedia): number | undefined => {
    let msgId: number | undefined
    patchMsg(peerId, match, (m) => { msgId = m.id; return { ...m, media } as MessageReal })
    return msgId
  }

  /** Операции patch по всем окнам, где сообщение видно. */
  const ops = (peerId: number, msgId: number | undefined, media: MessageMedia): MessageOp[] =>
    msgId === undefined ? [] : opWindowsFor(peerId, msgId).map((key): MessageOp => ({ op: 'patch', key, msgId, fields: { media } }))

  return {
    // ── Опросы (Telegram Poll) ──
    // Пакет параметров отправки — как у всех остальных путей (порт tweb: опрос
    // уходит `sendOther({...sendingParams, inputMedia: inputMediaPoll})`,
    // appMessagesManager.ts:2413). `effect` пакета сюда не едет СОЗНАТЕЛЬНО:
    // бэкенд снимает эффект с типа 'poll' по whitelist (sanitizeEffect,
    // backend/internal/usecase/chat/sanitize.go:29-32) — как и Telegram, который
    // эффекты на опросах не показывает.
    async sendPoll(peerId: number, p: { question: string; options: string[]; anonymous: boolean; multiple: boolean; quiz: boolean; correctOption?: number; clientMsgId?: string } & MessageSendingParams): Promise<MyMessage> {
      const wire = sendingParamsToWire(p)
      const r = await rest.post<RawMyMessage>(`/chats/${peerId}/polls`, {
        question: p.question, options: p.options, anonymous: p.anonymous,
        multiple: p.multiple, quiz: p.quiz, correct_option: p.correctOption ?? null,
        client_msg_id: p.clientMsgId ?? '',
        reply_to_id: wire.replyToId, reply_quote_text: wire.replyQuoteText,
        reply_quote_offset: wire.replyQuoteOffset, thread_root_id: wire.threadRootId,
        silent: wire.silent, send_as_peer_id: wire.sendAsPeerId,
      })
      return mapOne(r)
    },
    // Голос (пустой список — отзыв). Ответ АВТОРИТЕТЕН и несёт мой выбор —
    // `results.results[].pFlags.chosen` — которого нет в общем WS-кадре
    // poll_update (он собирается для «зрителя 0»). Ставим вложение ПОЛНОСТЬЮ в
    // SSOT воркера; main-стор обновляет вызыватель результатом (setPollMedia, не
    // merge), иначе WS-merge стёр бы chosen.
    async votePoll(peerId: number, pollId: number, options: number[]): Promise<MessageMediaPoll> {
      const r = await rest.post<{ media: MessageMediaPoll }>(`/polls/${pollId}/vote`, { options })
      setMedia(peerId, byPollId(pollId), r.media)
      return r.media
    },
    async closePoll(pollId: number): Promise<void> {
      await rest.post(`/polls/${pollId}/close`, {})
    },

    // ── Чек-листы (Telegram todo list) ──
    async sendChecklist(peerId: number, c: { title: string; items: string[]; othersCanAdd: boolean; othersCanMark: boolean; clientMsgId?: string }): Promise<MyMessage> {
      const r = await rest.post<RawMyMessage>(`/chats/${peerId}/checklists`, {
        title: c.title, items: c.items,
        others_can_add: c.othersCanAdd, others_can_mark: c.othersCanMark,
        client_msg_id: c.clientMsgId ?? '',
      })
      return mapOne(r)
    },
    // Отметить/снять отметку «выполнено» на пункте. Ответ авторитетен (несёт мою
    // отметку) → пушим в SSOT; main-стор обновляет вызыватель (storeProjection чист).
    async toggleChecklistItem(peerId: number, checklistId: number, itemId: number): Promise<MessageMediaToDo> {
      const r = await rest.post<{ media: MessageMediaToDo }>(`/checklists/${checklistId}/items/${itemId}/toggle`, {})
      setMedia(peerId, byTodoId(checklistId), r.media)
      return r.media
    },
    // Добавить пункты; ответ авторитетен → пуш в SSOT.
    async addChecklistItems(peerId: number, checklistId: number, items: string[]): Promise<MessageMediaToDo> {
      const r = await rest.post<{ media: MessageMediaToDo }>(`/checklists/${checklistId}/items`, { items })
      setMedia(peerId, byTodoId(checklistId), r.media)
      return r.media
    },

    // Участвовать в розыгрыше. Ответ — ЛИЧНОЕ состояние зрителя
    // (`payments.giveawayInfo`), и в сообщение оно не кладётся вовсе: тело кадра
    // одно на всех получателей, а «участвую ли я» у каждого своё. Раньше этот
    // ответ патчил вложение — ровно та ловушка, что уже поймана у `pFlags.out`.
    async participateGiveaway(giveawayId: number): Promise<GiveawayState> {
      const r = await rest.post<{ giveaway_info: GiveawayState }>(`/giveaways/${giveawayId}/participate`, {})
      return r.giveaway_info
    },

    // ── Live-кадры funnel'а (worker APPLY зовёт messages.cacheX) → SSOT + операции ──
    // Опрос: свой выбор (`pFlags.chosen` у варианта) — локальный, кадр его не
    // несёт (`publishPollUpdate` собирает итоги для «зрителя 0»). SSOT воркера
    // всё равно обновляем целиком — это офлайн-кэш воркера, а не операция; сама
    // операция несёт агрегат КАК ПРИШЁЛ, а окно вкладки сохраняет свой выбор при
    // слиянии патча (см. `patch()` в core/realtime/messageOps.ts).
    cachePoll(evt: { peer_id: number; media: MessageMediaPoll }): MessageOp[] {
      return ops(evt.peer_id, setMedia(evt.peer_id, byPollId(evt.media.poll.id), evt.media), evt.media)
    },
    // Чек-лист: отметки глобальны — локального выбора нет, полная замена.
    cacheChecklist(evt: { peer_id: number; media: MessageMediaToDo }): MessageOp[] {
      return ops(evt.peer_id, setMedia(evt.peer_id, byTodoId(evt.media.todo.id), evt.media), evt.media)
    },
    // Розыгрыш: локального выбора у вложения БОЛЬШЕ НЕТ — участие уехало в
    // отдельную ручку, — поэтому исключения в `patch()` розыгрышу больше не
    // нужно, замена полная.
    cacheGiveaway(evt: { peer_id: number; media: MessageMedia }): MessageOp[] {
      const id = giveawayIdOf(evt.media)
      if (id === undefined) return []
      return ops(evt.peer_id, setMedia(evt.peer_id, byGiveawayId(id), evt.media), evt.media)
    },
  }
}
