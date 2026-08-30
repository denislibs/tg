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
// ─── Чего здесь нет и почему ────────────────────────────────────────────────
//  • `plain: false` (богатая форма с сущностями и DOM-узлами). Оригинал умеет
//    обе; у нас пока ВСЕ три места показывают строку, поэтому ветка узлов не
//    заводится — пустая была бы мёртвым кодом. Вернётся вместе с
//    reply-заголовком в бабле, которому нужны сущности.
//  • самоуничтожающееся медиа (`ttl_seconds`), `rich_message`, ограничения
//    (`restriction_reason`), перевод (`canTranslate`), подсветка поиска
//    (`highlightWord`) — подсистем нет.
//  • история (`messageMediaStory`), игра (`messageMediaGame`), кубик
//    (`messageMediaDice`), счёт (`messageMediaInvoice`) — вложений таких видов
//    наша модель не производит.
import { getMessageText, type MyMessage } from '@core/models'
import { getDocumentFromMessage, type MessageMedia } from '@core/media/messageMedia'
import { serviceMsgText } from '@core/serviceMsg'
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
}

/**
 * Строка превью сообщения.
 *
 * Порядок ветвления и состав частей — оригинала (messageForReply.ts:100-345):
 * альбом даёт свой лейбл и подпись группы, стикер — «эмодзи + Стикер» и гасит
 * текст, аудио — «🎵 исполнитель - название», файл — своё имя, опрос — «📊
 * вопрос». Служебное сообщение отдаёт своё действие целиком.
 */
export default function wrapMessageForReply(options: WrapMessageForReplyOptions): string {
  const { message, withoutMediaType, groupedMessages } = options
  const t = useI18nStore.getState().t

  // Служебное — целиком своё действие, без лейблов вложения (оригинал зовёт
  // `wrapMessageActionTextNew`, у нас ту же роль играет `serviceMsgText`).
  if (message._ === 'messageService') {
    return serviceMsgText(message)
  }
  if (message._ !== 'message') return ''

  const parts: string[] = []
  let text = options.text ?? getMessageText(message)

  const rawMedia = message.media

  // Альбом: лейбл один на всю группу, а текст берётся у того сообщения группы,
  // где он есть (tweb `getGroupedText`). Оригинал добавляет лейбл только когда
  // показывает группу ЦЕЛИКОМ (`usingFullGrouped`).
  const isFullGrouped = !!message.grouped_id && !!groupedMessages?.length
  if (isFullGrouped) {
    text = groupedMessages.map((m) => getMessageText(m)).find(Boolean) ?? ''
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

  if (text) parts.push(text.length > MAX_LENGTH ? text.slice(0, MAX_LENGTH) : text)

  return parts.filter(Boolean).join(', ')
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
  t: (key: string) => string,
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
function documentPart(message: MyMessage, t: (key: string) => string): string | undefined {
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
