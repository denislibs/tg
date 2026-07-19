// Тред форум-топика в колонке чата (tweb setPeer({peerId, threadId}) → обычный
// чат в режиме треда): плавающий хедер с иконкой и названием темы, лента
// настоящими баблами (ChatFeed) поверх обоев, плавающий настоящий Composer.
// Раскладка 1:1 с DiscussionView/ConversationView.
import { useMemo, useRef } from 'react'
import IconButton from '../shared/ui/IconButton'
import TgIcon from './TgIcon'
import Text from '../shared/ui/Text'
import { useT } from '../i18n'
import { useTopicThread } from '../core/hooks/useTopicThread'
import { useVoiceRecorder } from '../core/hooks/useVoiceRecorder'
import Composer from './Composer'
import ChatFeed from './messages/ChatFeed'
import type { FeedFns } from './messages/MessageRow'
import type { ConvMsg } from '../data'
import type { TopicRow } from '../core/managers/groupsManager'
import { TopicIcon } from './TopicsPanel'
import useMediaQuery from '../shared/lib/useMediaQuery'
import s from './TopicView.module.scss'

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
  toggleReaction: NOOP,
}
const EMPTY_COUNTS = new Map<number, number>()
const EMPTY_SELECTED = new Set<number>()

const headerH = (narrow: boolean) => (narrow ? 8 : 16) + 48 + 12
const padBottom = (narrow: boolean) => (narrow ? 56 : 64)

export default function TopicView({ chatId, topic, groupName, onBack }: {
  chatId: number
  topic: TopicRow
  groupName: string
  onBack: () => void
}) {
  const t = useT()
  const { comments, send } = useTopicThread(chatId, topic.rootMsgId)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Real composer needs a voice recorder; topic threads don't support voice yet,
  // so the completed clip is discarded.
  const rec = useVoiceRecorder({ onComplete: NOOP })

  const feedMsgs = useMemo<ConvMsg[]>(() => {
    const list: ConvMsg[] = [
      { clientId: 'svc', type: 'service', text: `${t('Topic created')}: ${topic.title}` },
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
  }, [comments, topic.title, t])

  const narrow = useMediaQuery('(max-width:900px)')
  const topClear = headerH(narrow)

  return (
    <div className={s.root}>
      {/* Плавающий хедер-карточка: назад + иконка/название темы + группа */}
      <div className={s.headerBar}>
        <div className={s.headerCard}>
          <IconButton onClick={onBack} color="var(--tg-textSecondary)" style={{ marginLeft: '-4px' }}>
            <TgIcon name="back" />
          </IconButton>
          <TopicIcon color={topic.iconColor} title={topic.title} size={30} />
          <div className={s.titleBody}>
            <Text noWrap weight={600} size={15.5} color="var(--tg-textPrimary)">{topic.title}</Text>
            <Text noWrap size={12.5} color="var(--tg-textSecondary)">{groupName}</Text>
          </div>
          {topic.closed && <TgIcon name="lock" size={18} color="var(--tg-textFaint)" />}
        </div>
      </div>

      {/* Лента — центрированная колонка поверх обоев */}
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
            unreadDividerSeq={null}
            selecting={false}
            selected={EMPTY_SELECTED}
            ladderActive={false}
            dateStickyTop={topClear}
            feedFns={FEED_FNS}
            onOpenDiscussion={NOOP}
          />
        </div>
      </div>

      {/* Плавающий композер / плашка закрытой темы */}
      <div className={s.footer}>
        {topic.closed ? (
          <div className={s.closedBar}>
            <TgIcon name="lock" size={16} color="var(--tg-textSecondary)" />
            <Text size={14.5} color="var(--tg-textSecondary)">{t('Topic is closed')}</Text>
          </div>
        ) : (
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
        )}
      </div>
    </div>
  )
}
