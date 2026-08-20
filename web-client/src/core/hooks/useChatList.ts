// Маппинг диалогов в Chat[] для сайдбара с per-dialog ref-кэшем: возвращаем ТУ ЖЕ
// ссылку на Chat, если его JSON-представление не изменилось — обновление dialogs
// (например markRead одного чата) создаёт новый объект только для изменившейся
// строки, и memo(ChatListItem) пропускает перерисовку всех остальных.
// ВАЖНО: стабильность ссылок критична для FPS списка — логику не менять.
import { useMemo, useRef, useSyncExternalStore } from 'react'
import type { Chat } from '../../data'
import { useChatsStore } from '../../stores/chatsStore'
import { useDrafts } from '../../stores/draftsStore'
import { useNotifyStore, isDialogMuted } from '../../stores/notifyStore'
import { dialogToChat } from '../dialogToChat'
import { cachedChat, cachedPeer, peerMirrorVersion, subscribePeerMirror } from '../peerCache'
import { usePeers } from './usePeers'

export function useChatList(): Chat[] {
  const dialogs = useChatsStore((s) => s.dialogs)
  const meId = useChatsStore((s) => s.meId)
  const notifySettings = useNotifyStore((s) => s.settings)
  const draftsByChat = useDrafts()
  const chatCacheRef = useRef<Map<number, { json: string; chat: Chat }>>(new Map())
  // Имя, аватарка и вид чата приехали в КАРТОЧКУ ПИРА (векторы chats/users
  // контейнера `/chats`), а не в строку диалога. Значит строка списка зависит
  // от зеркала пиров: подписываемся на его движение (иначе доехавшая позже
  // карточка группы не перерисовала бы строку) и объявляем ему пробел — тем же
  // единственным каналом, что и все прочие читатели (`usePeers`).
  const peersVersion = useSyncExternalStore(subscribePeerMirror, peerMirrorVersion)
  usePeers(useMemo(() => dialogs.map((d) => d.peerId), [dialogs]))

  return useMemo<Chat[]>(() => {
    const cache = chatCacheRef.current
    const seen = new Set<number>()
    const next = dialogs.map((d) => {
      let chat = dialogToChat(d, meId, draftsByChat[d.peerId], cachedPeer)
      // Глобально выключенный тип чатов показывается как muted (tweb
      // isPeerLocalMuted с respectType): иконка + серый badge у всех таких чатов.
      // Само правило — одно на всё приложение (stores/notifyStore.ts::isDialogMuted,
      // пин stores/noDuplicateMuteRule.test.ts); здесь только его применение.
      if (!chat.muted && isDialogMuted(d, cachedChat(d.peerId), notifySettings)) chat = { ...chat, muted: true }
      seen.add(d.peerId)
      const json = JSON.stringify(chat)
      const hit = cache.get(d.peerId)
      if (hit && hit.json === json) return hit.chat // value-identical → reuse ref
      cache.set(d.peerId, { json, chat })
      return chat
    })
    for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k)
    return next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogs, meId, notifySettings, draftsByChat, peersVersion])
}
