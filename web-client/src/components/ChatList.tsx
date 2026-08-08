// src/components/ChatList.tsx
// The sidebar's dialog list: the scroll container + the folder-switch slide
// animation + the mapped rows. Extracted from Sidebar and memoized so Sidebar's
// own transient state (stories fold/reveal on scroll, overlay toggles) doesn't
// re-render the list. The scroll container ref is forwarded back to Sidebar, which
// owns the fold/reveal scroll listeners.
import { forwardRef, memo } from 'react'
import classNames from '../shared/lib/classNames'
import { TabSlide } from '../shared/ui/Tabs'
import ChatListItem from './ChatListItem'
import ArchiveRow from './ArchiveRow'
import DialogSkeleton from './DialogSkeleton'
import type { Chat } from '../data'
import s from './ChatList.module.scss'

export interface ChatListProps {
  chats: Chat[] // already filtered by folder
  selectedId: string
  onSelect: (id: string) => void
  loaded: boolean
  folder: number // id выбранной папки (0 = «Все чаты»)
  folderOrder: readonly number[] // порядок табов для направления слайда
  /** архивные чаты (только в папке «Все») → псевдо-закреплённый ряд «Архив» сверху */
  archived?: Chat[]
  onOpenArchive?: () => void
  /** свёрнуть список в узкую колонку аватаров (открыта панель форум-тем, tweb .is-collapsed) */
  collapsed?: boolean
}

const ChatList = forwardRef<HTMLDivElement, ChatListProps>(function ChatList(
  { chats, selectedId, onSelect, loaded, folder, folderOrder, archived, onOpenArchive, collapsed },
  ref,
) {
  return (
    // tweb appDialogsManager.setFilterId → `scrollable.container.classList.add(
    // 'tabs-tab', 'chatlist-parts', 'folders-scrollable')` внутри #folders-container.
    // Геометрию и скроллбар даёт `.scrollable.scrollable-y` (_scrollable.scss),
    // верхний отступ под оверлеем табов — `padding-top: var(--chatlist-overlay-height)`
    // у `.folders-scrollable` (_leftSidebar.scss:418).
    //
    // Отступление: в tweb на КАЖДУЮ папку свой .folders-scrollable (свой scrollTop,
    // слайд даёт .tabs-container). У нас один контейнер + TabSlide внутри — список
    // не виртуализирован, N копий по M строк не потянуть (см. бэклог виртуализации).
    <div
      ref={ref}
      className={classNames(
        'scrollable', 'scrollable-y', 'tabs-tab', 'chatlist-parts', 'folders-scrollable', 'active',
        s.scroll, collapsed ? s.collapsed : '',
      )}
    >
      <TabSlide tab={folder} order={folderOrder} className={s.slide}>
        {loaded && !collapsed && archived != null && archived.length > 0 && onOpenArchive && (
          <ArchiveRow chats={archived} onOpen={onOpenArchive} />
        )}
        {loaded ? (
          /* tweb: строки лежат в `ul.chatlist` — от неё наследуется половина правил
             ряда (`.user-title { display: flex }`, цвета статуса/бейджей,
             `.dialog-subtitle` и т.д., _chatlist.scss). Без неё заголовок был
             блочным и галочка верификации переносилась на вторую строку. */
          <ul className="chatlist">
            {chats.map((chat, i) => (
              <ChatListItem
                key={chat.id}
                chat={chat}
                index={i}
                selected={chat.id === selectedId}
                onSelect={onSelect}
                collapsed={collapsed}
              />
            ))}
          </ul>
        ) : (
          <DialogSkeleton />
        )}
      </TabSlide>
    </div>
  )
})

export default memo(ChatList)
