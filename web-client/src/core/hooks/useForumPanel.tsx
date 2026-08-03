import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE } from '../../motion'
import s from '../../components/Sidebar.module.scss'
import TopicsPanel from '../../components/TopicsPanel'
import type { Chat } from '../../data'
import type { TopicRow } from '../managers/groupsManager'

// Форум-группа (tweb toggleForumTabByPeerId): клик по ней открывает панель топиков
// СЛЕВА поверх списка чатов — правая колонка не трогается. handleSelect — обёртка
// над onSelect: форум → панель топиков, обычный чат → onSelect напрямую.
export function useForumPanel({ chats, onSelect, activeTopicId, onOpenTopic }: {
  chats: Chat[]
  onSelect: (id: string) => void
  activeTopicId: number | null
  onOpenTopic: (chatId: number, topic: TopicRow) => void
}) {
  const [forumChat, setForumChat] = useState<Chat | null>(null)

  const handleSelect = (id: string) => {
    const c = chats.find((x) => x.id === id)
    if (c?.isForum) {
      setForumChat(c)
      return
    }
    onSelect(id)
  }

  const panel = (
    <AnimatePresence>
      {forumChat && (
        <motion.div
          className={s.forumPanel}
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ duration: 0.22, ease: EASE }}
        >
          <TopicsPanel
            chatId={Number(forumChat.id)}
            chatName={forumChat.name}
            activeRootMsgId={activeTopicId}
            onClose={() => setForumChat(null)}
            onOpenTopic={(topic) => onOpenTopic(Number(forumChat.id), topic)}
            onViewAsMessages={() => {
              setForumChat(null)
              onSelect(forumChat.id)
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )

  return { forumChat, handleSelect, panel }
}
