// Форум-группа (tweb ForumTab / GroupForumTab): вместо ленты — список тем
// (ряды 64px без аватара: вымпел-иконка цвета TOPIC_COLORS с первой буквой,
// название, превью последнего сообщения, время), «Создать тему» (право любое,
// как в группах по умолчанию), клик — тред темы с композером.
import { useEffect, useRef, useState } from 'react'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import Popup from '../shared/ui/Popup'
import { useManagers } from '../core/hooks/useManagers'
import { useTopicThread } from '../core/hooks/useTopicThread'
import type { TopicRow } from '../core/managers/groupsManager'
import { fmtWhen, mediaLabel } from '../core/dialogToChat'
import { useT } from '../i18n'
import classNames from '../shared/lib/classNames'
import s from './ForumView.module.scss'

// tweb TOPIC_COLORS (constants.ts)
export const TOPIC_COLORS = ['#6FB9F0', '#FFD67E', '#CB86DB', '#8EEE98', '#FF93B2', '#FB6F5F']

// Вымпел темы (tweb topicAvatar: градиентный значок с первой буквой)
export function TopicIcon({ color, title, size = 40 }: { color: number; title: string; size?: number }) {
  const c = TOPIC_COLORS[Math.abs(color) % TOPIC_COLORS.length]
  return (
    <div className={s.topicIcon} style={{ width: size, height: size, background: `linear-gradient(135deg, ${c}, ${c}cc)`, fontSize: size * 0.42 }}>
      {(title.charAt(0) || '#').toUpperCase()}
    </div>
  )
}

export default function ForumView({ chatId, chatName }: { chatId: number; chatName: string }) {
  const t = useT()
  const managers = useManagers()
  const [topics, setTopics] = useState<TopicRow[] | null>(null)
  const [active, setActive] = useState<TopicRow | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const reload = () => {
    void managers.groups.listTopics(chatId).then(setTopics).catch(() => setTopics([]))
  }
  useEffect(() => {
    setTopics(null)
    setActive(null)
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId])

  if (active) {
    return (
      <TopicThread
        chatId={chatId}
        topic={active}
        onBack={() => {
          setActive(null)
          reload()
        }}
      />
    )
  }

  return (
    <div className={s.root}>
      <div className={s.header}>
        <div>
          <Text size={16.5} weight={600} color="var(--tg-textPrimary)">{chatName}</Text>
          <Text size={13.5} color="var(--tg-textSecondary)" style={{ display: 'block' }}>
            {topics ? `${topics.length} ${t('topics')}` : t('Topics')}
          </Text>
        </div>
        <IconButton onClick={() => setCreateOpen(true)} color="var(--tg-accent)" title={t('Create Topic')} aria-label={t('Create Topic')}>
          <TgIcon name="add" size={24} />
        </IconButton>
      </div>
      <div className={s.list}>
        {topics != null && topics.length === 0 && (
          <Text size={14.5} color="var(--tg-textSecondary)" style={{ padding: '3rem 1rem', textAlign: 'center', display: 'block' }}>
            {t('No topics')}
          </Text>
        )}
        {(topics ?? []).map((topic) => (
          <div key={topic.id} className={s.row} onClick={() => setActive(topic)}>
            <TopicIcon color={topic.iconColor} title={topic.title} />
            <div className={s.body}>
              <div className={s.titleRow}>
                <Text noWrap size={15.5} weight={600} color="var(--tg-textPrimary)" style={{ flex: 1 }}>
                  {topic.title}
                </Text>
                {topic.closed && <TgIcon name="lock" size={14} color="var(--tg-textFaint)" />}
                <Text size={12} color="var(--tg-textFaint)">{fmtWhen(topic.lastAt)}</Text>
              </div>
              <Text noWrap size={14.5} color="var(--tg-textSecondary)">
                {topic.lastSenderName ? `${topic.lastSenderName}: ` : ''}
                {topic.lastText || mediaLabel(topic.lastType)}
              </Text>
            </div>
          </div>
        ))}
      </div>

      {createOpen && (
        <CreateTopicPopup
          onClose={() => setCreateOpen(false)}
          onCreate={(title, color) => {
            setCreateOpen(false)
            void managers.groups.createTopic(chatId, title, color).then(reload)
          }}
        />
      )}
    </div>
  )
}

// «Новая тема» (tweb editTopic: имя + клик по значку циклит цвет)
function CreateTopicPopup({ onCreate, onClose }: {
  onCreate: (title: string, color: number) => void
  onClose: () => void
}) {
  const t = useT()
  const [title, setTitle] = useState('')
  const [color, setColor] = useState(0)
  return (
    <Popup
      open
      title={t('New Topic')}
      onClose={onClose}
      width={360}
      action={{ label: t('Create'), onClick: () => title.trim() && onCreate(title.trim(), color) }}
    >
      <div className={s.createBody}>
        <div onClick={() => setColor((c) => (c + 1) % TOPIC_COLORS.length)} style={{ cursor: 'pointer' }}>
          <TopicIcon color={color} title={title || '#'} size={56} />
        </div>
        <input
          className={s.titleInput}
          value={title}
          maxLength={70}
          placeholder={t('Topic Name')}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
      </div>
    </Popup>
  )
}

// Тред темы: сообщения + композер (live через discussionStore-механику тредов)
function TopicThread({ chatId, topic, onBack }: { chatId: number; topic: TopicRow; onBack: () => void }) {
  const t = useT()
  const { comments, send } = useTopicThread(chatId, topic.rootMsgId)
  const [text, setText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [comments.length])

  const submit = () => {
    if (!text.trim()) return
    send(text)
    setText('')
  }

  return (
    <div className={s.root}>
      <div className={s.header}>
        <IconButton onClick={onBack} color="var(--tg-textSecondary)" aria-label={t('Back')}>
          <TgIcon name="back" size={22} />
        </IconButton>
        <TopicIcon color={topic.iconColor} title={topic.title} size={34} />
        <Text size={16} weight={600} color="var(--tg-textPrimary)" style={{ flex: 1 }} noWrap>
          {topic.title}
        </Text>
      </div>
      <div ref={scrollRef} className={s.thread}>
        {comments.map((c) => (
          <div key={c.key} className={classNames(s.msg, c.out ? s.msgOut : '')}>
            {!c.out && <Text size={13} weight={600} style={{ color: c.color }}>{c.name}</Text>}
            <Text size={15} color="var(--tg-textPrimary)" style={{ wordBreak: 'break-word' }}>{c.text}</Text>
            <Text size={11} color="var(--tg-textFaint)" style={{ textAlign: 'right', display: 'block' }}>{c.time}</Text>
          </div>
        ))}
      </div>
      {topic.closed ? (
        <div className={s.closedBar}>
          <TgIcon name="lock" size={16} color="var(--tg-textSecondary)" />
          <Text size={14.5} color="var(--tg-textSecondary)">{t('Topic is closed')}</Text>
        </div>
      ) : (
        <div className={s.composer}>
          <input
            className={s.input}
            value={text}
            placeholder={t('Message')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          />
          <IconButton onClick={submit} color="var(--tg-accent)" aria-label={t('Send')}>
            <TgIcon name="send" size={22} />
          </IconButton>
        </div>
      )}
    </div>
  )
}
