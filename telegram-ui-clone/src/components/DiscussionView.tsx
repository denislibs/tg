import { useMemo, useRef, useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import TgIcon from './TgIcon'
import Text from '../shared/ui/Text'
import { useT, useLang } from '../i18n'
import { useDiscussion } from '../core/hooks/useDiscussion'
import { commentsLabel } from '../core/commentsLabel'
import { useVoiceRecorder } from '../core/hooks/useVoiceRecorder'
import Composer from './Composer'
import ChatFeed from './messages/ChatFeed'
import type { FeedFns } from './messages/MessageRow'
import type { ConvMsg } from '../data'
import useMediaQuery from '../shared/lib/useMediaQuery'
import s from './DiscussionView.module.scss'

const NOOP = () => {}
// Feed callbacks are inert here (sending is via the composer, no context menu/select).
const FEED_FNS: FeedFns = {
  openSender: NOOP,
  playVoice: NOOP,
  toggleSelect: NOOP,
  openMsgMenu: NOOP,
  jumpToSeq: NOOP,
  openLightbox: NOOP,
  recall: NOOP,
  mediaPlayed: NOOP,
  roundPlaying: NOOP,
}
const EMPTY_COUNTS = new Map<number, number>()
const EMPTY_SELECTED = new Set<number>()

// Match ConversationView's floating-chrome clearances (плейты на мобилке в 8px
// от краёв — tweb --page-chats-padding: 8px handheld).
const headerH = (narrow: boolean) => (narrow ? 8 : 16) + 48 + 12 // top + card + gap
const padBottom = (narrow: boolean) => (narrow ? 56 : 64) // как ConversationView
const PINNED_EXTRA = 56 // extra when the pinned plate is shown

export default function DiscussionView({
  channelId,
  postId,
  discussionChatId,
  post,
  onBack,
}: {
  channelId: number
  postId: number
  discussionChatId: number
  post: { title?: string; text?: string; gradient?: string; emoji?: string }
  onBack: () => void
}) {
  const t = useT()
  const [lang] = useLang()
  const { comments, count, send } = useDiscussion(channelId, postId, discussionChatId)
  const [pinnedHidden, setPinnedHidden] = useState(false)
  // Search over comments: null = closed; '' or text = open with that query.
  const [search, setSearch] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Real composer needs a voice recorder; comments don't support voice, so the
  // completed clip is discarded (the mic still records but nothing is sent).
  const rec = useVoiceRecorder({ onComplete: NOOP })

  // Тред как обычный чат: исходный пост → сервис «Начало обсуждения» → комментарии,
  // настоящими баблами (ChatFeed) поверх обоев. В режиме поиска — только совпавшие
  // комментарии (пост/сервис прячутся).
  const feedMsgs = useMemo<ConvMsg[]>(() => {
    const commentMsg = (c: (typeof comments)[number]): ConvMsg => ({
      clientId: c.key,
      type: 'text',
      out: c.out,
      sender: c.out ? undefined : c.name,
      senderColor: c.out ? undefined : c.color,
      text: c.text,
      time: c.time,
      status: c.out ? 'read' : undefined,
    })
    if (search !== null) {
      const q = search.trim().toLowerCase()
      const hits = q ? comments.filter((c) => c.text.toLowerCase().includes(q)) : comments
      return hits.map(commentMsg)
    }
    const postText = post.text || post.title || ''
    const list: ConvMsg[] = [
      { clientId: 'post', type: 'text', out: false, text: postText },
      { clientId: 'svc', type: 'service', text: t('Discussion started') },
    ]
    for (const c of comments) list.push(commentMsg(c))
    return list
  }, [comments, post, t, search])

  const jumpToPost = () => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  const postPreview = post.text || post.title || t('Message')
  const showPinned = !pinnedHidden && search === null
  const narrow = useMediaQuery('(max-width:900px)')
  const topClear = headerH(narrow) + (showPinned ? PINNED_EXTRA : 0)

  return (
    <div className={s.root}>
      {/* Плавающий хедер-карточка (как ChatHeader): «N комментариев» + поиск + меню */}
      <div className={s.headerBar}>
        <div className={s.headerCard}>
          {search === null ? (
            <>
              <IconButton onClick={onBack} color="var(--tg-textSecondary)" style={{ marginLeft: '-4px' }}>
                <TgIcon name="back" />
              </IconButton>
              <Text noWrap weight={500} size={16} color="var(--tg-textPrimary)" className={s.title}>
                {commentsLabel(count, lang, t)}
              </Text>
              <IconButton onClick={() => { setMenuOpen(false); setSearch('') }} color="var(--tg-textFaint)">
                <TgIcon name="search" />
              </IconButton>
              <IconButton onClick={() => setMenuOpen((o) => !o)} color="var(--tg-textFaint)">
                <TgIcon name="more" />
              </IconButton>
            </>
          ) : (
            <>
              <IconButton onClick={() => setSearch(null)} color="var(--tg-textSecondary)" style={{ marginLeft: '-4px' }}>
                <TgIcon name="back" />
              </IconButton>
              <input
                className={s.searchInput}
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('Search comments')}
              />
              <IconButton onClick={() => (search ? setSearch('') : setSearch(null))} color="var(--tg-textFaint)">
                <TgIcon name="close" size={20} />
              </IconButton>
            </>
          )}
        </div>
        {menuOpen && (
          <div className={s.menu}>
            <button
              className={s.menuItem}
              onClick={() => { setPinnedHidden((h) => !h); setMenuOpen(false) }}
            >
              {pinnedHidden ? t('Show pinned message') : t('Hide pinned message')}
            </button>
          </div>
        )}
      </div>

      {/* Плавающая pinned-плашка поста (tweb .pinned-message) */}
      {showPinned && (
        <div className={s.pinnedBar}>
          <div className={s.pinnedCard} onClick={jumpToPost}>
            <TgIcon name="pin" size={20} color="var(--tg-accent)" />
            <div className={s.pinnedLine} />
            <div className={s.pinnedBody}>
              <Text size={13} weight={600} color="var(--tg-accent)" style={{ lineHeight: 1.2 }}>
                {t('Pinned message')}
              </Text>
              <Text noWrap size={13.5} color="var(--tg-textSecondary)">
                {postPreview}
              </Text>
            </div>
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); setPinnedHidden(true) }}
              color="var(--tg-textFaint)"
            >
              <TgIcon name="close" size={20} />
            </IconButton>
          </div>
        </div>
      )}

      {/* Лента — центрированная колонка (max-width) поверх обоев */}
      <div ref={scrollRef} className={s.scroll}>
        <div className={s.content} style={{ paddingTop: `${topClear}px`, paddingBottom: `${padBottom(narrow)}px` }}>
          <ChatFeed
            msgs={feedMsgs}
            winMsgs={[]}
            isRealChat={false}
            isGroup
            discussionsEnabled={false}
            commentCounts={EMPTY_COUNTS}
            highlightSeq={null}
            selecting={false}
            selected={EMPTY_SELECTED}
            ladderActive={false}
            dateStickyTop={topClear}
            feedFns={FEED_FNS}
            onOpenDiscussion={NOOP}
          />
        </div>
      </div>

      {/* Плавающий композер (как в ConversationView) */}
      <div className={s.footer}>
        <Composer
          reply={null}
          editing={null}
          rec={rec}
          onSend={(text) => send(text)}
          onTyping={NOOP}
          onCancelReply={NOOP}
          onCancelEdit={NOOP}
          onOpenAttach={NOOP}
        />
      </div>
    </div>
  )
}
