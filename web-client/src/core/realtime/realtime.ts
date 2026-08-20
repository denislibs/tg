// src/core/realtime/realtime.ts
//
// Фабрика realtime-менеджера. Раньше это был инлайн-объект в worker.ts с
// вручную продублированным контрактом в bootstrap.ts (RealtimeApi) — источник
// дрейфа (одна из копий уже теряла geo/contactUserId/threadRootId). Теперь это
// обычная фабрика, как остальные менеджеры: тип выводится из ReturnType и
// подхватывается в реестре воркера (WorkerRegistry) → UI-тип Managers.realtime
// генерится автоматически, ручной RealtimeApi больше не нужен.
//
// ОТПРАВКИ СООБЩЕНИЙ ЗДЕСЬ БОЛЬШЕ НЕТ. Она переехала к владельцу окна —
// `messages.sendText` / `messages.sendFile` (core/managers/messages/pending.ts),
// как в tweb, где `beforeMessageSending` заканчивается вызовом `message.send()`
// внутри самого appMessagesManager. Транспорт (`conn.sendMessage`) приходит туда
// инъекцией при сборке (workerCore.ts), поэтому кольца импортов не возникает.
// Здесь остались только то, что и правда про соединение: старт, статус,
// read-маркеры, typing, подписка на каналы.

import type { newConnectionManager } from './connectionManager'
import type { ChannelFunnel } from './channelFunnel'
import { RT, type TypingAction } from './events'
import type { MessageOp } from './messageOps'
import { getServerMessageId } from '../history/messageId'

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
  messages: {
    cacheMediaRead(p: { peer_id: number; id: number }): MessageOp[]
  }
  broadcast: (event: string, payload: unknown) => void
  channelFunnel: ChannelFunnel
}

export function newRealtime({ conn, sync, tokens, messages, broadcast, channelFunnel }: RealtimeDeps) {
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
    // Горизонт чтения уходит на сервер СЕРВЕРНЫМ номером — как и всё остальное,
    // что покидает клиентское пространство (core/history/messageId.ts).
    async markRead(args: { peerId: number; upToId: number }) { conn.markRead(args.peerId, getServerMessageId(args.upToId)); return { ok: true } },
    async markMediaRead(args: { peerId: number; msgId: number }) {
      // Локально гасим точку media_unread в SSOT + рассылаем операции всем вкладкам
      // (окно теперь правит ТОЛЬКО applyOps(RT.messageOp) — сырой rt:media_read
      // проектор больше не слушает), затем шлём read_media серверу (у отправителя
      // точка гаснет по его серверному media_read-кадру).
      // ГРАНИЦА: наружу (кадр серверу и его же форма в broadcast) уходит
      // СЕРВЕРНЫЙ номер, внутрь SSOT — клиентский.
      const serverId = getServerMessageId(args.msgId)
      const ops = messages.cacheMediaRead({ peer_id: args.peerId, id: serverId })
      if (ops.length) broadcast(RT.messageOp, { ops })
      broadcast(RT.mediaRead, { peer_id: args.peerId, id: serverId })
      conn.markMediaRead(args.peerId, serverId)
      return { ok: true }
    },
    async sendTyping(args: { peerId: number; action?: TypingAction }) { conn.sendTyping(args.peerId, args.action ?? 'typing'); return { ok: true } },
    async sendCallFrame(args: { type: string; data: Record<string, unknown> }) { conn.sendCallFrame(args.type, args.data); return { ok: true } },
    // Подписка на канал = вход в per-channel funnel: подписаться на топик (живые
    // кадры) + open (сид курсора из IDB и добор пропущенного через difference).
    async subscribeChannel(args: { peerId: number }) { conn.subscribeChannel(args.peerId); void channelFunnel.open(args.peerId); return { ok: true } },
    async unsubscribeChannel(args: { peerId: number }) { conn.unsubscribeChannel(args.peerId); channelFunnel.close(args.peerId); return { ok: true } },
  }
}
