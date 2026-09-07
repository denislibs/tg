// Действия навигации, которым нужны managers (открыть/создать приватный чат,
// вступить в публичный канал, субтитр темы). Чистые useCallback БЕЗ эффектов —
// поэтому хук безопасно звать в любом View (Sidebar/Chat), а не только
// в Shell. Состояние навигации при этом читается из navigationStore напрямую.
import { useCallback } from 'react'
import type { TopicRow } from '../managers/groupsManager'
import type { OpenPeer } from '../../data'
import { useManagers } from './useManagers'
import { useNavigationStore } from '../../stores/navigationStore'
import { useChatStackStore } from '../../stores/chatStackStore'
import { peerTitle } from '../peerCache'
import { openPeer as openPeerPlain } from '../navigation/openPeer'

export function useNavigationActions() {
  const managers = useManagers()

  // Форум-топик в tweb остаётся инстансом `chat` с threadId (chat.ts:894) —
  // кладём его поверх стека (tweb setInnerPeer). Субтитр темы (имя группы)
  // готовим здесь, чтобы chatStackStore не импортировал chatsStore.
  //
  // (Fix ревью Task 5, Critical.) `useForumPanel.handleSelect` зовёт этот путь
  // «с чистого листа» — форум в списке чатов НЕ выбран (клик по форуму открывает
  // панель тем локальным стейтом Sidebar, минуя `selectChat`). Без корня стек
  // получал бы РОВНО один элемент (саму тему) — `selectedId` оставался бы `null`
  // (нет подсветки в сайдбаре, `#column-center` уезжает офскрин на узких
  // экранах), а `selectOpenThreadDesc`/`closeTop()` требуют глубины > 1, так что
  // подсветка темы, хэш и кнопка «назад» в шапке треда молча не работали бы.
  // Поэтому сначала — тем же путём, что и обычный выбор чата из списка —
  // ставим корень форума (`selectChat` заодно выставляет `selectedId`), и лишь
  // затем кладём тему поверх (`setInnerPeer`).
  const openTopicThread = useCallback((peerId: PeerId, topic: TopicRow) => {
    // Заголовок форума — из карточки чата (зеркало пиров), а не из строки
    // диалога: `title` с провода `/chats` ушёл в вектор `chats` контейнера.
    const subtitle = peerTitle(peerId) || undefined
    useNavigationStore.getState().selectChat(String(peerId))
    useChatStackStore.getState().setInnerPeer({
      peerId,
      threadId: topic.rootMsgId,
      type: 'chat',
      thread: {
        rootMsgId: topic.rootMsgId, title: topic.title, subtitle,
        iconColor: topic.iconColor, closed: topic.closed, topicId: topic.id, kind: 'topic',
      },
    })
  }, [])

  // Открыть чат с пользователем (участник, автор в группе, результат поиска).
  // Само правило («диалог есть → выбрать, человека без диалога → черновик»)
  // живёт в `core/navigation/openPeer.ts` — им же пользуется Solid-список
  // «Чаты» правой колонки, у которого React-хука нет.
  const openPeer = useCallback((peer: OpenPeer) => openPeerPlain(managers, peer), [managers])

  // Первое сообщение в черновике создало реальный чат: обновить список и открыть.
  const onChatCreated = useCallback((peerId: PeerId) => {
    // selectChat сам обнуляет draftPeer и переключает chatStackStore на новый
    // peerId реального чата — иначе после первого сообщения колонка осталась бы
    // показывать инстанс черновика (draft-запись стека).
    useNavigationStore.getState().selectChat(String(peerId))
    // `.catch` (Minor #3 финального ревью): fire-and-forget вызов, а refresh()
    // пробрасывает HttpError — без него 401/5xx даёт unhandled rejection.
    void managers.dialogs.refresh().catch(() => {})
  }, [managers])

  // Клик по «похожему каналу»: вступаем по @username и открываем.
  const openPublicChannel = useCallback(async (peerId: PeerId, username: string) => {
    if (username) {
      try { await managers.channels.join(username) } catch { /* уже вступил / приватный — просто откроем */ }
    }
    await managers.dialogs.refresh()
    useNavigationStore.getState().selectChat(String(peerId))
  }, [managers])

  return { openTopicThread, openPeer, onChatCreated, openPublicChannel }
}
