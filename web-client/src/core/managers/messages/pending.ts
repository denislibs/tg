// src/core/managers/messages/pending.ts
//
// Жизненный цикл оптимистичного («неотправленного») сообщения И САМА ОТПРАВКА —
// В МЕНЕДЖЕРЕ ВОРКЕРА, как в tweb. Порт формы `appMessagesManager`:
//
//   tweb                          → здесь
//   sendText()                    → sendText()
//   sendFile()                    → sendFile()
//   pendingByRandomId             → pendingByClientId
//   beforeMessageSending()        → beforeMessageSending()
//   finalizePendingMessage()      → finalizePendingMessage()
//   checkPendingMessage()         → checkPendingMessage() (зовёт cacheLive)
//   cancelPendingMessage()        → cancelPendingMessage()
//   message.error / pFlags.is_outgoing → Message.failed
//
// ТРАНСПОРТ — ВНУТРИ. В tweb хвост `beforeMessageSending` — это `message.send()`
// (appMessagesManager.ts:2846-2853), где `send` — закрытие, поставленное
// `sendText`/`sendFile` (`message.send = upload`, :1782). Здесь так же: сам кадр
// шлёт `ctx.send`, а закрытие собирает `sendText`/`sendFile`. Циклического
// импорта нет по той же причине, что и в оригинале: зависимость приходит
// ИНЪЕКЦИЕЙ при сборке (workerCore подставляет `conn.sendMessage`), менеджер
// connectionManager не импортирует.
//
// АПЛОАД — ВНУТРИ `sendFile`, тоже как в tweb: там `upload()` и последующий
// `invokeSend(inputMedia)` живут в одном методе менеджера, отдельной фазы
// «вкладка догрузила байты и попросила отправить» не существует. Метаданные
// файла (width/height/duration) считает ГЛАВНЫЙ ПОТОК и передаёт аргументами —
// это тоже 1:1 с оригиналом (поля `width`/`height`/`duration` в `SendFileArgs`,
// :415): им нужен DOM (<video> для длительности, canvas для масштабирования).
//
// ЗАЧЕМ переносили. До этого временный бабл жил ТОЛЬКО в zustand каждой вкладки:
// воркер получал `appendPending` и просто бродкастил эхо, своего состояния не
// держал. Следствия, каждое воспроизводилось:
//   • вкладка, открытая ПОСЛЕ отправки, неотправленного бабла не видела вовсе —
//     SuperMessagePort кадры не буферизует, а в SSOT воркера бабла не было;
//   • переоткрытие чата читало историю из SSOT воркера — без своего же бабла;
//   • реконсиляция ack шла независимо в каждой вкладке (N разборов одного факта)
//     вместо одного применения владельцем.
// В tweb ничего этого нет by construction: временное сообщение лежит в ТОМ ЖЕ
// хранилище, что и настоящие (`messagesStorage`), а его id — в том же
// `historyStorage.history` (SlicedArray). Здесь так же: `msgsByChat` + `slices`.
//
// ЧТО НАРУЖУ. Только `MessageOp` — тот же канал, которым воркер объявляет любое
// изменение окна. Пяти событий `rt:pending_*` больше нет: «бабл появился» это
// `insert`, «доехал ack» это `insert` финального (слияние по clientId живёт в
// messageOps.insert), «ошибка отправки» это `patch {failed:true}`, «отменили» это
// `remove`. Тем самым исчезает исключение из инварианта «окно правит только
// applyOps», которое раньше приходилось держать в CLAUDE.md.
//
// ЧЕГО НЕ ДЕЛАЕМ. Временный бабл НЕ персистится в IndexedDB. В tweb неотправленное
// не переживает перезагрузку — и не должно: воскресший из IDB «отправляется…»
// без живого outbox навсегда останется висеть. Поэтому здесь пишем в Map SSOT
// напрямую, минуя write-through `put()`.
//
// ЧТО ОСТАЛОСЬ НА ВКЛАДКЕ (и это НЕ отступление от tweb):
//   • метаданные файла — `scaleImageForSend`, `probeMediaDuration`
//     (core/hooks/useChatSend.ts): им нужен DOM (canvas, <video>), tweb считает
//     их там же и передаёт полями `width`/`height`/`duration` в `SendFileArgs`;
//   • секретные чаты идут не сюда, а в `secretManager` (тоже воркер): по проводу
//     уходит шифртекст, а не текст бабла. Секретных чатов у tweb нет вовсе —
//     сравнивать не с чем, это наша фича, а не расхождение с оригиналом;
//   • пост канала уходит по REST (`channelsManager.post`) — транспорт другой,
//     но владелец бабла тот же: он зовёт `beforeMessageSending` явно.
import { deriveOut, type Message, type MessageEntity } from '../../models'
import {
  saveDocument, THUMB_TYPE_FULL,
  type DocumentAttribute, type MessageMedia, type MyDocument,
} from '../../media/messageMedia'
import type { MessageOp } from '../../realtime/messageOps'
import type { AckEvt, PendingMedia, PendingNewEvt, TypingAction } from '../../realtime/events'
import type { SendArgs as WireSendArgs } from '../../realtime/connectionManager'
import type { UploadArgs } from '../mediaManager'
import { b64FromBytes } from '../../secret/crypto'
import SlicedArray, { SliceEnd } from '../../history/slicedArray'
import { sendingParamsToWire, splitSendingParams, type MessageSendingParams, type SendingParamsWireFields } from './sendingParams'

/** Данные временного бабла, которых нет в проводных полях send_message: автор,
 *  локальная мета файла, имя контакта, заголовок send-as, метка секретного чата.
 *  Присутствие объекта = «завести бабл»; пути без оптимистики (черновик →
 *  createPrivate, комментарий к форварду, переотправка уже существующего бабла)
 *  его не передают. */
export interface SendOptimistic {
  senderId: number
  media?: PendingMedia
  /** имя контакта для бабла — проводной contactUserId имени не несёт */
  contactName?: string
  /** send-as: бабл сразу от имени выбранной личности, а не «от себя» */
  sendAs?: { chatId: number; title: string }
  /** секретный чат: бабл с плейнтекстом, помеченный secret */
  secret?: boolean
  /** кросс-чат ответ: снимок превью оригинала (его нет в SSOT этого чата) */
  replySnapshot?: { peerId: number; name: string; text: string }
}

/** Проводные поля кадра МИНУС те, что целиком покрыты пакетом параметров:
 *  передать `replyToId`/`silent`/`effect`/… мимо пакета теперь нельзя даже
 *  типом — ровно то свойство, ради которого форма пакета и портируется. */
export type SendWireArgs = Omit<WireSendArgs, keyof SendingParamsWireFields>

/** Аргументы `sendText` — проводные поля send_message + ПАКЕТ ПАРАМЕТРОВ +
 *  заявка на бабл. Порт tweb `sendText(options: MessageSendingParams & {...})`
 *  (:1290); наш `sendText` покрывает и `sendOther` (стикер/гиф/гео/контакт): у
 *  них ровно та же форма — байтов нет, кадр один, пакет тот же. */
export interface SendTextArgs extends SendWireArgs, MessageSendingParams {
  optimistic?: SendOptimistic
}

/** Порт tweb `SendFileArgs = MessageSendingParams & SendFileDetails & {...}`
 *  (:415) — включая САМ ПАКЕТ параметров, ровно как в оригинале. Совпадающие
 *  поля — `file`, `width`, `height`, `duration`, `waveform`, `caption`,
 *  `entities`, `groupId`, `isMedia`; `objectURL` у нас нет СОЗНАТЕЛЬНО
 *  (см. sendFile: blob-URL минтит воркер, а не вкладка). */
export interface SendFileArgs extends MessageSendingParams {
  chatId: number
  clientMsgId: string
  senderId: number
  file: Blob
  /** photo/video/audio/document/voice/roundVideo — как в проводном send_message */
  type: string
  mime?: string
  fileName?: string
  caption?: string
  entities?: MessageEntity[]
  width?: number
  height?: number
  duration?: number
  waveform?: Uint8Array
  /** альбом (Telegram grouped_id): общий id на все сообщения группы */
  groupedId?: string
  paidMediaPrice?: number | null
  /** tweb `isMedia`: фото/видео «как медиа» — бабл сразу с локальным превью */
  isMedia?: boolean
  /** tweb `isAnimated` (appMessagesManager.ts:2010-2014): файл отправляется
   * ГИФКОЙ — в документ уходит `documentAttributeAnimated`, из которого
   * `saveDocument` и выводит `doc.type === 'gif'` */
  isAnimated?: boolean
  /** tweb `sendFile({spoiler})` (appMessagesManager.ts:134): отправитель прячет
   * медиа под спойлером — признак едет и в кадр, и в оптимистичный бабл */
  spoiler?: boolean
  /** «отправляет фото/файл…» у собеседника на время аплоада (tweb sendMessageUpload*Action) */
  uploadAction?: TypingAction
  /** кросс-чат ответ: снимок превью оригинала для бабла (см. SendOptimistic) */
  replySnapshot?: { peerId: number; name: string; text: string }
}

/** Регистрация неотправленного сообщения — аналог tweb PendingMessageDetails. */
interface PendingDetails {
  chatId: number
  threadRootId?: number | null
  /** позиция в окне (у нас порядок задаёт seq, в tweb — временный mid) */
  tempSeq: number
  /** окна, куда бабл вставлен: основное чата и, для тред-сообщения, окно треда */
  keys: string[]
  /** Порт поля tweb `PendingMessageDetails.sequential` (appMessagesManager.ts:228):
   *  кадр отправки ушёл в том же ходу, что и появление бабла, — значит серверный
   *  идентификатор сохранит уже занятую баблом позицию внизу окна. Заводится
   *  здесь, уезжает наружу полем операции `insert` из `finalizePendingMessage`
   *  (в tweb — полем события `history_update` из `checkPendingMessage`,
   *  appMessagesManager.ts:8730-8737). */
  sequential?: boolean
}

/** Внутренности хранилища истории, которые нужны pending-механике. Отдельно от
 *  `MessagesCtx`: тем под-модулям (опросы/реакции) хватает точечного patchMsg, а
 *  здесь нужна сама структура окна — как в tweb, где beforeMessageSending трогает
 *  и `messagesStorage`, и `historyStorage.history`. */
export interface PendingCtx {
  hkey: (chatId: number, threadRoot?: number | null) => string
  slices: Map<string, SlicedArray<number>>
  msgsFor: (chatId: number) => Map<number, Message>
  /** id текущего пользователя — временный бабл получает `out` тем же предикатом
   *  (`deriveOut`), что и настоящие сообщения на границе маппинга. Геттер, а не
   *  значение: `me` у воркера разрешается лениво. */
  getMeId: () => number | null
  /** Публикация изменений окна всем вкладкам (rt:message_op). Правило: публикует
   *  ТОТ, КТО инициировал изменение. Пути отправки инициирует этот модуль —
   *  поэтому emit здесь; кадры message_ack/message_error инициирует роутер
   *  кадров (workerCore.ts::onFrame), там публикация и остаётся. */
  emit: (ops: MessageOp[]) => void
  /** Транспорт: кадр send_message в WS. Инъекция при сборке (workerCore
   *  подставляет conn.sendMessage) — так же, как tweb раздаёт менеджерам
   *  зависимости через реестр AppManagers, а не импортом. */
  send: (args: WireSendArgs) => void
  /** Отгрузка байтов медиа (mediaManager.upload воркера) → media_id. */
  upload: (a: UploadArgs) => Promise<number>
  /** Оборвать активный аплоад по progressId (=clientMsgId). */
  cancelUpload: (progressId: string) => void
  /** «Отправляет фото/файл…» на время аплоада (conn.sendTyping). */
  sendTyping: (chatId: number, action: TypingAction) => void
  /** Прогресс аплоада вкладкам (media:upload_progress). `done` — аплоад
   *  закончился (успехом, ошибкой или отменой): кольцо на бабле снимается. */
  uploadProgress: (id: string, loaded: number, total: number, done?: boolean) => void
}

/** Период пинга «отправляет фото/файл…» (TTL приёмника — 6 с). */
const UPLOAD_TYPING_MS = 3000

/**
 * Порт tweb `makeDocumentAndMetaForSendingFile` (appMessagesManager.ts:1908-2112)
 * в той его роли, ради которой он и зовётся из `sendFile`: собрать ВЛОЖЕНИЕ
 * отправляемого файла — настоящий `messageMediaPhoto`/`messageMediaDocument` —
 * ещё до аплоада, чтобы бабл «отправляется…» рисовался тем же кодом, что и
 * пришедшее с сервера сообщение (в оригинале это `message.media = media`,
 * :1596-1631: `photo`/`document`, собранные тут же, кладутся прямо в бабл).
 *
 * `attachType` берётся ГОТОВЫМ (проводное поле `type` кадра), а не выводится
 * заново из mime, как в оригинале (:1932-2017): у нас этот вывод уже сделан
 * вкладкой, уезжает на сервер полем кадра и там же описывает медиа
 * (`domain.MediaSource.Kind`). Второй вывод того же факта здесь был бы вторым
 * источником истины, а не портом.
 *
 * ── Чего нет и почему ───────────────────────────────────────────────────────
 *  • `strippedBytes` (ступень `photoStrippedSize` в начало лестницы) — оригинал
 *    получает stripped-байты из попапа отправки, где превью уже посчитано; у нас
 *    их до аплоада не считает никто, роль подложки бабла несёт `localUrl`;
 *  • `thumb` + `thumbsStorage.setCacheContextURL` — ступени в оригинале нужны,
 *    чтобы повесить на них локальный objectURL; у нас его несёт `Message.localUrl`
 *    (blob-URL минтит воркер, см. `sendFile`), а ступени адресуются id медиа,
 *    которого до аплоада ещё нет. Поэтому `thumbs` у локального документа пуст.
 */
function makeDocumentAndMetaForSendingFile(o: PendingMedia & {
  /** tweb `mediaTempId` (:1554): id, под которым файл живёт до ответа сервера */
  mediaTempId: number
  /** tweb `attachType` — 'photo' | 'video' | 'roundVideo' | 'voice' | 'audio' | … */
  attachType: string
}): MessageMedia {
  const mime = o.mime ?? ''
  // tweb `pFlags: {...(options.spoiler ? {spoiler: true} : {})}` (:1600-1602);
  // у нас «выключено» — это ОТСУТСТВИЕ ключа, поэтому и самого pFlags нет.
  const pFlags = o.spoiler ? { pFlags: { spoiler: true as const } } : {}

  // tweb :1957-1979 — фото «как медиа» едет messageMediaPhoto с одной ступенью
  // THUMB_TYPE_FULL (`photoSize` с размерами кадра и размером файла).
  if (o.attachType === 'photo') {
    return {
      _: 'messageMediaPhoto',
      ...pFlags,
      photo: {
        _: 'photo',
        id: o.mediaTempId,
        sizes: [{ _: 'photoSize', type: THUMB_TYPE_FULL, w: o.width ?? 0, h: o.height ?? 0, size: o.size ?? 0 }],
      },
    }
  }

  const attributes: DocumentAttribute[] = []
  switch (o.attachType) {
    // tweb :1932-1955 — аудио и голосовое отличаются одним битом атрибута.
    case 'voice':
    case 'audio':
      attributes.push({
        _: 'documentAttributeAudio',
        ...(o.attachType === 'voice' ? { pFlags: { voice: true as const } } : {}),
        duration: o.duration ?? 0,
        ...(o.waveform ? { waveform: o.waveform } : {}),
      })
      break
    // tweb :1991-2009 — видео и кружок, тоже одним битом (`round_message`).
    case 'video':
    case 'roundVideo':
      attributes.push({
        _: 'documentAttributeVideo',
        pFlags: {
          ...(o.attachType === 'roundVideo' ? { round_message: true as const } : {}),
          supports_streaming: true,
        },
        duration: o.duration ?? 0,
        w: o.width ?? 0,
        h: o.height ?? 0,
      })
      break
  }
  // tweb :2010-2014 — «must follow after video attribute».
  if (o.animated) attributes.push({ _: 'documentAttributeAnimated' })
  // tweb :2019 — имя файла дописывается всегда, последним из «своих».
  attributes.push({ _: 'documentAttributeFilename', file_name: o.name ?? '' })
  // tweb :2043-2047 — картинка, отправленная файлом, описывается кадром: именно
  // из этого атрибута оригинал выводит `doc.type === 'photo'`.
  if (mime.startsWith('image/')) {
    attributes.push({ _: 'documentAttributeImageSize', w: o.width ?? 0, h: o.height ?? 0 })
  }

  // tweb :2027-2098 — документ собирается и прогоняется через `saveDoc`: тип
  // выводится из атрибутов и mime, а не задаётся отправителем.
  const document: MyDocument = saveDocument({
    _: 'document',
    id: o.mediaTempId,
    mime_type: mime,
    size: o.size ?? 0,
    attributes,
    thumbs: [],
  })
  return { _: 'messageMediaDocument', ...pFlags, document }
}

/** Тот же документ/фото, но под настоящим id медиа: аплоад завершился, и файл,
 *  живший под временным id (tweb `mediaTempId`), получил адрес на сервере. */
function withMediaId(media: MessageMedia, id: number): MessageMedia {
  return media._ === 'messageMediaDocument'
    ? { ...media, document: { ...media.document, id } }
    : { ...media, photo: { ...media.photo, id } }
}

export function newPendingMethods(ctx: PendingCtx) {
  const { hkey, slices, msgsFor, emit } = ctx
  const pendingByClientId = new Map<string, PendingDetails>()

  /** Окна чата, готовые принять вставку: срез должен держать НИЗ истории, иначе
   *  позиция нового сообщения неизвестна (тот же гейт, что в cacheLive). */
  const targetKeys = (chatId: number, threadRootId?: number | null): string[] => {
    const keys = threadRootId ? [hkey(chatId), hkey(chatId, threadRootId)] : [hkey(chatId)]
    return keys.filter((k) => slices.get(k)?.first.isEnd(SliceEnd.Bottom))
  }

  /** Следующий свободный seq внизу окна. Порядок бабла и только: реконсиляция
   *  матчит по clientId, а не по этому seq (см. dedupKey в messageOps). */
  const tentativeSeq = (chatId: number, keys: string[]): number => {
    const c = msgsFor(chatId)
    let max = 0
    for (const key of keys) {
      const sa = slices.get(key)
      if (!sa) continue
      for (const slice of sa.slices) for (const s of slice) if (s > max) max = s
    }
    for (const s of c.keys()) if (s > max) max = s
    return max + 1
  }

  /** Снять временный бабл из SSOT и срезов. Возвращает, был ли он там. */
  const dropTemp = (d: PendingDetails): boolean => {
    const c = msgsFor(d.chatId)
    const existed = c.delete(d.tempSeq)
    for (const key of d.keys) slices.get(key)?.delete(d.tempSeq)
    return existed
  }

  /** Точечно поправить временный бабл в SSOT. */
  const patchTemp = (d: PendingDetails, upd: (m: Message) => Message): Message | undefined => {
    const c = msgsFor(d.chatId)
    const cur = c.get(d.tempSeq)
    if (!cur) return undefined
    const next = upd(cur)
    c.set(d.tempSeq, next)
    return next
  }

  const opsFor = (d: PendingDetails, make: (key: string) => MessageOp): MessageOp[] =>
    d.keys.map(make)

  /** Порт tweb `finalizePendingMessage`: временный бабл уходит из SSOT и срезов,
   *  на его место встаёт настоящее сообщение. Наружу — `insert` финального:
   *  слияние с оптимистичным по clientId (перенос clientId/localUrl/secret)
   *  живёт в `messageOps.insert` и работает одинаково у всех потребителей. */
  const finalizePendingMessage = (clientMsgId: string, final: Message): MessageOp[] => {
    const d = pendingByClientId.get(clientMsgId)
    if (!d) return []
    pendingByClientId.delete(clientMsgId)
    dropTemp(d)
    const c = msgsFor(d.chatId)
    c.set(final.seq, final)
    for (const key of d.keys) {
      const sa = slices.get(key)
      if (sa && !sa.findSlice(final.seq)) sa.unshift(final.seq)
    }
    // `sequential` объявляется вместе с финальным сообщением — ровно как в tweb,
    // где `checkPendingMessage` кладёт `pendingData.sequential` в `history_update`
    // (appMessagesManager.ts:8730-8737). Лента по нему решает, надо ли вообще
    // перекладывать бабл (`chat/bubbles.ts`, порт bubbles.ts:802-819).
    return opsFor(d, (key) => ({ op: 'insert', key, msg: final, sequential: d.sequential }))
  }

  /** Порт tweb `beforeMessageSending`: временное сообщение попадает в SSOT и в
   *  срез окна ДО ухода на сервер, регистрируется в pending-реестре, наружу
   *  уходит `insert` — И ТОЛЬКО ПОТОМ зовётся `send` (в оригинале это
   *  `message.send()`, appMessagesManager.ts:2846-2853). Порядок обязателен:
   *  сперва бабл на экран, затем сеть.
   *
   *  Пустой результат = ни одно окно чата не держит низ истории (бабл появится
   *  обычным эхом при следующей загрузке); `send` при этом всё равно зовётся —
   *  отсутствие открытого окна не отменяет отправку. */
  const beforeMessageSending = (e: PendingNewEvt, send?: () => void): MessageOp[] => {
    const ops = insertPending(e)
    emit(ops)
    send?.()
    return ops
  }

  /** Превью ответа для ВРЕМЕННОГО бабла. Порт tweb `generateReplyHeader`
   *  (appMessagesManager.ts:2926 — исходящее сообщение получает `reply_to` ещё
   *  до ухода на сервер): без этого бабл появлялся бы без цитаты и «прыгал» бы,
   *  когда её принесёт эхо. Оригинал ищем в SSOT воркера — той же единой Map
   *  сообщений чата, из которой живёт окно (у главного потока для входящих ту же
   *  работу делает `storeProjection`, но у СВОЕЙ отправки владелец бабла — здесь). */
  const resolveReplyTo = (chatId: number, replyToId: number, quoteText?: string): Message['replyTo'] => {
    for (const m of msgsFor(chatId).values()) {
      if (m.id !== replyToId) continue
      return {
        msgId: m.id, seq: m.seq, senderId: m.senderId, text: m.text,
        entities: m.entities, type: m.type, mediaId: m.mediaId ?? undefined,
        quoteText: quoteText || undefined,
      }
    }
    return null
  }

  const insertPending = (e: PendingNewEvt): MessageOp[] => {
    const keys = targetKeys(e.chat_id, e.thread_root_id)
    if (!keys.length) return []
    const seq = tentativeSeq(e.chat_id, keys)
    const replyToId = e.reply_to_id ?? null
    const msg: Message = {
      // Отрицательный id помечает неотправленное (dedupKey ключует такое по
      // clientId — иначе чужое входящее с тем же tentative seq вытеснило бы
      // бабл из окна без ack и без ошибки).
      id: -seq,
      chatId: e.chat_id,
      seq,
      senderId: e.sender_id,
      type: e.type ?? 'text',
      text: e.text,
      entities: e.entities,
      replyToId,
      // Кросс-чат ответ: оригинала в этом чате нет, превью рисуется из снимка
      // (та же ветка `messageToConvMsg`, что у серверного `reply_snapshot_*`);
      // обычный ответ — резолв оригинала по SSOT.
      replyToPeerId: e.reply_snapshot?.peerId,
      replySnapshotName: e.reply_snapshot?.name,
      replySnapshotText: e.reply_snapshot?.text,
      replyTo: replyToId != null && !e.reply_snapshot ? resolveReplyTo(e.chat_id, replyToId, e.reply_quote_text) : undefined,
      mediaId: e.media_id ?? null,
      createdAt: new Date().toISOString(),
      threadRootId: e.thread_root_id ?? null,
      groupedId: e.grouped_id ?? null,
      clientId: e.client_msg_id,
      // localUrl — обычное поле SSOT: blob-URL минтит ВОРКЕР (sendFile ниже), а
      // воркерный blob виден всем вкладкам (тот же приём, что у downloadMediaURL
      // в mediaManager). Раньше поля здесь не было, потому что URL создавала
      // вкладка и вкладка же накладывала его на операцию у себя.
      localUrl: e.local_url,
      // Вложение бабла — НАСТОЯЩЕЕ `MessageMedia`, собранное здесь же (порт tweb
      // `sendFile`: `message.media = media`, где media — результат
      // `makeDocumentAndMetaForSendingFile`). Поэтому «отправляется…» рисуется
      // тем же кодом, что и серверное сообщение: волна голосового, кадр видео,
      // имя/размер файла и заслонка спойлера стоят на бабле сразу, а не после эха.
      //
      // id файла: настоящий, если он уже есть (сохранённый GIF/стикер уходят с
      // `media_id` — это ветка `isDocument` оригинала, :1538-1541, где в бабл
      // кладётся УЖЕ сохранённый документ), иначе временный — id самого бабла,
      // ровно как tweb `mediaTempId = message.id` (:1554).
      media: e.media
        ? makeDocumentAndMetaForSendingFile({ ...e.media, mediaTempId: e.media_id ?? -seq, attachType: e.type ?? 'document' })
        : undefined,
      // Сервер ставит media_unread на голосовые и кружки — отражаем сразу,
      // чтобы точка не «моргала» после ack.
      mediaUnread: e.type === 'voice' || e.type === 'roundVideo' || undefined,
      geo: e.geo,
      contact: e.contact,
      secret: e.secret,
      sendAs: e.send_as,
      // Тот же предикат, что на границе маппинга (порт tweb pFlags.out): бабл
      // «отправляется…» исходящий, но send-as (пост от имени канала/группы)
      // рисуется входящим — как и его серверное эхо.
      out: deriveOut({ senderId: e.sender_id, sendAs: e.send_as }, ctx.getMeId()),
    }
    const d: PendingDetails = { chatId: e.chat_id, threadRootId: e.thread_root_id, tempSeq: seq, keys, sequential: e.sequential }
    pendingByClientId.set(e.client_msg_id, d)
    msgsFor(e.chat_id).set(seq, msg)
    for (const key of keys) {
      const sa = slices.get(key)
      if (sa && !sa.findSlice(seq)) sa.unshift(seq)
    }
    return opsFor(d, (key) => ({ op: 'insert', key, msg }))
  }

  /** Аплоад завершился — к неотправленному баблу приклеился настоящий mediaId.
   *  В tweb ту же роль играет подмена temp-документа настоящим внутри `sendFile`;
   *  зовётся отсюда же, из `sendFile`, а не вторым RPC с вкладки. Вместе с
   *  `mediaId` настоящий адрес получает и сам файл вложения (`mediaTempId`
   *  оригинала перестаёт быть временным) — иначе бабл остался бы с вложением,
   *  указывающим в никуда. */
  const attachPendingMedia = (clientMsgId: string, mediaId: number): MessageOp[] => {
    const d = pendingByClientId.get(clientMsgId)
    if (!d) return []
    let fields: Partial<Message> = { mediaId }
    const next = patchTemp(d, (m) => {
      fields = m.media ? { mediaId, media: withMediaId(m.media, mediaId) } : { mediaId }
      return { ...m, ...fields }
    })
    if (!next) return []
    return opsFor(d, (key) => ({ op: 'patch', key, msgId: next.id, fields }))
  }

  /** Сервер отверг отправку (`message_error`) либо сорвался аплоад. Бабл
   *  остаётся с красной пометкой — решение (переслать/удалить) за пользователем,
   *  поэтому регистрация в pending СОХРАНЯЕТСЯ: ack после ретрая должен найти
   *  тот же бабл (tweb держит `message.error` ровно так же). */
  const failPendingMessage = (clientMsgId: string): MessageOp[] => {
    const d = pendingByClientId.get(clientMsgId)
    if (!d) return []
    const next = patchTemp(d, (m) => ({ ...m, failed: true }))
    if (!next) return []
    return opsFor(d, (key) => ({ op: 'patch', key, msgId: next.id, fields: { failed: true } }))
  }

  /** Пользователь нажал «повторить»: снимаем пометку ошибки, бабл снова «в пути». */
  const retryPendingMessage = (clientMsgId: string): MessageOp[] => {
    const d = pendingByClientId.get(clientMsgId)
    if (!d) return []
    const next = patchTemp(d, (m) => ({ ...m, failed: undefined }))
    if (!next) return []
    return opsFor(d, (key) => ({ op: 'patch', key, msgId: next.id, fields: { failed: undefined } }))
  }

  /** Порт tweb `cancelPendingMessage`: отмена аплоада / удаление неотправленного. */
  const cancelPendingMessage = (clientMsgId: string): MessageOp[] => {
    const d = pendingByClientId.get(clientMsgId)
    if (!d) return []
    pendingByClientId.delete(clientMsgId)
    const cur = msgsFor(d.chatId).get(d.tempSeq)
    if (!dropTemp(d) || !cur) return []
    return opsFor(d, (key) => ({ op: 'remove', key, msgId: cur.id }))
  }

  /** Порт tweb `upload()` внутри `sendFile` (:1642-1775): отгрузка байтов, затем
   *  отправка кадра уже с media_id. Пинг «отправляет фото/файл…» — порт
   *  `setTyping(peerId, {_: actionName})` из того же места. Ошибка/отмена —
   *  `cancelPendingMessage`/`toggleError` там же. */
  const uploadAndSend = async (o: SendFileArgs, mime: string, wire: WireSendArgs): Promise<number | null> => {
    ctx.uploadProgress(o.clientMsgId, 0, 1)
    // Пинг сразу и каждые UPLOAD_TYPING_MS — TTL приёмника вдвое больше.
    const action = o.uploadAction
    let ping: ReturnType<typeof setInterval> | null = null
    if (action) {
      ctx.sendTyping(o.chatId, action)
      ping = setInterval(() => ctx.sendTyping(o.chatId, action), UPLOAD_TYPING_MS)
    }
    try {
      const mediaId = await ctx.upload({
        blob: o.file, mime, size: o.file.size,
        width: o.width, height: o.height, duration: o.duration,
        fileName: o.fileName, waveform: o.waveform, progressId: o.clientMsgId,
      })
      emit(attachPendingMedia(o.clientMsgId, mediaId))
      ctx.send({ ...wire, mediaId })
      return mediaId
    } catch {
      // Отменённый аплоад бабл уже снял (cancelPending) — fail тогда no-op.
      emit(failPendingMessage(o.clientMsgId))
      return null
    } finally {
      if (ping !== null) clearInterval(ping)
      ctx.uploadProgress(o.clientMsgId, 0, 0, true)
    }
  }

  return {
    finalizePendingMessage,
    beforeMessageSending,
    attachPendingMedia,
    failPendingMessage,
    retryPendingMessage,
    cancelPendingMessage,

    /** Порт tweb `sendText` (:1290) — и `sendOther` (стикер/гиф/гео/контакт):
     *  байтов нет, поэтому весь метод — бабл + один кадр. Единственная точка
     *  отправки сообщения без файла; транспорт зовётся ВНУТРИ
     *  `beforeMessageSending`, как `message.send()` в оригинале. */
    async sendText({ optimistic, ...o }: SendTextArgs): Promise<{ ok: true }> {
      const { params, rest } = splitSendingParams(o)
      const args: WireSendArgs = { ...rest, ...sendingParamsToWire(params) }
      const send = () => ctx.send(args)
      if (!optimistic) { send(); return { ok: true } }
      beforeMessageSending({
        chat_id: args.chatId,
        thread_root_id: params.threadId ?? null,
        client_msg_id: args.clientMsgId,
        sender_id: optimistic.senderId,
        text: args.text,
        type: args.type,
        entities: args.entities ?? undefined,
        media_id: args.mediaId ?? null,
        grouped_id: args.groupedId,
        media: optimistic.media,
        geo: args.geo,
        // Телефон гидрирует сервер (приедет с эхом new_message) — в бабле пока
        // только локальный снимок имени.
        contact: args.contactUserId != null ? { userId: args.contactUserId, name: optimistic.contactName ?? '', phone: '' } : undefined,
        secret: optimistic.secret,
        send_as: optimistic.sendAs,
        reply_to_id: params.replyToMsgId ?? null,
        reply_quote_text: params.replyToQuote?.text,
        reply_snapshot: optimistic.replySnapshot,
        // Порт tweb `sendText → beforeMessageSending({sequential: true})`
        // (appMessagesManager.ts:1503-1508): байтов нет, кадр уходит тем же
        // ходом, что и бабл, — позиция внизу окна за ним и останется.
        sequential: true,
      }, send)
      return { ok: true }
    },

    /** Порт tweb `sendFile` (:1526): бабл → аплоад → отправка, всё внутри одного
     *  метода менеджера. Двух фаз («вкладка догрузила и попросила отправить»)
     *  нет — как и в оригинале.
     *
     *  Превью МИНТИМ ЗДЕСЬ, в воркере, а не принимаем `objectURL` аргументом,
     *  как tweb: blob-URL резолвится только в породившем контексте, и вкладочный
     *  был бы битым во всех остальных вкладках, а воркерный валиден во всех
     *  (blob-стор общий на origin). Это не отступление от модели tweb, а её
     *  последовательное применение: владелец медиа-факта — воркер, ровно так же
     *  минтит URL `mediaManager.downloadMediaURL`.
     *
     *  Возвращает media_id — он нужен вызывающему для действий над УЖЕ
     *  загруженным файлом (автосохранение отправленного Tenor-гифа в /gifs/saved);
     *  `null` = аплоад сорвался или был отменён. */
    async sendFile(o: SendFileArgs): Promise<{ mediaId: number | null }> {
      const mime = o.mime || o.file.type || 'application/octet-stream'
      const localUrl = o.isMedia ? URL.createObjectURL(o.file) : undefined
      const { params } = splitSendingParams(o)
      const wire: WireSendArgs = {
        chatId: o.chatId,
        text: o.caption ?? '',
        entities: o.entities ?? null,
        clientMsgId: o.clientMsgId,
        type: o.type,
        groupedId: o.groupedId,
        paidMediaPrice: o.paidMediaPrice ?? null,
        mediaSpoiler: o.spoiler,
        ...sendingParamsToWire(params),
      }
      let sent: Promise<number | null> = Promise.resolve(null)
      beforeMessageSending({
        chat_id: o.chatId,
        thread_root_id: params.threadId ?? null,
        client_msg_id: o.clientMsgId,
        reply_to_id: params.replyToMsgId ?? null,
        reply_quote_text: params.replyToQuote?.text,
        reply_snapshot: o.replySnapshot,
        sender_id: o.senderId,
        text: o.caption ?? '',
        type: o.type,
        entities: o.entities,
        grouped_id: o.groupedId,
        local_url: localUrl,
        media: {
          width: o.width, height: o.height, mime, size: o.file.size, name: o.fileName,
          duration: o.duration,
          // tweb `isAnimated` → `documentAttributeAnimated` в собранном документе.
          animated: o.isAnimated,
          // Те же байты пиков, что уедут в аплоад: волна на бабле «отправляется…»
          // рисуется сразу и не меняется после ack — сервер вернёт их же.
          waveform: o.waveform ? b64FromBytes(o.waveform) : undefined,
          // Своя отправка со спойлером обязана показать спойлер СРАЗУ: в tweb
          // попап отправки уже накрыл превью (applyMediaSpoiler), и бабл не
          // должен на миг обнажить медиа до эха сервера.
          spoiler: o.spoiler,
        },
        // `sequential` здесь НЕ ставится — 1:1 с tweb `sendFile`
        // (appMessagesManager.ts:1784-1790, единственный send-путь оригинала без
        // этой опции): между баблом и кадром стоит аплоад, за время которого
        // вперёд успевает уйти другое сообщение, и серверный порядок разойдётся
        // с позицией бабла. Такой бабл лента перекладывает общим путём.
      }, () => { sent = uploadAndSend(o, mime, wire) })
      return { mediaId: await sent }
    },

    /** Отправка сорвалась на пути, который идёт мимо `sendFile` (секретный чат:
     *  нет ключа / оффлайн / упал аплоад шифртекста) — красная пометка на бабле
     *  с публикацией. Зовёт владелец этого пути, из воркера. */
    async failPending(args: { clientMsgId: string }): Promise<{ ok: true }> {
      emit(failPendingMessage(args.clientMsgId))
      return { ok: true }
    },

    /** «Повторить» на упавшем бабле: снимаем пометку ошибки. Сам кадр вкладка
     *  шлёт следом обычным `sendText` (бабл уже есть, optimistic не передаётся). */
    async retryPending(args: { clientMsgId: string }): Promise<{ ok: true }> {
      emit(retryPendingMessage(args.clientMsgId))
      return { ok: true }
    },

    /** Отмена аплоада с бабла / «удалить» на упавшем. Аплоад рвём здесь же:
     *  им владеет воркер (порт tweb — `cancelPendingMessage` внутри обработчика
     *  ошибки `uploadPromise`, :1666-1673). */
    async cancelPending(args: { clientMsgId: string }): Promise<{ ok: true }> {
      ctx.cancelUpload(args.clientMsgId)
      ctx.uploadProgress(args.clientMsgId, 0, 0, true)
      emit(cancelPendingMessage(args.clientMsgId))
      return { ok: true }
    },

    /** Сервер подтвердил отправку (`message_ack`): у временного бабла появляются
     *  настоящие id/seq/дата, остальное содержимое остаётся своим. Настоящее
     *  сообщение придёт следом обычным `new_message` и сольётся по clientId. */
    ackPendingMessage(ack: AckEvt): MessageOp[] {
      const d = pendingByClientId.get(ack.client_msg_id)
      if (!d) return []
      const cur = msgsFor(d.chatId).get(d.tempSeq)
      if (!cur) return []
      return finalizePendingMessage(ack.client_msg_id, {
        ...cur,
        id: ack.msg_id,
        seq: ack.seq,
        createdAt: ack.created_at,
        failed: undefined,
      })
    },

    /** Порт tweb `checkPendingMessage`: пришло настоящее сообщение — если это эхо
     *  нашей же отправки, снимаем временный бабл из SSOT воркера. Вставку самого
     *  сообщения делает вызывающий (cacheLive), здесь только уборка временного:
     *  без неё в SSOT осталось бы два объекта, и переоткрытие чата показало бы
     *  «отправляется…» рядом с отправленным. */
    checkPendingMessage(clientMsgId: string | undefined): void {
      if (!clientMsgId) return
      const d = pendingByClientId.get(clientMsgId)
      if (!d) return
      pendingByClientId.delete(clientMsgId)
      dropTemp(d)
    },

    /** Есть ли ещё неотправленные — для тестов и диагностики. */
    hasPending(clientMsgId: string): boolean {
      return pendingByClientId.has(clientMsgId)
    },
  }
}
