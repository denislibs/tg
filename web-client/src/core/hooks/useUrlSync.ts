// Синхронизация URL-хэша с открытым чатом (Phase A роутинга, в духе tweb Web K:
// #@username / #<peerId> / #<peerId>_<threadRoot>). Двунаправленно:
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
import { useChatStackStore, selectOpenThreadDesc } from '../../stores/chatStackStore'
import { setBaseHandler } from '../navigation/navigationStack'
import { parseNavHash, requestMessageJump } from '../messageLink'
import { getPeerPhotoId, peerKey } from '../peers/peer'
import { getUserTitle } from '../peers/getPeerTitle'
import type { Managers } from '../../client/bootstrap'

// Хэш для текущего состояния навигации (без ведущего #). '' — список чатов.
function hashForState(): string {
  const nav = useNavigationStore.getState()
  const openThread = selectOpenThreadDesc(useChatStackStore.getState())
  if (openThread) return `${openThread.peerId}_${openThread.thread.rootMsgId}`
  const id = nav.selectedId
  if (!id) return ''
  if (id.startsWith('draft:')) {
    // Черновик без диалога: делимся по @username, если он есть; иначе не пишем.
    return nav.draftPeer?.username ? `@${nav.draftPeer.username}` : ''
  }
  // Публичный чат/канал/группа с username → #@username (шарибельно, как tweb);
  // иначе числовой id (private-чаты username в диалоге не несут).
  const dlg = useChatsStore.getState().dialogs.find((d) => String(d.peerId) === id)
  return dlg?.username ? `@${dlg.username}` : id
}

// Применить хэш к навигации. Публичный @username, которого нет в диалогах,
// резолвим директорией (channels.search): чат → вступить+открыть, юзер → черновик.
export async function applyHash(rawHash: string, managers: Managers): Promise<void> {
  const nav = useNavigationStore.getState()
  if (!rawHash.replace(/^#/, '')) { nav.selectChat(null); return }

  const parsed = parseNavHash(rawHash)
  if (!parsed) return

  // Прыжок к сообщению ставится ДО открытия чата: лента потребляет pendingJump
  // при монтировании (тот же путь, что переход из поиска).
  const openAt = (peerId: PeerId | string) => {
    if (parsed.seq != null) requestMessageJump(Number(peerId), parsed.seq)
    nav.selectChat(String(peerId))
  }

  if (parsed.target.startsWith('@')) {
    const username = parsed.target.slice(1).toLowerCase()
    const dlg = useChatsStore.getState().dialogs.find((d) => d.username?.toLowerCase() === username)
    if (dlg) { openAt(dlg.peerId); return }
    try {
      const res = await managers.channels.search(username)
      // Публичное имя есть только у `channel` (у базового `chat` его в схеме
      // нет вовсе, и мы такой не производим) — поэтому ветвление по
      // конструктору, а не по полю строки-витрины.
      const chat = res.chats.find((c) => c._ === 'channel' && c.username?.toLowerCase() === username)
      if (chat?._ === 'channel' && chat.username) {
        try { await managers.channels.join(chat.username) } catch { /* уже вступил / приватный */ }
        await managers.dialogs.refresh()
        // Ключ чата ЗНАКОВЫЙ (`-id`), а `chat.id` внутри конструктора —
        // положительный сырой идентификатор: переход между ними только через
        // `peerKey`.
        const peerId = peerKey(chat)
        if (parsed.seq != null) requestMessageJump(peerId, parsed.seq)
        useNavigationStore.getState().selectChat(String(peerId))
        return
      }
      const user = res.users.find((u) => u.username?.toLowerCase() === username)
      if (user) {
        // selectChat кладёт черновик-инстанс в chatStackStore (см. openPeer в
        // useNavigationActions — та же пара вызовов и тот же порядок: draftPeer
        // восстанавливается ПОСЛЕ selectChat, которая сама его обнуляет).
        nav.selectChat(`draft:${user.id}`)
        nav.setDraftPeer({ id: peerKey(user), title: getUserTitle(user), username: user.username, photoId: getPeerPhotoId(user.photo) || undefined })
      }
    } catch { /* директория недоступна — оставляем список */ }
    return
  }

  // #<peerId>, #<peerId>_<threadRoot> (ветку в Phase A не восстанавливаем)
  // или #<peerId>/<seq> — открываем чат, при наличии якоря прыгаем к сообщению.
  openAt(parsed.target)
}

export function useUrlSync(): void {
  const managers = useManagers()
  const selectedId = useNavigationStore((s) => s.selectedId)
  const openThread = useChatStackStore(selectOpenThreadDesc)
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
