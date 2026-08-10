// src/client/realtime/refetchSubscriber.ts
//
// Подписчик REST-рефетчей, инициируемых realtime-событиями. Вынесен из
// storeProjection: проектор пишет ТОЛЬКО стор, а «дорефетчить с сервера» — это
// сеть/команда, отдельная забота (как в tweb: рефетч решают менеджеры-слушатели,
// а не сам updates-manager). Все рефетчи независимы/дебаунснуты — порядок с
// проектором не важен.
import rootScope from '@lib/rootScope'
import { RT, type PinMessageEvt } from '../../core/realtime/events'
import { loadChats, useChatsStore } from '../../stores/chatsStore'
import { usePinsStore } from '../../stores/pinsStore'
import { applyFolderUpdate, type FolderUpdateEvt } from '../../stores/foldersStore'
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
  rootScope.addEventListener(RT.pinMessage, (raw) => {
    const e = raw as PinMessageEvt
    void managers.messages.listPins(e.chat_id).then((p) => usePinsStore.getState().setPins(e.chat_id, p))
  })
  // Метаданные чата сменились (title/photo/права/участники/…). Бэкенд шлёт
  // АБСОЛЮТНЫЙ снимок (backend chat_update.go:18-42) — применяем его в уже
  // известный диалог, в сеть не идём. Карточка чата (число участников, права,
  // настройки) грузится отдельно (useChatInfoCard) и из /chats не приходила.
  //
  // Исключение — чата ещё НЕТ в списке: меня только что добавили в группу
  // (group.go:145-151 — AddMember → publishChatUpdate), и единственный способ
  // узнать про новый диалог у нас — /chats. Тогда, и только тогда, дебаунснутый
  // рефетч. Раньше он уходил на КАЖДЫЙ chat_update, а publishChatUpdate зовётся
  // из 13 мест бэкенда — и рефетч прилетал каждому участнику чата.
  rootScope.addEventListener(RT.chatUpdate, (evt) => {
    if (useChatsStore.getState().dialogs.some((d) => d.chatId === evt.chat_id)) {
      useChatsStore.getState().applyChatMeta(evt)
    } else {
      reloadChats()
    }
  })
  // Папки изменились на другом устройстве/вкладке. Бэкенд шлёт АБСОЛЮТНЫЙ снимок
  // папки (backend folders.go:94-102), поэтому в сеть не идём — применяем прямо
  // из события (обоснование, почему одного снимка хватает по `pos`, — в
  // applyFolderUpdate). tweb здесь вынужден перезапрашивать список
  // (filters.ts:167): апдейт MTProto самих фильтров не несёт.
  rootScope.addEventListener(RT.folderUpdate, (raw) => {
    applyFolderUpdate(raw as FolderUpdateEvt)
  })
  // Полный resync (too_long) → перезагрузить диалоги.
  rootScope.addEventListener('rt:resync', () => { void loadChats(managers) })
}
