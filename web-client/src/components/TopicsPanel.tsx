// Панель топиков форум-группы (tweb ForumTab/GroupForumTab): слайд в ЛЕВОМ
// сайдбаре поверх списка чатов — правая колонка при этом не трогается. Шапка:
// «назад», название группы + «N тем», меню (Новая тема — по правам, Показать
// как сообщения). Ряды 64px без аватара (tweb topic-dialogs-override): иконка
// топика в строке названия, превью последнего сообщения, время. Клик по теме
// открывает её тред в колонке чата (tweb setPeer({peerId, threadId})).
//
// Список видимых тем — то же виртуальное ядро, что у списка чатов и оверлея
// архива (`DeferredSortedVirtualList`): в tweb это `SortedDialogList` с
// `itemSize: 64, noAvatar: true` (`forumTab/groupForumTab.ts:27-32`).
import { memo, useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import Badge from '../shared/ui/Badge'
import IconButton from '../shared/ui/IconButton'
import Popup from '../shared/ui/Popup'
import Menu, { MenuItem } from '../shared/ui/Menu'
import DeferredSortedVirtualList, {
  type DeferredSortedVirtualListItem,
  type DeferredSortedVirtualListRenderItemProps,
} from './virtual/DeferredSortedVirtualList'
import { useManagers } from '../core/hooks/useManagers'
import { useMiddlewareHelper } from '../core/hooks/useMiddlewareHelper'
import { useEvent } from '../core/hooks/useEvent'
// Тип строки данных темы. Локальный алиас — потому что `TopicRow` в этом файле
// занят мемоизированным КОМПОНЕНТОМ строки (см. ниже).
import type { TopicRow as Topic } from '../core/managers/groupsManager'
import { fmtWhen, previewOf } from '../core/dialogToChat'
import { messageDateISO } from '../core/messageToConvMsg'
import { getPeerTitle } from '../core/peers/getPeerTitle'
import { cachedPeer } from '../core/peerCache'
import { useChatsStore } from '../stores/chatsStore'
import { useT, useTArgs } from '../i18n'
import classNames from '../shared/lib/classNames'
import s from './TopicsPanel.module.scss'
import { hasRights } from '../core/peers/rights'

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

/** Высота строки темы — `itemSize: 64` из tweb `forumTab/groupForumTab.ts:28`. */
const TOPIC_ITEM_HEIGHT = 64

/**
 * Пагинации у тем нет (весь список приезжает одним RPC `listTopics`), поэтому
 * просить страницу некому. Ссылка обязана быть СТАБИЛЬНОЙ — контракт пропа
 * `requestItemForIdx` ядра: он зовётся из эффекта каждой непоказанной строки.
 *
 * Сама эта стабильность СОЗНАТЕЛЬНО НЕ ПОКРЫТА тестом: при
 * `totalCount === items.length` дырок в списке не бывает вовсе, непоказанных
 * строк нет, а вызов и так пустой (проверено мутацией «инлайновая стрелка
 * вместо константы» — `TopicsPanel.test.tsx` остаётся зелёным).
 *
 * Тот же локальный `NO_ITEM_REQUEST` под тот же контракт живёт в
 * `userInfo/SharedMedia.tsx:479` (у архива своего больше нет: `Sidebar.tsx`
 * теперь просит страницы настоящим курсором — `useDialogListSource`).
 */
const NO_ITEM_REQUEST = () => {}

/**
 * Ряд темы «как диалог» (tweb DialogElement без аватара): иконка темы в
 * заголовке, галочки/замок/mute справа, бейджи mention/unread/pinned в превью.
 * В активном (открытом) ряду фон акцентный — весь текст/иконки светлые (Text
 * рендерит div, поэтому цвета задаём через active, а не CSS-селектором span).
 *
 * Отдельный `memo`-компонент, а не функция в теле панели: строка входит в окно
 * виртуального списка, и пересоздание её на каждом рендере панели обнуляло бы
 * мемоизацию окна — виртуализация не давала бы ничего. Отсюда же требование к
 * вызывающему: все пропсы стабильны (колбэки — `useEvent`, `topic` — обёртка из
 * кэша), иначе `memo` не держит.
 */
export const TopicRow = memo(function TopicRow({ topic, active, dimmed, onOpen, onContextMenu, ref }: {
  topic: Topic
  /** тема открыта в колонке чата — ряд подсвечен акцентом */
  active: boolean
  /** ряд из свёрнутой секции скрытых тем — приглушённый */
  dimmed?: boolean
  onOpen: (topic: Topic) => void
  onContextMenu: (e: React.MouseEvent, topic: Topic) => void
  /** ref виртуального списка; у строк секции скрытых тем его нет (они в потоке) */
  ref?: Ref<HTMLDivElement>
}) {
  const t = useT()
  const meId = useChatsStore((st) => st.meId)
  // Превью, время и «моё ли последнее» ВЫВОДЯТСЯ из самого сообщения: сервер
  // больше не везёт ни `last_text`, ни `last_at`, ни склеенное подзапросом
  // `last_sender_name` — сообщение приезжает вектором контейнера, а имя автора
  // собирает клиент из карточки пира (то же правило, что в списке чатов).
  const lm = topic.lastMessage
  const lastMine = lm != null && meId != null && lm.fromId === meId
  const preview = previewOf(lm).text
  const author = !lastMine && lm?.fromId
    ? getPeerTitle({ peerId: lm.fromId, peer: cachedPeer(lm.fromId), onlyFirstName: true })
    : ''
  const titleColor = active ? '#fff' : 'var(--primary-text-color)'
  const subColor = active ? 'rgba(255,255,255,0.9)' : 'var(--secondary-text-color)'
  const metaColor = active ? 'rgba(255,255,255,0.85)' : 'var(--secondary-text-color)'
  return (
    <div
      ref={ref}
      className={classNames(s.row, active ? s.rowActive : '', dimmed ? s.rowDimmed : '')}
      onClick={() => onOpen(topic)}
      onContextMenu={(e) => onContextMenu(e, topic)}
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
        ) : lastMine ? (
          <TgIcon name="checks" size={18} color={active ? '#fff' : 'var(--primary-color)'} style={{ flexShrink: 0 }} />
        ) : null}
        <Text size={12} color={metaColor} style={{ flexShrink: 0 }}>
          {fmtWhen(lm ? messageDateISO(lm.date) : undefined)}
        </Text>
      </div>
      <div className={s.subtitleRow}>
        <Text noWrap size={16} color={subColor} style={{ flex: 1 }}>
          {author ? `${author}: ` : ''}
          {preview}
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
})

export default function TopicsPanel({ chatId, chatName, activeRootMsgId, onClose, onOpenTopic, onViewAsMessages }: {
  chatId: number
  chatName: string
  /** rootMsgId темы, открытой в колонке чата — её ряд подсвечен */
  activeRootMsgId: number | null
  onClose: () => void
  onOpenTopic: (topic: Topic) => void
  onViewAsMessages: () => void
}) {
  const t = useT()
  const tArgs = useTArgs()
  const managers = useManagers()
  const middlewareHelper = useMiddlewareHelper()
  const chatIdRef = useRef(chatId)
  chatIdRef.current = chatId
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Topic | null>(null)
  // Поиск по темам (tweb: кнопка search в шапке форум-таба); null — закрыт.
  const [query, setQuery] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null)
  // контекстное меню ряда темы (правый клик / long-press, tweb)
  const [rowMenu, setRowMenu] = useState<{ topic: Topic; top: number; left: number } | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  // «Новая тема» — создатель или право «Изменение инфо» (tweb manage_topics)
  const [canManage, setCanManage] = useState(false)

  const reload = () => {
    const forChat = chatId
    // Если к моменту позднего вызова из меню чат уже сменился — выходим
    if (forChat !== chatIdRef.current) return
    const middleware = middlewareHelper.get()
    void managers.groups.listTopics(forChat)
      .then((t) => { if (middleware()) setTopics(t) })
      .catch(() => { if (middleware()) setTopics([]) })
  }
  useEffect(() => {
    setTopics(null)
    reload()
    const middleware = middlewareHelper.get()
    void managers.groups.card(chatId).then((c) => {
      // Право — у конструктора `channel` (`pFlags.creator` / `admin_rights`),
      // а не у поля `my_role` и битмаска, которых на проводе больше нет.
      if (middleware()) setCanManage(hasRights(c?.chat, 'change_info'))
    }).catch(() => { if (middleware()) setCanManage(false) })
    // Смена chatId/unmount гасит висящий reload() из меню и ответы эффекта.
    return () => middlewareHelper.clean()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId])

  const all = (topics ?? []).filter((topic) => !query || topic.title.toLowerCase().includes(query.trim().toLowerCase()))
  const visible = all.filter((topic) => !topic.hidden)
  const hidden = all.filter((topic) => topic.hidden)

  // Колбэки строк — стабильными ссылками (`useEvent`): они входят в пропсы
  // `memo`-строки, и новая стрелка на каждом рендере панели перерисовывала бы
  // всё окно списка.
  const openRowMenu = useEvent((e: React.MouseEvent, topic: Topic) => {
    if (!canManage) return
    e.preventDefault()
    setRowMenu({ topic, top: e.clientY, left: e.clientX })
  })

  // Клик по теме: открыть тред + оптимистично пометить прочитанной (обнулить
  // unread этого ряда локально; реальные данные подтянутся при следующем reload).
  const handleOpenTopic = useEvent((topic: Topic) => {
    if (topic.unread > 0 || topic.unreadMentions > 0) {
      setTopics((cur) => (cur ?? []).map((tp) => (tp.id === topic.id ? { ...tp, unread: 0, unreadMentions: 0 } : tp)))
      void managers.groups.readTopic(chatId, topic.rootMsgId, topic.lastMsgSeq).catch(() => {})
    }
    onOpenTopic(topic)
  })

  // Хост нужен ядру ЗНАЧЕНИЕМ (оно вешает на него слушатель скролла и
  // ResizeObserver), поэтому это состояние: первый рендер идёт с null, второй —
  // с живым узлом. Ref-колбэк обязан быть СТАБИЛЬНЫМ: смена идентичности
  // заставила бы React переприсваивать его на каждом рендере, то есть на каждом
  // рендере пересобирать окно видимости. Всё — как в `ChatList`/`ArchiveList`.
  const [scrollHost, setScrollHost] = useState<HTMLElement | null>(null)
  const setListEl = useCallback((ul: HTMLUListElement | null) => {
    setScrollHost(ul?.parentElement ?? null)
  }, [])

  // Обёртки строк, живущие между пересчётами, — контракт пропа `items` ядра
  // (`DeferredSortedVirtualList.tsx:64-80`): обёртка приезжает НОВОЙ, только
  // когда изменилось её значение. Без кэша `visible.map(...)` отдавал бы новые
  // обёртки на ЛЮБОЙ рендер панели (открыли меню, набрали букву в поиске), и
  // `memo` строки не держал бы ничего, а `useShouldAnimate` не находил бы
  // прежние строки по ссылке — компенсация равномерного сдвига не срабатывала бы.
  const itemCacheRef = useRef<Map<number, DeferredSortedVirtualListItem<Topic>>>(new Map())
  const prevItemsRef = useRef<readonly DeferredSortedVirtualListItem<Topic>[]>([])

  const items = useMemo<readonly DeferredSortedVirtualListItem<Topic>[]>(() => {
    const cache = itemCacheRef.current
    const seen = new Set<number>()
    const next = visible.map((topic) => {
      seen.add(topic.id)
      const hit = cache.get(topic.id)
      if (hit && hit.value === topic) return hit
      const item: DeferredSortedVirtualListItem<Topic> = { id: topic.id, value: topic }
      cache.set(topic.id, item)
      return item
    })
    for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id)

    // Вторая половина контракта — ссылка на САМ массив. СОЗНАТЕЛЬНО НЕ ПОКРЫТА
    // (как и у архива, `Sidebar.tsx`): при живом кэше выше её снятие не
    // наблюдаемо — состав пересчёта тот же и по ссылкам, поэтому
    // `useShouldAnimate` находит все видимые строки на прежних местах и
    // компенсирует нулевой сдвиг, то есть ничего не делает.
    const prev = prevItemsRef.current
    if (prev.length === next.length && prev.every((it, i) => it === next[i])) return prev
    prevItemsRef.current = next
    return next
  }, [visible])

  // Меняется только на смене активной темы — на кадре скролла нет.
  const renderItem = useCallback(
    ({ value, itemRef }: DeferredSortedVirtualListRenderItemProps<Topic>) => (
      <TopicRow
        ref={itemRef as Ref<HTMLDivElement>}
        topic={value}
        active={value.rootMsgId === activeRootMsgId}
        onOpen={handleOpenTopic}
        onContextMenu={openRowMenu}
      />
    ),
    [activeRootMsgId, handleOpenTopic, openRowMenu],
  )

  return (
    <div className={s.root}>
      <div className={s.header}>
        <IconButton onClick={onClose} color="var(--secondary-text-color)" aria-label={t('Close')}>
          <TgIcon name="close" size={24} />
        </IconButton>
        {query === null ? (
          <div className={s.headerBody}>
            <Text noWrap size={16.5} weight={600} color="var(--primary-text-color)">{chatName}</Text>
            <Text size={13} color="var(--secondary-text-color)">
              {topics ? tArgs('TopicsCount', [topics.length]) : t('Topics')}
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
          color="var(--secondary-text-color)"
          aria-label={t('Search')}
        >
          <TgIcon name={query === null ? 'search' : 'close'} size={24} />
        </IconButton>
        <IconButton
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setMenuAnchor({ top: r.bottom + 4, right: window.innerWidth - r.right })
          }}
          color="var(--secondary-text-color)"
          aria-label={t('Common.Menu')}
        >
          <TgIcon name="more" size={24} />
        </IconButton>
      </div>

      <Menu
        open={menuAnchor != null}
        onClose={() => setMenuAnchor(null)}
        corner="bottom-left"
        style={menuAnchor ? { top: menuAnchor.top, right: menuAnchor.right } : undefined}
      >
        {canManage && (
          <MenuItem
            icon={<TgIcon name="add" size={20} />}
            label={t('NewTopic')}
            onClick={() => { setMenuAnchor(null); setCreateOpen(true) }}
          />
        )}
        <MenuItem
          icon={<TgIcon name="message" size={20} />}
          label={t('ForumTopic.Context.ShowAsMessages')}
          onClick={() => { setMenuAnchor(null); onViewAsMessages() }}
        />
      </Menu>

      {/* контекстное меню ряда темы (tweb topic actions) */}
      <Menu
        open={rowMenu != null}
        onClose={() => setRowMenu(null)}
        corner="bottom-right"
        style={rowMenu ? { top: rowMenu.top, left: rowMenu.left } : undefined}
      >
        {rowMenu && [
          <MenuItem
            key="edit"
            icon={<TgIcon name="edit" size={20} />}
            label={t('ForumTopic.Title.Edit')}
            onClick={() => { const tp = rowMenu.topic; setRowMenu(null); setEditing(tp) }}
          />,
          ...(!rowMenu.topic.isGeneral ? [
            <MenuItem
              key="pin"
              icon={<TgIcon name={rowMenu.topic.pinned ? 'unpin' : 'pin'} size={20} />}
              label={rowMenu.topic.pinned ? t('ChatList.Context.Unpin') : t('ChatList.Context.Pin')}
              onClick={() => { const tp = rowMenu.topic; setRowMenu(null); void managers.groups.setTopicPinned(chatId, tp.id, !tp.pinned).then(reload) }}
            />,
          ] : []),
          // Уведомления темы (mute/unmute) — как в диалоге; адресуется по rootMsgId.
          <MenuItem
            key="mute"
            icon={<TgIcon name={rowMenu.topic.muted ? 'unmute' : 'mute'} size={20} />}
            label={rowMenu.topic.muted ? t('ChatList.Context.Unmute') : t('ChatList.Context.Mute')}
            onClick={() => { const tp = rowMenu.topic; setRowMenu(null); void managers.groups.setTopicMuted(chatId, tp.rootMsgId, !tp.muted).then(reload) }}
          />,
          <MenuItem
            key="hide"
            icon={<TgIcon name={rowMenu.topic.hidden ? 'eye' : 'hide'} size={20} />}
            label={rowMenu.topic.hidden ? t('ForumTopic.Unhide') : t('Hide')}
            onClick={() => { const tp = rowMenu.topic; setRowMenu(null); void managers.groups.setTopicHidden(chatId, tp.id, !tp.hidden).then(reload) }}
          />,
          ...(!rowMenu.topic.isGeneral ? [
            <MenuItem
              key="close"
              icon={<TgIcon name={rowMenu.topic.closed ? 'message' : 'lock'} size={20} />}
              label={rowMenu.topic.closed ? t('RestartTopic') : t('CloseTopic')}
              onClick={() => { const tp = rowMenu.topic; setRowMenu(null); void managers.groups.closeTopic(chatId, tp.id, !tp.closed).then(reload) }}
            />,
          ] : []),
        ]}
      </Menu>

      <div className={s.list}>
        {topics != null && all.length === 0 && (
          <Text size={14.5} color="var(--secondary-text-color)" style={{ padding: '3rem 1rem', textAlign: 'center', display: 'block' }}>
            {t('NoTopics')}
          </Text>
        )}
        {/* Виртуализируется ТОЛЬКО список видимых тем; секция скрытых ниже
            остаётся обычным потоком. Это осознанное отступление (спека
            `2026-08-13-remaining-lists-design.md`, «Отступления от tweb» №1):
            у секции свой заголовок-раскрывашка, а ядро умеет только однородные
            строки фиксированной высоты. В tweb скрытые темы живут в том же
            `SortedDialogList` — отступление СУЩЕСТВУЮЩЕЕ, не вводимое этим
            переносом.

            Пагинации у тем нет: весь список приезжает одним `listTopics`,
            поэтому `totalCount` — длина набора (дырок-скелетонов не бывает
            вовсе), а `wasAtLeastOnceFetched` взводится ответом владельца.
            Значение `totalCount` СОЗНАТЕЛЬНО НЕ ПОКРЫТО тестом: ядро берёт
            `max(totalCount, items.length)` (`fullItems`), поэтому при живых
            `items` любое НЕ большее значение не наблюдаемо (проверено мутацией
            `totalCount={0}` — прогон зелёный). Проп держится ради контракта.
            `noAvatar` — из tweb `groupForumTab.ts:29` (у темы аватара нет,
            значок стоит в строке названия).

            `extraPaddingBottom: 0` — отступление от дефолтных 8px ядра
            (`deferredSortedVirtualList.tsx:55`): нижний клиренс у нас уже даёт
            `padding-bottom` самого контейнера прокрутки (`.list`), а СРАЗУ за
            `ul` в потоке идёт секция скрытых тем — второй клиренс сдвинул бы её
            заголовок. Тот же приём, что у tweb-списка «Избранное»
            (`appSearchSuper.ts:1906` — `extraPaddingBottom: 0`, тоже вложенный
            список).

            `animate` — константа: в оригинале это `blockedAnimationCount() === 0`,
            а счётчик глушилки держит владелец ПЕРВОЙ ЗАГРУЗКИ, которой у тем
            нет. Значение СОЗНАТЕЛЬНО НЕ ПОКРЫТО (как и у архива): оно доходит до
            `useAnimatedTop`, который анимирует `top` в DOM покадрово, а в
            happy-dom наблюдаемой разницы у `animate={false}` нет; сама механика
            покрыта `virtual/useAnimatedTop.test.ts`. */}
        <DeferredSortedVirtualList<Topic>
          listRef={setListEl}
          className={s.virtualList}
          scrollableHost={scrollHost}
          items={items}
          totalCount={items.length}
          wasAtLeastOnceFetched={topics != null}
          itemSize={TOPIC_ITEM_HEIGHT}
          noAvatar
          extraPaddingBottom={0}
          animate
          requestItemForIdx={NO_ITEM_REQUEST}
          renderItem={renderItem}
        />

        {hidden.length > 0 && (
          <>
            <div className={s.hiddenHeader} onClick={() => setShowHidden((v) => !v)}>
              <TgIcon name={showHidden ? 'down' : 'next'} size={16} color="var(--secondary-text-color)" />
              <Text size={13} weight={600} color="var(--secondary-text-color)">
                {t('ForumTopic.Hidden')} ({hidden.length})
              </Text>
            </div>
            {showHidden && hidden.map((topic) => (
              <TopicRow
                key={topic.id}
                topic={topic}
                active={topic.rootMsgId === activeRootMsgId}
                dimmed
                onOpen={handleOpenTopic}
                onContextMenu={openRowMenu}
              />
            ))}
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
  initial?: Topic
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
      title={initial ? t('ForumTopic.Title.Edit') : t('NewTopic')}
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
          placeholder={t('ForumTopic.Name.Placeholder')}
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
