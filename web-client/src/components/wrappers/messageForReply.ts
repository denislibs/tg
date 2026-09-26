// wrapMessageForReply — порт tweb `components/wrappers/messageForReply.ts`.
//
// ОДНА таблица лейблов на три места сразу — ровно как у оригинала, где эту
// функцию зовут превью строки списка чатов (`appDialogsManager.ts:2185`),
// цитата ответа (`chat/replyContainer.ts`) и уведомления
// (`uiNotificationsManager.ts`). До этого порта у нас жила ВТОРАЯ, независимая
// реализация той же таблицы — `mediaLabel()` в `core/dialogToChat.ts`, — и
// расходиться с первой она могла молча.
//
// ЧТО СОБИРАЕТСЯ. Строка превью это СПИСОК ЧАСТЕЙ, склеенных «, » (оригинал —
// `parts.splice(i, 0, ', ')`): сначала лейбл вложения, потом текст сообщения.
// Поэтому «Фото» у фото без подписи и «Фото, привет» у фото с подписью — это
// не два правила, а одно.
//
// ДВЕ ФОРМЫ, как у оригинала: строка (`plain`) и фрагмент с узлами. Богатую
// зовёт превью строки в группе «Messages» глобального поиска
// (`components/dialogRow.ts::setLastMessageN`, tweb `appDialogsManager.ts:2184-2192`)
// — ради подсветки запроса (`highlightWord`, tweb :36, :45-46, :384-397):
// каждое вхождение — сущность `messageEntityHighlight`, её рисует
// `wrapRichText` узлом `i.text-highlight`.
//
// ─── Чего здесь нет и почему ────────────────────────────────────────────────
//  • форма по умолчанию — СТРОКА, у оригинала наоборот (`plain` не передан →
//    фрагмент). Реплай-плашка (`chat/replyContainer.ts`) и лента
//    (`chat/bubbles.ts`) у нас берут строку; богатая форма заказывается явным
//    `plain: false`. Функция синхронная (у оригинала `async`): ни одна ветка
//    ниже не ждёт менеджеров — альбом приходит готовым `groupedMessages`;
//  • лейбл вложения в богатой форме — `span` с готовой строкой, а не живой
//    узел `i18n(langKey)` (tweb `addPart`, :56-71): таблица лейблов общая с
//    plain-формой и отдаёт уже переведённое;
//  • самоуничтожающееся медиа (`ttl_seconds`), `rich_message`, ограничения
//    (`restriction_reason`), перевод (`canTranslate`), спойлер кода служебных
//    ботов (`SERVICE_PEER_ID`, :399-414) — подсистем нет.
//  • история (`messageMediaStory`), игра (`messageMediaGame`), кубик
//    (`messageMediaDice`), счёт (`messageMediaInvoice`) — вложений таких видов
//    наша модель не производит.
import type { LangPackKey } from '@/lang'
import { getMessageText, type MyMessage } from '@core/models'
import { getDocumentFromMessage, type MessageMedia } from '@core/media/messageMedia'
import { serviceMsgText } from '@core/serviceMsg'
import type { MessageEntity } from '@layer'
import { parseEntities, wrapRichText } from '@lib/richtext'
import { sortEntities } from '@lib/richtext/entities'
import escapeRegExp from '@helpers/string/escapeRegExp'
import { useI18nStore } from '../../i18n'

// КЛЮЧИ ЛОКАЛИЗАЦИИ — английские строки, как принято в проекте
// (`i18n/dict.ts`: «keys ARE the English strings»), а не langPack-имена
// оригинала (`AttachPhoto`). Соответствие однозначное: Album, Photo, Video,
// GIF, Video message, Voice message, Sticker, Location, Live location,
// Contact, Checklist, Giveaway, Unsupported message.

/** Предел строки превью — tweb `limitSymbols(options.text, 100)`. */
const MAX_LENGTH = 100

export interface WrapMessageForReplyOptions {
  message: MyMessage
  /** текст вместо собственного (tweb `options.text`) — подпись альбома */
  text?: string
  /** не добавлять лейбл вложения (tweb `withoutMediaType`) */
  withoutMediaType?: boolean
  /** сообщения группы, если превью показывает альбом целиком (tweb `usingMids`) */
  groupedMessages?: MyMessage[]
  /** запрос поиска: его вхождения подсвечиваются (tweb `highlightWord`, :36) — только богатая форма */
  highlightWord?: string
  /** `false` — фрагмент с узлами (tweb `plain`); по умолчанию строка, см. шапку */
  plain?: boolean
}

/**
 * Превью сообщения.
 *
 * Порядок ветвления и состав частей — оригинала (messageForReply.ts:100-345):
 * альбом даёт свой лейбл и подпись группы, стикер — «эмодзи + Стикер» и гасит
 * текст, аудио — «🎵 исполнитель - название», файл — своё имя, опрос — «📊
 * вопрос». Служебное сообщение отдаёт своё действие целиком.
 */
export default function wrapMessageForReply(options: WrapMessageForReplyOptions & { plain: false }): DocumentFragment
export default function wrapMessageForReply(options: WrapMessageForReplyOptions & { plain?: true }): string
export default function wrapMessageForReply(options: WrapMessageForReplyOptions): string | DocumentFragment {
  const { message, withoutMediaType, groupedMessages } = options
  const plain = options.plain !== false
  // tweb :45-46 — запрос чистится только для богатой формы: у строки подсветки нет
  const highlightWord = !plain && options.highlightWord ? options.highlightWord.trim() : undefined
  const t = useI18nStore.getState().t

  // Служебное — целиком своё действие, без лейблов вложения (оригинал зовёт
  // `wrapMessageActionTextNew` и кладёт его `addPart`, :356-366; у нас ту же
  // роль играет `serviceMsgText`).
  if (message._ === 'messageService') {
    const action = serviceMsgText(message)
    return plain ? action : fragmentOf([labelSpan(action)])
  }
  if (message._ !== 'message') return plain ? '' : document.createDocumentFragment()

  const parts: string[] = []
  let text = options.text ?? getMessageText(message)
  let entities = message.entities

  const rawMedia = message.media

  // Альбом: лейбл один на всю группу, а текст берётся у того сообщения группы,
  // где он есть (tweb `getGroupedText`). Оригинал добавляет лейбл только когда
  // показывает группу ЦЕЛИКОМ (`usingFullGrouped`).
  const isFullGrouped = !!message.grouped_id && !!groupedMessages?.length
  if (isFullGrouped) {
    const withText = groupedMessages.find((m) => getMessageText(m))
    text = withText ? getMessageText(withText) : ''
    entities = withText?._ === 'message' ? withText.entities : undefined
    if (!withoutMediaType) parts.push(t('AttachAlbum'))
  }

  // Лейбл вложения — если группа не показана целиком и лейбл не запрещён, либо
  // текста нет вовсе (tweb :146).
  if ((!isFullGrouped && !withoutMediaType) || !text) {
    const part = mediaPart(rawMedia, message, t)
    if (part !== undefined) parts.push(part)
    // Стикер и аудио НЕСУТ свой текст в лейбле — своего у сообщения нет.
    if (part !== undefined && stealsText(rawMedia)) text = ''
  }

  if (text.length > MAX_LENGTH) text = text.slice(0, MAX_LENGTH)

  if (plain) {
    if (text) parts.push(text)
    return parts.filter(Boolean).join(', ')
  }

  // Богатая форма (tweb :347-354, :376-440): лейблы — узлами, между частями
  // «, » текстом, сам текст — `wrapRichText` без ссылок и форматирования.
  const nodes: (Node | string)[] = []
  parts.filter(Boolean).forEach((part, idx) => {
    if (idx) nodes.push(', ')
    nodes.push(labelSpan(part))
  })

  if (text) {
    if (nodes.length) nodes.push(', ')

    let textEntities: MessageEntity[] = entities ?? parseEntities(text)
    if (highlightWord) {
      let found = false
      let match: RegExpExecArray | null
      const regExp = new RegExp(escapeRegExp(highlightWord), 'gi')
      textEntities = textEntities.slice() // fix leaving highlight entity
      while ((match = regExp.exec(text)) !== null) {
        textEntities.push({ _: 'messageEntityHighlight', length: highlightWord.length, offset: match.index })
        found = true
      }

      if (found) {
        sortEntities(textEntities)
      }
    }

    nodes.push(wrapRichText(text, { noLinks: true, noTextFormat: true, entities: textEntities }))
  }

  return fragmentOf(nodes)
}

/** tweb `addPart` для готовой строки (:65-69); текст — `textContent`, не `innerHTML`. */
function labelSpan(part: string): HTMLSpanElement {
  const el = document.createElement('span')
  el.textContent = part
  return el
}

function fragmentOf(nodes: (Node | string)[]): DocumentFragment {
  const fragment = document.createDocumentFragment()
  fragment.append(...nodes)
  return fragment
}

/** Вложения, у которых лейбл ЗАМЕНЯЕТ текст (tweb обнуляет `options.text`). */
function stealsText(media: MessageMedia | undefined): boolean {
  if (media?._ !== 'messageMediaDocument') return false
  const type = media.document?.type
  return type === 'sticker' || type === 'audio'
}

/**
 * Лейбл одного вложения — switch оригинала по `media._` (messageForReply.ts:
 * 148-345). `undefined` — вложение лейбла не даёт вовсе (веб-страница: у
 * оригинала эта ветка пустая, :385-390).
 */
function mediaPart(
  media: MessageMedia | undefined,
  message: MyMessage,
  t: (key: LangPackKey) => string,
): string | undefined {
  switch (media?._) {
    case undefined: return undefined
    case 'messageMediaPhoto': return t('AttachPhoto')
    case 'messageMediaGeo': return t('AttachLocation')
    case 'messageMediaGeoLive': return t('AttachLiveLocation')
    // Место у оригинала отдаёт СВОЁ название текстом плюс лейбл локации.
    case 'messageMediaVenue': return `${t('AttachLocation')}, ${media.title}`
    case 'messageMediaContact': return t('AttachContact')
    case 'messageMediaPoll': return `📊 ${media.poll.question.text}`
    case 'messageMediaToDo': return `${t('Checklist')} ${media.todo.title.text}`
    case 'messageMediaGiveaway':
    case 'messageMediaGiveawayResults': return t('BoostingGiveaway')
    case 'messageMediaWebPage': return undefined
    case 'messageMediaDocument': return documentPart(message, t)
    default: return t('Message.Unsupported')
  }
}

/** Лейбл документа — ветвление по `doc.type` (tweb :193-240). */
function documentPart(message: MyMessage, t: (key: LangPackKey) => string): string | undefined {
  const doc = getDocumentFromMessage(message)
  if (!doc) return undefined

  switch (doc.type) {
    case 'video': return t('AttachVideo')
    case 'gif': return t('AttachGif')
    case 'round': return t('AttachRound')
    case 'voice': return t('AttachAudio')
    // Стикер: эмодзи и лейбл склеиваются В ОДНУ часть (оригинал сливает их
    // `parts.splice(i, 2)`), иначе между ними встала бы запятая.
    case 'sticker': return `${doc.stickerEmojiRaw ? doc.stickerEmojiRaw + ' ' : ''}${t('AttachSticker')}`
    case 'audio': {
      const attribute = doc.attributes.find((a) => a._ === 'documentAttributeAudio' && (a.title || a.performer))
      const title = attribute?._ === 'documentAttributeAudio'
        ? [attribute.title, attribute.performer].filter(Boolean).join(' - ')
        : doc.file_name
      return `🎵 ${title}`
    }
    // Файл говорит за себя своим именем — лейбла у оригинала нет вовсе.
    default: return doc.file_name || undefined
  }
}
