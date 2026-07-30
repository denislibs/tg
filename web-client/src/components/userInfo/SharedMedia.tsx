// userInfo/SharedMedia.tsx
// Шаред-медиа секция панели профиля (порт tweb sidebarRight/tabs/sharedMedia):
// липкий таб-ряд + скользящий контент по табам (Участники/Чаты/Подарки и
// непустые медиа-табы Media/Files/Links/Music/Voice). Данные тянет per-filter
// из mediaHistory, глобальный плеер — из audioStore, просмотрщик — MediaLightbox.
import { lazy, Suspense, useEffect, useState } from 'react'
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
import { mediaContentUrl, mediaThumbUrl, useMediaTokenVersion } from '../../core/mediaUrl'
import { fmtWhen, mediaLabel } from '../../core/dialogToChat'
import { roleLabel, type RealMember } from '../../core/hooks/useGroupInfo'
import type { SavedDialog } from '../../core/managers/chatsManager'
import type { GiftInfo } from '../../core/managers/starsManager'
import type { Message } from '../../core/models'
import type { OpenPeer } from '../../data'
import type { LightboxItem } from '../messages/MediaLightbox'
import s from '../UserInfoPanel.module.scss'

const MediaLightbox = lazy(() => import('../messages/MediaLightbox'))

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
  // Ре-рендер при (пере)прайме медиа-токена — иначе превью сетки рендерятся с
  // пустым/протухшим token'ом (401) и залипают серыми плейсхолдерами (как в фиде:
  // RealMediaBubble/AlbumGrid тоже подписаны на useMediaTokenVersion).
  useMediaTokenVersion()
  // Глобальный плеер: клик по строке «Музыка»/«Голосовые» ставит очередь из
  // сообщений таба; плеер-плашка выезжает над шапкой чата (NowPlayingBar).
  const meId = useChatsStore((st) => st.meId)
  const playQueue = useAudioStore((st) => st.playQueue)
  const togglePlay = useAudioStore((st) => st.toggle)
  const curMediaId = useAudioStore((st) => st.track?.mediaId)
  const audioPlaying = useAudioStore((st) => st.playing)
  // кэш по фильтру: загружаем таб один раз за открытие панели
  const [byFilter, setByFilter] = useState<Partial<Record<string, Message[]>>>({})
  const filter = TAB_FILTER[tab]

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
  useEffect(() => { setByFilter({}) }, [winLen])

  useEffect(() => {
    if (chatId == null || !filter || byFilter[filter]) return
    const forTab = tab
    void managers.messages
      .mediaHistory(chatId, filter)
      .then((r) => {
        setByFilter((d) => ({ ...d, [filter]: r.messages }))
        onCount?.(forTab, r.messages.length)
      })
      .catch(() => setByFilter((d) => ({ ...d, [filter]: [] })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, filter])

  const msgs = byFilter[filter]
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

  // Просмотрщик медиа — тот же MediaLightbox, что в чате (клик по тайлу).
  const [lightbox, setLightbox] = useState<{
    items: LightboxItem[]
    index: number
    originRect: { top: number; left: number; width: number; height: number }
    originSrc?: string
    originEl: HTMLElement
  } | null>(null)
  const openMedia = (index: number, e: React.MouseEvent<HTMLDivElement>) => {
    const list = (msgs ?? []).filter((m) => m.mediaId != null)
    const items: LightboxItem[] = list.map((m) => ({ mediaId: m.mediaId as number, type: m.type, date: when(m), width: m.mediaWidth, height: m.mediaHeight }))
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const img = el.querySelector('img')
    el.style.visibility = 'hidden' // как в чате: оригинал прячется под клоном
    setLightbox({
      items, index,
      originRect: { top: r.top, left: r.left, width: r.width, height: r.height },
      originSrc: img?.currentSrc || img?.src, originEl: el,
    })
  }
  const empty = (
    <Text size={14} color="var(--tg-textSecondary)" style={{ padding: '16px 24px', display: 'block', textAlign: 'center' }}>
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
      <TabsBar mode="sticky" from="var(--tg-sectionBackdrop)" top={stickyTop} barRef={navRef}>
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
                    <Text noWrap size={16} color="var(--tg-textPrimary)">{title}</Text>
                    <span className={s.roleLabel}>{fmtWhen(d.last.at)}</span>
                  </div>
                  <Text noWrap size={14} color="var(--tg-textSecondary)">
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
                  <Text noWrap size={16} color="var(--tg-textPrimary)">{mem.displayName}</Text>
                  <span
                    onClick={canManageAdmins ? (e) => { e.stopPropagation(); onEditMember?.(mem) } : undefined}
                    className={classNames(s.roleLabel, canManageAdmins ? s.roleClickable : '')}
                  >
                    {roleLabel(mem.role, !!isChannel)}
                  </span>
                </div>
                <Text size={14} color="var(--tg-textSecondary)">
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
            <Text size={15} color="var(--tg-textSecondary)">{t('No gifts yet')}</Text>
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

      {tab === 'Media' && msgs != null && msgs.length > 0 && (
        <div className={s.mediaGrid}>
          {msgs.map((m, i) => (
            <div key={m.id} className={s.mediaTile} onClick={(e) => openMedia(i, e)}>
              {m.mediaId != null && (
                <img
                  className={s.tileImg}
                  src={mediaThumbUrl(m.mediaId)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    // превью ещё не сгенерировано → полный контент
                    const img = e.currentTarget
                    if (m.mediaId != null && !img.dataset.fb) {
                      img.dataset.fb = '1'
                      img.src = mediaContentUrl(m.mediaId)
                    }
                  }}
                />
              )}
              {m.type === 'video' && <span className={s.tileDuration}>{fmtDur(m.mediaDuration)}</span>}
            </div>
          ))}
        </div>
      )}

      {tab === 'Files' && msgs != null && msgs.length > 0 && (
        <div className={s.mediaList}>
          {msgs.map((m) => (
            <div key={m.id} className={s.mediaRow}>
              <div className={s.rowSquare} style={{ background: EXT_COLORS[extOf(m.mediaName)] ?? 'var(--tg-accent)' }}>
                {extOf(m.mediaName).toUpperCase().slice(0, 4) || 'FILE'}
              </div>
              <div className={s.grow}>
                <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">{m.mediaName || t('Document')}</Text>
                <Text size={13.5} color="var(--tg-textSecondary)">{[fmtSize(m.mediaSize), when(m)].filter(Boolean).join(' · ')}</Text>
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
                  <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">{hostOf(url)}</Text>
                  <Text noWrap size={13.5} color="var(--tg-link)">{url}</Text>
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
                <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">{m.mediaName || t('Audio')}</Text>
                <Text noWrap size={13.5} color="var(--tg-textSecondary)">{[fmtDur(m.mediaDuration), when(m)].filter(Boolean).join(' · ')}</Text>
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
                <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">{m.type === 'roundVideo' ? t('Video message') : t('Voice message')}</Text>
                <Text size={13.5} color="var(--tg-textSecondary)">{[fmtDur(m.mediaDuration), when(m)].filter(Boolean).join(' · ')}</Text>
              </div>
            </div>
          ))}
        </div>
      )}
      </TabSlide>

      {/* вне TabSlide: transform слайда ломал бы position:fixed лайтбокса */}
      {lightbox && (
        <Suspense fallback={null}>
          <MediaLightbox
            items={lightbox.items}
            index={lightbox.index}
            originRect={lightbox.originRect}
            originSrc={lightbox.originSrc}
            originEl={lightbox.originEl}
            onClosingStart={() => { lightbox.originEl.style.visibility = '' }}
            onClose={() => { lightbox.originEl.style.visibility = ''; setLightbox(null) }}
          />
        </Suspense>
      )}
    </>
  )
}
