// Открыть чат с пиром (участник, автор в группе, строка «Избранного», результат
// поиска) — ЧИСТАЯ функция поверх сторов, без React. Роль оригинала —
// `appImManager.setPeer`, которым `appDialogsManager.setListClickListener`
// (tweb `appDialogsManager.ts:1768`) открывает пира из любого списка.
//
// Вынесено из `core/hooks/useNavigationActions.ts::openPeer` (хук теперь
// делегирует сюда): у Solid-списка «Чаты» правой колонки
// (`components/sidebarRight/savedDialogsTab.solid.tsx`) React-хука нет, а
// вторая копия той же развилки «диалог есть → выбрать, человека без диалога →
// черновик» была бы вторым источником правила навигации.
import type { OpenPeer } from '@/data'
import { useChatsStore, loadPresence } from '@stores/chatsStore'
import { useNavigationStore } from '@stores/navigationStore'
import { isAnyChat } from '@core/peers/peerId'

/** Срез менеджеров: черновик человека без диалога подгружает его присутствие. */
export type OpenPeerManagers = Parameters<typeof loadPresence>[0]

/**
 * Переиспользует существующий приватный диалог; иначе — черновик, который
 * становится реальным чатом лишь после первого сообщения.
 */
export function openPeer(managers: OpenPeerManagers, peer: OpenPeer): void {
  const nav = useNavigationStore.getState()
  const { meId, dialogs } = useChatsStore.getState()
  if (meId != null && peer.id === meId) return // skip self for now
  // Ключ пира И ЕСТЬ ключ диалога: у приватного это id собеседника, у
  // группы/канала `-id`. Прежняя пара `id` + `chatId` описывала одно число
  // двумя, и ветка «диалог уже известен» была отдельной. Черновик бывает
  // только у ЧЕЛОВЕКА — группы/канала без диалога открыть нечем.
  if (isAnyChat(peer.id) || dialogs.some((d) => d.peerId === peer.id)) {
    nav.selectChat(String(peer.id))
    return
  }
  // selectChat кладёт корневой инстанс в chatStackStore (иначе ChatsContainer
  // ничего не отрендерит — с переездом App.tsx на стек он больше НЕ читает
  // draftPeer/selectedId напрямую), но сам обнуляет draftPeer в своём set() —
  // поэтому setDraftPeer идёт ВТОРЫМ, восстанавливая peer уже после него.
  nav.selectChat(`draft:${peer.id}`)
  nav.setDraftPeer(peer)
  void loadPresence(managers, [peer.id])
}
