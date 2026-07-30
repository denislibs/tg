// src/core/managers/messages/pollMethods.ts
//
// Опросы + чек-листы + розыгрыши (порт tweb appPolls). Выделено из God-объекта
// messagesManager: зависит только от rest и точечного патча SSOT (patchMsg через
// ctx). Публичный API не меняется — методы спредятся в объект messagesManager.
import { mapMessage, mapPoll, mapChecklist, mapGiveaway, type Message, type Poll, type Checklist, type Giveaway, type RawMessage, type RawPoll, type RawChecklist, type RawGiveaway } from '../../models'
import type { MessagesCtx } from './ctx'

export function newPollMethods({ rest, patchMsg }: MessagesCtx) {
  // Чек-лист → SSOT: отметки глобальны (нет локального состояния), полная замена.
  const applyChecklistToCache = (chatId: number, raw: RawChecklist): void => {
    const checklist = mapChecklist(raw)
    patchMsg(chatId, (m) => m.checklist?.id === checklist.id, (m) => ({ ...m, checklist }))
  }

  return {
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
    // отметку) → пушим в SSOT; main-стор обновляет вызыватель (storeProjection чист).
    async toggleChecklistItem(chatId: number, checklistId: number, itemId: number): Promise<Checklist> {
      const r = await rest.post<{ checklist: RawChecklist }>(`/checklists/${checklistId}/items/${itemId}/toggle`, {})
      applyChecklistToCache(chatId, r.checklist)
      return mapChecklist(r.checklist)
    },
    // Добавить пункты; ответ авторитетен → пуш в SSOT.
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

    // ── Live-кадры funnel'а (worker APPLY зовёт messages.cacheX) → SSOT ──
    // Опрос: свой выбор (myVotes) локальный — сохраняем (WS его не несёт).
    cachePoll(evt: { chat_id: number; poll: RawPoll }): void {
      const poll = mapPoll(evt.poll)
      patchMsg(evt.chat_id, (m) => m.poll?.id === poll.id, (m) => ({ ...m, poll: { ...poll, myVotes: m.poll!.myVotes } }))
    },
    cacheChecklist(evt: { chat_id: number; checklist: RawChecklist }): void {
      applyChecklistToCache(evt.chat_id, evt.checklist)
    },
    // Розыгрыш: своё участие (participating/iWon) локальное — сохраняем.
    cacheGiveaway(evt: { chat_id: number; giveaway: RawGiveaway }): void {
      const giveaway = mapGiveaway(evt.giveaway)
      patchMsg(evt.chat_id, (m) => m.giveaway?.id === giveaway.id, (m) => ({ ...m, giveaway: { ...giveaway, participating: m.giveaway!.participating, iWon: m.giveaway!.iWon } }))
    },
  }
}
