// Панель топиков форум-группы (tweb ForumTab/GroupForumTab): слайд в ЛЕВОМ
// сайдбаре поверх списка чатов — правая колонка при этом не трогается. Шапка:
// «назад», название группы + «N тем», меню (Новая тема — по правам, Показать
// как сообщения). Ряды 64px без аватара (tweb topic-dialogs-override): иконка
// топика в строке названия, превью последнего сообщения, время. Клик по теме
// открывает её тред в колонке чата (tweb setPeer({peerId, threadId})).
import { useEffect, useState } from 'react'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import Badge from '../shared/ui/Badge'
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

// Короткий набор unicode-emoji для иконки темы (custom-emoji инфраструктуры нет).
const TOPIC_EMOJI = ['💬', '📌', '🔥', '⭐', '✅', '💡', '🎉', '❤️', '🚀', '📷', '🎵', '⚽', '🍕', '🐱', '🌟', '🔔']

// Иконка темы (tweb topicAvatar: значок-вымпел). С emoji — показываем emoji,
// иначе градиентный значок с первой буквой названия.
export function TopicIcon({ color, emoji, title, size = 26 }: { color: number; emoji?: string; title: string; size?: number }) {
  if (emoji) {
    return (
      <div
        className={s.topicIcon}
        style={{ width: size, height: size, background: 'transparent', fontSize: size * 0.82, lineHeight: 1 }}
      >
        {emoji}
      </div>
    )
  }
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
  const [editing, setEditing] = useState<TopicRow | null>(null)
  // Поиск по темам (tweb: кнопка search в шапке форум-таба); null — закрыт.
  const [query, setQuery] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null)
  // контекстное меню ряда темы (правый клик / long-press, tweb)
  const [rowMenu, setRowMenu] = useState<{ topic: TopicRow; top: number; left: number } | null>(null)
  const [showHidden, setShowHidden] = useState(false)
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

  const all = (topics ?? []).filter((topic) => !query || topic.title.toLowerCase().includes(query.trim().toLowerCase()))
  const visible = all.filter((topic) => !topic.hidden)
  const hidden = all.filter((topic) => topic.hidden)

  const openRowMenu = (e: React.MouseEvent, topic: TopicRow) => {
    if (!canManage) return
    e.preventDefault()
    setRowMenu({ topic, top: e.clientY, left: e.clientX })
  }

  // Клик по теме: открыть тред + оптимистично пометить прочитанной (обнулить
  // unread этого ряда локально; реальные данные подтянутся при следующем reload).
  const handleOpenTopic = (topic: TopicRow) => {
    if (topic.unread > 0 || topic.unreadMentions > 0) {
      setTopics((cur) => (cur ?? []).map((tp) => (tp.id === topic.id ? { ...tp, unread: 0, unreadMentions: 0 } : tp)))
      void managers.groups.readTopic(chatId, topic.rootMsgId, topic.lastMsgSeq).catch(() => {})
    }
    onOpenTopic(topic)
  }

  // Ряд темы «как диалог» (tweb DialogElement без аватара): иконка темы в
  // заголовке, галочки/замок/mute справа, бейджи mention/unread/pinned в превью.
  // В активном (открытом) ряду фон акцентный — весь текст/иконки светлые (Text
  // рендерит div, поэтому цвета задаём через active, а не CSS-селектором span).
  const renderRow = (topic: TopicRow, dimmed = false) => {
    const active = topic.rootMsgId === activeRootMsgId
    const titleColor = active ? '#fff' : 'var(--tg-textPrimary)'
    const subColor = active ? 'rgba(255,255,255,0.9)' : 'var(--tg-textSecondary)'
    const metaColor = active ? 'rgba(255,255,255,0.85)' : 'var(--tg-textFaint)'
    return (
      <div
        key={topic.id}
        className={classNames(s.row, active ? s.rowActive : '', dimmed ? s.rowDimmed : '')}
        onClick={() => handleOpenTopic(topic)}
        onContextMenu={(e) => openRowMenu(e, topic)}
      >
        <div className={s.titleRow}>
          {topic.isGeneral ? (
            <TopicIcon color={0} title="#" size={20} />
          ) : (
            <TopicIcon color={topic.iconColor} emoji={topic.iconEmoji} title={topic.title} size={20} />
          )}
          <Text noWrap size={16} weight={500} color={titleColor} style={{ flex: 1 }}>
            {topic.isGeneral ? t('General') : topic.title}
          </Text>
          {/* muted тема — иконка nosound серым (tweb .is-muted .dialog-title .tgico-nosound) */}
          {topic.muted && <TgIcon name="muted" size={17} color={metaColor} style={{ flexShrink: 0 }} />}
          {/* закрытая тема — замок; иначе исходящее последнее — галочки «доставлено»
              (read-tracking исходящих в тредах нет, поэтому всегда ✓✓). */}
          {topic.closed ? (
            <TgIcon name="lock" size={16} color={metaColor} style={{ flexShrink: 0 }} />
          ) : topic.lastOut ? (
            <TgIcon name="checks" size={18} color={active ? '#fff' : 'var(--tg-accent)'} style={{ flexShrink: 0 }} />
          ) : null}
          <Text size={12} color={metaColor} style={{ flexShrink: 0 }}>{fmtWhen(topic.lastAt)}</Text>
        </div>
        <div className={s.subtitleRow}>
          <Text noWrap size={16} color={subColor} style={{ flex: 1 }}>
            {topic.lastSenderName ? `${topic.lastSenderName}: ` : ''}
            {topic.lastText || mediaLabel(topic.lastType)}
          </Text>
          {/* Порядок бейджей как в tweb: mention → unread; pinned вместо счётчика у прочитанной. */}
          {topic.unreadMentions > 0 && <Badge muted={topic.muted} className={s.badge}>@</Badge>}
          {topic.unread > 0 ? (
            <Badge muted={topic.muted} className={s.badge}>{topic.unread}</Badge>
          ) : topic.pinned ? (
            <TgIcon name="chatspinned" size={19} color={metaColor} style={{ flexShrink: 0 }} />
          ) : null}
        </div>
      </div>
    )
  }

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

      {/* контекстное меню ряда темы (tweb topic actions) */}
      <Menu
        open={rowMenu != null}
        onClose={() => setRowMenu(null)}
        style={rowMenu ? { top: rowMenu.top, left: rowMenu.left, transformOrigin: 'top left' } : undefined}
      >
        {rowMenu && [
          <MenuItem
            key="edit"
            icon={<TgIcon name="edit" size={20} />}
            label={t('Edit Topic')}
            onClick={() => { const tp = rowMenu.topic; setRowMenu(null); setEditing(tp) }}
          />,
          ...(!rowMenu.topic.isGeneral ? [
            <MenuItem
              key="pin"
              icon={<TgIcon name={rowMenu.topic.pinned ? 'unpin' : 'pin'} size={20} />}
              label={rowMenu.topic.pinned ? t('Unpin') : t('Pin')}
              onClick={() => { const tp = rowMenu.topic; setRowMenu(null); void managers.groups.setTopicPinned(chatId, tp.id, !tp.pinned).then(reload) }}
            />,
          ] : []),
          // Уведомления темы (mute/unmute) — как в диалоге; адресуется по rootMsgId.
          <MenuItem
            key="mute"
            icon={<TgIcon name={rowMenu.topic.muted ? 'unmute' : 'mute'} size={20} />}
            label={rowMenu.topic.muted ? t('Unmute') : t('Mute')}
            onClick={() => { const tp = rowMenu.topic; setRowMenu(null); void managers.groups.setTopicMuted(chatId, tp.rootMsgId, !tp.muted).then(reload) }}
          />,
          <MenuItem
            key="hide"
            icon={<TgIcon name={rowMenu.topic.hidden ? 'eye' : 'hide'} size={20} />}
            label={rowMenu.topic.hidden ? t('Unhide') : t('Hide')}
            onClick={() => { const tp = rowMenu.topic; setRowMenu(null); void managers.groups.setTopicHidden(chatId, tp.id, !tp.hidden).then(reload) }}
          />,
          ...(!rowMenu.topic.isGeneral ? [
            <MenuItem
              key="close"
              icon={<TgIcon name={rowMenu.topic.closed ? 'message' : 'lock'} size={20} />}
              label={rowMenu.topic.closed ? t('Reopen Topic') : t('Close Topic')}
              onClick={() => { const tp = rowMenu.topic; setRowMenu(null); void managers.groups.closeTopic(chatId, tp.id, !tp.closed).then(reload) }}
            />,
          ] : []),
        ]}
      </Menu>

      <div className={s.list}>
        {topics != null && all.length === 0 && (
          <Text size={14.5} color="var(--tg-textSecondary)" style={{ padding: '3rem 1rem', textAlign: 'center', display: 'block' }}>
            {t('No topics')}
          </Text>
        )}
        {visible.map((topic) => renderRow(topic))}

        {hidden.length > 0 && (
          <>
            <div className={s.hiddenHeader} onClick={() => setShowHidden((v) => !v)}>
              <TgIcon name={showHidden ? 'down' : 'next'} size={16} color="var(--tg-textFaint)" />
              <Text size={13} weight={600} color="var(--tg-textSecondary)">
                {t('Hidden Topics')} ({hidden.length})
              </Text>
            </div>
            {showHidden && hidden.map((topic) => renderRow(topic, true))}
          </>
        )}
      </div>

      {createOpen && (
        <TopicFormPopup
          onClose={() => setCreateOpen(false)}
          onSubmit={(title, color, emoji) => {
            setCreateOpen(false)
            void managers.groups.createTopic(chatId, title, color, emoji).then(reload)
          }}
        />
      )}
      {editing && (
        <TopicFormPopup
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={(title, color, emoji) => {
            const tp = editing
            setEditing(null)
            void managers.groups.editTopic(chatId, tp.id, title, color, emoji).then(reload)
          }}
        />
      )}
    </div>
  )
}

// Форма темы (создание/редактирование, tweb editTopic): имя + emoji/цвет значка.
// Клик по большому значку циклит цвет (когда emoji не выбран). У General
// (initial.isGeneral) правится только имя — значок системный.
function TopicFormPopup({ initial, onSubmit, onClose }: {
  initial?: TopicRow
  onSubmit: (title: string, color: number, emoji: string) => void
  onClose: () => void
}) {
  const t = useT()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [color, setColor] = useState(initial?.iconColor ?? 0)
  const [emoji, setEmoji] = useState(initial?.iconEmoji ?? '')
  const isGeneral = initial?.isGeneral ?? false
  return (
    <Popup
      open
      title={initial ? t('Edit Topic') : t('New Topic')}
      onClose={onClose}
      width={360}
      action={{ label: initial ? t('Save') : t('Create'), onClick: () => title.trim() && onSubmit(title.trim(), color, emoji) }}
    >
      <div className={s.createBody}>
        <div
          onClick={() => !isGeneral && !emoji && setColor((c) => (c + 1) % TOPIC_COLORS.length)}
          style={{ cursor: isGeneral || emoji ? 'default' : 'pointer' }}
        >
          {isGeneral ? (
            <TopicIcon color={0} title="#" size={56} />
          ) : (
            <TopicIcon color={color} emoji={emoji} title={title || '#'} size={56} />
          )}
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
      {!isGeneral && (
        <div className={s.emojiGrid}>
          <button
            type="button"
            className={classNames(s.emojiCell, !emoji ? s.emojiCellActive : '')}
            onClick={() => setEmoji('')}
            title={t('Close')}
          >
            <TgIcon name="colorize" size={20} />
          </button>
          {TOPIC_EMOJI.map((e) => (
            <button
              type="button"
              key={e}
              className={classNames(s.emojiCell, emoji === e ? s.emojiCellActive : '')}
              onClick={() => setEmoji(e)}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </Popup>
  )
}
