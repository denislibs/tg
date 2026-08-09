// src/components/conversation/ChatHeader.tsx
// The floating chat header (avatar + title/status + call/search/menu actions, with
// an animated search-mode swap). Extracted from Chat and memoized so
// transient parent state (composer text, context menu, media viewer) never
// re-renders it — only its own data (chat, presence/typing, search) does.
// Логика поиска — в useChatHeaderSearch; UI поисковой карточки — в ChatSearchCard.
import { memo, type ReactNode, type Ref } from 'react'
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
  /** стек плавающих плашек под топбаром (tweb .topbar-floating-plates) */
  plates?: ReactNode
  /** число видимых плашек — tweb topbar.setFloating: `data-floating` на топбаре,
   *  а пустой стек прячется классом `.hide` */
  platesCount?: number
  /** ref на контейнер плейтов — его высоту меряет Chat (tweb setFloating) */
  platesRef?: Ref<HTMLDivElement>
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
  isBot, plates, platesCount = 0, platesRef, onJumpToSeq, onBack, onToggleInfo, onOpenMenu,
}: ChatHeaderProps) {
  const { start: startCall } = useCall()
  const search = useChatHeaderSearch(chat, onJumpToSeq)

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
          style={{ transformOrigin: 'top center' }}
        >
          <ChatSearchCard chat={chat} avatarSrc={avatarSrc} search={search} />
        </motion.div>
      ) : (
        // ── Топбар-пилюля tweb: .sidebar-header.topbar (_chatTopbar.scss:25) —
        //    absolute top 0 внутри #column-center, max-width --chat-width,
        //    48px, radius 24, сдвиг вниз под плейты плеера/звонка. ──
        <motion.div
          key="normal"
          className={classNames('sidebar-header', 'topbar', 'has-avatar')}
          data-floating={platesCount}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.in, ease: EASE }}
        >
          <div className="chat-info-container">
            {onBack && (
              <IconButton onClick={onBack} color="var(--secondary-text-color)" className="sidebar-close-button">
                <TgIcon name="back" />
              </IconButton>
            )}
            <div className="chat-info" onClick={onToggleInfo}>
              <div className="person">
                <Avatar
                  background={chat.avatar}
                  text={chat.avatarText}
                  emoji={chat.avatarEmoji}
                  src={avatarSrc}
                  size="sm"
                  online={chat.online || peerOnline}
                  ringColor="var(--surface-color)"
                  className="person-avatar"
                />
                <div className="content">
                  <div className="top">
                    <div className="user-title">
                      {/* секретный чат: замок + зелёное имя (tweb .is-secret) */}
                      {chat.type === 'secret' && (
                        <TgIcon name="lock" size={16} color="var(--green-color)" style={{ flexShrink: 0 }} />
                      )}
                      <span className="peer-title" style={chat.type === 'secret' ? { color: 'var(--green-color)' } : undefined}>
                        {chat.name}
                      </span>
                      {chat.verified && <VerifiedBadge size={18} />}
                      {chat.premium && <PremiumBadge size={18} />}
                      {chat.emojiStatus && <EmojiStatus emoji={chat.emojiStatus} size={18} />}
                    </div>
                  </div>
                  <div className="bottom">
                    <span className={classNames('info', typingActive || online ? s.infoOnline : '')}>
                      {typingActive && <TypingIndicator kind={typingKind} color="var(--primary-color)" />}
                      {typingActive ? typingText : status}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="chat-utils">
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
            </div>
          </div>
          {/* Стек плавающих плашек под топбаром (пин, теги «Избранного», …) */}
          <div ref={platesRef} className={classNames('topbar-floating-plates', platesCount === 0 ? 'hide' : '')}>{plates}</div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default memo(ChatHeader)
