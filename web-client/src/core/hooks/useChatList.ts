// Маппинг диалогов в Chat[] для сайдбара с per-dialog ref-кэшем: возвращаем ТУ ЖЕ
// ссылку на Chat, если его JSON-представление не изменилось — обновление dialogs
// (например markRead одного чата) создаёт новый объект только для изменившейся
// строки, и memo(ChatListItem) пропускает перерисовку всех остальных.
// ВАЖНО: стабильность ссылок критична для FPS списка — логику не менять.
import { useMemo, useRef } from 'react'
import type { Chat } from '../../data'
import { useChatsStore } from '../../stores/chatsStore'
import { useDrafts } from '../../stores/draftsStore'
import { useNotifyStore, isDialogMuted } from '../../stores/notifyStore'
import { dialogToChat } from '../dialogToChat'

export function useChatList(): Chat[] {
  const dialogs = useChatsStore((s) => s.dialogs)
  const meId = useChatsStore((s) => s.meId)
  const notifySettings = useNotifyStore((s) => s.settings)
  const draftsByChat = useDrafts()
  const chatCacheRef = useRef<Map<number, { json: string; chat: Chat }>>(new Map())

  return useMemo<Chat[]>(() => {
    const cache = chatCacheRef.current
    const seen = new Set<number>()
    const next = dialogs.map((d) => {
      let chat = dialogToChat(d, meId, draftsByChat[d.chatId])
      // Глобально выключенный тип чатов показывается как muted (tweb
      // isPeerLocalMuted с respectType): иконка + серый badge у всех таких чатов.
      // Само правило — одно на всё приложение (stores/notifyStore.ts::isDialogMuted,
      // пин stores/noDuplicateMuteRule.test.ts); здесь только его применение.
      if (!chat.muted && isDialogMuted(d, notifySettings)) chat = { ...chat, muted: true }
      seen.add(d.chatId)
      const json = JSON.stringify(chat)
      const hit = cache.get(d.chatId)
      if (hit && hit.json === json) return hit.chat // value-identical → reuse ref
      cache.set(d.chatId, { json, chat })
      return chat
    })
    for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k)
    return next
  }, [dialogs, meId, notifySettings, draftsByChat])
}
