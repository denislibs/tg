import type { RestClient } from '../net/restClient'
import {
  mapBoostStatus, mapGiveaway, mapMessage,
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

export function newBoostsManager({ rest }: { rest: Pick<RestClient, 'get' | 'post'> }) {
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
      return mapMessage(r)
    },
    async participateGiveaway(id: number): Promise<Giveaway> {
      const r = await rest.post<{ giveaway: RawGiveaway }>(`/giveaways/${id}/participate`, {})
      return mapGiveaway(r.giveaway)
    },
    async getGiveaway(id: number): Promise<Giveaway> {
      const r = await rest.get<{ giveaway: RawGiveaway }>(`/giveaways/${id}`)
      return mapGiveaway(r.giveaway)
    },
  }
}
