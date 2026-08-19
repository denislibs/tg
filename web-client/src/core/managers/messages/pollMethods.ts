// src/core/managers/messages/pollMethods.ts
//
// Опросы + чек-листы + розыгрыши (порт tweb appPolls). Выделено из God-объекта
// messagesManager: зависит только от rest и точечного патча SSOT (patchMsg через
// ctx). Публичный API не меняется — методы спредятся в объект messagesManager.
import { mapMessage, mapPoll, mapChecklist, mapGiveaway, deriveOut, type Message, type Poll, type Checklist, type Giveaway, type RawMessage, type RawPoll, type RawChecklist, type RawGiveaway } from '../../models'
import type { MessageOp } from '../../realtime/messageOps'
import type { MessagesCtx } from './ctx'
import { sendingParamsToWire, type MessageSendingParams } from './sendingParams'

export function newPollMethods({ rest, patchMsg, getMeId, opWindowsFor }: MessagesCtx) {
  // Та же граница маппинга, что в messagesManager: созданный опрос/чек-лист
  // вкладка кладёт прямо в окно (useChatPopups → applyIncoming), минуя SSOT
  // воркера и его маппер, — без `out` бабл своего же опроса рисовался бы входящим.
  const mapOne = (r: RawMessage): Message => {
    const m = mapMessage(r)
    return { ...m, out: deriveOut(m, getMeId?.() ?? null) }
  }
  // Чек-лист → SSOT: отметки глобальны (нет локального состояния), полная замена.
  // Возвращает id патченного сообщения (для построения операций у cacheChecklist) —
  // undefined, если чек-лист ни на одном сообщении SSOT не найден.
  const applyChecklistToCache = (peerId: number, raw: RawChecklist): number | undefined => {
    const checklist = mapChecklist(raw)
    let msgId: number | undefined
    patchMsg(peerId, (m) => m.checklist?.id === checklist.id, (m) => { msgId = m.id; return { ...m, checklist } })
    return msgId
  }

  return {
    // ── Опросы (Telegram Poll) ──
    // Пакет параметров отправки — как у всех остальных путей (порт tweb: опрос
    // уходит `sendOther({...sendingParams, inputMedia: inputMediaPoll})`,
    // appMessagesManager.ts:2413). `effect` пакета сюда не едет СОЗНАТЕЛЬНО:
    // бэкенд снимает эффект с типа 'poll' по whitelist (sanitizeEffect,
    // backend/internal/usecase/chat/sanitize.go:29-32) — как и Telegram, который
    // эффекты на опросах не показывает.
    async sendPoll(peerId: number, p: { question: string; options: string[]; anonymous: boolean; multiple: boolean; quiz: boolean; correctOption?: number; clientMsgId?: string } & MessageSendingParams): Promise<Message> {
      const wire = sendingParamsToWire(p)
      const r = await rest.post<RawMessage>(`/chats/${peerId}/polls`, {
        question: p.question, options: p.options, anonymous: p.anonymous,
        multiple: p.multiple, quiz: p.quiz, correct_option: p.correctOption ?? null,
        client_msg_id: p.clientMsgId ?? '',
        reply_to_id: wire.replyToId, reply_quote_text: wire.replyQuoteText,
        reply_quote_offset: wire.replyQuoteOffset, thread_root_id: wire.threadRootId,
        silent: wire.silent, send_as_peer_id: wire.sendAsPeerId,
      })
      return mapOne(r)
    },
    // Голос (пустой список — отзыв); ответ авторитетен и несёт МОЙ выбор (myVotes),
    // которого нет в общем WS-событии poll_update. Ставим опрос ПОЛНОСТЬЮ в SSOT
    // воркера; main-стор обновляет вызыватель результатом (setPoll, не merge), иначе
    // WS-merge потерял бы myVotes. WS poll_update затем реконсилит агрегат.
    async votePoll(peerId: number, pollId: number, options: number[]): Promise<Poll> {
      const r = await rest.post<{ poll: RawPoll }>(`/polls/${pollId}/vote`, { options })
      const poll = mapPoll(r.poll)
      patchMsg(peerId, (m) => m.poll?.id === poll.id, (m) => ({ ...m, poll }))
      return poll
    },
    async closePoll(pollId: number): Promise<void> {
      await rest.post(`/polls/${pollId}/close`, {})
    },

    // ── Чек-листы (Telegram todo list) ──
    async sendChecklist(peerId: number, c: { title: string; items: string[]; othersCanAdd: boolean; othersCanMark: boolean; clientMsgId?: string }): Promise<Message> {
      const r = await rest.post<RawMessage>(`/chats/${peerId}/checklists`, {
        title: c.title, items: c.items,
        others_can_add: c.othersCanAdd, others_can_mark: c.othersCanMark,
        client_msg_id: c.clientMsgId ?? '',
      })
      return mapOne(r)
    },
    // Отметить/снять отметку «выполнено» на пункте. Ответ авторитетен (несёт мою
    // отметку) → пушим в SSOT; main-стор обновляет вызыватель (storeProjection чист).
    async toggleChecklistItem(peerId: number, checklistId: number, itemId: number): Promise<Checklist> {
      const r = await rest.post<{ checklist: RawChecklist }>(`/checklists/${checklistId}/items/${itemId}/toggle`, {})
      applyChecklistToCache(peerId, r.checklist)
      return mapChecklist(r.checklist)
    },
    // Добавить пункты; ответ авторитетен → пуш в SSOT.
    async addChecklistItems(peerId: number, checklistId: number, items: string[]): Promise<Checklist> {
      const r = await rest.post<{ checklist: RawChecklist }>(`/checklists/${checklistId}/items`, { items })
      applyChecklistToCache(peerId, r.checklist)
      return mapChecklist(r.checklist)
    },

    // Участвовать в розыгрыше. Ответ несёт МОЁ participating/iWon, которого нет в
    // общем WS giveaway_update → ставим розыгрыш ПОЛНОСТЬЮ в SSOT воркера; main-стор
    // обновляет вызыватель результатом (setGiveaway, не merge). WS реконсилит агрегат.
    async participateGiveaway(peerId: number, giveawayId: number): Promise<Giveaway> {
      const r = await rest.post<{ giveaway: RawGiveaway }>(`/giveaways/${giveawayId}/participate`, {})
      const giveaway = mapGiveaway(r.giveaway)
      patchMsg(peerId, (m) => m.giveaway?.id === giveaway.id, (m) => ({ ...m, giveaway }))
      return giveaway
    },

    // ── Live-кадры funnel'а (worker APPLY зовёт messages.cacheX) → SSOT + операции ──
    // Опрос: свой выбор (myVotes) — локальный, WS его не несёт (poll_update шлёт
    // только агрегат). SSOT воркера всё равно сохраняем как раньше (m.poll!.myVotes
    // из своей же копии — эта мутация не про операцию, а про офлайн-кэш воркера).
    // Операция же (Stage 1B.3, Task 4) несёт ТОЛЬКО агрегат mapPoll(evt.poll), БЕЗ
    // myVotes — окно вкладки сохраняет свой локальный выбор само при слиянии патча
    // (см. patch() в core/realtime/messageOps.ts и карту обогащений §3.1): если бы
    // операция несла myVotes из SSOT воркера, в многовкладочном сценарии она
    // навязала бы окну чужую (воркерную) копию локального выбора.
    cachePoll(evt: { peer_id: number; poll: RawPoll }): MessageOp[] {
      const poll = mapPoll(evt.poll)
      let msgId: number | undefined
      patchMsg(evt.peer_id, (m) => m.poll?.id === poll.id, (m) => { msgId = m.id; return { ...m, poll: { ...poll, myVotes: m.poll!.myVotes } } })
      if (msgId === undefined) return []
      return opWindowsFor(evt.peer_id, msgId).map((key): MessageOp => ({ op: 'patch', key, msgId: msgId!, fields: { poll } }))
    },
    // Чек-лист: отметки глобальны — локального выбора нет, полная замена агрегата.
    cacheChecklist(evt: { peer_id: number; checklist: RawChecklist }): MessageOp[] {
      const checklist = mapChecklist(evt.checklist)
      const msgId = applyChecklistToCache(evt.peer_id, evt.checklist)
      if (msgId === undefined) return []
      return opWindowsFor(evt.peer_id, msgId).map((key): MessageOp => ({ op: 'patch', key, msgId, fields: { checklist } }))
    },
    // Розыгрыш: своё участие (participating/iWon) — локальное, симметрично опросу
    // (см. комментарий у cachePoll выше и карту обогащений §3.2).
    cacheGiveaway(evt: { peer_id: number; giveaway: RawGiveaway }): MessageOp[] {
      const giveaway = mapGiveaway(evt.giveaway)
      let msgId: number | undefined
      patchMsg(evt.peer_id, (m) => m.giveaway?.id === giveaway.id, (m) => { msgId = m.id; return { ...m, giveaway: { ...giveaway, participating: m.giveaway!.participating, iWon: m.giveaway!.iWon } } })
      if (msgId === undefined) return []
      return opWindowsFor(evt.peer_id, msgId).map((key): MessageOp => ({ op: 'patch', key, msgId: msgId!, fields: { giveaway } }))
    },
  }
}
