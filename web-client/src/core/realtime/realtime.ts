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

type Conn = ReturnType<typeof newConnectionManager>

export interface RealtimeDeps {
  conn: Conn
  tokens: { load(): Promise<unknown> }
  messages: { cacheMediaRead(p: { chat_id: number; msg_id: number }): void }
  broadcast: (event: string, payload: unknown) => void
  channelFunnel: ChannelFunnel
}

export function newRealtime({ conn, tokens, messages, broadcast, channelFunnel }: RealtimeDeps) {
  return {
    async start() { await tokens.load(); conn.start(); return { state: conn.state() } },
    async sendMessage(args: SendArgs) { conn.sendMessage(args); return { ok: true } },
    async markRead(args: { chatId: number; upToSeq: number }) { conn.markRead(args.chatId, args.upToSeq); return { ok: true } },
    async markMediaRead(args: { chatId: number; msgId: number }) {
      // Локально гасим точку media_unread в SSOT + эхо всем вкладкам (у отправителя
      // точка гаснет по его серверному media_read-кадру), затем шлём read_media серверу.
      messages.cacheMediaRead({ chat_id: args.chatId, msg_id: args.msgId })
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
