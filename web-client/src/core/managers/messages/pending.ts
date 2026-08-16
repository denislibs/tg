// src/core/managers/messages/pending.ts
//
// Жизненный цикл оптимистичного («неотправленного») сообщения — В МЕНЕДЖЕРЕ
// ВОРКЕРА, как в tweb. Порт формы `appMessagesManager`:
//
//   tweb                          → здесь
//   pendingByRandomId             → pendingByClientId
//   beforeMessageSending()        → beforeMessageSending()
//   finalizePendingMessage()      → finalizePendingMessage()
//   checkPendingMessage()         → checkPendingMessage() (зовёт cacheLive)
//   cancelPendingMessage()        → cancelPendingMessage()
//   message.error / pFlags.is_outgoing → Message.failed
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
import type { Message } from '../../models'
import type { MessageOp } from '../../realtime/messageOps'
import type { AckEvt, PendingNewEvt } from '../../realtime/events'
import SlicedArray, { SliceEnd } from '../../history/slicedArray'

/** Регистрация неотправленного сообщения — аналог tweb PendingMessageDetails. */
interface PendingDetails {
  chatId: number
  threadRootId?: number | null
  /** позиция в окне (у нас порядок задаёт seq, в tweb — временный mid) */
  tempSeq: number
  /** окна, куда бабл вставлен: основное чата и, для тред-сообщения, окно треда */
  keys: string[]
}

/** Внутренности хранилища истории, которые нужны pending-механике. Отдельно от
 *  `MessagesCtx`: тем под-модулям (опросы/реакции) хватает точечного patchMsg, а
 *  здесь нужна сама структура окна — как в tweb, где beforeMessageSending трогает
 *  и `messagesStorage`, и `historyStorage.history`. */
export interface PendingCtx {
  hkey: (chatId: number, threadRoot?: number | null) => string
  slices: Map<string, SlicedArray<number>>
  msgsFor: (chatId: number) => Map<number, Message>
}

export function newPendingMethods(ctx: PendingCtx) {
  const { hkey, slices, msgsFor } = ctx
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
    return opsFor(d, (key) => ({ op: 'insert', key, msg: final }))
  }

  return {
    finalizePendingMessage,

    /** Порт tweb `beforeMessageSending`: временное сообщение попадает в SSOT и в
     *  срез окна ДО ухода на сервер, регистрируется в pending-реестре, наружу
     *  уходит `insert`. Пустой результат = ни одно окно чата не держит низ
     *  истории (бабл появится обычным эхом при следующей загрузке). */
    beforeMessageSending(e: PendingNewEvt): MessageOp[] {
      const keys = targetKeys(e.chat_id, e.thread_root_id)
      if (!keys.length) return []
      const seq = tentativeSeq(e.chat_id, keys)
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
        replyToId: null,
        mediaId: e.media_id ?? null,
        createdAt: new Date().toISOString(),
        threadRootId: e.thread_root_id ?? null,
        groupedId: e.grouped_id ?? null,
        clientId: e.client_msg_id,
        // localUrl (blob-URL локального превью) здесь НЕТ сознательно: SSOT
        // воркера общий на все вкладки, а blob валиден только в породившей —
        // разослав его, мы бы дали остальным битый превью навсегда (localUrl
        // приоритетнее mediaId и не очищается). Своё превью вкладка накладывает
        // на пришедшую операцию сама (core/media/localPreview.ts).
        mediaWidth: e.media?.width,
        mediaHeight: e.media?.height,
        mediaMime: e.media?.mime,
        mediaSize: e.media?.size,
        mediaName: e.media?.name,
        // Сервер ставит media_unread на голосовые и кружки — отражаем сразу,
        // чтобы точка не «моргала» после ack.
        mediaUnread: e.type === 'voice' || e.type === 'roundVideo' || undefined,
        geo: e.geo,
        contact: e.contact,
        secret: e.secret,
        sendAs: e.send_as,
      }
      const d: PendingDetails = { chatId: e.chat_id, threadRootId: e.thread_root_id, tempSeq: seq, keys }
      pendingByClientId.set(e.client_msg_id, d)
      msgsFor(e.chat_id).set(seq, msg)
      for (const key of keys) {
        const sa = slices.get(key)
        if (sa && !sa.findSlice(seq)) sa.unshift(seq)
      }
      return opsFor(d, (key) => ({ op: 'insert', key, msg }))
    },

    /** Аплоад завершился — к неотправленному баблу приклеился настоящий mediaId.
     *  В tweb это часть `sendFile` (temp-документ подменяется настоящим), у нас —
     *  отдельный шаг, потому что байты грузит отдельный менеджер. */
    attachPendingMedia(clientMsgId: string, mediaId: number): MessageOp[] {
      const d = pendingByClientId.get(clientMsgId)
      if (!d) return []
      const next = patchTemp(d, (m) => ({ ...m, mediaId }))
      if (!next) return []
      return opsFor(d, (key) => ({ op: 'patch', key, msgId: next.id, fields: { mediaId } }))
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

    /** Сервер отверг отправку (`message_error`) либо сорвался аплоад. Бабл
     *  остаётся с красной пометкой — решение (переслать/удалить) за пользователем,
     *  поэтому регистрация в pending СОХРАНЯЕТСЯ: ack после ретрая должен найти
     *  тот же бабл (tweb держит `message.error` ровно так же). */
    failPendingMessage(clientMsgId: string): MessageOp[] {
      const d = pendingByClientId.get(clientMsgId)
      if (!d) return []
      const next = patchTemp(d, (m) => ({ ...m, failed: true }))
      if (!next) return []
      return opsFor(d, (key) => ({ op: 'patch', key, msgId: next.id, fields: { failed: true } }))
    },

    /** Пользователь нажал «повторить»: снимаем пометку ошибки, бабл снова «в пути». */
    retryPendingMessage(clientMsgId: string): MessageOp[] {
      const d = pendingByClientId.get(clientMsgId)
      if (!d) return []
      const next = patchTemp(d, (m) => ({ ...m, failed: undefined }))
      if (!next) return []
      return opsFor(d, (key) => ({ op: 'patch', key, msgId: next.id, fields: { failed: undefined } }))
    },

    /** Порт tweb `cancelPendingMessage`: отмена аплоада / удаление неотправленного. */
    cancelPendingMessage(clientMsgId: string): MessageOp[] {
      const d = pendingByClientId.get(clientMsgId)
      if (!d) return []
      pendingByClientId.delete(clientMsgId)
      const cur = msgsFor(d.chatId).get(d.tempSeq)
      if (!dropTemp(d) || !cur) return []
      return opsFor(d, (key) => ({ op: 'remove', key, msgId: cur.id }))
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
