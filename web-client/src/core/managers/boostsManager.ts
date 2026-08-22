import type { RestClient } from '../net/restClient'
import {
  mapBoostStatus, mapMyMessage,
  type BoostStatus, type RawBoostStatus,
  type GiveawayState,
  type MyMessage, type RawMyMessage,
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
    // Ответ ручки — КОНСТРУКТОР схемы плюс наше число свободных слотов рядом:
    // в схеме на этом месте `my_boost_slots` — вектор идентификаторов ЗАНЯТЫХ
    // слотов, то есть другой предмет под похожим именем.
    async status(peerId: number): Promise<BoostStatus> {
      const r = await rest.get<{ status: RawBoostStatus; slots: number }>(`/channels/${peerId}/boosts`)
      return mapBoostStatus(r.status, r.slots)
    },
    // Бустит канал (расходует слот premium): возвращает обновлённый статус.
    async boost(peerId: number): Promise<BoostStatus> {
      const r = await rest.post<{ status: RawBoostStatus; slots: number }>(`/channels/${peerId}/boost`, {})
      return mapBoostStatus(r.status, r.slots)
    },
    // Создаёт розыгрыш; возвращает сообщение-баббл розыгрыша.
    async createGiveaway(peerId: number, a: CreateGiveawayArgs): Promise<MyMessage> {
      const r = await rest.post<RawMyMessage>(`/channels/${peerId}/giveaways`, {
        prize_kind: a.prizeKind,
        months: a.months ?? 0,
        stars: a.stars ?? 0,
        winners_count: a.winnersCount,
        until_date: a.untilDate,
        client_msg_id: a.clientMsgId ?? '',
      })
      // `pFlags.out` производит сервер; клиенту остаётся перевод номеров и
      // уточнение действия — их делает сам маппер.
      return mapMyMessage(r, getMeId?.() ?? null)
    },
    // ЛИЧНОЕ состояние зрителя (`payments.giveawayInfo`): «участвую ли»,
    // «выиграл ли», сколько участников. Сами условия розыгрыша едут вложением
    // сообщения и здесь не повторяются — второй формы розыгрыша на проводе нет.
    // Участие (`participateGiveaway`) живёт в messagesManager и возвращает ЭТО
    // ЖЕ состояние: сообщение оно больше не трогает.
    async getGiveaway(id: number): Promise<GiveawayState> {
      const r = await rest.get<{ giveaway_info: GiveawayState }>(`/giveaways/${id}`)
      return r.giveaway_info
    },
  }
}
