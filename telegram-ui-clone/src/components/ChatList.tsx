// src/components/ChatList.tsx
// The sidebar's dialog list: the scroll container + the folder-switch slide
// animation + the mapped rows. Extracted from Sidebar and memoized so Sidebar's
// own transient state (stories fold/reveal on scroll, overlay toggles) doesn't
// re-render the list. The scroll container ref is forwarded back to Sidebar, which
// owns the fold/reveal scroll listeners.
import { forwardRef, memo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE, DUR } from '../motion'
import ChatListItem from './ChatListItem'
import DialogSkeleton from './DialogSkeleton'
import type { Chat } from '../data'
import type { FolderKey } from './FolderTabs'
import s from './ChatList.module.scss'

export interface ChatListProps {
  chats: Chat[] // already filtered by folder
  selectedId: string
  onSelect: (id: string) => void
  loaded: boolean
  folder: FolderKey
  dir: number // folder-switch slide direction (+1 right, -1 left)
}

const ChatList = forwardRef<HTMLDivElement, ChatListProps>(function ChatList(
  { chats, selectedId, onSelect, loaded, folder, dir },
  ref,
) {
  return (
    <div ref={ref} className={s.scroll}>
      <AnimatePresence mode="popLayout" custom={dir} initial={false}>
        <motion.div
          className={s.slide}
          key={folder}
          custom={dir}
          variants={{
            enter: (d: number) => ({ x: d > 0 ? '100%' : '-100%' }),
            center: { x: '0%' },
            exit: (d: number) => ({ x: d > 0 ? '-100%' : '100%' }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: DUR.in, ease: EASE }}
        >
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
        </motion.div>
      </AnimatePresence>
    </div>
  )
})

export default memo(ChatList)
