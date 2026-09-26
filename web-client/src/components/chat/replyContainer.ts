// Reply-заголовок бабла — порт tweb `chat/replyContainer.ts` (`ReplyContainer`
// поверх `divAndCaption.ts`, собирает `wrappers/reply.ts::wrapReply`) вместе с
// выбором заголовка из `MessageRender.setReply` (messageRender.ts:443-620).
//
// РАЗМЕТКА 1:1 с оригиналом (divAndCaption.ts:11-29, replyContainer.ts:263-290,
// док `docs/tweb/bubbles.md` §4.19):
//
//   div.reply.quote-like.quote-like-hoverable.quote-like-border[.is-media][.reply-no-subtitle]
//     ├ div.reply-border
//     └ div.reply-content
//         ├ div.reply-media          ← превью 32×32, prepend только если есть
//         ├ div.reply-title          ← имя автора оригинала (живой PeerTitle)
//         └ div.reply-subtitle       ← текст оригинала либо цитата; без
//                                      сообщения узла нет (wrapReply, :66-69)
//
// ЗАГОЛОВОК — по веткам `setReply` (:506-552), и порядок у них значимый:
//  • оригинал есть — автор оригинала узлом `PeerTitle` (:545-551): узел сам
//    объявляет пробел зеркала пиров и перерисовывается приехавшей карточкой.
//    Прежде здесь стояла строка `getPeerTitle(cachedPeer(…))`, снятая ОДИН раз
//    на рендере: при холодном зеркале (перезагрузка, история из кэша воркера)
//    она застывала «Удалённым аккаунтом» навсегда — дефект K3;
//  • оригинала нет, но есть атрибуция `reply_from` — автор атрибуции (:514-523);
//  • ссылка помечена `reply_to_msg_deleted` (владелец спросил сервер и получил
//    дыру) — «Удалённое сообщение» (:522-523);
//  • иначе оригинал ЕЩЁ ЕДЕТ — «Загрузка» (:524-529), а догрузку заказывает
//    лента (`loading` в ответе → `ChatBubbles.renderReply`).
//
// ─── Чего здесь нет и почему ────────────────────────────────────────────────
//  • ЦВЕТ автора (`setPeerColorToElement` + канвас-паттерн
//    `reply-background-canvas`, reply.ts:48-66) — подсистемы цветов пира у нас
//    нет; класс `quote-like-border` при этом ставится, и рамку рисует CSS.
//  • ПРЕВЬЮ МЕДИА (`wrapReplyMedia`, :83-94) — узел `.reply-media` заводится
//    только под него, поэтому пока не создаётся вовсе: пустой div сдвинул бы
//    раскладку, а `is-media` объявил бы наличие того, чего нет.
//  • Иконки атрибуции `reply_from` (`newchannel_filled`/`group_filled`/
//    `newprivate_filled`, messageRender.ts:554-578) и автор ПЕРЕСЛАННОГО
//    оригинала (`fwdFromId`, :533-544) — производного `fwdFromId` наша модель
//    не заполняет (см. `ChatBubbles.createAvatar`), автор берётся тем же
//    правилом, что у серии, — `fromId ?? peerId`.
//  • Poll-option reply (:195-204) и story-reply — таких ответов наша модель не
//    производит.
import type { MessageReplyHeader, MyMessage } from '@core/models'
import { getPeerId } from '@core/peers/peerId'
import type { Middleware } from '@helpers/middleware'
import replaceContent from '@helpers/dom/replaceContent'
import { i18n } from '@lib/langPack'
import wrapMessageForReply from '@components/wrappers/messageForReply'
import PeerTitle, { type PeerTitleManagers } from './peerTitle'

export interface ReplyContainerOptions {
  /** заголовок ответа самого бабла (tweb `message.reply_to`) */
  replyTo: MessageReplyHeader
  /** оригинал; `undefined` — его у ленты нет (tweb `getMessageByPeer` промахнулся) */
  original: MyMessage | undefined
  middleware: Middleware
  managers: PeerTitleManagers
}

export interface ReplyContainer {
  container: HTMLElement
  /** заголовок — «Загрузка»: оригинал надо запросить у владельца
   *  (tweb зовёт `fetchMessageReplyTo` в этой же ветке, messageRender.ts:527) */
  loading: boolean
}

/**
 * Узел reply-заголовка.
 *
 * ЧТО В ПОДЗАГОЛОВКЕ — порядок оригинала (`wrapReplyDivAndCaption`,
 * replyContainer.ts:219-245): ЦИТАТА (`quote_text`) сильнее самого оригинала,
 * потому что выделенный фрагмент нельзя вывести из сообщения, которое потом
 * изменили (решение Р4 разбора сообщения); дальше — превью оригинала через
 * `wrapMessageForReply`. Сообщения нет — нет и подзаголовка (`reply-no-subtitle`,
 * wrappers/reply.ts:66-69); у атрибуции `reply_from` сообщением служит
 * вложение атрибуции (`reply_media`, messageRender.ts:584-593).
 */
export function createReplyContainer({ replyTo, original, middleware, managers }: ReplyContainerOptions): ReplyContainer {
  const container = document.createElement('div')
  container.className = 'reply quote-like quote-like-hoverable quote-like-border'
  // Цитата у оригинала помечает себя иконкой кавычки (bubbles.md §4.19).
  if (replyTo.pFlags?.quote) container.classList.add('quote-like-icon', 'reply-multiline')

  const border = document.createElement('div')
  border.classList.add('reply-border')

  const content = document.createElement('div')
  content.classList.add('reply-content')

  const title = document.createElement('div')
  title.classList.add('reply-title')
  title.setAttribute('dir', 'auto')

  let loading = false
  let message: MyMessage | undefined = original
  if (original) {
    replaceContent(title, new PeerTitle({ peerId: original.fromId ?? original.peerId, middleware, managers }).element)
  } else if (replyTo.reply_from) {
    const from = replyTo.reply_from
    const peerId = from.from_id ? getPeerId(from.from_id) : replyTo.reply_to_peer_id ? getPeerId(replyTo.reply_to_peer_id) : undefined
    replaceContent(title, new PeerTitle({ peerId, fromName: from.from_name, middleware, managers }).element)
    message = { _: 'message', pFlags: {}, id: 0, peerId: 0, date: 0, message: '', media: replyTo.reply_media } as MyMessage
  } else if (replyTo.reply_to_msg_deleted) {
    replaceContent(title, i18n('DeletedMessage'))
  } else {
    replaceContent(title, i18n('Loading'))
    loading = true
  }

  content.append(title)
  if (message) {
    const subtitle = document.createElement('div')
    subtitle.classList.add('reply-subtitle')
    subtitle.setAttribute('dir', 'auto')
    subtitle.textContent = replyTo.quote_text || wrapMessageForReply({ message })
    content.append(subtitle)
  } else {
    container.classList.add('reply-no-subtitle')
  }

  container.append(border, content)
  return { container, loading }
}
