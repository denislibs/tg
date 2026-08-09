// src/client/realtime/refetchSubscriber.ts
//
// Подписчик REST-рефетчей, инициируемых realtime-событиями. Вынесен из
// storeProjection: проектор пишет ТОЛЬКО стор, а «дорефетчить с сервера» — это
// сеть/команда, отдельная забота (как в tweb: рефетч решают менеджеры-слушатели,
// а не сам updates-manager). Все рефетчи независимы/дебаунснуты — порядок с
// проектором не важен.
import { eventBus } from '../../core/realtime/eventBus'
import { RT, type PinMessageEvt } from '../../core/realtime/events'
import { loadChats } from '../../stores/chatsStore'
import { usePinsStore } from '../../stores/pinsStore'
import { setAppState } from '../../stores/appState'
import type { Managers } from '../bootstrap'

// Дебаунс полного /chats-рефетча: несколько триггеров подряд → один запрос.
function makeChatsReload(managers: Parameters<typeof loadChats>[0]): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) return
    timer = setTimeout(() => { timer = null; void loadChats(managers) }, 300)
  }
}

export function registerRefetchSubscriber(managers: Managers): void {
  const reloadChats = makeChatsReload(managers)

  // Pin/unpin: перечитать пины чата (usePinnedBar читает из стора).
  eventBus.subscribe(RT.pinMessage, (raw) => {
    const e = raw as PinMessageEvt
    void managers.messages.listPins(e.chat_id).then((p) => usePinsStore.getState().setPins(e.chat_id, p))
  })
  // Метаданные чата сменились (title/photo/права/…) → рефетч списка диалогов.
  eventBus.subscribe(RT.chatUpdate, () => { reloadChats() })
  // Папки изменились на другом устройстве/вкладке → перечитать список папок.
  // Папки живут в State, поэтому пишем туда (write-through в персист).
  eventBus.subscribe(RT.folderUpdate, () => {
    void managers.folders.list().then((f) => setAppState('folders', f))
  })
  // Полный resync (too_long) → перезагрузить диалоги.
  eventBus.subscribe('rt:resync', () => { void loadChats(managers) })
}
