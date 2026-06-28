// src/components/ChatList.tsx
// The sidebar's dialog list: the scroll container + the folder-switch slide
// animation + the mapped rows. Extracted from Sidebar and memoized so Sidebar's
// own transient state (stories fold/reveal on scroll, overlay toggles) doesn't
// re-render the list. The scroll container ref is forwarded back to Sidebar, which
// owns the fold/reveal scroll listeners.
import { forwardRef, memo } from 'react'
import { Box, useTheme } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE, DUR } from '../motion'
import ChatListItem from './ChatListItem'
import DialogSkeleton from './DialogSkeleton'
import type { Chat } from '../data'
import type { FolderKey } from './FolderTabs'

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
  const tg = useTheme().tg
  return (
    <Box
      ref={ref}
      sx={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        // reserve a thin gutter so the list width stays constant whether or not it
        // scrolls — switching folders no longer shifts the content (tweb keeps the
        // scrollbar as a thin overlay for the same reason)
        scrollbarGutter: 'stable',
        scrollbarWidth: 'thin',
        scrollbarColor: `${tg.textFaint} transparent`,
        '&::-webkit-scrollbar': { width: '6px' },
        '&::-webkit-scrollbar-thumb': {
          background: 'transparent',
          borderRadius: '3px',
          transition: 'background .2s',
        },
        '&:hover::-webkit-scrollbar-thumb': { background: tg.textFaint },
      }}
    >
      <AnimatePresence mode="popLayout" custom={dir} initial={false}>
        <Box
          component={motion.div}
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
          sx={{ pt: '64px', pb: '84px', width: '100%' }}
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
        </Box>
      </AnimatePresence>
    </Box>
  )
})

export default memo(ChatList)
