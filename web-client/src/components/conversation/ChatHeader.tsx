// src/components/conversation/ChatHeader.tsx
// The floating chat header (avatar + title/status + call/search/menu actions).
// Extracted from Chat and memoized so transient parent state (composer text,
// context menu, media viewer) never re-renders it — only its own data does.
//
// Поиск по чату — как в tweb (chat.ts:767-818): `topbar-search-container`
// ДОПИСЫВАЕТСЯ в тот же `.sidebar-header.topbar`, а `.content` и `.chat-utils`
// уводятся в opacity 0 встречной анимацией (200ms ease-in-out). Топбар не
// подменяется другой карточкой — аватар остаётся на месте.
import { memo, useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import IconButton from '../../shared/ui/IconButton'
import classNames from '../../shared/lib/classNames'
import TgIcon from '../TgIcon'
import Avatar from '../../shared/ui/Avatar'
import VerifiedBadge from '../VerifiedBadge'
import PremiumBadge from '../PremiumBadge'
import EmojiStatus from '../EmojiStatus'
import TypingIndicator from './TypingIndicator'
import TopbarSearch from './TopbarSearch'
import { useCall } from '../call/CallProvider'
import { useSearchStore } from '../../stores/searchStore'
import { SERVICE_USER_ID } from '../../core/dialogToChat'
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
  const numericChatId = Number(chat.id)
  const searchOpen = useSearchStore((st) => st.byChat[numericChatId]?.open ?? false)
  // tweb topbar.ts:845 — лупа зовёт `chat.initSearch()` без параметров
  const openSearch = () => useSearchStore.getState().initSearch(numericChatId)

  // tweb chat.ts:745-760 `animateElements`: контейнер поиска и пара
  // `.content`/`.chat-utils` анимируются встречно (opacity, 200ms ease-in-out,
  // fill forwards); удаление узла — после окончания анимации ухода.
  const [searchMounted, setSearchMounted] = useState(searchOpen)
  const searchRef = useRef<HTMLDivElement>(null)
  const topbarRef = useRef<HTMLDivElement>(null)
  const firstRunRef = useRef(true)
  // номер прогона: отложенное размонтирование отменяется, если поиск успели
  // открыть заново (tweb `.then` снимает ЗАХВАЧЕННЫЙ узел, а не текущий).
  const runRef = useRef(0)

  // tweb создаёт узел поиска синхронно внутри того же прохода эффекта
  // (chat.ts:779 → `topbar.container.append` → `animateElements`). У нас узел
  // рисует React, поэтому монтируем его прямо в рендере: к моменту эффекта
  // анимации `searchRef` уже заполнен, и эффекту не нужен второй прогон.
  if (searchOpen && !searchMounted) setSearchMounted(true)

  // Зависимость ТОЛЬКО от `searchOpen` — как единственный tweb-эффект по
  // `needSearch()` (chat.ts:766). Размонтирование поиска меняет `searchMounted`,
  // и если бы он был в списке зависимостей, эффект прогонялся бы второй раз и
  // повторно проигрывал бы 0→1 на `.content`/`.chat-utils` — шапка мигала дважды.
  useEffect(() => {
    const topbar = topbarRef.current
    if (!topbar) return
    if (firstRunRef.current) {
      firstRunRef.current = false
      // первый рендер с закрытым поиском: анимировать нечего (tweb — ранний
      // выход `if(!needSearch()) { if(!topbarSearch) return; … }`, chat.ts:767)
      if (!searchOpen) return
    }
    const run = ++runRef.current

    const keyframes: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }]
    const options: KeyframeAnimationOptions = { fill: 'forwards', duration: 200, easing: 'ease-in-out' }
    if (!searchOpen) keyframes.reverse()
    const promises: Promise<unknown>[] = []
    if (searchRef.current) promises.push(searchRef.current.animate(keyframes, options).finished)
    keyframes.reverse()
    topbar.querySelectorAll<HTMLElement>('.content, .chat-utils').forEach((el) => {
      promises.push(el.animate(keyframes, options).finished)
    })
    if (!searchOpen) {
      // tweb chat.ts:773 — узел удаляется после окончания анимации ухода
      const unmount = () => { if (run === runRef.current) setSearchMounted(false) }
      void Promise.all(promises).then(unmount, unmount)
    }
  }, [searchOpen])

  return (
        // ── Топбар-пилюля tweb: .sidebar-header.topbar (_chatTopbar.scss:25) —
        //    absolute top 0 внутри #column-center, max-width --chat-width,
        //    48px, radius 24, сдвиг вниз под плейты плеера/звонка. ──
        <div
          ref={topbarRef}
          className={classNames('sidebar-header', 'topbar', 'has-avatar')}
          data-floating={platesCount}
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
                  preview={chat.avatarPreview}
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
              {chat.type === 'private' && Number(chat.id) !== SERVICE_USER_ID && !(isBot || chat.isBot) && (
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
                <IconButton onClick={openSearch} color="var(--secondary-text-color)" className={s.desktopOnly}>
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
          {/* tweb chat.ts:816 — контейнер поиска живёт ВНУТРИ топбара */}
          {searchMounted && (
            <TopbarSearch containerRef={searchRef} chat={chat} onJumpToSeq={onJumpToSeq} />
          )}
        </div>
  )
}

export default memo(ChatHeader)
