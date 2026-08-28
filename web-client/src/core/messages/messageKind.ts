// src/core/messages/messageKind.ts
//
// «Что это за сообщение» — ВОПРОС ВИТРИНЫ, а не поле провода.
//
// С провода снято `type: string`, где `"service"` стояло наравне с `"photo"`,
// `"poll"` и `"encrypted"`: одно поле отвечало на три разных вопроса — «это
// служебное?», «какое вложение?», «это шифрованное сообщение секретного чата?».
// Первый вопрос теперь решает ВЫБОР КОНСТРУКТОРА (`message` против
// `messageService`, а у пилюли — её действие), второй — объединение
// `MessageMedia` вместе с выведенным из атрибутов `doc.type` (`saveDocument`,
// порт `appDocsManager.saveDoc`), третий — наш параметр вне схемы `enc_body`.
//
// Ровно так ветвится и оригинал: `wrapMessageContent` смотрит на `media._`, а
// внутри документа — на `doc.type`. Здесь этот же вывод собран в ОДНУ функцию,
// потому что спрашивают его трое (бабл, превью списка чатов, цитата ответа), и
// три копии вывода — это ровно то, чем было снятое поле.
import { getDocumentFromMessage, getExtendedMedia, getMediaFromMessage, type MessageMedia } from '../media/messageMedia'
import type { MyMessage } from '../models'

/**
 * Виды, которые различает витрина. Совпадают с ветками рендера бабла; альбом
 * (`grouped_id`) видом НЕ является — это группировка соседних сообщений, и
 * собирает её лента.
 */
export type MessageKind =
  | 'text'
  | 'photo'
  | 'video'
  | 'gif'
  | 'roundVideo'
  | 'voice'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'geo'
  | 'contact'
  | 'poll'
  | 'checklist'
  | 'giveaway'
  | 'gift'
  | 'call'
  | 'service'
  | 'encrypted'

/**
 * Вид ВЛОЖЕНИЯ — по КОНСТРУКТОРУ объединения `MessageMedia`, а внутри документа
 * по выведенному из атрибутов `doc.type`. Ровно так ветвится оригинал
 * (`wrapMessageContent` смотрит на `media._`).
 *
 * Платное медиа своего вида НЕ даёт: это обёртка, и вид берётся у того, что
 * лежит внутри вектора. Неоплаченная позиция (`messageExtendedMediaPreview`)
 * файла не несёт вовсе, и вид у неё картиночный — псевдо-фото из превью
 * (`generatePhotoForExtendedMediaPreview`), как в оригинале.
 */
export function mediaKind(media: MessageMedia | undefined): MessageKind | undefined {
  switch (media?._) {
    case undefined: return undefined
    case 'messageMediaPhoto': return 'photo'
    case 'messageMediaGeo':
    case 'messageMediaVenue':
    case 'messageMediaGeoLive': return 'geo'
    case 'messageMediaContact': return 'contact'
    case 'messageMediaPoll': return 'poll'
    case 'messageMediaToDo': return 'checklist'
    case 'messageMediaGiveaway':
    case 'messageMediaGiveawayResults': return 'giveaway'
    // Карточка ссылки — вложение, но бабл у неё ТЕКСТОВЫЙ: карточка рисуется
    // внутри тела сообщения (tweb bubbles.ts:8112), а не вместо него.
    case 'messageMediaWebPage': return 'text'
    case 'messageMediaPaidMedia': {
      const item = getExtendedMedia(media)
      return item?._ === 'messageExtendedMedia' ? mediaKind(item.media) ?? 'photo' : 'photo'
    }
    case 'messageMediaDocument':
      switch (media.document.type) {
        case 'sticker': return 'sticker'
        case 'gif': return 'gif'
        case 'video': return 'video'
        case 'round': return 'roundVideo'
        case 'voice': return 'voice'
        case 'audio': return 'audio'
        // Картинка, отправленная ФАЙЛОМ, у оригинала тоже `photo` (документ с
        // `documentAttributeImageSize`) — бабл у неё картиночный.
        case 'photo': return 'photo'
        default: return 'document'
      }
  }
}

/** Вид сообщения целиком. */
export function getMessageKind(m: MyMessage): MessageKind {
  if (m._ === 'messageService') {
    switch (m.action._) {
      // Лог звонка — служебное сообщение с `messageActionPhoneCall`; прежде это
      // был `type === 'call'` с JSON `{video, reason, duration}` внутри текста.
      case 'messageActionPhoneCall': return 'call'
      // Подарок — ТОЖЕ служебное сообщение, а не вид вложения: конструктора
      // `messageMediaStarGift` в схеме нет вовсе, есть действие
      // `messageActionStarGift`. Прежде это было поле `gift` у обычного
      // сообщения — то есть вид бабла подделывался наличием поля.
      case 'messageActionStarGift': return 'gift'
      default: return 'service'
    }
  }
  // Секретный чат — подсистема вне периметра порта: у шифрованного сообщения
  // тела нет вовсе, на проводе едет блоб `iv||ciphertext`.
  if (m.enc_body) return 'encrypted'
  return mediaKind(m.media) ?? 'text'
}

/** Адрес файла вложения; `undefined` — файла нет (или вложение файла не несёт
 *  вовсе: гео, визитка, опрос, чек-лист, розыгрыш). Прежде это было плоское
 *  поле `media_id` рядом с самим вложением — два места на одно значение. */
export function getMediaId(m: MyMessage): number | undefined {
  return getMediaFromMessage(m._ === 'message' ? m : undefined)?.id
}

/** Имя файла документа — для превью и лейблов. */
export function getFileName(m: MyMessage): string | undefined {
  return getDocumentFromMessage(m._ === 'message' ? m : undefined)?.file_name || undefined
}
