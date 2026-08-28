// Построение ReplyState (плашка «ответ» над композером) из ConvMsg — общий
// расчёт имени/цвета для «Ответить» из контекстного меню (useMessageActions.
// startReply) и восстановления reply из облачного черновика (draft.reply_to_id,
// tweb ChatInput.setDraftReply). Чистая логика — тестируется без React.
import { peerColor } from '../components/peerColor'
import type { ConvMsg } from '../data'
import type { MyMessage } from './models'
import { cachedPeer } from './peerCache'
import { getPeerTitle } from './peers/getPeerTitle'
import { messageToConvMsg } from './messageToConvMsg'
import type { ReplyState } from './hooks/useChatSend'

/** Кто есть кто в этом чате — чтобы у плашки был id автора оригинала
 *  (tweb кладёт его в `data-peer-id` на `span.peer-title`, wrapPeerTitle). */
export interface ReplyAuthors {
  /** мой id (для своих сообщений) */
  meId?: number
  /** id собеседника — фолбэк для входящих в личном чате, где senderId не приходит */
  peerId?: number
}

// ReplyState для одного сообщения; date-плашки не реплаются.
export function convMsgReplyState(m: ConvMsg, msgId: number | undefined, chatName: string, accent: string, authors?: ReplyAuthors): NonNullable<ReplyState> | null {
  if (m.type === 'date') return null
  // Имя автора оригинала. У СВОЕГО сообщения это моё имя — из карточки пира,
  // тем же `getPeerTitle`, которым берутся все остальные имена: второго ответа
  // на вопрос «как зовут пира» быть не должно.
  //
  // Здесь стояла ЛИТЕРАЛЬНАЯ строка `'Дн'` — чужая тестовая заглушка, утёкшая в
  // продуктовый код. Живьём плашка ответа на своё сообщение так и писала:
  // «Ответ Дн». Тест при этом был зелёным, потому что фиксировал ровно её.
  //
  // Наличие карточки проверяется ЯВНО, а не через `||`: `getPeerTitle` на
  // отсутствующей карточке отдаёт не пустоту, а «Удалённый аккаунт» (свой
  // фолбэк, порт `!user` из getPeerTitle.ts:63). Положись мы на `||` — плашка
  // до приезда карточки писала бы «Ответ Удалённый аккаунт», что хуже литерала.
  const meId = authors?.meId
  const mePeer = meId != null ? cachedPeer(meId) : undefined
  const name = m.out
    ? (mePeer && meId != null ? getPeerTitle({ peerId: meId, peer: mePeer }) : chatName)
    : m.sender ?? chatName
  const color = m.out ? accent : m.senderColor ?? peerColor(name)
  const peerId = m.out ? authors?.meId : m.senderId ?? authors?.peerId
  return { msgId, name, text: m.text ?? m.emoji ?? '', color, peerId }
}

// ReplyState по НОМЕРУ сообщения в загруженном окне. Окно приходит сырым
// (`MyMessage[]` из зеркала `core/history/messagesMirror.ts`), а не read-model'ю
// ленты: плашку ответа собирает владелец композера, и он обязан говорить о том
// же окне, что рисует лента (`components/chat/bubbles.ts` читает то же
// зеркало), — иначе плашка собиралась бы из другой копии окна.
//
// Вне окна — null, восстановление/жест скипается (ручки «дай сообщение по id» у
// бэка нет, ровно как в tweb `getMessageByPeer` возвращает пустое).
export function windowReplyState(
  msgs: readonly MyMessage[],
  msgId: number,
  chatName: string,
  accent: string,
  authors?: ReplyAuthors & {
    /** открыт групповой чат — тогда у ВХОДЯЩЕГО в плашке стоит имя автора, а не
     *  имя чата. Тот же гейт, что у ленты (`bubbles.ts` — `chat.isMegagroup`). */
    isGroup?: boolean
  },
): NonNullable<ReplyState> | null {
  const m = msgs.find((x) => x.id === msgId)
  if (!m) return null
  // Имя автора — из зеркала пиров (`core/peerCache.ts`), тем же `getPeerTitle`,
  // которым его берёт лента; карточки ещё нет — `undefined`, и `convMsgReplyState`
  // сваливается на имя чата.
  const senderName = authors?.isGroup && m.fromId != null && m.fromId !== authors.meId
    ? getPeerTitle({ peerId: m.fromId, peer: cachedPeer(m.fromId) }) || undefined
    : undefined
  const conv = messageToConvMsg(m, authors?.meId ?? null, { senderName, isMegagroup: !!authors?.isGroup })
  return convMsgReplyState(conv, msgId, chatName, accent, authors)
}
