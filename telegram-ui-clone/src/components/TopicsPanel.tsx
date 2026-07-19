// Панель топиков форум-группы (tweb ForumTab/GroupForumTab): слайд в ЛЕВОМ
// сайдбаре поверх списка чатов — правая колонка при этом не трогается. Шапка:
// «назад», название группы + «N тем», меню (Новая тема — по правам, Показать
// как сообщения). Ряды 64px без аватара (tweb topic-dialogs-override): иконка
// топика в строке названия, превью последнего сообщения, время. Клик по теме
// открывает её тред в колонке чата (tweb setPeer({peerId, threadId})).
import { useEffect, useState } from 'react'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import Popup from '../shared/ui/Popup'
import Menu, { MenuItem } from '../shared/ui/Menu'
import { useManagers } from '../core/hooks/useManagers'
import type { TopicRow } from '../core/managers/groupsManager'
import { fmtWhen, mediaLabel } from '../core/dialogToChat'
import { useT } from '../i18n'
import classNames from '../shared/lib/classNames'
import s from './TopicsPanel.module.scss'

// tweb TOPIC_COLORS (constants.ts)
export const TOPIC_COLORS = ['#6FB9F0', '#FFD67E', '#CB86DB', '#8EEE98', '#FF93B2', '#FB6F5F']

// Иконка темы (tweb topicAvatar: градиентный значок-вымпел с аббревиатурой)
export function TopicIcon({ color, title, size = 26 }: { color: number; title: string; size?: number }) {
  const c = TOPIC_COLORS[Math.abs(color) % TOPIC_COLORS.length]
  return (
    <div
      className={s.topicIcon}
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${c}, ${c}cc)`, fontSize: size * 0.46 }}
    >
      {(title.charAt(0) || '#').toUpperCase()}
    </div>
  )
}

const CHANGE_INFO = 64

export default function TopicsPanel({ chatId, chatName, activeRootMsgId, onClose, onOpenTopic, onViewAsMessages }: {
  chatId: number
  chatName: string
  /** rootMsgId темы, открытой в колонке чата — её ряд подсвечен */
  activeRootMsgId: number | null
  onClose: () => void
  onOpenTopic: (topic: TopicRow) => void
  onViewAsMessages: () => void
}) {
  const t = useT()
  const managers = useManagers()
  const [topics, setTopics] = useState<TopicRow[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  // Поиск по темам (tweb: кнопка search в шапке форум-таба); null — закрыт.
  const [query, setQuery] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null)
  // «Новая тема» — создатель или право «Изменение инфо» (tweb manage_topics)
  const [canManage, setCanManage] = useState(false)

  const reload = () => {
    void managers.groups.listTopics(chatId).then(setTopics).catch(() => setTopics([]))
  }
  useEffect(() => {
    setTopics(null)
    reload()
    void managers.groups.card(chatId).then((c) => {
      setCanManage(c.myRole === 'creator' || (c.myRights & CHANGE_INFO) !== 0)
    }).catch(() => setCanManage(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId])

  return (
    <div className={s.root}>
      <div className={s.header}>
        <IconButton onClick={onClose} color="var(--tg-textSecondary)" aria-label={t('Close')}>
          <TgIcon name="close" size={24} />
        </IconButton>
        {query === null ? (
          <div className={s.headerBody}>
            <Text noWrap size={16.5} weight={600} color="var(--tg-textPrimary)">{chatName}</Text>
            <Text size={13} color="var(--tg-textSecondary)">
              {topics ? `${topics.length} ${t('topics')}` : t('Topics')}
            </Text>
          </div>
        ) : (
          <input
            className={s.searchInput}
            autoFocus
            value={query}
            placeholder={t('Search')}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        <IconButton
          onClick={() => setQuery((q) => (q === null ? '' : null))}
          color="var(--tg-textFaint)"
          aria-label={t('Search')}
        >
          <TgIcon name={query === null ? 'search' : 'close'} size={24} />
        </IconButton>
        <IconButton
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setMenuAnchor({ top: r.bottom + 4, right: window.innerWidth - r.right })
          }}
          color="var(--tg-textFaint)"
          aria-label={t('Menu')}
        >
          <TgIcon name="more" size={24} />
        </IconButton>
      </div>

      <Menu
        open={menuAnchor != null}
        onClose={() => setMenuAnchor(null)}
        style={menuAnchor ? { top: menuAnchor.top, right: menuAnchor.right, transformOrigin: 'top right' } : undefined}
      >
        {canManage && (
          <MenuItem
            icon={<TgIcon name="add" size={20} />}
            label={t('New Topic')}
            onClick={() => { setMenuAnchor(null); setCreateOpen(true) }}
          />
        )}
        <MenuItem
          icon={<TgIcon name="message" size={20} />}
          label={t('View as Messages')}
          onClick={() => { setMenuAnchor(null); onViewAsMessages() }}
        />
      </Menu>

      <div className={s.list}>
        {topics != null && topics.length === 0 && (
          <Text size={14.5} color="var(--tg-textSecondary)" style={{ padding: '3rem 1rem', textAlign: 'center', display: 'block' }}>
            {t('No topics')}
          </Text>
        )}
        {(topics ?? [])
          .filter((topic) => !query || topic.title.toLowerCase().includes(query.trim().toLowerCase()))
          .map((topic) => (
          <div
            key={topic.id}
            className={classNames(s.row, topic.rootMsgId === activeRootMsgId ? s.rowActive : '')}
            onClick={() => onOpenTopic(topic)}
          >
            <div className={s.titleRow}>
              <TopicIcon color={topic.iconColor} title={topic.title} size={20} />
              <Text noWrap size={15.5} weight={600} color="var(--tg-textPrimary)" style={{ flex: 1 }}>
                {topic.title}
              </Text>
              {topic.closed && <TgIcon name="lock" size={14} color="var(--tg-textFaint)" />}
              <Text size={12} color="var(--tg-textFaint)">{fmtWhen(topic.lastAt)}</Text>
            </div>
            <Text noWrap size={14.5} color="var(--tg-textSecondary)" className={s.preview}>
              {topic.lastSenderName ? `${topic.lastSenderName}: ` : ''}
              {topic.lastText || mediaLabel(topic.lastType)}
            </Text>
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
