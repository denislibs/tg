import { useMemo, useRef, useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import { motion } from 'framer-motion'
import TgIcon from './TgIcon'
import Text from '../shared/ui/Text'
import { slideInRight } from '../motion'
import { useT, useLang } from '../i18n'
import { useDiscussion } from '../core/hooks/useDiscussion'
import { commentsLabel } from '../core/commentsLabel'
import ChatFeed from './messages/ChatFeed'
import type { FeedFns } from './messages/MessageRow'
import type { ConvMsg } from '../data'
import s from './DiscussionView.module.scss'

const NOOP = () => {}
// The thread is a read-only feed here (send is via the composer); the feed's
// callbacks (open sender, play voice, context menu, jump, lightbox) are no-ops.
const FEED_FNS: FeedFns = {
  openSender: NOOP,
  playVoice: NOOP,
  toggleSelect: NOOP,
  openMsgMenu: NOOP,
  jumpToSeq: NOOP,
  openLightbox: NOOP,
}
const EMPTY_COUNTS = new Map<number, number>()
const EMPTY_SELECTED = new Set<number>()

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
  const [draft, setDraft] = useState('')
  const [pinnedHidden, setPinnedHidden] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Тред как обычный чат: исходный пост → сервис «Начало обсуждения» → комментарии,
  // отрисованные настоящими баблами (ChatFeed) поверх обоев (глобальный ChatBackground
  // проступает через прозрачный фон). Данные — из useDiscussion (load/live/optimistic).
  const feedMsgs = useMemo<ConvMsg[]>(() => {
    const postText = post.text || post.title || ''
    const list: ConvMsg[] = [
      // исходный пост первым баблом (входящий, без sender → без аватар-колонки)
      { clientId: 'post', type: 'text', out: false, text: postText },
      { clientId: 'svc', type: 'service', text: t('Discussion started') },
    ]
    for (const c of comments) {
      list.push({
        clientId: c.key,
        type: 'text',
        out: c.out,
        sender: c.out ? undefined : c.name,
        senderColor: c.out ? undefined : c.color,
        text: c.text,
        time: c.time,
        status: c.out ? 'read' : undefined,
      })
    }
    return list
  }, [comments, post, t])

  const submit = () => {
    if (!draft.trim()) return
    send(draft)
    setDraft('')
  }

  // Клик по плашке — скролл к посту (первому сообщению); поведение как в tweb.
  const jumpToPost = () => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  const postPreview = post.text || post.title || t('Message')

  return (
    <motion.div
      className={s.root}
      variants={slideInRight}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* Header — «N комментариев» */}
      <div className={s.header}>
        <IconButton onClick={onBack} color="var(--tg-textPrimary)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--tg-textPrimary)" className={s.title}>
          {commentsLabel(count, lang, t)}
        </Text>
      </div>

      {/* Pinned-плашка исходного поста (tweb .pinned-message) */}
      {!pinnedHidden && (
        <div className={s.pinned} onClick={jumpToPost}>
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
      )}

      {/* Лента треда — настоящие баблы поверх обоев */}
      <div ref={scrollRef} className={s.scroll}>
        <div className={s.content}>
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
            dateStickyTop={0}
            feedFns={FEED_FNS}
            onOpenDiscussion={NOOP}
          />
        </div>
      </div>

      {/* Footer composer */}
      <div className={s.composer}>
        <input
          className={s.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={t('Comment')}
        />
        <div className={s.sendBtn} onClick={submit}>
          <TgIcon name="microphone" size={22} color="#fff" />
        </div>
      </div>
    </motion.div>
  )
}
