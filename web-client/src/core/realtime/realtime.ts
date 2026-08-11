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
// connectionManager) — три копии аргументов схлопываются в одну.

import type { newConnectionManager } from './connectionManager'
import type { SendArgs } from './connectionManager'
import type { ChannelFunnel } from './channelFunnel'
import { RT, type TypingAction, type PendingNewEvt } from './events'
import type { MessageOp } from './messageOps'

type Conn = ReturnType<typeof newConnectionManager>

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
  messages: { cacheMediaRead(p: { chat_id: number; msg_id: number }): MessageOp[] }
  broadcast: (event: string, payload: unknown) => void
  channelFunnel: ChannelFunnel
}

export function newRealtime({ conn, sync, tokens, messages, broadcast, channelFunnel }: RealtimeDeps) {
  return {
    async start() { await tokens.load(); conn.start(); return { state: conn.state() } },
    // ЕДИНСТВЕННЫЙ источник правды о состоянии соединения — модель 1:1 с tweb, не
    // разовый снапшот. У tweb (connectionStatus.ts:86-89) компонент на КАЖДОЕ
    // событие 'connection_status_change' тянет getConnectionStatus() и читает
    // состояние ОТТУДА, а не из payload события — плюс отдельный стартовый pull по
    // INITIAL_DELAY (:66-69), если события ещё не было. Событие там — лишь «что-то
    // изменилось, дёрни pull», значение всегда приходит запросом.
    //
    // У нас то же самое: RT.state/RT.stateSynchronizing/synchronized (rootScope.ts)
    // остаются событиями-УВЕДОМЛЕНИЯМИ (автомату нужно знать МОМЕНТ изменения), но
    // их payload — не источник правды и не должен читаться напрямую; при получении
    // любого из них следует звать getStatus() и брать значение оттуда. Это делает
    // модель иммунной к потере события by construction: SuperMessagePort не
    // буферизует кадры, а `smp.on(...)` вешается в realtimeBridge из эффекта, ПОСЛЕ
    // первого рендера — ранние события физически теряются (тот же класс дыры, что
    // у loadChats vs push для `me`). Пропущенное уведомление не страшно: следующее
    // всё равно дёрнет актуальный pull; если не было ни одного — see примечание
    // Задаче 3 про стартовый INITIAL_DELAY-pull (tweb connectionStatus.ts:66-69).
    //
    // Осознанное отступление от tweb: там карта статусов живёт в ВОРКЕРНОМ rootScope
    // (rootScope.ts:254 `connectionStatus`, ключ `'NET-'+baseDcId` — у них
    // мультидатацентровость MTProto), у нас источник — connectionManager (`state`+
    // `lastRetryAt`) и syncEngine (`isSyncing()`), потому что состояние соединения
    // у нас изначально там и живёт, а мультидатацентровости нет (одно WS-соединение
    // → плоский объект, без карты по DC). Форма (pull из воркера через RPC) та же,
    // владелец другой — сверяющий не должен читать это как расхождение с оригиналом.
    async getStatus() { return { state: conn.state(), retryAt: conn.retryAt(), syncing: sync.isSyncing() } },
    async sendMessage(args: SendArgs) { conn.sendMessage(args); return { ok: true } },
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
    // Оптимистичный бабл отправки: воркер — funnel жизненного цикла, бродкастит эхо
    // всем вкладкам → storeProjection (единственный писатель окна). Транспорт (outbox)
    // и reconcile ack/err — прежним путём (conn), ack/err воркер обогащает маршрутом.
    async appendPending(p: PendingNewEvt) { broadcast(RT.pendingNew, p); return { ok: true } },
    async attachPendingMedia(args: { chatId: number; threadRootId?: number | null; clientMsgId: string; mediaId: number }) { broadcast(RT.pendingMedia, { chat_id: args.chatId, thread_root_id: args.threadRootId ?? null, client_msg_id: args.clientMsgId, media_id: args.mediaId }); return { ok: true } },
    async failPending(args: { chatId: number; threadRootId?: number | null; clientMsgId: string }) { broadcast(RT.pendingFail, { chat_id: args.chatId, thread_root_id: args.threadRootId ?? null, client_msg_id: args.clientMsgId }); return { ok: true } },
    async retryPending(args: { chatId: number; threadRootId?: number | null; clientMsgId: string }) { broadcast(RT.pendingRetry, { chat_id: args.chatId, thread_root_id: args.threadRootId ?? null, client_msg_id: args.clientMsgId }); return { ok: true } },
    async removePending(args: { chatId: number; threadRootId?: number | null; clientMsgId: string }) { broadcast(RT.pendingRemove, { chat_id: args.chatId, thread_root_id: args.threadRootId ?? null, client_msg_id: args.clientMsgId }); return { ok: true } },
    async sendTyping(args: { chatId: number; action?: TypingAction }) { conn.sendTyping(args.chatId, args.action ?? 'typing'); return { ok: true } },
    async sendCallFrame(args: { type: string; data: Record<string, unknown> }) { conn.sendCallFrame(args.type, args.data); return { ok: true } },
    // Подписка на канал = вход в per-channel funnel: подписаться на топик (живые
    // кадры) + open (сид курсора из IDB и добор пропущенного через difference).
    async subscribeChannel(args: { chatId: number }) { conn.subscribeChannel(args.chatId); void channelFunnel.open(args.chatId); return { ok: true } },
    async unsubscribeChannel(args: { chatId: number }) { conn.unsubscribeChannel(args.chatId); channelFunnel.close(args.chatId); return { ok: true } },
  }
}
