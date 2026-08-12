// Глобальные хоткеи (tweb): Ctrl/Cmd+K — фокус в поиск; Esc при пустом стеке
// оверлеев — закрыть чат/тред; Ctrl/Cmd+Shift+M — mute текущего; Ctrl/Cmd+0 —
// «Избранное»; Alt+↑/↓ — циклическая навигация по диалогам. Все колбэки читают
// сторы через getState() → стабильны, поэтому ref-зеркала стейта больше не нужны.
import { useCallback, useEffect } from 'react'
import { useManagers } from './useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { useNavigationStore } from '../../stores/navigationStore'
import { initHotkeys } from '../hotkeys'

export function useAppHotkeys(): void {
  const managers = useManagers()
  // Esc: тред закрывается первым (комментарии → назад к каналу), затем чат.
  const escCloseChat = useCallback(() => {
    const nav = useNavigationStore.getState()
    if (nav.openThread) { nav.closeThread(); return }
    if (nav.selectedId) { nav.setSelectedId(null); nav.setDraftPeer(null) }
  }, [])

  // Task 4 (действия без оптимистики): локальный апдейт применяет владелец
  // (dialogsManager.applyMute) ПОСЛЕ успешного REST-ответа (groupsManager.ts) —
  // как и в ChatListItem/Chat.tsx.
  const muteCurrentChat = useCallback(() => {
    const id = useNavigationStore.getState().selectedId
    if (!id || id.startsWith('draft:')) return
    const chatId = Number(id)
    const dlg = useChatsStore.getState().dialogs.find((d) => d.chatId === chatId)
    if (!dlg) return
    void managers.groups.setMute(chatId, !dlg.muted).catch(() => {})
  }, [managers])

  // Ctrl/Cmd+0 — «Избранное»: тот же путь, что бургер-меню сайдбара.
  const openSaved = useCallback(() => {
    void (async () => {
      const id = await managers.chats.saved()
      await managers.dialogs.refresh()
      useNavigationStore.getState().selectChat(String(id))
    })()
  }, [managers])

  // Alt+↑/↓ — циклическая навигация. Черновики (draft:) в список не входят.
  const cycleChat = useCallback((dir: 1 | -1) => {
    const list = useChatsStore.getState().dialogs
    if (!list.length) return
    const cur = useNavigationStore.getState().selectedId
    const idx = list.findIndex((d) => String(d.chatId) === cur)
    const nextIdx = idx < 0 ? (dir === 1 ? 0 : list.length - 1) : (idx + dir + list.length) % list.length
    useNavigationStore.getState().selectChat(String(list[nextIdx].chatId))
  }, [])

  useEffect(
    () =>
      initHotkeys({
        focusSearch: () => window.dispatchEvent(new Event('tg-focus-search')),
        escFallback: escCloseChat,
        muteChat: muteCurrentChat,
        openSaved,
        nextChat: () => cycleChat(1),
        prevChat: () => cycleChat(-1),
      }),
    [escCloseChat, muteCurrentChat, openSaved, cycleChat],
  )
}
