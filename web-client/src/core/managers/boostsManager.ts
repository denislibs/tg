import type { RestClient } from '../net/restClient'
import {
  mapBoostStatus, mapGiveaway, mapMessage, deriveOut,
  type BoostStatus, type RawBoostStatus,
  type Giveaway, type RawGiveaway,
  type Message, type RawMessage,
} from '../models'

// Бусты каналов + розыгрыши. Буст доступен только premium-пользователю и тратит
// его слот; розыгрыш создаётся владельцем канала как сообщение типа 'giveaway'.

export interface CreateGiveawayArgs {
  prizeKind: 'premium' | 'stars'
  months?: number
  stars?: number
  winnersCount: number
  untilDate: number // unix millis
  clientMsgId?: string
}

export function newBoostsManager({ rest, getMeId }: {
  rest: Pick<RestClient, 'get' | 'post'>
  /** id текущего пользователя — созданный розыгрыш вкладка кладёт прямо в окно
   *  (useChatPopups → applyIncoming), минуя SSOT воркера и его маппер, поэтому
   *  `out` (порт tweb pFlags.out) выводится здесь тем же предикатом. Лениво,
   *  геттер: `me` у воркера разрешается асинхронно. */
  getMeId?: () => number | null
}) {
  return {
    async status(chatId: number): Promise<BoostStatus> {
      const r = await rest.get<RawBoostStatus>(`/channels/${chatId}/boosts`)
      return mapBoostStatus(r)
    },
    // Бустит канал (расходует слот premium): возвращает обновлённый статус.
    async boost(chatId: number): Promise<BoostStatus> {
      const r = await rest.post<RawBoostStatus>(`/channels/${chatId}/boost`, {})
      return mapBoostStatus(r)
    },
    // Создаёт розыгрыш; возвращает сообщение-баббл розыгрыша.
    async createGiveaway(chatId: number, a: CreateGiveawayArgs): Promise<Message> {
      const r = await rest.post<RawMessage>(`/channels/${chatId}/giveaways`, {
        prize_kind: a.prizeKind,
        months: a.months ?? 0,
        stars: a.stars ?? 0,
        winners_count: a.winnersCount,
        until_date: a.untilDate,
        client_msg_id: a.clientMsgId ?? '',
      })
      const m = mapMessage(r)
      return { ...m, out: deriveOut(m, getMeId?.() ?? null) }
    },
    // participateGiveaway перенесён в messagesManager (single-writer: пуш в SSOT
    // сообщений + broadcast → storeProjection). Здесь остаётся только чтение статуса.
    async getGiveaway(id: number): Promise<Giveaway> {
      const r = await rest.get<{ giveaway: RawGiveaway }>(`/giveaways/${id}`)
      return mapGiveaway(r.giveaway)
    },
  }
}
