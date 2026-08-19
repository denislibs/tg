// src/client/realtime/refetchSubscriber.ts
//
// Подписчик REST-рефетчей, инициируемых realtime-событиями. Вынесен из
// storeProjection: проектор пишет ТОЛЬКО стор, а «дорефетчить с сервера» — это
// сеть/команда, отдельная забота (как в tweb: рефетч решают менеджеры-слушатели,
// а не сам updates-manager). Все рефетчи независимы/дебаунснуты — порядок с
// проектором не важен.
import rootScope from '@lib/rootScope'
import { RT, type PinMessageEvt } from '../../core/realtime/events'
import { useChatsStore } from '../../stores/chatsStore'
import { usePinsStore } from '../../stores/pinsStore'
import { applyFolderUpdate, type FolderUpdateEvt } from '../../stores/foldersStore'
import type { Managers } from '../bootstrap'

// Дебаунс полного /chats-рефетча: несколько триггеров подряд → один запрос.
// Единственный на модуль (а не замыкание внутри registerRefetchSubscriber) —
// storeProjection.ts дёргает тот же таймер на свои триггеры (сообщение в
// неизвестный чат / входящий secret-запрос), иначе у двух зон были бы два
// независимых 300мс-таймера на один и тот же рефетч (было так до задачи T3
// стадии 1C.1 — два триггера в одном окне давали два параллельных /chats).
// Task 6 (перенос владения диалогами): рефетч теперь — `managers.dialogs.
// refresh()` (владелец списка), не `loadChats` (диалоговая половина которого
// снесена).
let chatsReloadTimer: ReturnType<typeof setTimeout> | null = null
export function scheduleChatsReload(managers: Pick<Managers, 'dialogs'>): void {
  if (chatsReloadTimer) return
  chatsReloadTimer = setTimeout(() => {
    chatsReloadTimer = null
    // `.catch` (Minor #3 финального ревью): дебаунснутый fire-and-forget, а
    // refresh() пробрасывает HttpError — иначе 401/5xx = unhandled rejection.
    void managers.dialogs.refresh().catch(() => {})
  }, 300)
}

// Только для тестов: сбросить модульный таймер между кейсами. Состояние модуля
// переживает между it()-блоками одного файла (один и тот же модуль-синглтон),
// а vi.useRealTimers() в afterEach не отменяет незавершённый fake-таймер сам —
// без явного сброса следующий кейс молча получил бы chatsReloadTimer !== null
// от прошлого и его первый триггер был бы проглочен.
export function __resetChatsReloadTimerForTests(): void {
  if (chatsReloadTimer) clearTimeout(chatsReloadTimer)
  chatsReloadTimer = null
}

export function registerRefetchSubscriber(managers: Managers): void {
  // Pin/unpin: перечитать пины чата (usePinnedBar читает из стора).
  rootScope.addEventListener(RT.pinMessage, (raw) => {
    const e = raw as PinMessageEvt
    void managers.messages.listPins(e.peer_id).then((p) => usePinsStore.getState().setPins(e.peer_id, p))
  })
  // Метаданные чата сменились (title/photo/права/участники/…). Бэкенд шлёт
  // АБСОЛЮТНЫЙ снимок (backend chat_update.go:18-42). Карточка чата (число
  // участников, права, настройки) грузится отдельно (useChatInfoCard) и из
  // /chats не приходила.
  //
  // Task 3 (перенос владения диалогами): слияние снимка в уже известный диалог
  // (applyChatMeta) теперь делает владелец — workerCore.ts::dispatch зовёт
  // dialogs.applyChatMeta(e) РАНЬШЕ, чем этот сырой кадр вообще доезжает сюда
  // (см. комментарий у dispatch), и публикует rt:dialog_op сам. Здесь остаётся
  // только вторая ветка, которую владелец решить не может: чата ещё НЕТ в
  // списке — меня только что добавили в группу (group.go:145-151 — AddMember →
  // publishChatUpdate), и единственный способ узнать про новый диалог у нас —
  // /chats. Тогда, и только тогда, дебаунснутый рефетч. Раньше он уходил на
  // КАЖДЫЙ chat_update, а publishChatUpdate зовётся из 13 мест бэкенда — и
  // рефетч прилетал каждому участнику чата.
  rootScope.addEventListener(RT.chatUpdate, (evt) => {
    if (!useChatsStore.getState().dialogs.some((d) => d.peerId === evt.peer_id)) {
      scheduleChatsReload(managers)
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
  rootScope.addEventListener('rt:resync', () => { void managers.dialogs.refresh().catch(() => {}) }) // .catch — см. Minor #3 выше
}
