// Глобальные хоткеи (tweb): Ctrl/Cmd+K — фокус в поиск; Esc при пустом стеке
// оверлеев — закрыть чат/тред; Ctrl/Cmd+Shift+M — mute текущего; Ctrl/Cmd+0 —
// «Избранное»; Alt+↑/↓ — циклическая навигация по диалогам. Все колбэки читают
// сторы через getState() → стабильны, поэтому ref-зеркала стейта больше не нужны.
import { useCallback, useEffect } from 'react'
import { useManagers } from './useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { isPeerMuted } from '../dialogs/notifySettings'
import { useNavigationStore } from '../../stores/navigationStore'
import { initHotkeys } from '../hotkeys'
import { parsePeerId } from '../peers/peerId'
import { backChatLevel } from '../navigation/chatHistory'

export function useAppHotkeys(): void {
  const managers = useManagers()
  // Esc, запасной путь (`hotkeys.ts` зовёт `escFallback`, только если ничего
  // не забрало событие раньше — оверлеи со своей записью навигации гасят его
  // в фазе захвата). Пока чат открыт, `chatHistory.ts` держит на стеке
  // контроллера запись `im` (корень) и по одной `chat` на каждый уровень
  // глубже (тред/комментарии) — их же `onKeyDown` в норме перехватывает Esc
  // первым (`appNavigationController.ts:294-301`), эта ветка остаётся
  // подстраховкой на случай, если запись почему-то ещё не успела встать.
  // Какую из двух типов закрывать — решает `backChatLevel` (порт
  // `chat.ts:1628-1632`: `back(isFirstChat ? 'im' : 'chat')`), а ветвление
  // «тред первым, потом чат» — внутри общего `closeChatLevel`
  // (`core/navigation/chatHistory.ts`).
  const escCloseChat = useCallback(() => {
    if (!useNavigationStore.getState().selectedId) return
    backChatLevel()
  }, [])

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
        escFallback: escCloseChat,
        muteChat: muteCurrentChat,
        openSaved,
        nextChat: () => cycleChat(1),
        prevChat: () => cycleChat(-1),
      }),
    [escCloseChat, muteCurrentChat, openSaved, cycleChat],
  )
}
