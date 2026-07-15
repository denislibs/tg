// src/components/ChatList.tsx
// The sidebar's dialog list: the scroll container + the folder-switch slide
// animation + the mapped rows. Extracted from Sidebar and memoized so Sidebar's
// own transient state (stories fold/reveal on scroll, overlay toggles) doesn't
// re-render the list. The scroll container ref is forwarded back to Sidebar, which
// owns the fold/reveal scroll listeners.
import { forwardRef, memo } from 'react'
import { TabSlide } from '../shared/ui/Tabs'
import ChatListItem from './ChatListItem'
import DialogSkeleton from './DialogSkeleton'
import type { Chat } from '../data'
import { FOLDER_ORDER, type FolderKey } from './FolderTabs'
import s from './ChatList.module.scss'

export interface ChatListProps {
  chats: Chat[] // already filtered by folder
  selectedId: string
  onSelect: (id: string) => void
  loaded: boolean
  folder: FolderKey
}

const ChatList = forwardRef<HTMLDivElement, ChatListProps>(function ChatList(
  { chats, selectedId, onSelect, loaded, folder },
  ref,
) {
  return (
    <div ref={ref} className={s.scroll}>
      <TabSlide tab={folder} order={FOLDER_ORDER} className={s.slide}>
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
