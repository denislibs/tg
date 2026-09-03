// Синхронизация URL-хэша с открытым чатом: направление «хэш → стор» (Phase A
// роутинга, в духе tweb Web K: #@username / #<peerId>). На загрузке и popstate
// читает хэш и открывает чат (без восстановления ветки треда — для неё нужны
// метаданные топика).
//
// Направление «стор → хэш» отсюда уехало в `core/navigation/chatHistory.ts`
// (`startChatHistory`): та сторона пишет хэш НА МЕСТЕ через
// `appNavigationController.overrideHash`, а не собственным `history.pushState`
// — смена чата не создаёт запись истории, как в оригинале (снятие ОСТАТКА
// #108, см. докблок `chatHistory.ts`).
//
// Phase A охватывает слой ЧАТА (шаринг ссылки, восстановление после reload).
// Оверлеи (попапы/панели/поиск) через Back — это Phase B (navigationController).
import { useEffect } from 'react'
import { useManagers } from './useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { useNavigationStore } from '../../stores/navigationStore'
import appNavigationController from '../navigation/appNavigationController'
import { parseNavHash, requestMessageJump } from '../messageLink'
import { getPeerPhotoId, peerKey } from '../peers/peer'
import { cachedChat } from '../peerCache'
import { getUserTitle } from '../peers/getPeerTitle'
import type { Managers } from '../../client/bootstrap'

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
    const known = useChatsStore.getState().dialogs.find((d) => {
      const chat = cachedChat(d.peerId)
      return chat?._ === 'channel' && chat.username?.toLowerCase() === username
    })
    if (known) { openAt(known.peerId); return }
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
  // хэш → стор: первичное применение + смена хэша, дошедшая до контроллера
  // навигации (он единственный владелец popstate). `onHashChange` — ручка
  // самого оригинала (`appNavigationController.ts:41`, `appImManager.ts:317`
  // ставит туда свой обработчик): контроллер зовёт её, когда пришедший
  // popstate поменял ХЭШ, а не снял запись навигации.
  useEffect(() => {
    const apply = () => { void applyHash(location.hash, managers) }
    apply()
    appNavigationController.onHashChange = apply
  }, [managers])
}
