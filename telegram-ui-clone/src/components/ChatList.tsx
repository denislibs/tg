// src/components/ChatList.tsx
// The sidebar's dialog list: the scroll container + the folder-switch slide
// animation + the mapped rows. Extracted from Sidebar and memoized so Sidebar's
// own transient state (stories fold/reveal on scroll, overlay toggles) doesn't
// re-render the list. The scroll container ref is forwarded back to Sidebar, which
// owns the fold/reveal scroll listeners.
import { forwardRef, memo } from 'react'
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
  /** над списком есть оверлей горизонтальных табов → верхний отступ */
  tabsShown: boolean
  /** архивные чаты (только в папке «Все») → псевдо-закреплённый ряд «Архив» сверху */
  archived?: Chat[]
  onOpenArchive?: () => void
}

const ChatList = forwardRef<HTMLDivElement, ChatListProps>(function ChatList(
  { chats, selectedId, onSelect, loaded, folder, folderOrder, tabsShown, archived, onOpenArchive },
  ref,
) {
  return (
    <div ref={ref} className={s.scroll}>
      <TabSlide tab={folder} order={folderOrder} className={tabsShown ? `${s.slide} ${s.withTabs}` : s.slide}>
        {loaded && archived != null && archived.length > 0 && onOpenArchive && (
          <ArchiveRow chats={archived} onOpen={onOpenArchive} />
        )}
        {loaded ? (
          chats.map((chat, i) => (
            <ChatListItem
              key={chat.id}
              chat={chat}
              index={i}
              selected={chat.id === selectedId}
              onSelect={onSelect}
            />
          ))
        ) : (
          <DialogSkeleton />
        )}
      </TabSlide>
    </div>
  )
})

export default memo(ChatList)
