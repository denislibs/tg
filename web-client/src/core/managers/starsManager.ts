import type { RestClient } from '../net/restClient'
import type { TextWithEntities } from '../media/messageMedia'
import type { MessageActionStarGift, StarGift } from '../messages/messageAction'
import { mapMessage, type Message, type RawMessage } from '../models'
import type { Peer } from '../peers/peerId'

// Telegram Stars + Star Gifts. Реального провайдера нет: пополнение (topUp) —
// dev-операция.
//
// ── Подарок — ДЕЙСТВИЕ, а не вложение ───────────────────────────────────────
// Конструктора `messageMediaStarGift` в схеме нет: подарок приходит получателю
// СЛУЖЕБНЫМ сообщением с действием `messageActionStarGift` (объявлено в
// `core/messages/messageAction.ts` вместе с самой позицией каталога `starGift`).
// Здесь остаётся только витрина ПРОФИЛЯ — `savedStarGift`, отдельный
// конструктор: у неё есть дата подарка (в ленте её несёт само сообщение) и нет
// привязки к сообщению.

/**
 * savedStarGift#41df43fc flags:# name_hidden:flags.0?true unsaved:flags.5?true
 * … from_id:flags.1?Peer date:int gift:StarGift message:flags.2?TextWithEntities
 * … saved_id:flags.11?long convert_stars:flags.4?long = SavedStarGift;
 *
 * ТОТ ЖЕ подарок, но в ВИТРИНЕ ПРОФИЛЯ. Наш прежний `hidden` здесь зовётся
 * `unsaved` и знака НЕ меняет — в отличие от `messageActionStarGift.saved`, где
 * тот же смысл выражен отрицанием. Это форма схемы, а не наша вольность.
 */
export interface SavedStarGift {
  _: 'savedStarGift'
  pFlags?: Partial<{ name_hidden: true; unsaved: true }>
  from_id?: Peer
  /** когда подарен, секунды эпохи */
  date: number
  gift: StarGift
  message?: TextWithEntities
  saved_id?: number
  convert_stars?: number
}

/** Подарок глазами попапа: пилюля ленты и строка витрины профиля — РАЗНЫЕ
 *  конструкторы одного предмета, и попап рисует оба. */
export type AnyStarGift = MessageActionStarGift | SavedStarGift

/**
 * Подарок скрыт из профиля. Один вопрос — два разных параметра схемы:
 * `savedStarGift.unsaved` (прямой) и `messageActionStarGift.saved` (обратный).
 * Ветвление живёт здесь, чтобы витрина не выводила «скрыт» дважды.
 */
export function isGiftHidden(g: AnyStarGift): boolean {
  return g._ === 'savedStarGift' ? !!g.pFlags?.unsaved : !g.pFlags?.saved
}

/** Подарок обменян на звёзды. У витрины профиля обменянных нет вовсе — строка
 *  исчезает вместе с подарком, поэтому вопрос осмыслен только у пилюли. */
export function isGiftConverted(g: AnyStarGift): boolean {
  return g._ === 'messageActionStarGift' && !!g.pFlags?.converted
}

/**
 * ПОЗИЦИЯ КАТАЛОГА в плоской форме — `GET /gifts/catalog` отдаёт её как есть
 * (`domain.StarGift`), конструктором `starGift` каталог ещё не поехал. Названный
 * остаток: витрина каталога — не подсистема сообщения, и в этот шаг она не
 * входила.
 */
export interface StarGiftCatalogItem {
  id: number
  emoji: string
  title: string
  priceStars: number
  convertStars: number
  total: number | null
  remains: number | null
  soldOut: boolean
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

const mapGift = (g: RawGift): StarGiftCatalogItem => ({
  id: g.id, emoji: g.emoji, title: g.title,
  priceStars: g.price_stars, convertStars: g.convert_stars,
  total: g.total, remains: g.remains, soldOut: g.sold_out,
})

// Транзакция звёзд (история кошелька). amount со знаком: + начисление, − списание.
export interface StarTransaction {
  id: number
  amount: number
  kind: string
  title: string
  peerId: number | null
  date: string
}
interface RawStarTx {
  id: number
  amount: number
  kind: string
  title?: string
  peer_id?: number | null
  date: string
}
const mapTx = (t: RawStarTx): StarTransaction => ({
  id: t.id, amount: t.amount, kind: t.kind,
  title: t.title ?? '', peerId: t.peer_id ?? null, date: t.date,
})

export function newStarsManager({ rest }: { rest: Pick<RestClient, 'get' | 'post'> }) {
  return {
    async balance(): Promise<number> {
      const r = await rest.get<{ balance: number }>('/stars/balance')
      return r.balance
    },
    async transactions(offset = 0, limit = 30): Promise<StarTransaction[]> {
      const r = await rest.get<{ transactions: RawStarTx[] }>(`/stars/transactions?offset=${offset}&limit=${limit}`)
      return (r.transactions ?? []).map(mapTx)
    },
    // dev-пополнение (без реальной оплаты): возвращает новый баланс.
    async topUp(amount: number): Promise<number> {
      const r = await rest.post<{ balance: number }>('/stars/topup', { amount })
      return r.balance
    },
    async catalog(): Promise<StarGiftCatalogItem[]> {
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
    // Витрина профиля едет конструкторами схемы — маппера у неё больше нет
    // вовсе: форма провода и форма модели совпали (тот же исход, что у `peer`,
    // `dialog` и `reply_markup`).
    async profileGifts(userId: number): Promise<SavedStarGift[]> {
      const r = await rest.get<{ gifts: SavedStarGift[] }>(`/users/${userId}/gifts`)
      return r.gifts ?? []
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
