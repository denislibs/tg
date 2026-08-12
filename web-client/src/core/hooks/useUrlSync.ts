// Синхронизация URL-хэша с открытым чатом (Phase A роутинга, в духе tweb Web K:
// #@username / #<chatId> / #<chatId>_<threadRoot>). Двунаправленно:
//   стор → хэш: смена selectedId/openThread пишет history.pushState (Back браузера
//               возвращает к предыдущему чату/списку);
//   хэш → стор: на загрузке и popstate читает хэш и открывает чат.
// Защита от петли: suppressRef на время применения хэша, readyRef чтобы первый
// проход «стор→хэш» не затёр входящий хэш до его применения.
//
// Phase A охватывает слой ЧАТА (шаринг ссылки, восстановление после reload, Back
// между чатами). Оверлеи (попапы/панели/поиск) через Back — это Phase B
// (navigationController). Тред восстанавливается до уровня чата (без самой ветки —
// для неё нужны метаданные топика).
import { useEffect, useRef } from 'react'
import { useManagers } from './useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { useNavigationStore } from '../../stores/navigationStore'
import { setBaseHandler } from '../navigation/navigationStack'
import type { Managers } from '../../client/bootstrap'

// Хэш для текущего состояния навигации (без ведущего #). '' — список чатов.
function hashForState(): string {
  const nav = useNavigationStore.getState()
  if (nav.openThread) return `${nav.openThread.chatId}_${nav.openThread.thread.rootMsgId}`
  const id = nav.selectedId
  if (!id) return ''
  if (id.startsWith('draft:')) {
    // Черновик без диалога: делимся по @username, если он есть; иначе не пишем.
    return nav.draftPeer?.username ? `@${nav.draftPeer.username}` : ''
  }
  // Публичный чат/канал/группа с username → #@username (шарибельно, как tweb);
  // иначе числовой id (private-чаты username в диалоге не несут).
  const dlg = useChatsStore.getState().dialogs.find((d) => String(d.chatId) === id)
  return dlg?.username ? `@${dlg.username}` : id
}

// Применить хэш к навигации. Публичный @username, которого нет в диалогах,
// резолвим директорией (channels.search): чат → вступить+открыть, юзер → черновик.
async function applyHash(rawHash: string, managers: Managers): Promise<void> {
  const h = rawHash.replace(/^#/, '')
  const nav = useNavigationStore.getState()
  if (!h) { nav.selectChat(null); return }

  if (h.startsWith('@')) {
    const username = h.slice(1).toLowerCase()
    const dlg = useChatsStore.getState().dialogs.find((d) => d.username?.toLowerCase() === username)
    if (dlg) { nav.selectChat(String(dlg.chatId)); return }
    try {
      const res = await managers.channels.search(username)
      const chat = res.chats.find((c) => c.username.toLowerCase() === username)
      if (chat) {
        try { await managers.channels.join(chat.username) } catch { /* уже вступил / приватный */ }
        await managers.dialogs.refresh()
        useNavigationStore.getState().selectChat(String(chat.id))
        return
      }
      const user = res.users.find((u) => u.username.toLowerCase() === username)
      if (user) {
        nav.setDraftPeer({ id: user.id, displayName: user.displayName, username: user.username, avatarUrl: user.avatarUrl })
        nav.setSelectedId(`draft:${user.id}`)
      }
    } catch { /* директория недоступна — оставляем список */ }
    return
  }

  // #<chatId> или #<chatId>_<threadRoot> — открываем чат (ветку в Phase A не восстанавливаем).
  const m = h.match(/^(\d+)(?:_\d+)?$/)
  if (m) nav.selectChat(m[1])
}

export function useUrlSync(): void {
  const managers = useManagers()
  const selectedId = useNavigationStore((s) => s.selectedId)
  const openThread = useNavigationStore((s) => s.openThread)
  const suppressRef = useRef(false)
  const readyRef = useRef(false)

  // хэш → стор: первичное применение + Back, когда стек оверлеев пуст (базовый
  // слой navigationStack — единственного владельца popstate).
  useEffect(() => {
    const apply = () => {
      suppressRef.current = true
      void applyHash(location.hash, managers).finally(() => {
        suppressRef.current = false
        readyRef.current = true
      })
    }
    apply()
    setBaseHandler(apply)
  }, [managers])

  // стор → хэш: push нового адреса при навигации пользователя.
  useEffect(() => {
    if (!readyRef.current || suppressRef.current) return
    const want = hashForState()
    const cur = location.hash.replace(/^#/, '')
    if (want === cur) return
    const url = want ? `#${want}` : location.pathname + location.search
    history.pushState(null, '', url)
  }, [selectedId, openThread])
}
