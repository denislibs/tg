// userInfo/SharedMedia.tsx
// Шаред-медиа секция панели профиля (порт tweb sidebarRight/tabs/sharedMedia):
// липкий таб-ряд + скользящий контент по табам (Участники/Чаты/Подарки и
// непустые медиа-табы Media/Files/Links/Music/Voice). Данные тянет per-filter
// из mediaHistory, глобальный плеер — из audioStore, просмотрщик — vanilla-
// вьювер (mediaViewer/openMediaViewer, Task 16).
import type { LangPackKey } from '@/lang'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import Avatar from '../../shared/ui/Avatar'
import UserAvatar from '../UserAvatar'
import PlayPauseGlyph from '../PlayPauseGlyph'
import StarIcon from '../stars/StarIcon'
import { TabSlide } from '../../shared/ui/Tabs'
import { useRipple } from '../../shared/ui/Ripple/useRipple'
import classNames from '../../shared/lib/classNames'
import { useT, useLang } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { useMirrorWindow } from '../../core/hooks/useMirrorWindow'
import { winKey } from '../../core/history/messagesMirror'
import { useAudioStore, type AudioTrack } from '../../stores/audioStore'
import { markMediaPlayed } from '../../core/mediaRead'
import { getDocumentFromMessage, getMediaFromMessage, hasServerThumb } from '../../core/media/messageMedia'
import { friendlyMsgTime } from '../../core/format/friendlyTime'
import { EXT_COLORS, extOf, firstUrl, fmtDur, fmtSize, hostOf } from '../../core/format/sharedMediaFmt'
import MediaGridThumb from '../MediaGridThumb'
import { fmtWhen, previewOf } from '../../core/dialogToChat'
import { roleLabel, type RealMember } from '../../core/hooks/useGroupInfo'
import type { SavedDialog } from '../../core/managers/chatsManager'
import { isGiftHidden, type SavedStarGift } from '../../core/managers/starsManager'
import { getPeerId, isUser } from '../../core/peers/peerId'
import { getPeerPhotoId } from '../../core/peers/peer'
import { getChatPhoto } from '../../core/peers/predicates'
import { getMessageText, type MyMessage } from '../../core/models'
import { getMediaId, getMessageKind } from '../../core/messages/messageKind'
import { messageDateISO } from '../../core/messageToConvMsg'
import type { OpenPeer } from '../../data'
import { cachedPeer } from '../../core/peerCache'
import type { Chat as PeerChat, User } from '../../core/peers/peer'
import { isUserStatusOnline } from '../../core/peers/peer'
import { getPeerTitle, getUserTitle } from '../../core/peers/getPeerTitle'
import { usePeers } from '../../core/hooks/usePeers'
import { userStatusLabel } from '../../core/presence'
import { messageToViewerItem } from '../mediaViewer/collectLightboxItems'
import { openMediaViewer } from '../mediaViewer/openMediaViewer'
import DeferredSortedVirtualList, {
  type DeferredSortedVirtualListItem,
  type DeferredSortedVirtualListRenderItemProps,
} from '../virtual/DeferredSortedVirtualList'
import { useEvent } from '../../core/hooks/useEvent'
// Витрина подарков — модули tweb 1:1 (см. комментарий у рендера ниже)
import giftsGrid from '../stargifts/stargiftsGrid.module.scss'
import profileList from '../stargifts/profileList.module.scss'

const SHARED_TABS = ['SharedMediaTab2', 'SharedFilesTab2', 'SharedLinksTab2', 'SharedMusicTab2', 'SharedVoiceTab2'] as const
// Порядок узлов ряда — как в tweb (дамп 07-right-sidebar): сначала
// Chats/Members, затем Gifts и медиа-табы. Скрытые несут `hide`, но остаются.
const ALL_TABS = ['FilterChats', 'PeerMedia.Members', 'SharedMedia.Gifts', ...SHARED_TABS] as const
// Ключ строки ряда — он же идентификатор вкладки: своих английских имён у вкладок
// больше нет (задача 6), и таблица фильтров ключуется тем же, чем ряд.
type MediaFilter = 'media' | 'files' | 'links' | 'music' | 'voice'
const TAB_FILTER: Record<(typeof SHARED_TABS)[number], MediaFilter> = {
  SharedMediaTab2: 'media',
  SharedFilesTab2: 'files',
  SharedLinksTab2: 'links',
  SharedMusicTab2: 'music',
  SharedVoiceTab2: 'voice',
}

/**
 * Пункт таб-ряда шаред-медиа — `menu-horizontal-div-item` из tweb
 * (`horizontalMenu`, дамп 07-right-sidebar):
 *   div.menu-horizontal-div-item.rp[.active][.hide]
 *     > div.c-ripple + i.menu-horizontal-div-item-background
 *     + span.menu-horizontal-div-item-span > span.i18n
 * Подчёркивание активного рисует `i.menu-horizontal-div-item-background`,
 * своей полоски-индикатора у нас больше нет.
 */
function SharedMediaTab({ name, active, hidden, onClick }: { name: LangPackKey; active: boolean; hidden: boolean; onClick: () => void }) {
  const t = useT()
  const { onPointerDown, ripple } = useRipple()
  return (
    <div
      className={classNames('menu-horizontal-div-item rp', active ? 'active' : '', hidden ? 'hide' : '')}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      {ripple}
      <i className="menu-horizontal-div-item-background" />
      <span className="menu-horizontal-div-item-span">
        <span className="i18n">{t(name)}</span>
      </span>
    </div>
  )
}

export default function SharedMedia({ tab, onTab, chatId, members, savedDialogs, gifts, onOpenGift, onSendGift, isChannel, canManageAdmins, onOpenPeer, onEditMember, navRef, stickyTop, onCount }: {
  tab: LangPackKey
  onTab: (v: LangPackKey) => void
  chatId: number | null
  /** участники для первого таба (только реальные группы/каналы) */
  members?: RealMember[]
  /** «Избранное»: сохранённые диалоги для первого таба «Чаты» */
  savedDialogs?: SavedDialog[]
  /** подарки профиля пользователя (таб «Подарки») */
  gifts?: SavedStarGift[]
  onOpenGift?: (g: SavedStarGift) => void
  /** открыть попап отправки подарка из пустого состояния (только чужой профиль) */
  onSendGift?: () => void
  isChannel?: boolean
  canManageAdmins?: boolean
  onOpenPeer?: (peer: OpenPeer) => void
  onEditMember?: (m: RealMember) => void
  /** реф таб-плашки — родитель меряет её позицию при скролле (header-filled) */
  navRef?: React.Ref<HTMLDivElement>
  /** sticky-отступ табов под absolute-шапкой панели */
  stickyTop?: number
  /** счётчик загруженного таба — подзаголовок залитой шапки (tweb onLengthChange) */
  onCount?: (tab: LangPackKey, n: number) => void
}) {
  const t = useT()
  const [lang] = useLang()
  const managers = useManagers()
  // Имена дарителей собирает КЛИЕНТ из ссылок на пиры: серверной склейки
  // `from_name` на проводе больше нет.
  const giftSenders = usePeers((gifts ?? []).map((g) => (g.from_id ? getPeerId(g.from_id) : 0)).filter(Boolean))
  // Глобальный плеер: клик по строке «Музыка»/«Голосовые» ставит очередь из
  // сообщений таба; плеер-плашка выезжает над шапкой чата (NowPlayingBar).
  const meId = useChatsStore((st) => st.meId)
  const playQueue = useAudioStore((st) => st.playQueue)
  const togglePlay = useAudioStore((st) => st.toggle)
  const curMediaId = useAudioStore((st) => st.track?.mediaId)
  const audioPlaying = useAudioStore((st) => st.playing)
  // Кэш по фильтру с infinite scroll (tweb searchSuper.load + loadMutex):
  // страницы аккумулируются, hasMore гасится по total count с бэка.
  const [byFilter, setByFilter] = useState<Partial<Record<string, { msgs: MyMessage[]; hasMore: boolean }>>>({})
  const byFilterRef = useRef(byFilter)
  byFilterRef.current = byFilter
  // guard от параллельных загрузок одного фильтра (tweb loadMutex)
  const loadingRef = useRef(new Set<string>())
  // поколение кэша: инвалидация (новое сообщение) обесценивает in-flight ответы
  const genRef = useRef(0)
  const filter = TAB_FILTER[tab as (typeof SHARED_TABS)[number]] as MediaFilter | undefined
  const PAGE_SIZE = 30

  // Total-счётчики всех медиа-фильтров (tweb searchSuper counts): грузим один
  // лёгкий запрос на фильтр при открытии, чтобы скрывать пустые табы.
  const [totals, setTotals] = useState<Partial<Record<string, number>>>({})
  useEffect(() => {
    if (chatId == null) { setTotals({}); return }
    let alive = true
    void Promise.all(
      SHARED_TABS.map((name) =>
        managers.messages.mediaHistory(chatId, TAB_FILTER[name], 0, 1)
          .then((r) => [TAB_FILTER[name], r.count] as const)
          .catch(() => [TAB_FILTER[name], 0] as const),
      ),
    ).then((pairs) => { if (alive) setTotals(Object.fromEntries(pairs)) })
    return () => { alive = false }
  }, [chatId, managers])

  // Счётчик подарков для залитой шапки (у медиа-табов он приходит из mediaHistory).
  useEffect(() => { if (gifts) onCount?.('SharedMedia.Gifts', gifts.length) }, [gifts, onCount])

  // Live: новое сообщение в открытом чате инвалидирует кэш табов — активный
  // таб перезагрузится и свежая отправка (голосовое/фото/…) появится сразу.
  //
  // Сигнал — ДЛИНА окна из зеркала (`core/history/messagesMirror.ts`), а не из
  // zustand-копии: копия живёт только у React-ленты и уходит вместе с ней
  // (этап 7), а панель к рисованию баблов отношения не имеет. Молчаливая цена
  // ошибки здесь выше обычного: потеря сигнала не роняет ничего — вкладки
  // просто перестают обновляться, поэтому её ловит отдельный тест
  // (`SharedMedia.invalidate.test.tsx`).
  const winLen = useMirrorWindow(chatId != null ? winKey(chatId) : null).length
  useEffect(() => {
    genRef.current++
    loadingRef.current.clear()
    setByFilter({})
  }, [winLen])

  // Догрузка следующей страницы фильтра (append) с offset = уже загружено.
  const loadPage = (f: MediaFilter | undefined, forTab: LangPackKey) => {
    if (chatId == null || !f || loadingRef.current.has(f)) return
    const cur = byFilterRef.current[f]
    if (cur && !cur.hasMore) return
    const offset = cur?.msgs.length ?? 0
    const gen = genRef.current
    loadingRef.current.add(f)
    void managers.messages
      .mediaHistory(chatId, f, offset, PAGE_SIZE)
      .then((r) => {
        if (gen !== genRef.current) return
        setByFilter((d) => {
          const prev = d[f]?.msgs ?? []
          const msgs = prev.concat(r.messages)
          return { ...d, [f]: { msgs, hasMore: r.messages.length > 0 && msgs.length < r.count } }
        })
        // подзаголовок залитой шапки — TOTAL по фильтру (tweb onLengthChange)
        onCount?.(forTab, r.count)
      })
      .catch(() => {
        if (gen !== genRef.current) return
        setByFilter((d) => ({ ...d, [f]: d[f] ?? { msgs: [], hasMore: false } }))
      })
      .finally(() => loadingRef.current.delete(f))
  }
  const loadPageRef = useRef(loadPage)
  loadPageRef.current = loadPage

  // первая страница активного таба (и после инвалидации кэша)
  useEffect(() => {
    if (chatId == null || !filter || byFilter[filter]) return
    loadPageRef.current(filter, tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, filter, byFilter])

  const entry = filter ? byFilter[filter] : undefined
  const msgs = entry?.msgs
  const hasMore = entry?.hasMore ?? false

  // sentinel в конце грида/списка: доезжает до вьюпорта скролл-контейнера
  // панели → следующая страница (tweb: onScrolledBottom searchSuper.load)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    // root — фактический скролл-контейнер (панель скроллится целиком)
    let root: Element | null = el.parentElement
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) loadPageRef.current(filter, tab)
      },
      // порог дозагрузки — 300px до низа (tweb Scrollable.onScrollOffset = 300)
      { root, rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [filter, tab, hasMore, msgs?.length])

  const when = (m: MyMessage) => friendlyMsgTime(messageDateISO(m.date), lang)

  // Клик по строке: текущий трек — play/pause, иначе очередь из всего таба
  // с этой позиции; чужое непрослушанное голосовое гасит media_unread.
  const playRow = (m: MyMessage, title: string) => {
    if (getMediaId(m) == null || chatId == null) return
    if (getMediaId(m) === curMediaId) {
      togglePlay()
      return
    }
    const list = (msgs ?? []).filter((x) => getMediaId(x) != null)
    const tracks: AudioTrack[] = list.map((x) => ({
      mediaId: getMediaId(x) as number,
      title: getMessageKind(x) === 'audio' ? getDocumentFromMessage(x)?.file_name || t('SharedMedia.Audio') : title,
      subtitle: when(x),
      chatId,
      msgId: x.id,
    }))
    playQueue(tracks, list.indexOf(m))
    if ((m.fromId ?? 0) !== meId && m.pFlags.media_unread) markMediaPlayed(chatId, m.id)
  }

  // Просмотрщик медиа — тот же vanilla-вьювер, что в чате (клик по тайлу,
  // Task 16). items — из сообщений таба (messageToViewerItem); имена авторов —
  // из зеркала карточек пиров (core/peerCache), фолбэков чата у панели нет.
  // jump/forward/delete не пробрасываются — их не было и у старого лайтбокса.
  const openMedia = (rawIndex: number, e: React.MouseEvent<HTMLDivElement>) => {
    const list = (msgs ?? []).filter((m) => getMediaId(m) != null)
    // индекс грида — по msgs целиком; во вьювер идёт индекс в отфильтрованном
    const clicked = msgs?.[rawIndex]
    const index = clicked ? list.indexOf(clicked) : -1
    if (index < 0) return
    // Своё имя собирает клиент из краткого конструктора `user` — `display_name`
    // с провода убран.
    const me = useChatsStore.getState().me
    const ctx = {
      meId,
      meName: me ? getUserTitle(me.user) : undefined,
      peers: new Map(
        list.map((m) => [(m.fromId ?? 0), cachedPeer((m.fromId ?? 0))] as const)
          .filter((p): p is [PeerId, User | PeerChat] => !!p[1]),
      ),
      lang,
    }
    const el = e.currentTarget
    const items = list.map((m, i) => messageToViewerItem(m, ctx, i === index ? el : null))
    // порядок таба — newest-first (REST), reverse не ставим: next = older ✓
    void openMediaViewer({ items, index, target: el })
  }
  const empty = (
    <Text size={14} color="var(--secondary-text-color)" style={{ padding: '16px 24px', display: 'block', textAlign: 'center' }}>
      {t('SharedMedia.Empty')}
    </Text>
  )

  // Порядок табов: Участники/Чаты → Подарки → непустые медиа-табы (tweb:
  // показываются только непустые). Медиа-таб появляется, лишь когда его total
  // загрузился и > 0 — иначе таб-бар мигал бы пустыми на открытии.
  const mediaTabs = SHARED_TABS.filter((name) => (totals[TAB_FILTER[name]] ?? 0) > 0)
  // Подарки: таб есть у любого пользовательского профиля (tweb показывает
  // витрину и пустой — с приглашением подарить); у групп/каналов gifts == null.
  const tabOrder: LangPackKey[] = [
    ...(savedDialogs ? (['FilterChats'] as const) : members ? (['PeerMedia.Members'] as const) : []),
    ...(gifts ? (['SharedMedia.Gifts'] as const) : []),
    ...mediaTabs,
  ]

  // Если активный таб пропал из набора (пустой/скрыт) — переключиться на первый.
  useEffect(() => {
    if (tabOrder.length > 0 && !tabOrder.includes(tab)) onTab(tabOrder[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabOrder.join(), tab])

  // Нечего показывать (пустой профиль без медиа/подарков/участников) — без табов.
  if (tabOrder.length === 0) return null

  return (
    <>
      {/* Таб-ряд шаред-медиа 1:1 с оригиналом (дамп 07-right-sidebar):
          градиент-обрезка + sticky-скроллер + nav.menu-horizontal-div.
          Неподходящие табы В DOM и скрыты классом `hide` (как в tweb), а не
          выброшены условным рендером — иначе `is-single` и раскладка ряда
          считались бы по другому набору узлов. */}
      <div className="menu-horizontal-gradient-container search-super-tabs-gradient-container">
        <div className="menu-horizontal-gradient menu-horizontal-gradient-color-background search-super-tabs-gradient" />
      </div>
      <div
        ref={navRef}
        className={classNames(
          'search-super-tabs-scrollable menu-horizontal-scrollable sticky',
          tabOrder.length === 1 ? 'is-single' : '',
        )}
        style={{ top: stickyTop }}
      >
        <div className="scrollable scrollable-x search-super-nav-scrollable">
          <nav className="search-super-tabs menu-horizontal-div">
            {ALL_TABS.map((name) => (
              <SharedMediaTab
                key={name}
                name={name}
                active={tab === name}
                hidden={!tabOrder.includes(name)}
                onClick={() => onTab(name)}
              />
            ))}
          </nav>
        </div>
      </div>

      {/* контент табов скользит ±100% (tweb TransitionSlider 'tabs') */}
      <TabSlide tab={tab} order={tabOrder} containerClassName="search-super-tabs-container" className="search-super-tab-container">
      {/* «Избранное» → «Чаты»: сохранённые диалоги по источнику пересылки.
          Список виртуальный (см. `SavedDialogsList`); заглушка пустого набора
          рендерится ВМЕСТО `ul`, а не внутри него — у виртуального `ul` своя
          геометрия под весь набор. */}
      {tab === 'FilterChats' && savedDialogs && (
        <div className="search-super-content-container search-super-content-savedDialogs">
          <div className="sidebar-left-section-container">
            <div className="sidebar-left-section no-delimiter">
              <div className="sidebar-left-section-content">
                {savedDialogs.length === 0 ? empty : <SavedDialogsList dialogs={savedDialogs} onOpenPeer={onOpenPeer} />}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'PeerMedia.Members' && members && (
        <div className="search-super-content-container search-super-content-members">
          <div className="sidebar-left-section-container">
            <div className="sidebar-left-section no-delimiter">
              <div className="sidebar-left-section-content">
                {/* Строки участников — тот же `chatlist-chat`, что у списка чатов
                    (дамп 15-right-11): `a.row.chatlist-chat.chatlist-chat-abitbigger`
                    с `.row-row.row-title-row.dialog-title`, подписью и
                    `.row-media.row-media-abitbigger` под аватар. */}
                <ul className="chatlist">
                  {members.map((mem) => (
                    <a
                      key={mem.userId}
                      className="row no-wrap row-with-padding row-clickable hover-effect chatlist-chat chatlist-chat-abitbigger rp"
                      data-peer-id={mem.userId}
                      onClick={() => onOpenPeer?.({ id: mem.userId, title: mem.title, username: mem.username, photoId: mem.photoId })}
                    >
                      <div className="row-row row-title-row dialog-title">
                        <div className="row-title">{mem.title}</div>
                        {/* роль — правым слотом заголовка (tweb row-title-right-secondary) */}
                        <div
                          className="row-title row-title-right row-title-right-secondary"
                          onClick={canManageAdmins ? (e) => { e.stopPropagation(); onEditMember?.(mem) } : undefined}
                        >
                          {roleLabel(mem.role, !!isChannel)}
                        </div>
                      </div>
                      <div className="row-row row-subtitle-row dialog-subtitle">
                        <div className="row-subtitle">{userStatusLabel(mem.status, lang)}</div>
                      </div>
                      <UserAvatar
                        id={mem.userId}
                        name={mem.title}
                        photoId={mem.photoId}
                        online={isUserStatusOnline(mem.status, Date.now() / 1000)}
                        className="dialog-avatar row-media row-media-abitbigger"
                      />
                    </a>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Подарки профиля (tweb stargifts/profileList): сетка полученных подарков.
          Скрытые (hidden) приходят только владельцу — помечаем «глаз-off» и
          приглушаем. Ограниченные — бейдж «Лимит»; отправитель — мини-аватар
          (аноним → безликий кружок), как itemFrom/itemUnsaved в tweb. */}
      {/* Витрина подарков — модули САМОГО tweb, портированные дословно
          (`components/stargifts/stargiftsGrid.module.scss` и
          `profileList.module.scss`): в оригинале подарки тоже сделаны
          CSS-модулями, а не глобальными классами, так что это та же форма.
          `gridItem` — плитка, `itemPrice` — цена в звёздах, `itemFrom` —
          мини-аватар дарителя (аноним → `itemFromAnonymous`), `itemLock` —
          метка скрытого, `empty*` — пустое состояние из profileList. */}
      {tab === 'SharedMedia.Gifts' && gifts && (
        gifts.length === 0 ? (
          <div className={profileList.empty}>
            <div className={profileList.emptyTitle}>{t('SharedMedia.Gifts.Empty')}</div>
            {onSendGift && (
              <button type="button" className="btn-primary btn-color-primary btn-control" onClick={onSendGift}>
                {t('Chat.Menu.SendGift')}
              </button>
            )}
          </div>
        ) : (
          <div className={classNames(giftsGrid.grid, giftsGrid.viewProfile)}>
            {gifts.map((g) => {
              // Аноним — это ОТСУТСТВИЕ `from_id` (флаг `name_hidden` и значит
              // «дарителя не показываем»), а не пустая карточка рядом с флагом.
              const fromId = g.from_id ? getPeerId(g.from_id) : undefined
              const anon = !!g.pFlags?.name_hidden || fromId == null
              return (
                <div key={g.saved_id ?? g.date} className={giftsGrid.gridItem} onClick={() => onOpenGift?.(g)}>
                  {isGiftHidden(g) && <TgIcon name="hide" size={16} className={giftsGrid.itemLock} />}
                  {g.gift.pFlags?.limited && <span className={giftsGrid.badgeResale}>{t('StarGiftShowLimited')}</span>}
                  <span className={giftsGrid.itemSticker}>{g.gift.emoji}</span>
                  <span className={giftsGrid.itemPrice}>
                    <StarIcon size={12} />
                    {g.gift.stars}
                  </span>
                  <div className={giftsGrid.itemFrom}>
                    {anon ? (
                      <span className={giftsGrid.itemFromAnonymous}>?</span>
                    ) : (
                      // Имя дарителя собирает КЛИЕНТ из ссылки на пир: серверной
                      // склейки `from_name` на проводе больше нет.
                      <UserAvatar id={fromId} name={getPeerTitle({ peerId: fromId, peer: giftSenders.get(fromId) })} size={18} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {msgs != null && msgs.length === 0 && tab !== 'SharedMedia.Gifts' && empty}

      {/* Сетка медиа 1:1 с оригиналом (дамп 07-right-sidebar):
          `.search-super-content-media > .grid > .grid-item.search-super-item.media-container`,
          превью — `.grid-item-media`. `video-time` — плашка длительности
          (её же вьювер гасит на полёте мувера, FLOATING_CONTEXTS). */}
      {tab === 'SharedMediaTab2' && msgs != null && msgs.length > 0 && (
        <div className="search-super-content-container search-super-content-media">
        <div className="grid">
          {msgs.map((m, i) => (
            <div key={m.id} className="grid-item search-super-item media-container" data-mid={m.id} onClick={(e) => openMedia(i, e)}>
              {getMediaId(m) != null && (
                <MediaGridThumb className="grid-item-media" mediaId={getMediaId(m)!} hasThumb={hasServerThumb(getMediaFromMessage(m))} />
              )}
              {getMessageKind(m) === 'video' && <span className="video-time">{fmtDur(getDocumentFromMessage(m)?.duration)}</span>}
            </div>
          ))}
        </div>
        </div>
      )}

      {tab === 'SharedFilesTab2' && msgs != null && msgs.length > 0 && (
        <div className="search-super-content-container search-super-content-files">
        <div className="sidebar-left-section-container">
          <div className="sidebar-left-section no-delimiter">
            <div className="sidebar-left-section-content">
        {/* Строка файла — вендорный `.document` (порт tweb `wrapDocument`,
            стили `_document.scss` + доводка `.search-super-content-files`):
            `.document-container > .document-wrapper > .document.ext-{ext}`
            с `.document-ico > .document-ico-text`, `.document-name`,
            `.document-size` (дамп 03-document). Цвет квадрата даёт
            `--background-color`, как у оригинала. */}
        {msgs.map((m) => {
          // tweb wrapDocument: расширение/имя/размер — у САМОГО документа
          // (`doc.file_name`, `doc.size`), а не отдельными полями сообщения.
          const doc = getDocumentFromMessage(m)
          const ext = extOf(doc?.file_name)
          return (
            <div key={m.id} className="document-container">
              <div className="document-wrapper">
                <div
                  className={classNames('document', ext ? `ext-${ext}` : '')}
                  style={{ ['--background-color' as string]: EXT_COLORS[ext] ?? 'var(--primary-color)' }}
                >
                  <div className="document-ico">
                    <span className="document-ico-text">{ext.slice(0, 4) || 'file'}</span>
                  </div>
                  <div className="document-name">{doc?.file_name || t('Chat.Input.Attach.Document')}</div>
                  <div className="document-size">
                    <span>{[fmtSize(doc?.size), when(m)].filter(Boolean).join(' · ')}</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
            </div>
          </div>
        </div>
        </div>
      )}

      {tab === 'SharedLinksTab2' && msgs != null && msgs.length > 0 && (
        <div className="search-super-content-container search-super-content-links">
        <div className="sidebar-left-section-container">
          <div className="sidebar-left-section no-delimiter">
            <div className="sidebar-left-section-content">
        {/* Строка ссылки — `.search-super-item` с абсолютной `.row-media`
            слева (`_searchSuper.scss` → `.search-super-content-links`):
            превью-квадрат, заголовок хоста и сам url. */}
        {msgs.map((m) => {
          const url = firstUrl(getMessageText(m))
          return (
            <div key={m.id} className="search-super-item rp" onClick={() => window.open(url, '_blank', 'noopener')}>
              <div className="row-media">{hostOf(url).charAt(0).toUpperCase()}</div>
              <div className="row-title">{hostOf(url)}</div>
              <div className="row-subtitle">{url}</div>
            </div>
          )
        })}
            </div>
          </div>
        </div>
        </div>
      )}

      {tab === 'SharedMusicTab2' && msgs != null && msgs.length > 0 && (
        <div className="search-super-content-container search-super-content-music">
        <div className="sidebar-left-section-container">
          <div className="sidebar-left-section no-delimiter">
            <div className="sidebar-left-section-content">
        {/* Строка аудио — вендорный `.audio` (порт tweb `wrapAudio`, стили
            `_audio.scss` + `.search-super-content-music`): `.document-container
            > .document-wrapper > .audio` с `.audio-toggle.audio-ico`,
            `.audio-details > .audio-title + .audio-subtitle` (дамп 03-reply-audio).
            Кнопка play/pause — наш глиф внутри штатного `.audio-toggle`. */}
        {msgs.map((m) => (
          <div key={m.id} className="document-container">
            <div className="document-wrapper">
              <div className="audio" onClick={() => playRow(m, getDocumentFromMessage(m)?.file_name || t('SharedMedia.Audio'))}>
                <div className={classNames('audio-toggle audio-ico', audioPlaying && getMediaId(m) === curMediaId ? 'playing' : '')}>
                  <PlayPauseGlyph playing={audioPlaying && getMediaId(m) === curMediaId} size={22} />
                </div>
                <div className="audio-details">
                  <div className="audio-title">{getDocumentFromMessage(m)?.file_name || t('SharedMedia.Audio')}</div>
                  <div className="audio-subtitle">
                    <div className="audio-time">{[fmtDur(getDocumentFromMessage(m)?.duration), when(m)].filter(Boolean).join(' · ')}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
            </div>
          </div>
        </div>
        </div>
      )}

      {tab === 'SharedVoiceTab2' && msgs != null && msgs.length > 0 && (
        <div className="search-super-content-container search-super-content-voice">
        <div className="sidebar-left-section-container">
          <div className="sidebar-left-section no-delimiter">
            <div className="sidebar-left-section-content">
        {msgs.map((m) => (
          <div key={m.id} className="document-container">
            <div className="document-wrapper">
              <div className="audio" onClick={() => playRow(m, getMessageKind(m) === 'roundVideo' ? t('AttachRound') : t('AttachAudio'))}>
                <div className={classNames('audio-toggle audio-ico', audioPlaying && getMediaId(m) === curMediaId ? 'playing' : '')}>
                  <PlayPauseGlyph playing={audioPlaying && getMediaId(m) === curMediaId} size={22} />
                </div>
                <div className="audio-details">
                  <div className="audio-title">{getMessageKind(m) === 'roundVideo' ? t('AttachRound') : t('AttachAudio')}</div>
                  <div className="audio-subtitle">
                    <div className="audio-time">{[fmtDur(getDocumentFromMessage(m)?.duration), when(m)].filter(Boolean).join(' · ')}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
            </div>
          </div>
        </div>
        </div>
      )}

      {/* sentinel infinite scroll медиа-табов: виден → догрузка следующей страницы */}
      {/* sentinel догрузки — пустой маркер для IntersectionObserver; в tweb на
          этом месте `div.preloader` (дамп 07-right-sidebar), но спиннера у нас
          нет: страница подгружается молча, как и раньше. */}
      {filter && msgs != null && hasMore && <div ref={sentinelRef} />}
      </TabSlide>
    </>
  )
}

/**
 * Высота строки «Избранного» — `itemSize: 72` оригинала
 * (`tweb/src/components/appSearchSuper.ts:1905`, `loadSavedDialogs`): там строки
 * этой вкладки — обычные строки списка диалогов (`SortedDialogList`), то есть
 * `.row-big { min-height: 4.5rem }` (`tweb/src/scss/partials/_row.scss:131`).
 */
const SAVED_ITEM_HEIGHT = 72

/**
 * `extraPaddingBottom: 0` — буквально из оригинала
 * (`tweb/src/components/appSearchSuper.ts:1906`). Это единственное, чем геометрия
 * этого списка отличается от списка чатов и архива (у тех — дефолтные 8px,
 * `deferredSortedVirtualList.tsx:55`): список вложен в панель профиля, снизу под
 * ним идёт свой контент панели, и лишний отступ там не нужен. Высота `ul` —
 * ровно `count * 72`.
 */
const SAVED_EXTRA_PADDING_BOTTOM = 0

/**
 * Пагинации у «Избранного» нет: набор приезжает ОДНИМ RPC
 * (`useSavedDialogs` → `managers.chats.savedDialogs()`), поэтому дырок в
 * `fullItems` ядра не возникает вовсе и просить страницу некому. Ссылка обязана
 * быть СТАБИЛЬНОЙ — контракт пропа `requestItemForIdx` ядра (он зовётся из
 * эффекта каждой непоказанной строки).
 *
 * Стабильность ПОКРЫТА: проп входит в пропсы `memo`-строки ядра, поэтому мутация
 * «инлайновая стрелка вместо константы» перерисовывает всё окно на каждом рендере
 * панели и красит тест «рендер панели строк не касается…».
 */
const NO_ITEM_REQUEST = () => {}

/**
 * Сохранённые диалоги «Избранного» на том же виртуальном ядре, что список чатов
 * и архив. Оригинал — `tweb/src/components/appSearchSuper.ts:1890-1935`
 * (`loadSavedDialogs`): вкладка поднимает `SortedDialogList` с `itemSize: 72` и
 * `extraPaddingBottom: 0`, а `scrollable` ему отдаётся ТОТ ЖЕ, что у всей панели
 * (`sidebarRight/tabs/sharedMedia.tsx:648` — `scrollable: tab.scrollable`, в него
 * же `:160` кладётся шапка профиля).
 *
 * Пропы ядра, отличные от списка папки:
 * 1. `totalCount = items.length`, `wasAtLeastOnceFetched` взведён с первого
 *    рендера, `requestItemForIdx` — no-op: пагинации нет (см. `NO_ITEM_REQUEST`);
 * 2. `pinnedItems` не передаётся — закреплённых строк у вкладки нет;
 * 3. `animate` — константа: в оригинале это `blockedAnimationCount() === 0`, а
 *    счётчик глушилки держит владелец ПЕРВОЙ ЗАГРУЗКИ, которой у этого списка
 *    нет. Значение СОЗНАТЕЛЬНО НЕ ПОКРЫТО (как и у архива): оно доходит до
 *    `useAnimatedTop`, покадровая анимация `top` в happy-dom не наблюдаема, сама
 *    механика покрыта `virtual/useAnimatedTop.test.ts`.
 */
function SavedDialogsList({ dialogs, onOpenPeer }: {
  dialogs: SavedDialog[]
  onOpenPeer?: (peer: OpenPeer) => void
}) {
  // Хост ядру нужен ЗНАЧЕНИЕМ (оно вешает на него слушатель скролла и
  // ResizeObserver), поэтому это состояние: первый рендер идёт с null, второй —
  // с живым узлом (штатная ветка `scrollableHost === null` в
  // `VerticalVirtualList`). Ref-колбэк обязан быть СТАБИЛЬНЫМ: смена
  // идентичности заставила бы React переприсваивать его на каждом рендере, то
  // есть на каждом рендере пересобирать окно видимости.
  //
  // Хост — скроллер ПАНЕЛИ ПРОФИЛЯ (`.scrollable-y` панели, tweb
  // `_sidebar.scss`/`_scrollable.scss` — у панели больше нет своего модуля), а не
  // родитель `ul` (у списка чатов и архива `ul` лежит прямо в скроллере, здесь —
  // в карточке внутри вкладки) и не окно. Так же и в оригинале: `SortedDialogList`
  // «Избранного» получает `scrollable` всей панели.
  const [scrollHost, setScrollHost] = useState<HTMLElement | null>(null)
  const setListEl = useCallback((ul: HTMLUListElement | null) => {
    setScrollHost(ul?.closest<HTMLElement>('.scrollable-y') ?? null)
  }, [])

  // Обёртки строк (`{id, value}`) обязаны переживать рендеры родителя — контракт
  // пропа `items` ядра (`DeferredSortedVirtualList.tsx:64-80`): ссылки на них
  // сравниваются между старым и новым списком в `useShouldAnimate`, а строка
  // сравнивает свой `item` по ссылке. Кэша по id (как у архива в `Sidebar.tsx`)
  // здесь НЕТ и он не нужен: `dialogs` — снимок одного RPC
  // (`useSavedDialogs`, состояние хука), он не пересобирается на операциях
  // зеркала, поэтому `useMemo` по нему даёт те же обёртки на все рендеры панели.
  // Обновление набора приходит только новым ответом RPC, где новы и сами
  // `SavedDialog` — кэш по id всё равно промахнулся бы на каждой строке.
  const items = useMemo<readonly DeferredSortedVirtualListItem<SavedDialog>[]>(
    () => dialogs.map((d) => ({ id: String(d.peerId), value: d })),
    [dialogs],
  )

  // `onOpenPeer` приезжает от панели новой стрелкой на каждом её рендере, а
  // `renderItem` обязан быть стабильным: он входит в пропсы `memo`-строки ядра,
  // и его смена перерисовывает ВСЁ окно.
  const openPeer = useEvent((peer: OpenPeer) => onOpenPeer?.(peer))

  const renderItem = useCallback(
    ({ value, itemRef }: DeferredSortedVirtualListRenderItemProps<SavedDialog>) => (
      <SavedDialogRow dialog={value} onOpenPeer={openPeer} itemRef={itemRef} />
    ),
    [openPeer],
  )

  return (
    <DeferredSortedVirtualList<SavedDialog>
      listRef={setListEl}
      className="chatlist"
      scrollableHost={scrollHost}
      items={items}
      totalCount={items.length}
      wasAtLeastOnceFetched
      itemSize={SAVED_ITEM_HEIGHT}
      extraPaddingBottom={SAVED_EXTRA_PADDING_BOTTOM}
      animate
      requestItemForIdx={NO_ITEM_REQUEST}
      renderItem={renderItem}
    />
  )
}

/**
 * Строка сохранённого диалога — та же разметка, что была у списка до
 * виртуализации; добавился только `itemRef` ядра на корневом узле (по нему ядро
 * анимирует `top` и вешает класс абсолютного позиционирования).
 */
function SavedDialogRow({ dialog, onOpenPeer, itemRef }: {
  dialog: SavedDialog
  onOpenPeer: (peer: OpenPeer) => void
  itemRef: (el: HTMLElement | null) => void
}) {
  const t = useT()
  const meId = useChatsStore((st) => st.meId)
  // «Мои заметки» — строка, чей ИСТОЧНИК это сам зритель: вида строкой
  // (`kind`) на проводе больше нет, его отвечает сам ключ.
  const isSelf = dialog.peerId === meId
  const peer = cachedPeer(dialog.peerId)
  // Имя и аватарку даёт КАРТОЧКА пира (она приезжает векторами того же
  // контейнера), а не снимок, подклеенный сервером в строку.
  const title = isSelf ? t('MyNotes') : getPeerTitle({ peerId: dialog.peerId, peer })
  const photoId = getPeerPhotoId(isUser(dialog.peerId) && peer?._ === 'user' ? peer.photo : getChatPhoto(peer as PeerChat | undefined)) || undefined
  const lm = dialog.lastMessage

  return (
    // Строка «Избранного» — тот же `chatlist-chat`, что у списка чатов и у
    // участников (дамп 15-right-11): время последнего сообщения уезжает в
    // штатный правый слот заголовка, превью — в `.row-subtitle`.
    <div
      ref={itemRef}
      className={classNames(
        'row no-wrap row-with-padding row-clickable hover-effect chatlist-chat chatlist-chat-abitbigger',
        isSelf ? '' : 'rp',
      )}
      data-peer-id={dialog.peerId}
      onClick={() => {
        if (isSelf) return
        // Ключ ЗНАКОВЫЙ и уже посчитан на проводе — различать «человек это или
        // чат» вторым полем рядом больше не нужно: знак и есть ответ.
        onOpenPeer({ id: dialog.peerId, title, photoId })
      }}
    >
      <div className="row-row row-title-row dialog-title">
        <div className="row-title">{title}</div>
        <div className="row-title row-title-right row-title-right-secondary">
          {fmtWhen(lm ? messageDateISO(lm.date) : undefined)}
        </div>
      </div>
      <div className="row-row row-subtitle-row dialog-subtitle">
        <div className="row-subtitle">{previewOf(lm).text}</div>
      </div>
      {isSelf ? (
        <Avatar size="md" background="var(--tg-accentGradient)" emoji="saved" className="dialog-avatar row-media row-media-abitbigger" />
      ) : (
        <UserAvatar id={dialog.peerId} name={title} photoId={photoId} className="dialog-avatar row-media row-media-abitbigger" />
      )}
    </div>
  )
}
