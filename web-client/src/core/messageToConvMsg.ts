import type { CallLog, ConvMsg } from '../data'
import { getMessageText, isOutMessage, type MyMessage } from './models'
import { getMediaId, getMessageKind, mediaKind, type MessageKind } from './messages/messageKind'
import { serviceMsgText } from './serviceMsg'
import { isLocalMessageId } from './history/messageId'
import { getPeerId } from './peers/peerId'
import { AUTHOR_HIDDEN_TITLE } from './peers/getPeerTitle'

/** Дата сообщения в ISO — вью-модель (`ConvMsg.createdAt`) считает отсчёты по
 *  абсолютному времени. На проводе и в модели это `date:int` (секунды), перевод
 *  живёт здесь, на границе витрины. */
export function messageDateISO(date: number): string {
  return new Date(date * 1000).toISOString()
}

// Human label for a replied-to media message that has no caption (Telegram shows
// these in the quote line, e.g. "Фотография"). Экспорт: тот же лейбл использует
// пин-бар и экран закреплённых для медиа без подписи.
export function replyMediaLabel(kind?: MessageKind): string {
  switch (kind) {
    case 'photo': return 'Фотография'
    case 'video': return 'Видео'
    case 'gif': return 'GIF'
    case 'roundVideo': return 'Видеосообщение'
    case 'voice': return 'Голосовое сообщение'
    case 'audio': return 'Аудио'
    case 'document': return 'Файл'
    case 'sticker': return 'Стикер'
    case 'geo': return 'Геолокация'
    case 'contact': return 'Контакт'
    default: return ''
  }
}

/**
 * Превью ЧУЖОГО сообщения — цитата ответа, строка индекса закреплённых, пилюля
 * закрепления. Прежде такой снимок склеивал СЕРВЕР (`reply_to.text`,
 * `msg_text`, обрезанный до 100 символов), теперь его строит клиент из того же
 * объекта, что рисует лента, — как `wrapMessageForReply` у оригинала.
 */
export function messageForReply(m: MyMessage): string {
  const kind = getMessageKind(m)
  if (kind === 'service') return serviceMsgText(m as Extract<MyMessage, { _: 'messageService' }>)
  return getMessageText(m) || replyMediaLabel(kind)
}

/**
 * Backend Message → вью-модель бабла.
 *
 * `out` здесь — СТОРОНА бабла (`isOutMessage`, порт `Chat.isOutMessage`,
 * chat.ts:1392 — именно он решает `is-out`/`is-in`, bubbles.ts:7613 → :9669),
 * а не «я ли отправил»: пост ВЕЩАТЕЛЬНОГО канала остаётся `pFlags.out` у
 * выложившего его админа, но рисуется входящим; пересылка в «Избранное» —
 * тоже входящим, от лица оригинального автора. А вот сообщение от лица канала
 * (send-as) в МЕГАГРУППЕ — исходящее: там оригинал берёт сырой `pFlags.out`
 * (chat.ts:1375-1377). Поэтому вид чата обязан приехать сюда параметром — см.
 * `OurMessageChat`.
 *
 * Тем же значением ведутся ТИКИ, и это тоже 1:1: у tweb они стоят под
 * `our && (peerId !== myId || isOut)` (bubbles.ts:9714), что вне «Избранного»
 * равно `our` (= `isOut`), а в «Избранном» — ровно `isOut`.
 *
 * `opts.replyToMessage` — РАЗРЕШЁННЫЙ оригинал ответа: с провода едет только
 * ссылка (`reply_to.reply_to_msg_id`), а сообщение берётся из окна тем, у кого
 * оно есть.
 */
export function messageToConvMsg(
  m: MyMessage,
  meId: number | null,
  opts?: {
    senderName?: string
    /** горизонт чтения СОБЕСЕДНИКА в КЛИЕНТСКОМ пространстве номеров */
    readUpToId?: number
    forwardFromName?: string
    replyToName?: string
    /** оригинал ответа, разрешённый вызывающим из окна */
    replyToMessage?: MyMessage
    /** закреплённое сообщение (цель `messageActionPinMessage`), тоже разрешённое */
    pinnedTarget?: MyMessage
    /** порт `chat.isMegagroup` — вид ОТКРЫТОГО чата; знает его вызывающий
     *  (`ChatBubbles` ← `ChatContext` ← `Chat.tsx`). */
    isMegagroup?: boolean
  },
): ConvMsg {
  const out = isOutMessage(m, { myId: meId, isMegagroup: opts?.isMegagroup })
  const kind = getMessageKind(m)
  // Секретное медиа приходит шифртекстом (`enc_body`); вид ('photo'|'video'|
  // 'document'|'audio') лежит в расшифрованном secretMedia.mediaType — он и
  // решает ветку рендера медиа.
  const secretType = m.secretMedia?.mediaType as MessageKind | undefined
  const convType: ConvMsg['type'] =
    kind === 'encrypted' && secretType ? convKind(secretType) : convKind(kind)

  const real = m._ === 'message' ? m : undefined
  const action = m._ === 'messageService' ? m.action : undefined
  // Предложение фото профиля: у получателя под превью кнопка «Установить фото»;
  // `accepted` — НАШ параметр действия, он скрывает её на всех устройствах.
  const photoSuggestion = action?._ === 'messageActionSuggestProfilePhoto'
    ? { accepted: !!action.accepted }
    : undefined

  const replyTo = opts?.replyToMessage
  const quoteText = m.reply_to?.quote_text
  const replyKind = replyTo ? getMessageKind(replyTo) : undefined
  // Оригинал недоступен зрителю (ответ на сообщение из чужого чата): вместо
  // ссылки едут СТРУКТУРЫ `reply_from` (атрибуция автора) и `reply_media`
  // (вложение) — прежде это были плоские `reply_snapshot_name`/`_text`.
  const replyFrom = m.reply_to?.reply_from
  return {
    id: m.id,
    peerId: m.peerId,
    clientId: m.random_id,
    type: convType,
    out,
    text: convType === 'service' ? serviceMsgText(m as Extract<MyMessage, { _: 'messageService' }>, opts?.pinnedTarget ? messageForReply(opts.pinnedTarget) : undefined) : getMessageText(m),
    photoSuggestion,
    entities: real?.entities,
    createdAt: messageDateISO(m.date),
    date: m.date,
    editDate: real?.edit_date,
    // sending → до message_ack (номер назначен клиентом, значит дробный);
    // error → send отвергнут; после ack номер становится серверным и статус сам
    // «дорастает» до sent/read.
    status: out
      ? m.failed
        ? 'error'
        : isLocalMessageId(m.id)
          ? 'sending'
          : opts?.readUpToId != null && m.id <= opts.readUpToId
            ? 'read'
            : 'sent'
      : undefined,
    call: action?._ === 'messageActionPhoneCall' ? callLog(action) : undefined,
    // Подарок — САМО действие пилюли, а не его пересборка: вид бабла выбран по
    // конструктору сообщения (`getMessageKind`), рисовать надо ровно то, что в
    // нём лежит.
    gift: action?._ === 'messageActionStarGift' ? action : undefined,
    factCheck: real?.factcheck,
    transcription: real?.transcription,
    effect: real?.effect_name,
    replyMarkup: real?.reply_markup,
    reactions: m.reactions,
    mediaId: getMediaId(m),
    // Вложение целиком, ОДНИМ полем — и гео, и визитка, и опрос, и чек-лист, и
    // розыгрыш, и карточка ссылки, и платное медиа лежат ЗДЕСЬ. Восьми копий
    // того же значения рядом больше нет.
    media: real?.media,
    groupedId: real?.grouped_id,
    localUrl: real?.localUrl,
    // Автор бабла — `from_id`: у сообщения от лица канала там сам канал, и имя
    // с аватаркой берутся из карточки этого пира, как у любого другого.
    sender: !out && opts?.senderName ? opts.senderName : undefined,
    senderId: !out ? m.fromId : undefined,
    edited: real?.edit_date != null,
    views: real?.views,
    forwards: real?.forwards,
    mediaUnread: m.pFlags.media_unread || undefined,
    // Пересылка: признак — САМ конструктор `messageFwdHeader`. Скрытая
    // атрибуция едет в `from_name` — ровно тот случай, ради которого в
    // оригинале есть фолбэк имени.
    forwardFrom: real?.fwd_from ? { name: opts?.forwardFromName ?? real.fwd_from.from_name ?? AUTHOR_HIDDEN_TITLE } : undefined,
    // Секретное сообщение: флаг + таймер самоуничтожения (destruct_at ставит
    // сервер после прочтения получателем; ttl_period — «взведённый» TTL).
    secret: m.secret || undefined,
    secretMedia: m.secretMedia,
    ttlSeconds: m.ttl_period,
    destructAt: real?.destruct_at,
    // Чат ОРИГИНАЛА, когда он другой: отсутствие `reply_to_peer_id` в схеме и
    // значит «тот же пир», поэтому отдельного признака кросс-чат-ответа нет.
    replyToPeerId: m.reply_to?.reply_to_peer_id ? getPeerId(m.reply_to.reply_to_peer_id) : undefined,
    reply: replyFrom
      ? {
          // Оригинала в этом чате нет: имя автора — из атрибуции, текст — лейбл
          // вложения (`reply_media`), потому что самого текста нам не дали.
          name: replyFrom.from_name || opts?.replyToName || 'Сообщение',
          text: quoteText || replyMediaLabel(mediaKindOfReply(m)) || 'Сообщение',
          quote: quoteText ? true : undefined,
        }
      : m.reply_to?.reply_to_msg_id
      ? {
          name: replyTo && replyTo.fromId === meId ? 'Вы' : opts?.replyToName ?? 'Сообщение',
          // Ответ с цитатой (reply quote): показываем выделенный фрагмент вместо
          // превью всего сообщения. Иначе — обычная логика: медиа без подписи →
          // метка типа, с подписью → текст подписи.
          text: quoteText || (replyTo ? messageForReply(replyTo) : ''),
          // entity-оффсеты заданы по полному тексту оригинала, для цитаты они не
          // совпадают → форматирование фрагмента опускаем.
          entities: quoteText ? undefined : (replyTo && replyTo._ === 'message' && replyTo.message ? replyTo.entities : undefined),
          seq: m.reply_to.reply_to_msg_id,
          mediaId: replyTo ? getMediaId(replyTo) : undefined,
          mediaType: replyKind,
          quote: quoteText ? true : undefined,
        }
      : undefined,
  }
}

/** Вид вложения НЕДОСТУПНОГО оригинала — из `reply_to.reply_media`. Тем же
 *  выводом, что и у обычного вложения: объединение одно, значит и ответ на
 *  «какой это вид» должен быть один. */
function mediaKindOfReply(m: MyMessage): MessageKind | undefined {
  return mediaKind(m.reply_to?.reply_media)
}

/** `MessageKind` → ветка рендера бабла. Виды, у которых своей ветки нет
 *  (`gif`, `encrypted` без расшифровки), рисуются как их ближайший бабл. */
function convKind(kind: MessageKind): ConvMsg['type'] {
  switch (kind) {
    case 'gif': return 'video'
    case 'encrypted': return 'text'
    default: return kind
  }
}

/** Лог звонка из действия. Прежде это был JSON внутри текста сообщения — та же
 *  подделка дискриминатора, что у служебных действий, но в другом поле.
 *
 *  Наши четыре исхода ложатся на схему так: Missed → `missed`, Busy → `busy`,
 *  Hangup → `ok` либо `cancelled`, и различает их НАЛИЧИЕ длительности (у
 *  соединившегося звонка она есть, у сорвавшегося нет). */
function callLog(a: Extract<import('./messages/messageAction').MessageAction, { _: 'messageActionPhoneCall' }>): CallLog {
  const reason: CallLog['reason'] =
    a.reason?._ === 'phoneCallDiscardReasonMissed' ? 'missed'
    : a.reason?._ === 'phoneCallDiscardReasonBusy' ? 'busy'
    : a.duration ? 'ok'
    : 'cancelled'
  return { video: !!a.pFlags?.video, reason, duration: a.duration }
}
