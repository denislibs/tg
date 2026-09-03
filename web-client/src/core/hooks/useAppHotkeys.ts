// Глобальные хоткеи (tweb): Ctrl/Cmd+K — фокус в поиск; Ctrl/Cmd+Shift+M —
// mute текущего; Ctrl/Cmd+0 — «Избранное»; Alt+↑/↓ — циклическая навигация по
// диалогам. Esc здесь больше не заводится — пока чат открыт, `chatHistory.ts`
// держит на стеке контроллера запись `im`/`chat` ВСЕГДА (задачи 1-2), и её
// `onPop` — та же `closeChatLevel`, которую раньше звал отсюда фолбэк
// `escFallback`; отдельный путь снят вместе с ним (chat-navigation-im-3), как
// у оригинала (`appNavigationController.ts:217-224`: Esc — это `back(item.type)`
// по верхней записи стека, без ветки специально под чат). Все колбэки читают
// сторы через getState() → стабильны, поэтому ref-зеркала стейта больше не нужны.
import { useCallback, useEffect } from 'react'
import { useManagers } from './useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { isPeerMuted } from '../dialogs/notifySettings'
import { useNavigationStore } from '../../stores/navigationStore'
import { initHotkeys } from '../hotkeys'
import { parsePeerId } from '../peers/peerId'

export function useAppHotkeys(): void {
  const managers = useManagers()

  // Task 4 (действия без оптимистики): локальный апдейт применяет владелец
  // (dialogsManager.applyNotifySettings) ПОСЛЕ успешного REST-ответа (groupsManager.ts) —
  // как и в ChatListItem/Chat.tsx.
  const muteCurrentChat = useCallback(() => {
    const id = useNavigationStore.getState().selectedId
    if (!id || id.startsWith('draft:')) return
    const peerId = parsePeerId(id)
    const dlg = useChatsStore.getState().dialogs.find((d) => d.peerId === peerId)
    if (!dlg) return
    void managers.groups.setMute(peerId, !isPeerMuted(dlg.notify_settings, Math.floor(Date.now() / 1000))).catch(() => {})
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
    const idx = list.findIndex((d) => String(d.peerId) === cur)
    const nextIdx = idx < 0 ? (dir === 1 ? 0 : list.length - 1) : (idx + dir + list.length) % list.length
    useNavigationStore.getState().selectChat(String(list[nextIdx].peerId))
  }, [])

  useEffect(
    () =>
      initHotkeys({
        focusSearch: () => window.dispatchEvent(new Event('tg-focus-search')),
        muteChat: muteCurrentChat,
        openSaved,
        nextChat: () => cycleChat(1),
        prevChat: () => cycleChat(-1),
      }),
    [muteCurrentChat, openSaved, cycleChat],
  )
}
