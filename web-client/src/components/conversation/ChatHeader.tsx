// src/components/conversation/ChatHeader.tsx
// The floating chat header (avatar + title/status + call/search/menu actions, with
// an animated search-mode swap). Extracted from Chat and memoized so
// transient parent state (composer text, context menu, media viewer) never
// re-renders it — only its own data (chat, presence/typing, search) does.
// Логика поиска — в useChatHeaderSearch; UI поисковой карточки — в ChatSearchCard.
import { memo } from 'react'
import Text from '../../shared/ui/Text'
import IconButton from '../../shared/ui/IconButton'
import classNames from '../../shared/lib/classNames'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import Avatar from '../../shared/ui/Avatar'
import VerifiedBadge from '../VerifiedBadge'
import PremiumBadge from '../PremiumBadge'
import EmojiStatus from '../EmojiStatus'
import TypingIndicator from './TypingIndicator'
import ChatSearchCard from './ChatSearchCard'
import { useCall } from '../call/CallProvider'
import { useChatHeaderSearch } from '../../core/hooks/useChatHeaderSearch'
import { SERVICE_USER_ID } from '../../core/dialogToChat'
import { EASE, DUR } from '../../motion'
import type { Chat } from '../../data'
import type { TypingKind } from '../../core/hooks/useTypingLabel'
import s from './ChatHeader.module.scss'

export interface ChatHeaderProps {
  chat: Chat
  avatarSrc?: string
  peerOnline?: boolean
  typingActive: boolean
  typingText: string
  typingKind: TypingKind
  status: string
  online: boolean
  isBot?: boolean // бот-собеседник: скрыть кнопки звонка (у ботов нет звонков)
  playerOffset: number
  // The only thing the header needs from the parent for search: jump the feed to a
  // result's seq (the scroll machine lives in useChatScroll). Everything else about
  // search — open state, query, the backend fetch, the result rows — the header owns.
  onJumpToSeq: (seq: number) => void
  onBack?: () => void
  onToggleInfo: () => void
  onOpenMenu: (rect: DOMRect) => void
}

function ChatHeader({
  chat, avatarSrc, peerOnline, typingActive, typingText, typingKind, status, online,
  isBot, playerOffset, onJumpToSeq, onBack, onToggleInfo, onOpenMenu,
}: ChatHeaderProps) {
  const { start: startCall } = useCall()
  const search = useChatHeaderSearch(chat, onJumpToSeq)

  // top: 16px (как на десктопе) — паритет зазора ленты; + смещение плеера
  const barTop = { top: `${16 + playerOffset}px` }

  return (
    <AnimatePresence initial={false}>
      {search.open ? (
        // ── Unified search card: input row + (growing) results list as ONE rounded
        //    surface. The list grows the card's height as you type. ──
        <motion.div
          key="search"
          className={classNames(s.bar, s.searchCard)}
          initial={{ opacity: 0, y: -6, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.985 }}
          transition={{ duration: DUR.in, ease: EASE }}
          style={{ ...barTop, transformOrigin: 'top center' }}
        >
          <ChatSearchCard chat={chat} avatarSrc={avatarSrc} search={search} />
        </motion.div>
      ) : (
        // ── Normal header: floating rounded pill ──
        <motion.div
          key="normal"
          className={classNames(s.bar, s.header)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.in, ease: EASE }}
          style={barTop}
        >
          {onBack && (
            <IconButton onClick={onBack} color="var(--secondary-text-color)" style={{ marginLeft: '-4px' }}>
              <TgIcon name="back" />
            </IconButton>
          )}
          <div className={s.peer} onClick={onToggleInfo}>
            <Avatar
              background={chat.avatar}
              text={chat.avatarText}
              emoji={chat.avatarEmoji}
              src={avatarSrc}
              size="sm"
              online={chat.online || peerOnline}
              ringColor="var(--surface-color)"
            />
            <div className={s.peerBody}>
              <div className={s.peerTitle}>
                {/* секретный чат: замок + зелёное имя (tweb .is-secret) */}
                {chat.type === 'secret' && (
                  <TgIcon name="lock" size={16} color="var(--green-color)" style={{ flexShrink: 0 }} />
                )}
                <Text noWrap weight={500} size={16} color={chat.type === 'secret' ? 'var(--green-color)' : 'var(--primary-text-color)'} style={{ lineHeight: 1.2 }}>
                  {chat.name}
                </Text>
                {chat.verified && <VerifiedBadge size={18} />}
                {chat.premium && <PremiumBadge size={18} />}
                {chat.emojiStatus && <EmojiStatus emoji={chat.emojiStatus} size={18} />}
              </div>
              <Text noWrap size={13.5} color={typingActive || online ? 'var(--primary-color)' : 'var(--secondary-text-color)'} style={{ lineHeight: 1.2 }}>
                {typingActive && <TypingIndicator kind={typingKind} color="var(--primary-color)" />}
                {typingActive ? typingText : status}
              </Text>
            </div>
          </div>
          {/* На handhelds tweb прячет кнопки звонков из шапки (остаются пунктами
              меню «⋮») — _chatTopbar.scss .chat-utils > .btn-icon: display none.
              Сервисному аккаунту «Telegram» звонить нельзя вовсе. Ботам звонить
              нельзя — у бот-аккаунтов нет звонков (Telegram). */}
          {chat.type === 'private' && chat.peerId !== SERVICE_USER_ID && !(isBot || chat.isBot) && (
            <>
              <IconButton onClick={() => startCall(false)} color="var(--secondary-text-color)" className={s.desktopOnly}>
                <TgIcon name="phone" />
              </IconButton>
              <IconButton onClick={() => startCall(true)} color="var(--secondary-text-color)" className={s.desktopOnly}>
                <TgIcon name="videocamera" />
              </IconButton>
            </>
          )}
          {/* На мобилке лупа скрыта — поиск открывается пунктом меню «⋮»
              (tweb topbar.ts: menuButton 'Search', verify isMobile).
              В секретном чате поиска нет: сервер хранит только шифртекст, искать по
              нему нельзя (клиентского поиска по расшифрованным сообщениям тут нет). */}
          {chat.type !== 'secret' && (
            <IconButton onClick={search.openSearch} color="var(--secondary-text-color)" className={s.desktopOnly}>
              <TgIcon name="search" />
            </IconButton>
          )}
          <IconButton onClick={(e) => onOpenMenu(e.currentTarget.getBoundingClientRect())} color="var(--secondary-text-color)">
            <TgIcon name="more" />
          </IconButton>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default memo(ChatHeader)
