// src/core/realtime/realtime.ts
//
// Фабрика realtime-менеджера. Раньше это был инлайн-объект в worker.ts с
// вручную продублированным контрактом в bootstrap.ts (RealtimeApi) — источник
// дрейфа (одна из копий уже теряла geo/contactUserId/threadRootId). Теперь это
// обычная фабрика, как остальные менеджеры: тип выводится из ReturnType и
// подхватывается в реестре воркера (WorkerRegistry) → UI-тип Managers.realtime
// генерится автоматически, ручной RealtimeApi больше не нужен.
//
// sendMessage принимает SendArgs напрямую (единый контракт с транспортом
// connectionManager) — три копии аргументов схлопываются в одну; сверху —
// `optimistic`/`awaitMedia` (см. RealtimeSendArgs), которые на провод не идут.
//
// Здесь же живёт ВСЯ проводка неотправленного («отправляется…») сообщения к его
// владельцу — менеджеру воркера (core/managers/messages/pending.ts). Пяти
// RPC-эх (appendPending/attachPendingMedia/failPending/retryPending/removePending),
// которые ничего не хранили и просто бродкастили пять событий rt:pending_*,
// больше нет: состояние держит владелец, наружу идут только MessageOp.

import type { newConnectionManager } from './connectionManager'
import type { SendArgs } from './connectionManager'
import type { ChannelFunnel } from './channelFunnel'
import { RT, type TypingAction, type PendingMedia, type PendingNewEvt } from './events'
import type { MessageOp } from './messageOps'

type Conn = ReturnType<typeof newConnectionManager>

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
}

export interface RealtimeSendArgs extends SendArgs {
  optimistic?: SendOptimistic
  /** Медиа ещё грузится: бабл появляется СЕЙЧАС, а кадр уходит на сервер из
   *  attachPendingMedia (аплоад завершился и принёс media_id). В tweb обе фазы
   *  внутри одного sendFile; у нас байты грузит вкладка (перенос аплоада в
   *  воркер — отдельная задача), поэтому фаза «отправить» приезжает вторым RPC. */
  awaitMedia?: boolean
}

export interface RealtimeDeps {
  conn: Conn
  // Задача 1 (ревью): «сигнал только push — новая вкладка слепа». isSyncing уже
  // существовал (funnel гейтит по нему живые кадры); getStatus ниже — первый
  // потребитель, которому нужен pull, а не только push onSyncStart/onSyncEnd.
  sync: { isSyncing(): boolean }
  tokens: { load(): Promise<unknown> }
  // Тип — MessageOp[], а не void: cacheMediaRead порождает операции (Stage 1B.3
  // сняла media_read с сырого кадра, окно правит только applyOps), и void здесь
  // однажды уже дал компилятору молча проглотить их потерю (Regression 1,
  // финальное ревью feat/remaining-ops) — markMediaRead звал cacheMediaRead и
  // выбрасывал результат.
  messages: {
    cacheMediaRead(p: { chat_id: number; msg_id: number }): MessageOp[]
    beforeMessageSending(e: PendingNewEvt): MessageOp[]
    attachPendingMedia(clientMsgId: string, mediaId: number): MessageOp[]
    failPendingMessage(clientMsgId: string): MessageOp[]
    retryPendingMessage(clientMsgId: string): MessageOp[]
    cancelPendingMessage(clientMsgId: string): MessageOp[]
  }
  broadcast: (event: string, payload: unknown) => void
  channelFunnel: ChannelFunnel
}

export function newRealtime({ conn, sync, tokens, messages, broadcast, channelFunnel }: RealtimeDeps) {
  // Кадры, ждущие конца аплоада (awaitMedia): clientMsgId → аргументы отправки.
  // Живут ровно до attachPendingMedia/failPending/cancelPending. Вкладка, умершая
  // посреди аплоада, оставляет здесь запись — она никогда не уйдёт на сервер
  // (кадр без media_id и не должен), только займёт место в памяти воркера.
  const awaitingMedia = new Map<string, SendArgs>()
  // Единственный выход pending-механики наружу: операции над окном. Пустой
  // список — не повод для кадра (идемпотентный повтор: бабла уже нет).
  const emit = (ops: MessageOp[]) => {
    if (ops.length) broadcast(RT.messageOp, { ops })
    return { ok: true as const }
  }
  return {
    async start() { await tokens.load(); conn.start(); return { state: conn.state() } },
    // Источник правды о `{state, retryAt}` — pull, а не разовый снапшот. Для ЭТОЙ
    // части модель 1:1 с tweb: `connectionStatus.ts:47-51` на `connection_status_change`
    // игнорирует payload события и тянет `getConnectionStatus()` (:87-91) — читает
    // состояние ОТТУДА, а не из payload; плюс отдельный стартовый pull по
    // INITIAL_DELAY (:66-69), если события ещё не было. Событие там — лишь «что-то
    // изменилось, дёрни pull», значение всегда приходит запросом.
    //
    // `syncing` — НЕ порт, а НАШЕ РАСШИРЕНИЕ той же дисциплины на вторую ось.
    // В tweb `state_synchronizing`/`state_synchronized` (:53-64) устроены иначе:
    // `this.updating = true/false` берётся из самого ФАКТА события (никакого pull),
    // и `updating` вообще не входит в `getConnectionStatus()` — `rootScope.ts:293`
    // отдаёт только карту `connectionStatus`, про синхронизацию там ничего нет.
    // Мы намеренно применили тот же pull-паттерн к `syncing` тоже (чтобы не иметь
    // двух разных дисциплин чтения в одном автомате — см. rootScope.ts/events.ts),
    // но выдавать это за букву оригинала было бы неточной ссылкой; это осознанное
    // расширение поверх 1:1, обоснование то же, что у гарантии парности onSyncEnd
    // в syncEngine.ts (последствие для UI, а не цитата из tweb).
    //
    // Итог для RT.state/RT.stateSynchronizing/synchronized (rootScope.ts): все три
    // остаются событиями-УВЕДОМЛЕНИЯМИ (автомату нужно знать МОМЕНТ изменения), их
    // payload — не источник правды; при получении любого из них следует звать
    // getStatus() и брать значение оттуда. Это делает модель иммунной к потере
    // события by construction: SuperMessagePort не буферизует кадры, а
    // `smp.on(...)` вешается в realtimeBridge из эффекта (useAppBootstrap.ts),
    // ПОСЛЕ первого рендера — ранние события физически теряются (тот же класс
    // дыры, что у loadChats vs push для `me`). Пропущенное уведомление не страшно:
    // следующее всё равно дёрнет актуальный pull; если не было ни одного — см.
    // примечание Задаче 3 про стартовый INITIAL_DELAY-pull (connectionStatus.ts:66-69,
    // задокументировано в task-1-report.md — точное ТЗ для консьюмера).
    //
    // Осознанное отступление от tweb (владелец, не форма): там карта статусов живёт
    // в ВОРКЕРНОМ rootScope (rootScope.ts:254 `connectionStatus`, ключ
    // `'NET-'+baseDcId` — у них мультидатацентровость MTProto), у нас источник —
    // connectionManager (`state`+`lastRetryAt`) и syncEngine (`isSyncing()`),
    // потому что состояние соединения у нас изначально там и живёт, а
    // мультидатацентровости нет (одно WS-соединение → плоский объект, без карты по
    // DC). Форма (pull из воркера через RPC) та же для `state`/`retryAt`, владелец
    // другой — сверяющий не должен читать ЭТО как расхождение с оригиналом
    // (в отличие от `syncing` выше, которое расхождение и есть).
    async getStatus() { return { state: conn.state(), retryAt: conn.retryAt(), syncing: sync.isSyncing() } },
    // Единственная точка отправки. Порт tweb `appMessagesManager.sendText`: сперва
    // `beforeMessageSending` (временный бабл в SSOT + операции наружу), потом
    // отправка. ОСОЗНАННОЕ ОТСТУПЛЕНИЕ от tweb: в оригинале отправку делает сам
    // менеджер (`message.send()` внутри), у нас транспорт остался здесь — иначе
    // messagesManager и connectionManager закольцевались бы импортом. Менеджер про
    // транспорт по-прежнему не знает: он только считает, что стало с окном, и
    // отдаёт операции; кому их разослать и когда уйдёт кадр — забота этого файла.
    async sendMessage({ optimistic, awaitMedia, ...args }: RealtimeSendArgs) {
      if (optimistic) {
        emit(messages.beforeMessageSending({
          chat_id: args.chatId,
          thread_root_id: args.threadRootId ?? null,
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
        }))
      }
      if (awaitMedia) awaitingMedia.set(args.clientMsgId, args)
      else conn.sendMessage(args)
      return { ok: true }
    },
    async markRead(args: { chatId: number; upToSeq: number }) { conn.markRead(args.chatId, args.upToSeq); return { ok: true } },
    async markMediaRead(args: { chatId: number; msgId: number }) {
      // Локально гасим точку media_unread в SSOT + рассылаем операции всем вкладкам
      // (окно теперь правит ТОЛЬКО applyOps(RT.messageOp) — сырой rt:media_read
      // проектор больше не слушает), затем шлём read_media серверу (у отправителя
      // точка гаснет по его серверному media_read-кадру).
      const ops = messages.cacheMediaRead({ chat_id: args.chatId, msg_id: args.msgId })
      if (ops.length) broadcast(RT.messageOp, { ops })
      broadcast(RT.mediaRead, { chat_id: args.chatId, msg_id: args.msgId })
      conn.markMediaRead(args.chatId, args.msgId)
      return { ok: true }
    },
    // Остальные шаги жизненного цикла неотправленного бабла. Маршрут к окну
    // (чат/тред) здесь не нужен: его знает сам менеджер — бабл зарегистрирован по
    // clientMsgId ещё в beforeMessageSending (порт tweb pendingByRandomId).
    //
    // Аплоад завершился: media_id приклеивается к баблу И ровно здесь кадр,
    // придержанный awaitMedia, уходит на сервер — раньше его слала вкладка вторым
    // вызовом sendMessage.
    async attachPendingMedia(args: { clientMsgId: string; mediaId: number }) {
      emit(messages.attachPendingMedia(args.clientMsgId, args.mediaId))
      const held = awaitingMedia.get(args.clientMsgId)
      if (held) { awaitingMedia.delete(args.clientMsgId); conn.sendMessage({ ...held, mediaId: args.mediaId }) }
      return { ok: true }
    },
    // Аплоад сорвался/отменён: бабл остаётся с красной пометкой, придержанный
    // кадр выбрасываем — отправлять нечего (переотправку решает пользователь).
    async failPending(args: { clientMsgId: string }) {
      awaitingMedia.delete(args.clientMsgId)
      return emit(messages.failPendingMessage(args.clientMsgId))
    },
    // «Повторить» на упавшем бабле: снимаем пометку ошибки — сам кадр вкладка
    // шлёт следом обычным sendMessage (бабл уже есть, optimistic не передаётся).
    async retryPending(args: { clientMsgId: string }) { return emit(messages.retryPendingMessage(args.clientMsgId)) },
    // Отмена аплоада с бабла / «удалить» на упавшем: бабл уходит из окна.
    async cancelPending(args: { clientMsgId: string }) {
      awaitingMedia.delete(args.clientMsgId)
      return emit(messages.cancelPendingMessage(args.clientMsgId))
    },
    async sendTyping(args: { chatId: number; action?: TypingAction }) { conn.sendTyping(args.chatId, args.action ?? 'typing'); return { ok: true } },
    async sendCallFrame(args: { type: string; data: Record<string, unknown> }) { conn.sendCallFrame(args.type, args.data); return { ok: true } },
    // Подписка на канал = вход в per-channel funnel: подписаться на топик (живые
    // кадры) + open (сид курсора из IDB и добор пропущенного через difference).
    async subscribeChannel(args: { chatId: number }) { conn.subscribeChannel(args.chatId); void channelFunnel.open(args.chatId); return { ok: true } },
    async unsubscribeChannel(args: { chatId: number }) { conn.unsubscribeChannel(args.chatId); channelFunnel.close(args.chatId); return { ok: true } },
  }
}
