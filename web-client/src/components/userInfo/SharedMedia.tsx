// userInfo/SharedMedia.tsx
// Шаред-медиа секция панели профиля (порт tweb sidebarRight/tabs/sharedMedia):
// липкий таб-ряд + скользящий контент по табам (Участники/Чаты/Подарки и
// непустые медиа-табы Media/Files/Links/Music/Voice). Данные тянет per-filter
// из mediaHistory, глобальный плеер — из audioStore, просмотрщик — vanilla-
// вьювер (mediaViewer/openMediaViewer, Task 16).
import { useEffect, useRef, useState } from 'react'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import Avatar from '../../shared/ui/Avatar'
import UserAvatar from '../UserAvatar'
import PlayPauseGlyph from '../PlayPauseGlyph'
import StarIcon from '../stars/StarIcon'
import { Tabs, TabSlide, TabsBar } from '../../shared/ui/Tabs'
import classNames from '../../shared/lib/classNames'
import { useT, useLang } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { useMessagesStore } from '../../stores/messagesStore'
import { useAudioStore, type AudioTrack } from '../../stores/audioStore'
import { markMediaPlayed } from '../../core/mediaRead'
import { friendlyMsgTime } from '../../core/format/friendlyTime'
import { EXT_COLORS, extOf, firstUrl, fmtDur, fmtSize, hostOf } from '../../core/format/sharedMediaFmt'
import MediaGridThumb from '../MediaGridThumb'
import { fmtWhen, mediaLabel } from '../../core/dialogToChat'
import { roleLabel, type RealMember } from '../../core/hooks/useGroupInfo'
import type { SavedDialog } from '../../core/managers/chatsManager'
import type { GiftInfo } from '../../core/managers/starsManager'
import type { Message } from '../../core/models'
import type { OpenPeer } from '../../data'
import { usePeersStore } from '../../stores/peersStore'
import { messageToViewerItem } from '../mediaViewer/collectLightboxItems'
import { openMediaViewer } from '../mediaViewer/openMediaViewer'
import s from '../UserInfoPanel.module.scss'

const SHARED_TABS = ['Media', 'Files', 'Links', 'Music', 'Voice'] as const
const TAB_FILTER: Record<string, 'media' | 'files' | 'links' | 'music' | 'voice'> = {
  Media: 'media', Files: 'files', Links: 'links', Music: 'music', Voice: 'voice',
}

export default function SharedMedia({ tab, onTab, chatId, members, savedDialogs, gifts, onOpenGift, onSendGift, isChannel, canManageAdmins, onOpenPeer, onEditMember, navRef, stickyTop, onCount }: {
  tab: string
  onTab: (v: string) => void
  chatId: number | null
  /** участники для первого таба (только реальные группы/каналы) */
  members?: RealMember[]
  /** «Избранное»: сохранённые диалоги для первого таба «Чаты» */
  savedDialogs?: SavedDialog[]
  /** подарки профиля пользователя (таб «Подарки») */
  gifts?: GiftInfo[]
  onOpenGift?: (g: GiftInfo) => void
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
  onCount?: (tab: string, n: number) => void
}) {
  const t = useT()
  const [lang] = useLang()
  const managers = useManagers()
  // Глобальный плеер: клик по строке «Музыка»/«Голосовые» ставит очередь из
  // сообщений таба; плеер-плашка выезжает над шапкой чата (NowPlayingBar).
  const meId = useChatsStore((st) => st.meId)
  const playQueue = useAudioStore((st) => st.playQueue)
  const togglePlay = useAudioStore((st) => st.toggle)
  const curMediaId = useAudioStore((st) => st.track?.mediaId)
  const audioPlaying = useAudioStore((st) => st.playing)
  // Кэш по фильтру с infinite scroll (tweb searchSuper.load + loadMutex):
  // страницы аккумулируются, hasMore гасится по total count с бэка.
  const [byFilter, setByFilter] = useState<Partial<Record<string, { msgs: Message[]; hasMore: boolean }>>>({})
  const byFilterRef = useRef(byFilter)
  byFilterRef.current = byFilter
  // guard от параллельных загрузок одного фильтра (tweb loadMutex)
  const loadingRef = useRef(new Set<string>())
  // поколение кэша: инвалидация (новое сообщение) обесценивает in-flight ответы
  const genRef = useRef(0)
  const filter = TAB_FILTER[tab]
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
  useEffect(() => { if (gifts) onCount?.('Gifts', gifts.length) }, [gifts, onCount])

  // Live: новое сообщение в открытом чате инвалидирует кэш табов — активный
  // таб перезагрузится и свежая отправка (голосовое/фото/…) появится сразу.
  const winLen = useMessagesStore((st) => (chatId != null ? st.byKey[String(chatId)]?.msgs.length ?? 0 : 0))
  useEffect(() => {
    genRef.current++
    loadingRef.current.clear()
    setByFilter({})
  }, [winLen])

  // Догрузка следующей страницы фильтра (append) с offset = уже загружено.
  const loadPage = (f: (typeof TAB_FILTER)[string] | undefined, forTab: string) => {
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

  const entry = byFilter[filter]
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

  const when = (m: Message) => friendlyMsgTime(m.createdAt, lang)

  // Клик по строке: текущий трек — play/pause, иначе очередь из всего таба
  // с этой позиции; чужое непрослушанное голосовое гасит media_unread.
  const playRow = (m: Message, title: string) => {
    if (m.mediaId == null || chatId == null) return
    if (m.mediaId === curMediaId) {
      togglePlay()
      return
    }
    const list = (msgs ?? []).filter((x) => x.mediaId != null)
    const tracks: AudioTrack[] = list.map((x) => ({
      mediaId: x.mediaId as number,
      title: x.type === 'audio' ? x.mediaName || t('Audio') : title,
      subtitle: when(x),
      chatId,
      msgId: x.id,
    }))
    playQueue(tracks, list.indexOf(m))
    if (m.senderId !== meId && m.mediaUnread) markMediaPlayed(chatId, m.id)
  }

  // Просмотрщик медиа — тот же vanilla-вьювер, что в чате (клик по тайлу,
  // Task 16). items — из сообщений таба (messageToViewerItem); имена авторов —
  // из зеркала карточек пиров (peersStore), фолбэков чата у панели нет.
  // jump/forward/delete не пробрасываются — их не было и у старого лайтбокса.
  const openMedia = (rawIndex: number, e: React.MouseEvent<HTMLDivElement>) => {
    const list = (msgs ?? []).filter((m) => m.mediaId != null)
    // индекс грида — по msgs целиком; во вьювер идёт индекс в отфильтрованном
    const clicked = msgs?.[rawIndex]
    const index = clicked ? list.indexOf(clicked) : -1
    if (index < 0) return
    const peersById = usePeersStore.getState().byId
    const ctx = {
      meId,
      meName: useChatsStore.getState().me?.displayName,
      peers: new Map(list.map((m) => [m.senderId, peersById[m.senderId]]).filter((p): p is [number, (typeof peersById)[number]] => !!p[1])),
      lang,
    }
    const el = e.currentTarget
    const items = list.map((m, i) => messageToViewerItem(m, ctx, i === index ? el : null))
    // порядок таба — newest-first (REST), reverse не ставим: next = older ✓
    void openMediaViewer({ items, index, target: el })
  }
  const empty = (
    <Text size={14} color="var(--secondary-text-color)" style={{ padding: '16px 24px', display: 'block', textAlign: 'center' }}>
      {t('Nothing here yet.')}
    </Text>
  )

  // Порядок табов: Участники/Чаты → Подарки → непустые медиа-табы (tweb:
  // показываются только непустые). Медиа-таб появляется, лишь когда его total
  // загрузился и > 0 — иначе таб-бар мигал бы пустыми на открытии.
  const mediaTabs = SHARED_TABS.filter((name) => (totals[TAB_FILTER[name]] ?? 0) > 0)
  // Подарки: таб есть у любого пользовательского профиля (tweb показывает
  // витрину и пустой — с приглашением подарить); у групп/каналов gifts == null.
  const tabOrder = [
    ...(savedDialogs ? ['Chats'] : members ? ['Members'] : []),
    ...(gifts ? ['Gifts'] : []),
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
      {/* Тот же framed-таб-ряд, что и у папок в списке чатов; липнет под
          absolute-шапку панели (tweb .search-super-tabs-scrollable: sticky) */}
      <TabsBar top={stickyTop} barRef={navRef}>
        <div className={s.tabsWrap}>
          <Tabs value={tab} onChange={(v) => onTab(v as string)}>
            <Tabs.List framed>
              {tabOrder.map((name) => (
                <Tabs.Tab key={name} value={name}>
                  {t(name)}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>
        </div>
      </TabsBar>

      {/* контент табов скользит ±100% (tweb TransitionSlider 'tabs') */}
      <TabSlide tab={tab} order={tabOrder}>
      {/* «Избранное» → «Чаты»: сохранённые диалоги по источнику пересылки */}
      {tab === 'Chats' && savedDialogs && (
        <div className={s.cardPlain} style={{ margin: '0 12px' }}>
          {savedDialogs.length === 0 && empty}
          {savedDialogs.map((d) => {
            const isSelf = d.kind === 'self'
            const title = isSelf ? t('My Notes') : d.title
            return (
              <div
                key={`${d.kind}:${d.peerId}`}
                className={s.memberRow}
                onClick={() => {
                  if (isSelf || !onOpenPeer) return
                  if (d.kind === 'user') onOpenPeer({ id: d.peerId, displayName: d.title, avatarUrl: d.photoUrl })
                  else onOpenPeer({ id: 0, displayName: d.title, chatId: d.peerId })
                }}
                style={isSelf ? { cursor: 'default' } : undefined}
              >
                {isSelf ? (
                  <Avatar size="md" background="var(--tg-accentGradient)" emoji="saved" />
                ) : (
                  <UserAvatar id={d.peerId} name={title} avatarUrl={d.photoUrl} />
                )}
                <div className={s.grow}>
                  <div className={s.memberTitleRow}>
                    <Text noWrap size={16} color="var(--primary-text-color)">{title}</Text>
                    <span className={s.roleLabel}>{fmtWhen(d.last.at)}</span>
                  </div>
                  <Text noWrap size={14} color="var(--secondary-text-color)">
                    {d.last.text || mediaLabel(d.last.type)}
                  </Text>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'Members' && members && (
        <div className={s.cardPlain} style={{ margin: '0 12px' }}>
          {members.map((mem) => (
            <div
              key={mem.userId}
              className={s.memberRow}
              onClick={() => onOpenPeer?.({ id: mem.userId, displayName: mem.displayName, username: mem.username, avatarUrl: mem.avatarUrl })}
            >
              <UserAvatar id={mem.userId} name={mem.displayName} avatarUrl={mem.avatarUrl} online={mem.online} />
              <div className={s.grow}>
                {/* роль — на линии заголовка (tweb row-title-right-secondary) */}
                <div className={s.memberTitleRow}>
                  <Text noWrap size={16} color="var(--primary-text-color)">{mem.displayName}</Text>
                  <span
                    onClick={canManageAdmins ? (e) => { e.stopPropagation(); onEditMember?.(mem) } : undefined}
                    className={classNames(s.roleLabel, canManageAdmins ? s.roleClickable : '')}
                  >
                    {roleLabel(mem.role, !!isChannel)}
                  </span>
                </div>
                <Text size={14} color="var(--secondary-text-color)">
                  {mem.online ? t('online') : t('last seen recently')}
                </Text>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Подарки профиля (tweb stargifts/profileList): сетка полученных подарков.
          Скрытые (hidden) приходят только владельцу — помечаем «глаз-off» и
          приглушаем. Ограниченные — бейдж «Лимит»; отправитель — мини-аватар
          (аноним → безликий кружок), как itemFrom/itemUnsaved в tweb. */}
      {tab === 'Gifts' && gifts && (
        gifts.length === 0 ? (
          <div className={s.giftsEmpty}>
            <span className={s.giftsEmptyEmoji}>🎁</span>
            <Text size={15} color="var(--secondary-text-color)">{t('No gifts yet')}</Text>
            {onSendGift && (
              <button type="button" className={s.giftsEmptyBtn} onClick={onSendGift}>
                {t('Send a Gift')}
              </button>
            )}
          </div>
        ) : (
          <div className={s.giftsProfileGrid}>
            {gifts.map((g) => {
              const anon = g.anonymous || (!g.fromName && g.fromId == null)
              return (
                <div
                  key={g.id}
                  className={classNames(s.giftTile, g.hidden ? s.giftTileHidden : '')}
                  onClick={() => onOpenGift?.(g)}
                >
                  {g.hidden && <TgIcon name="hide" size={16} className={s.giftTileHiddenIcon} />}
                  {g.gift.total != null && <span className={s.giftTileBadge}>{t('Limited')}</span>}
                  <span className={s.giftTileEmoji}>{g.gift.emoji}</span>
                  <span className={s.giftTilePrice}>
                    <StarIcon size={12} />
                    {g.gift.priceStars}
                  </span>
                  <div className={s.giftTileFrom}>
                    {anon ? (
                      <span className={s.giftTileAnon}>?</span>
                    ) : (
                      <UserAvatar id={g.fromId ?? undefined} name={g.fromName} size={18} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {msgs != null && msgs.length === 0 && tab !== 'Gifts' && empty}

      {/* tweb-классы `grid-item` (ячейка грида — appSearchSuper.ts:878) и
          `video-time` (плашку длительности в tweb строит wrapVideo) — контекст
          hideFloatings вьювера (mediaViewer/base.ts FLOATING_CONTEXTS): плашка
          гаснет на полёте мувера. Визуал остаётся на классах модуля (стили tweb
          `.video-time` скоуплены под .bubble и сюда не дотягиваются). */}
      {tab === 'Media' && msgs != null && msgs.length > 0 && (
        <div className={s.mediaGrid}>
          {msgs.map((m, i) => (
            <div key={m.id} className={`grid-item ${s.mediaTile}`} onClick={(e) => openMedia(i, e)}>
              {m.mediaId != null && (
                <MediaGridThumb className={s.tileImg} mediaId={m.mediaId} hasThumb={!!m.mediaHasThumb} />
              )}
              {m.type === 'video' && <span className={`video-time ${s.tileDuration}`}>{fmtDur(m.mediaDuration)}</span>}
            </div>
          ))}
        </div>
      )}

      {tab === 'Files' && msgs != null && msgs.length > 0 && (
        <div className={s.mediaList}>
          {msgs.map((m) => (
            <div key={m.id} className={s.mediaRow}>
              <div className={s.rowSquare} style={{ background: EXT_COLORS[extOf(m.mediaName)] ?? 'var(--primary-color)' }}>
                {extOf(m.mediaName).toUpperCase().slice(0, 4) || 'FILE'}
              </div>
              <div className={s.grow}>
                <Text noWrap size={15.5} weight={500} color="var(--primary-text-color)">{m.mediaName || t('Document')}</Text>
                <Text size={13.5} color="var(--secondary-text-color)">{[fmtSize(m.mediaSize), when(m)].filter(Boolean).join(' · ')}</Text>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'Links' && msgs != null && msgs.length > 0 && (
        <div className={s.mediaList}>
          {msgs.map((m) => {
            const url = firstUrl(m.text)
            return (
              <div key={m.id} className={s.mediaRow} onClick={() => window.open(url, '_blank', 'noopener')} style={{ cursor: 'pointer' }}>
                <div className={s.rowSquare} style={{ background: 'var(--tg-accentGradient)' }}>
                  {hostOf(url).charAt(0).toUpperCase()}
                </div>
                <div className={s.grow}>
                  <Text noWrap size={15.5} weight={500} color="var(--primary-text-color)">{hostOf(url)}</Text>
                  <Text noWrap size={13.5} color="var(--link-color)">{url}</Text>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'Music' && msgs != null && msgs.length > 0 && (
        <div className={s.mediaList}>
          {msgs.map((m) => (
            <div key={m.id} className={s.mediaRow} onClick={() => playRow(m, m.mediaName || t('Audio'))} style={{ cursor: 'pointer' }}>
              <div className={s.rowPlay}>
                <PlayPauseGlyph playing={audioPlaying && m.mediaId === curMediaId} size={22} className={s.rowGlyph} />
              </div>
              <div className={s.grow}>
                <Text noWrap size={15.5} weight={500} color="var(--primary-text-color)">{m.mediaName || t('Audio')}</Text>
                <Text noWrap size={13.5} color="var(--secondary-text-color)">{[fmtDur(m.mediaDuration), when(m)].filter(Boolean).join(' · ')}</Text>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'Voice' && msgs != null && msgs.length > 0 && (
        <div className={s.mediaList}>
          {msgs.map((m) => (
            <div key={m.id} className={s.mediaRow} onClick={() => playRow(m, m.type === 'roundVideo' ? t('Video message') : t('Voice message'))} style={{ cursor: 'pointer' }}>
              <div className={s.rowPlay}>
                <PlayPauseGlyph playing={audioPlaying && m.mediaId === curMediaId} size={22} className={s.rowGlyph} />
              </div>
              <div className={s.grow}>
                <Text noWrap size={15.5} weight={500} color="var(--primary-text-color)">{m.type === 'roundVideo' ? t('Video message') : t('Voice message')}</Text>
                <Text size={13.5} color="var(--secondary-text-color)">{[fmtDur(m.mediaDuration), when(m)].filter(Boolean).join(' · ')}</Text>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* sentinel infinite scroll медиа-табов: виден → догрузка следующей страницы */}
      {filter && msgs != null && hasMore && <div ref={sentinelRef} className={s.moreSentinel} />}
      </TabSlide>
    </>
  )
}
