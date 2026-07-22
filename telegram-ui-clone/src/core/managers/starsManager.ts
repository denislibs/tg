import type { RestClient } from '../net/restClient'
import { mapMessage, type Message, type RawMessage } from '../models'

// Telegram Stars + Star Gifts. Реального провайдера нет: пополнение (topUp) —
// dev-операция. Подарок за звёзды приходит получателю сообщением типа 'gift'.

export interface StarGift {
  id: number
  emoji: string
  title: string
  priceStars: number
  convertStars: number
  total: number | null
  remains: number | null
  soldOut: boolean
}

export interface GiftInfo {
  id: number
  gift: StarGift
  fromId: number | null
  fromName: string
  message: string
  anonymous: boolean
  hidden: boolean
  converted: boolean
  convertStars: number
  /** когда подарен (ISO), '' если бэкенд не прислал */
  date: string
}

interface RawGift {
  id: number
  emoji: string
  title: string
  price_stars: number
  convert_stars: number
  total: number | null
  remains: number | null
  sold_out: boolean
}
export interface RawGiftInfo {
  id: number
  gift: RawGift
  from_id?: number | null
  from_name?: string
  message?: string
  anonymous: boolean
  hidden: boolean
  converted: boolean
  convert_stars: number
  date?: string
}

const mapGift = (g: RawGift): StarGift => ({
  id: g.id, emoji: g.emoji, title: g.title,
  priceStars: g.price_stars, convertStars: g.convert_stars,
  total: g.total, remains: g.remains, soldOut: g.sold_out,
})
export const mapGiftInfo = (g: RawGiftInfo): GiftInfo => ({
  id: g.id, gift: mapGift(g.gift),
  fromId: g.from_id ?? null, fromName: g.from_name ?? '',
  message: g.message ?? '', anonymous: g.anonymous,
  hidden: g.hidden, converted: g.converted, convertStars: g.convert_stars,
  date: g.date ?? '',
})

export function newStarsManager({ rest }: { rest: Pick<RestClient, 'get' | 'post'> }) {
  return {
    async balance(): Promise<number> {
      const r = await rest.get<{ balance: number }>('/stars/balance')
      return r.balance
    },
    // dev-пополнение (без реальной оплаты): возвращает новый баланс.
    async topUp(amount: number): Promise<number> {
      const r = await rest.post<{ balance: number }>('/stars/topup', { amount })
      return r.balance
    },
    async catalog(): Promise<StarGift[]> {
      const r = await rest.get<{ gifts: RawGift[] }>('/gifts/catalog')
      return (r.gifts ?? []).map(mapGift)
    },
    // Дарит подарок: возвращает новый баланс отправителя.
    async send(toUserId: number, giftId: number, message: string, anonymous: boolean): Promise<{ balance: number }> {
      const r = await rest.post<{ balance: number }>('/gifts/send', {
        to_user_id: toUserId, gift_id: giftId, message, anonymous,
      })
      return { balance: r.balance }
    },
    async profileGifts(userId: number): Promise<GiftInfo[]> {
      const r = await rest.get<{ gifts: RawGiftInfo[] }>(`/users/${userId}/gifts`)
      return (r.gifts ?? []).map(mapGiftInfo)
    },
    async convert(giftId: number): Promise<number> {
      const r = await rest.post<{ balance: number }>(`/gifts/${giftId}/convert`, {})
      return r.balance
    },
    async setHidden(giftId: number, hidden: boolean): Promise<void> {
      await rest.post(`/gifts/${giftId}/hidden`, { hidden })
    },
    // Разблокировка платного медиа (Telegram paid media): списывает цену в звёздах,
    // возвращает разблокированное сообщение (полное медиа) и новый баланс покупателя.
    async unlockPaidMedia(msgId: number): Promise<{ message: Message; balance: number }> {
      const r = await rest.post<{ message: RawMessage; balance: number }>(`/messages/${msgId}/unlock`, {})
      return { message: mapMessage(r.message), balance: r.balance }
    },
  }
}
