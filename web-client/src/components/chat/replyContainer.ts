// Reply-заголовок бабла — порт tweb `chat/replyContainer.ts` (`ReplyContainer`
// поверх `divAndCaption.ts`) в применимом объёме.
//
// РАЗМЕТКА 1:1 с оригиналом (divAndCaption.ts:11-29, replyContainer.ts:263-290,
// док `docs/tweb/bubbles.md` §4.19):
//
//   div.reply.quote-like.quote-like-hoverable.quote-like-border[.is-media]
//     ├ div.reply-border
//     └ div.reply-content
//         ├ div.reply-media          ← превью 32×32, prepend только если есть
//         ├ div.reply-title          ← имя автора оригинала
//         └ div.reply-subtitle       ← текст оригинала либо цитата
//
// ─── Чего здесь нет и почему ────────────────────────────────────────────────
//  • ЦВЕТ автора (`setPeerColorToElement` + канвас-паттерн
//    `reply-background-canvas`, reply.ts:48-66) — подсистемы цветов пира у нас
//    нет; класс `quote-like-border` при этом ставится, и рамку рисует CSS.
//  • ПРЕВЬЮ МЕДИА (`wrapReplyMedia`, :83-94) — узел `.reply-media` заводится
//    только под него, поэтому пока не создаётся вовсе: пустой div сдвинул бы
//    раскладку, а `is-media` объявил бы наличие того, чего нет.
//  • «Loading» + `fetchMessageReplyTo` (bubbles.ts:2626) — догрузка оригинала,
//    которого нет в окне. Пока оригинал недоступен, показывается его АТРИБУЦИЯ
//    (`reply_from`) либо «Удалённое сообщение», как у оригинала в том же
//    случае.
//  • Poll-option reply (:195-204) и story-reply — таких ответов наша модель не
//    производит.
import { getPeerTitle } from '@core/peers/getPeerTitle'
import { cachedPeer } from '@core/peerCache'
import { getPeerId } from '@core/peers/peerId'
import type { MessageReplyHeader, MyMessage } from '@core/models'
import wrapMessageForReply from '@components/wrappers/messageForReply'
import { useI18nStore } from '../../i18n'

export interface ReplyContainerOptions {
  /** заголовок ответа самого бабла (tweb `message.reply_to`) */
  replyTo: MessageReplyHeader
  /** оригинал из окна; `undefined` — его там нет (tweb: «Loading»/атрибуция) */
  original: MyMessage | undefined
}

/**
 * Узел reply-заголовка.
 *
 * ЧТО В ПОДЗАГОЛОВКЕ — вопрос порядка, и порядок взят у оригинала: ЦИТАТА
 * (`quote_text`) сильнее самого оригинала, потому что выделенный фрагмент
 * нельзя вывести из сообщения, которое потом изменили (решение Р4 разбора
 * сообщения). Дальше — превью оригинала через `wrapMessageForReply`, и лишь
 * если оригинала нет — вложение его атрибуции либо «Удалённое сообщение».
 */
export function createReplyContainer({ replyTo, original }: ReplyContainerOptions): HTMLElement {
  const t = useI18nStore.getState().t

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
  title.textContent = replyTitle(replyTo, original, t)

  const subtitle = document.createElement('div')
  subtitle.classList.add('reply-subtitle')
  subtitle.setAttribute('dir', 'auto')
  subtitle.textContent = replySubtitle(replyTo, original, t)

  content.append(title, subtitle)
  container.append(border, content)
  return container
}

/** Имя автора оригинала: своего сообщения либо его атрибуции. */
function replyTitle(
  replyTo: MessageReplyHeader,
  original: MyMessage | undefined,
  t: (key: string) => string,
): string {
  const fromId = original?.fromId ?? (replyTo.reply_from?.from_id ? getPeerId(replyTo.reply_from.from_id) : undefined)
  if (fromId != null) {
    const title = getPeerTitle({ peerId: fromId, peer: cachedPeer(fromId) })
    if (title) return title
  }
  // Атрибуция может нести имя строкой — так оригинал показывает автора,
  // карточки которого у зрителя нет вовсе (`fwd_from.from_name`).
  return replyTo.reply_from?.from_name || t('DeletedMessage')
}

/** Текст подзаголовка — цитата, превью оригинала либо признание недоступности. */
function replySubtitle(
  replyTo: MessageReplyHeader,
  original: MyMessage | undefined,
  t: (key: string) => string,
): string {
  if (replyTo.quote_text) return replyTo.quote_text
  if (original) return wrapMessageForReply({ message: original })
  // Оригинал недоступен: у него могло ехать вложение атрибуции — его лейбл и
  // показываем, иначе честно говорим, что сообщения нет.
  if (replyTo.reply_media) {
    return wrapMessageForReply({
      message: { _: 'message', id: 0, peerId: 0, date: 0, message: '', media: replyTo.reply_media } as MyMessage,
    })
  }
  return t('DeletedMessage')
}
