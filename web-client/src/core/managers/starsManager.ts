import type { RestClient } from '../net/restClient'
import type { TextWithEntities } from '../media/messageMedia'
import type { MessageActionStarGift, StarGift } from '../messages/messageAction'
import { getPeerId, type Peer } from '../peers/peerId'
import { getServerMessageId } from '../history/messageId'

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
 * Строка истории кошелька — конструктор `starsTransaction`.
 *
 * Вида операции строкой (`kind`) здесь БОЛЬШЕ НЕТ: «это подарок» говорит ФЛАГ,
 * вторую сторону — конструктор (`starsTransactionPeer` либо
 * `starsTransactionPeerUnsupported`), а «начисление или списание» — знак
 * суммы. Прежнее перечисление из четырёх значений включало одно
 * (`paid_media`), которое сервер не производил вовсе.
 *
 * Сумма — тоже конструктор (`starsAmount{amount, nanos}`): дробных звёзд мы не
 * начисляем, поэтому наружу отдаётся целая часть.
 */
export interface StarTransaction {
  id: string
  amount: number
  /** движение по подарку — отправка либо обмен */
  gift: boolean
  title: string
  peerId: number | null
  /** секунды эпохи, как у любой другой даты схемы */
  date: number
}

export interface StarsTransactionWire {
  _: 'starsTransaction'
  pFlags?: { gift?: true }
  id: string
  amount: { _: 'starsAmount'; amount: number; nanos: number }
  date: number
  peer: { _: 'starsTransactionPeer'; peer: Peer } | { _: 'starsTransactionPeerUnsupported' }
  title?: string
}

/** `payments.starsStatus` — ответ ЛЮБОЙ операции с балансом. `history` едет
 *  только там, где её спрашивали: отсутствие ключа значит «не просили». */
export interface PaymentsStarsStatus {
  _: 'payments.starsStatus'
  balance: { _: 'starsAmount'; amount: number; nanos: number }
  history?: StarsTransactionWire[]
  chats: unknown[]
  users: unknown[]
}

const mapTx = (t: StarsTransactionWire): StarTransaction => ({
  id: t.id,
  amount: t.amount.amount,
  gift: !!t.pFlags?.gift,
  title: t.title ?? '',
  peerId: t.peer._ === 'starsTransactionPeer' ? getPeerId(t.peer.peer) : null,
  date: t.date,
})

export function newStarsManager({ rest }: { rest: Pick<RestClient, 'get' | 'post'> }) {
  return {
    async balance(): Promise<number> {
      return (await rest.get<PaymentsStarsStatus>('/stars/balance')).balance.amount
    },
    // История едет ТЕМ ЖЕ конструктором, что и остаток: у оригинала это один
    // ответ `payments.starsStatus`, где `history` — необязательный параметр.
    async transactions(offset = 0, limit = 30): Promise<StarTransaction[]> {
      const r = await rest.get<PaymentsStarsStatus>(`/stars/transactions?offset=${offset}&limit=${limit}`)
      return (r.history ?? []).map(mapTx)
    },
    // dev-пополнение (без реальной оплаты): возвращает новый баланс.
    async topUp(amount: number): Promise<number> {
      return (await rest.post<PaymentsStarsStatus>('/stars/topup', { amount })).balance.amount
    },
    // Каталог едет конструкторами схемы — маппера у него больше нет, как и у
    // витрины профиля: позиция каталога это `starGift`, ТОТ ЖЕ объект, который
    // лежит внутри `savedStarGift` и `messageActionStarGift`. Плоская вторая
    // форма (`price_stars`/`sold_out`/`total`/`remains`) с провода ушла.
    async catalog(): Promise<StarGift[]> {
      const r = await rest.get<{ _: 'payments.starGifts'; gifts: StarGift[] }>('/gifts/catalog')
      return r.gifts ?? []
    },
    // Дарит подарок. Баланса в ответе НЕТ: его владелец — кадр
    // `updateStarsBalance`, и второе значение того же факта в теле ответа
    // расходилось бы с ним. Ответ — созданное сообщение-пилюля.
    async send(toUserId: number, giftId: number, message: string, anonymous: boolean): Promise<void> {
      await rest.post('/gifts/send', { to_user_id: toUserId, gift_id: giftId, message, anonymous })
    },
    // Витрина профиля едет конструкторами схемы — маппера у неё больше нет
    // вовсе: форма провода и форма модели совпали (тот же исход, что у `peer`,
    // `dialog` и `reply_markup`).
    async profileGifts(userId: number): Promise<SavedStarGift[]> {
      const r = await rest.get<{ _: 'payments.savedStarGifts'; count: number; gifts: SavedStarGift[] }>(`/users/${userId}/gifts`)
      return r.gifts ?? []
    },
    async convert(giftId: number): Promise<number> {
      return (await rest.post<PaymentsStarsStatus>(`/gifts/${giftId}/convert`, {})).balance.amount
    },
    async setHidden(giftId: number, hidden: boolean): Promise<void> {
      await rest.post(`/gifts/${giftId}/hidden`, { hidden })
    },
    /**
     * Разблокировка платного медиа (Telegram paid media): списывает цену в
     * звёздах и отдаёт разблокированное сообщение.
     *
     * Адрес — ПАРА «пир + номер», как у любого другого сообщения. Прежде здесь
     * стоял путь `/messages/{id}/unlock`, которого на сервере не существует
     * вовсе: маршрут всегда был `/chats/{peerID}/messages/{msgSeq}/unlock`, и
     * разблокировка отвечала 404 на каждый клик.
     *
     * Баланса в ответе нет: его владелец — кадр `updateStarsBalance`.
     */
    async unlockPaidMedia(peerId: number, msgId: number): Promise<void> {
      await rest.post(`/chats/${peerId}/messages/${getServerMessageId(msgId)}/unlock`, {})
    },
  }
}
