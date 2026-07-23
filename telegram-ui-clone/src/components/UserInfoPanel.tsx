import { useEffect, useRef, useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import TgSwitch from './TgSwitch'
import { Tabs, TabSlide, TabsBar } from '../shared/ui/Tabs'
import QrModal from './QrModal'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE, DUR, slideInRight } from '../motion'
import TgIcon from './TgIcon'
import ChannelStats from './ChannelStats'
import Avatar from '../shared/ui/Avatar'
import { useAvatarSrc } from './useAvatarSrc'
import UserAvatar from './UserAvatar'
import VerifiedBadge from './VerifiedBadge'
import PremiumBadge from './PremiumBadge'
import EmojiStatus from './EmojiStatus'
import { fmtWhen, mediaLabel } from '../core/dialogToChat'
import type { SavedDialog } from '../core/managers/chatsManager'
import EditView from './EditView'
import GroupEditFlow from './group/GroupEditFlow'
import AddMembersScreen from './group/AddMembersScreen'
import { Section, Row } from './settings/kit'
import classNames from '../shared/lib/classNames'
import type { Chat, OpenPeer } from '../data'
import { useT } from '../i18n'
import { useGroupInfo, RIGHTS, roleLabel, type RealMember } from '../core/hooks/useGroupInfo'
import { useMessagesStore } from '../stores/messagesStore'
import { useChatsStore, loadChats } from '../stores/chatsStore'
import { useAudioStore, type AudioTrack } from '../stores/audioStore'
import { markMediaPlayed } from '../core/mediaRead'
import PlayPauseGlyph from './PlayPauseGlyph'
import { useManagers } from '../core/hooks/useManagers'
import { useLang } from '../i18n'
import { lastSeenLabel } from '../core/presence'
import { friendlyMsgTime } from '../core/friendlyTime'
import { EXT_COLORS, extOf, firstUrl, fmtDur, fmtSize, hostOf } from '../core/sharedMediaFmt'
import { mediaContentUrl, mediaThumbUrl } from '../core/mediaUrl'
import type { Message } from '../core/models'
import MediaLightbox, { type LightboxItem } from './messages/MediaLightbox'
import { clampIndex, pickZone, stepIndex, indexAfterSwipe } from '../core/photoPager'
import s from './UserInfoPanel.module.scss'
import useMediaQuery from '../shared/lib/useMediaQuery'
import type { UserProfile } from '../core/managers/privacyManager'
import type { GiftInfo } from '../core/managers/starsManager'
import StarIcon from './stars/StarIcon'
import GiftInfoPopup from './stars/GiftInfoPopup'
import KeyVerificationPopup from './secret/KeyVerificationPopup'

// склонение «N единиц» (счётчики подзаголовков)
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many
  return `${n} ${word}`
}

// «N участник(а/ов)» — склонение для подзаголовка профиля группы
function membersLabel(n: number, isChannel: boolean): string {
  if (isChannel) return `${n} подписчиков`
  return plural(n, 'участник', 'участника', 'участников')
}

// «N чат(а/ов)» — подзаголовок «Избранного» (число сохранённых диалогов)
const chatsLabel = (n: number) => plural(n, 'чат', 'чата', 'чатов')

// подпись счётчика активного таба в залитой шапке (tweb sharedMedia.tsx:
// пары type→LangPackKey — Members/MediaFiles/Files/Links/MusicFiles/Voice)
function countLabel(tab: string, n: number, isChannel: boolean): string {
  switch (tab) {
    case 'Members': return membersLabel(n, isChannel)
    case 'Chats': return chatsLabel(n)
    case 'Gifts': return plural(n, 'подарок', 'подарка', 'подарков')
    case 'Media': return plural(n, 'медиафайл', 'медиафайла', 'медиафайлов')
    case 'Files': return plural(n, 'файл', 'файла', 'файлов')
    case 'Links': return plural(n, 'ссылка', 'ссылки', 'ссылок')
    case 'Music': return plural(n, 'аудиофайл', 'аудиофайла', 'аудиофайлов')
    case 'Voice': return plural(n, 'голосовое сообщение', 'голосовых сообщения', 'голосовых сообщений')
    default: return String(n)
  }
}

// высота шапки панели — sticky-отступ табов и порог header-filled (tweb 3.5rem)
const HEADER_H = 56

export default function UserInfoPanel({ chat, onClose, onOpenPeer, canAddMembers, onEditContact, onSendGift }: { chat: Chat; onClose: () => void; onOpenPeer?: (peer: OpenPeer) => void; canAddMembers?: boolean; onEditContact?: () => void; onSendGift?: () => void }) {
  const t = useT()
  const narrow = useMediaQuery('(max-width:900px)')
  const managers = useManagers()
  const isSaved = chat.type === 'saved'
  // группы — таб «Участники», избранное — «Чаты» (tweb savedDialogs first), остальные — «Медиа»
  const [tab, setTab] = useState(chat.type === 'group' ? 'Members' : isSaved ? 'Chats' : 'Media')

  // «Избранное»: сохранённые диалоги (группировка по источнику пересылки)
  const [savedDialogs, setSavedDialogs] = useState<SavedDialog[] | null>(null)
  useEffect(() => {
    if (!isSaved) return
    void managers.chats.savedDialogs().then(setSavedDialogs).catch(() => setSavedDialogs([]))
  }, [isSaved, managers])
  const [editing, setEditing] = useState(false)
  const [addingMembers, setAddingMembers] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const headerAvatarSrc = useAvatarSrc(chat.avatarUrl)

  // Чужой профиль с применённой конфиденциальностью (GET /users/{id}):
  // телефон/bio/день рождения приходят пустыми, если скрыты правилами.
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const peerId = chat.peerId
  useEffect(() => {
    if (isSaved || peerId == null) return
    let alive = true
    void managers.privacy.profile(peerId).then((p) => {
      if (alive) setProfile(p)
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [isSaved, peerId, managers])

  // Тумблер Notifications = per-chat mute (tweb PeerProfile: checked = !muted,
  // переключение — togglePeerMute напрямую, без попапа длительности)
  const numericChatId = Number(chat.id)
  const setDialogMuted = useChatsStore((st) => st.setDialogMuted)
  const dialogMuted = useChatsStore((st) => st.dialogs.find((d) => d.chatId === numericChatId)?.muted)
  const muted = dialogMuted ?? !!chat.muted
  const toggleNotifications = () => {
    const next = !muted
    setDialogMuted(numericChatId, next) // оптимистично
    void managers.groups.setMute(numericChatId, next).catch(() => setDialogMuted(numericChatId, !next))
  }

  const {
    isRealChat,
    isChannel,
    isGroup,
    realMembers,
    canManageAdmins,
    canInvite,
    canManageDiscussion,
    canManageTopics,
    canViewStats,
    discussionChatId,
    enablingDiscussion,
    inviteLinks,
    joinRequests,
    editMember,
    setEditMember,
    approveJoinRequest,
    declineJoinRequest,
    saveRights,
    removeRights,
    enableDiscussion,
    refreshMembers,
  } = useGroupInfo(chat)

  const title = isSaved ? 'Saved Messages' : isChannel ? 'Channel Info' : isGroup ? 'Group Info' : 'User Info'

  // ── аватар (tweb peerProfileAvatars): по дефолту свёрнут в круг (collapsed);
  // клик разворачивает в большое фото на всю ширину (unfold), скролл вниз
  // сворачивает обратно ──
  const [expanded, setExpanded] = useState(false)

  // ── скролл-поведение шапки: при скролле до табов шаред-медиа шапка
  // заливается и показывает «имя + счётчик активного таба» (tweb sharedMedia.tsx
  // setIsSharedMedia / TransitionSlider) ──
  const [filled, setFilled] = useState(false)
  // фон+граница шапки — отдельно от filled: сверху прозрачная, при небольшом
  // скролле заливается (tweb .header-filled по scrollPosition >= ~5).
  const [scrolled, setScrolled] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const tabsBarRef = useRef<HTMLDivElement>(null)
  const onBodyScroll = () => {
    const body = bodyRef.current, bar = tabsBarRef.current
    if (!body || !bar) return
    // скролл вниз сворачивает развёрнутое фото обратно в круг (tweb collapse)
    if (body.scrollTop > 4) setExpanded(false)
    // фон/граница шапки появляются при небольшом скролле (не над развёрнутым фото)
    setScrolled(body.scrollTop > 8)
    // порог tweb: верх таб-плашки доехал до низа шапки (top <= OFFSET) — смена
    // заголовка на «имя + счётчик» (не связано с фоном шапки)
    const top = bar.getBoundingClientRect().top - body.getBoundingClientRect().top
    setFilled(top <= HEADER_H + 1)
  }
  // клик по «назад» в залитой шапке — к началу профиля (tweb closeBtn: scrollIntoView profile-content)
  const scrollBackToProfile = () => bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })

  // счётчики табов шаред-медиа для подзаголовка залитой шапки (tweb onLengthChange)
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({})
  const activeCount = tab === 'Members'
    ? realMembers?.length
    : tab === 'Chats'
      ? savedDialogs?.length
      : tabCounts[tab]

  // Онлайн-статус приватного собеседника — из presence-стора (как в топбаре
  // ChatHeader), а не из статичного chat.status: «в сети» / «был(а) …».
  const [lang] = useLang()
  const peerPresence = useChatsStore((st) => (peerId != null ? st.presence[peerId] : undefined))
  const presenceLabel =
    !isSaved && !isGroup && !isChannel
      ? peerPresence
        ? peerPresence.online
          ? t('online')
          : lastSeenLabel(peerPresence.lastSeen, lang)
        : chat.status
      : null
  const statusOnline = !!peerPresence?.online

  const subtitleText = isSaved
    ? chatsLabel(savedDialogs?.length ?? 0)
    : isRealChat && (isGroup || isChannel) && realMembers
      ? membersLabel(realMembers.length, isChannel)
      : presenceLabel ?? chat.status

  // ── галерея фото профиля в шапке (tweb peerProfileAvatars) ──
  // Список фото тянем СРАЗУ при разворачивании шапки (а не при клике в
  // просмотрщик): нужен для сегментной полоски-пейджера и перелистывания
  // прямо в шапке. Пусто/ошибка → одиночный текущий аватар.
  const avatarWrapRef = useRef<HTMLDivElement>(null)
  type HeaderPhoto = { src: string; isVideo: boolean; videoSrc?: string }
  const [photos, setPhotos] = useState<HeaderPhoto[] | null>(null)
  const [photoIndex, setPhotoIndex] = useState(0)
  // Смена собеседника — сбрасываем кэш галереи и позицию.
  useEffect(() => { setPhotos(null); setPhotoIndex(0) }, [peerId])
  // Сворачивание шапки возвращает к первому фото (tweb setCollapsed → go first).
  useEffect(() => { if (!expanded) setPhotoIndex(0) }, [expanded])

  useEffect(() => {
    if (!expanded || peerId == null || isSaved || photos !== null) return
    let alive = true
    void managers.profile.listPhotos(peerId).then(async (list) => {
      const items = await Promise.all(list.map(async (p): Promise<HeaderPhoto> => {
        const m = p.url.match(/\/media\/(\d+)\/content/)
        const src = m ? await managers.media.contentUrl(Number(m[1])) : p.url
        // Видео-аватар (tweb photo_video): резолвим video_url в токен-URL так же,
        // как still. Список чатов/сжатая шапка остаются на still — playback
        // только в развёрнутой шапке-пейджере и просмотрщике.
        if (p.videoUrl) {
          const vm = p.videoUrl.match(/\/media\/(\d+)\/content/)
          const videoSrc = vm ? await managers.media.contentUrl(Number(vm[1])) : p.videoUrl
          return { src, isVideo: true, videoSrc }
        }
        return { src, isVideo: false }
      }))
      if (!alive) return
      setPhotos(items.length ? items : headerAvatarSrc ? [{ src: headerAvatarSrc, isVideo: false }] : [])
    }).catch(() => {
      if (alive && headerAvatarSrc) setPhotos([{ src: headerAvatarSrc, isVideo: false }])
    })
    return () => { alive = false }
  }, [expanded, peerId, isSaved, photos, managers, headerAvatarSrc])

  // Отображаемый список: загруженная галерея либо одиночный текущий аватар.
  const headerPhotos: HeaderPhoto[] = photos ?? (headerAvatarSrc ? [{ src: headerAvatarSrc, isVideo: false }] : [])
  const photoCount = headerPhotos.length
  const curIndex = clampIndex(photoIndex, photoCount)
  const curPhoto = headerPhotos[curIndex]

  // просмотрщик фото профиля (tweb: клик по центру фото открывает полноэкранно)
  const [avatarView, setAvatarView] = useState<{
    originRect: { top: number; left: number; width: number; height: number }
    originEl: HTMLElement
    index: number
  } | null>(null)
  const avatarItems: LightboxItem[] = headerPhotos.map((p) =>
    p.isVideo ? { src: p.src, videoUrl: p.videoSrc, type: 'video' } : { src: p.src },
  )
  const openAvatarViewer = (startIndex: number) => {
    const el = avatarWrapRef.current
    if (!el || !headerAvatarSrc) return
    const r = el.getBoundingClientRect()
    setAvatarView({
      originRect: { top: r.top, left: r.left, width: r.width, height: r.height },
      originEl: el,
      index: clampIndex(startIndex, photoCount),
    })
  }
  const closeAvatarViewer = () => setAvatarView(null)

  // ── перелистывание в шапке: тап по краевым третям / свайп (tweb tap-zones +
  // SwipeHandler). Свайп ведём live-переводом дорожки, на отпускании — решаем. ──
  const canPage = photoCount >= 2
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean; width: number } | null>(null)
  const suppressClickRef = useRef(false)
  const [dragDx, setDragDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const onAvatarsPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canPage || e.button !== 0) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false, width: e.currentTarget.getBoundingClientRect().width }
  }
  const onAvatarsPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved) {
      if (Math.abs(dx) < 6) return
      if (Math.abs(dy) > Math.abs(dx)) { dragRef.current = null; return } // вертикаль — не свайп
      d.moved = true
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    setDragDx(dx)
  }
  const onAvatarsPointerUp = () => {
    const d = dragRef.current
    dragRef.current = null
    if (!d?.moved) return
    setPhotoIndex((i) => indexAfterSwipe(clampIndex(i, photoCount), photoCount, dragDx, d.width))
    setDragging(false)
    setDragDx(0)
    suppressClickRef.current = true // подавить клик-открытие после свайпа
  }
  const onAvatarsClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return }
    const r = e.currentTarget.getBoundingClientRect()
    const zone = pickZone(e.clientX - r.left, r.width, canPage)
    if (zone === 'prev') setPhotoIndex((i) => stepIndex(clampIndex(i, photoCount), photoCount, 'prev'))
    else if (zone === 'next') setPhotoIndex((i) => stepIndex(clampIndex(i, photoCount), photoCount, 'next'))
    else openAvatarViewer(curIndex)
  }

  // Подарки в профиле (tweb Gifts tab) — только для пользователя (private).
  const meId = useChatsStore((st) => st.meId)
  const isUser = !isSaved && !isGroup && !isChannel && peerId != null

  // «Ключ шифрования» (tweb chatEncryptionKey) — только для секретного чата.
  const isSecret = chat.type === 'secret'
  const [keyPopupOpen, setKeyPopupOpen] = useState<boolean | null>(null)
  const [gifts, setGifts] = useState<GiftInfo[]>([])
  const [selectedGift, setSelectedGift] = useState<GiftInfo | null>(null)
  const loadGifts = () => {
    if (!isUser || peerId == null) return
    void managers.stars.profileGifts(peerId).then(setGifts).catch(() => setGifts([]))
  }
  useEffect(() => {
    loadGifts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUser, peerId])

  // Ссылка группы в инфо-карточке: публичный username, иначе первая инвайт-ссылка.
  const inviteUrl = chat.username
    ? `${location.origin}/@${chat.username}`
    : inviteLinks[0]
      ? `${location.origin}/join/${inviteLinks[0].token}`
      : null
  const inviteShort = inviteUrl?.replace(/^https?:\/\//, '') ?? ''
  const [panelLinkCopied, setPanelLinkCopied] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const copyPanelLink = () => {
    if (!inviteUrl) return
    void navigator.clipboard.writeText(inviteUrl)
    setPanelLinkCopied(true)
    setTimeout(() => setPanelLinkCopied(false), 1500)
  }

  const linkText = chat.links?.length ? chat.links : null

  // Шапка прозрачная (белые иконки) над развёрнутым фото до заливки скроллом.
  const overPhoto = expanded && !filled && !!headerAvatarSrc

  return (
    <motion.div
      // Узкий режим: обёртка статична — анимацию (заезд справа) играет сама панель.
      initial={narrow ? false : { width: 0, opacity: 0 }}
      animate={narrow ? {} : { width: 404, opacity: 1 }}
      exit={narrow ? {} : { width: 0, opacity: 0 }}
      transition={{ duration: DUR.in, ease: EASE }}
      style={
        narrow
          ? { position: 'fixed', inset: 0, zIndex: 1900 }
          : {
              overflow: 'hidden',
              flexShrink: 0,
              position: 'sticky',
              top: '16px',
              alignSelf: 'flex-start',
              height: 'calc(100vh - 32px)',
              zIndex: 15,
            }
      }
    >
      <motion.div
        {...(narrow
          ? {
              initial: { x: '100%' },
              animate: { x: '0%' },
              exit: { x: '100%' },
              transition: { duration: DUR.in, ease: EASE },
            }
          : {})}
        className={classNames(s.panel, narrow ? s.panelNarrow : s.panelWide)}
      >
        {/* Шапка: absolute поверх контента. Над фото — прозрачная с белыми
            иконками (tweb .profile-container:not(.header-filled) .sidebar-header
            + .need-white); у табов — заливка, X→назад, «имя + счётчик таба»
            слайд-фейдом (tweb setIsSharedMedia + TransitionSlider slide-fade). */}
        {/* Шапка панели (tweb sidebar-header): X/карандаш; при скролле до табов
            заливается и показывает «имя + счётчик активного таба» слайд-фейдом,
            X→стрелка назад (tweb setIsSharedMedia + TransitionSlider). */}
        {/* overPhoto: развёрнутое фото под шапкой и ещё не залито скроллом —
            шапка прозрачная, иконки/текст белые поверх верхнего градиента
            (tweb .need-white). Скролл → filled: сплошной фон, обычные цвета. */}
        <div className={classNames(s.header, scrolled && !overPhoto ? s.headerScrolled : '', overPhoto ? s.headerWhite : '')}>
          <IconButton onClick={filled ? scrollBackToProfile : onClose} color={overPhoto ? '#fff' : 'var(--tg-textSecondary)'}>
            <TgIcon name={filled ? 'back' : 'close'} />
          </IconButton>
          <div className={s.headerTitles}>
            <AnimatePresence initial={false}>
              {filled && activeCount != null ? (
                <motion.div
                  key="peer"
                  className={s.headerTitleItem}
                  initial={{ y: 14, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 14, opacity: 0 }}
                  transition={{ duration: 0.2, ease: EASE }}
                >
                  <Text noWrap size={16} weight={600} color="var(--tg-textPrimary)">{isSaved ? t('Saved Messages') : chat.name}</Text>
                  <Text noWrap size={13} color="var(--tg-textSecondary)">{countLabel(tab, activeCount, isChannel)}</Text>
                </motion.div>
              ) : (
                <motion.div
                  key="title"
                  className={s.headerTitleItem}
                  initial={{ y: -14, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -14, opacity: 0 }}
                  transition={{ duration: 0.2, ease: EASE }}
                >
                  <Text noWrap size={19} weight={600} color={overPhoto ? '#fff' : 'var(--tg-textPrimary)'}>{t(title)}</Text>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {(isGroup || isChannel) && (
            <IconButton onClick={() => setEditing(true)} color={overPhoto ? '#fff' : 'var(--tg-textSecondary)'}>
              <TgIcon name="edit" />
            </IconButton>
          )}
          {/* Приватный чат: карандаш открывает экран «Изменить контакт»
              (редактируемые поля живут там, инфо-панель — только просмотр). */}
          {isUser && peerId !== meId && onEditContact && (
            <IconButton onClick={onEditContact} color={overPhoto ? '#fff' : 'var(--tg-textSecondary)'}>
              <TgIcon name="edit" />
            </IconButton>
          )}
        </div>

        {/* Развёрнутое фото уходит под прозрачную шапку (top:0, без верхнего
            отступа); свёрнутый круглый аватар — с отступом под шапку. */}
        <div ref={bodyRef} className={classNames(s.body, expanded && headerAvatarSrc ? '' : s.bodyPad)} onScroll={onBodyScroll}>
          {/* Аватар: свёрнут в круг по центру (tweb collapsed) → клик разворачивает
              в большое фото на всю ширину (unfold) → клик по нему открывает
              просмотрщик; скролл сворачивает обратно (onBodyScroll). */}
          <AnimatePresence mode="wait" initial={false}>
            {expanded && headerAvatarSrc ? (
              <motion.div
                key="big"
                ref={avatarWrapRef}
                className={s.profileAvatars}
                onClick={onAvatarsClick}
                onPointerDown={onAvatarsPointerDown}
                onPointerMove={onAvatarsPointerMove}
                onPointerUp={onAvatarsPointerUp}
                onPointerCancel={onAvatarsPointerUp}
                initial={{ scale: 0.35 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.35 }}
                transition={{ duration: 0.24, ease: EASE }}
              >
                {/* дорожка фото: перевод по индексу + live-смещение при свайпе
                    (tweb .profile-avatars translate). Видео играем только у
                    активного слайда, остальные — still-постер. */}
                <div
                  className={s.avatarsTrack}
                  style={{
                    transform: `translateX(calc(${-curIndex * 100}% + ${dragDx}px))`,
                    transition: dragging ? 'none' : undefined,
                  }}
                >
                  {headerPhotos.map((p, i) => (
                    <div key={i} className={s.avatarsSlide}>
                      {p.isVideo && p.videoSrc && i === curIndex ? (
                        <video className={s.profilePhoto} src={p.videoSrc} poster={p.src} autoPlay muted loop playsInline />
                      ) : (
                        <img className={s.profilePhoto} src={p.src} alt="" draggable={false} />
                      )}
                    </div>
                  ))}
                </div>
                {/* сегментная полоска-пейджер (tweb .profile-avatars-tabs) — только N≥2 */}
                {canPage && (
                  <div className={s.avatarsTabs}>
                    {headerPhotos.map((_, i) => (
                      <div key={i} className={classNames(s.avatarsTab, i === curIndex ? s.avatarsTabActive : '')} />
                    ))}
                  </div>
                )}
                <div className={s.avatarsGradient} />
                <div className={classNames(s.avatarsGradient, s.avatarsGradientTop)} />
                <div className={s.avatarsInfo}>
                  <div className={s.profileName}>{chat.name}</div>
                  <div className={s.profileSubtitle}>{subtitleText}</div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="small"
                className={s.avatarBlock}
                initial={{ scale: 1.15 }}
                animate={{ scale: 1 }}
                exit={{ scale: 1.15 }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                <div
                  onClick={() => { if (headerAvatarSrc) setExpanded(true) }}
                  style={{ cursor: headerAvatarSrc ? 'pointer' : 'default', borderRadius: '50%' }}
                >
                  <Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} src={headerAvatarSrc} size="profile" />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', marginTop: '8px', paddingLeft: '16px', paddingRight: '16px' }}>
                  <Text size={21} weight={600} color="var(--tg-textPrimary)" style={{ textAlign: 'center' }}>
                    {chat.name}
                  </Text>
                  {profile?.verified && <VerifiedBadge size={22} />}
                  {profile?.premium && <PremiumBadge size={22} />}
                  {profile?.emojiStatus && <EmojiStatus emoji={profile.emojiStatus} size={22} />}
                </div>
                <Text size={14} color={statusOnline ? 'var(--tg-accent)' : 'var(--tg-textSecondary)'}>
                  {subtitleText}
                </Text>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Info card — те же секции, что в настройках (settings/kit Section+Row).
              В «Избранном» её нет вовсе (tweb: свой профиль без phone/username/bio). */}
          {!isSaved && (
          <Section>
            {isChannel ? (
              <div className={s.channelRow}>
                <TgIcon name="info" size={24} color="var(--tg-textSecondary)" style={{ marginTop: 4 }} />
                <div className={s.grow}>
                  <Text size={15.5} color="var(--tg-textPrimary)" style={{ marginBottom: linkText ? '12px' : 0 }}>
                    {chat.description ?? t('Channel description.')}
                  </Text>
                  {linkText?.map((l) => (
                    <div key={l.label} style={{ marginBottom: '10px' }}>
                      <Text size={15.5} color="var(--tg-textPrimary)">{l.label}:</Text>
                      <Text size={15.5} color="var(--tg-link)" style={{ wordBreak: 'break-all' }}>
                        {l.value}
                      </Text>
                    </div>
                  ))}
                  <Text size={13.5} color="var(--tg-textSecondary)">{t('Info')}</Text>
                </div>
              </div>
            ) : isGroup ? (
              inviteUrl && (
                <div className={s.linkRow} onClick={() => copyPanelLink()}>
                  <TgIcon name="link" size={24} color="var(--tg-textSecondary)" />
                  <div className={s.grow}>
                    <Text size={16} color="var(--tg-textPrimary)" style={{ wordBreak: 'break-all' }}>{inviteShort}</Text>
                    <Text size={13.5} color={panelLinkCopied ? 'var(--tg-accent)' : 'var(--tg-textSecondary)'}>
                      {panelLinkCopied ? t('Link copied to clipboard.') : t('Link')}
                    </Text>
                  </div>
                  <IconButton
                    size="small"
                    color="var(--tg-textSecondary)"
                    onClick={(e) => { e.stopPropagation(); setQrOpen(true) }}
                    aria-label="QR"
                  >
                    <TgIcon name="qr" size={22} />
                  </IconButton>
                </div>
              )
            ) : (
              <>
                {/* Порядок строк — как в tweb peerProfile MainSection: Phone →
                    Username → Bio → Birthday. Данные — GET /users/{id} с уже
                    применённой конфиденциальностью: скрытое сюда не приходит. */}
                {profile?.phone && (
                  <Row
                    icon={<TgIcon name="phone" size={24} />}
                    label={profile.phone}
                    sublabel={t('Phone')}
                    translate={false}
                  />
                )}
                {(profile?.username ?? chat.username) && (
                  <Row
                    icon={<TgIcon name="mention" size={24} />}
                    label={`@${profile?.username ?? chat.username}`}
                    sublabel={t('Username')}
                    translate={false}
                  />
                )}
                {profile?.bio && (
                  <Row
                    icon={<TgIcon name="info" size={24} />}
                    label={profile.bio}
                    sublabel={t('Bio')}
                    translate={false}
                  />
                )}
                {profile?.birthday && (
                  <Row
                    icon={<TgIcon name="gift" size={24} />}
                    label={profile.birthday}
                    sublabel={t('Birthday')}
                    translate={false}
                  />
                )}
              </>
            )}
            <Row
              icon={<TgIcon name="unmute" size={24} />}
              label="Notifications"
              toggle
              checked={!muted}
              onClick={toggleNotifications}
            />
          </Section>
          )}

          {/* Ключ шифрования (tweb chatEncryptionKey) — emoji-fingerprint секретного чата */}
          {isSecret && (
            <Section>
              <Row
                icon={<TgIcon name="key" size={24} />}
                label="Encryption Key"
                onClick={() => setKeyPopupOpen(true)}
              />
            </Section>
          )}


          {/* Статистика (tweb chatFull.can_view_stats): канал/супергруппа → графики */}
          {isRealChat && canViewStats && (
            <div className={s.section}>
              <div className={s.cardPlain}>
                <div
                  className={s.enabledRow}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setShowStats(true)}
                >
                  <TgIcon name="statistics" size={24} color="var(--tg-textSecondary)" />
                  <Text size={16} color="var(--tg-textPrimary)" style={{ flex: 1 }}>
                    {t('Statistics')}
                  </Text>
                  <TgIcon name="next" size={20} color="var(--tg-textSecondary)" />
                </div>
              </div>
            </div>
          )}

          {/* Темы (tweb editChat Topics toggle): группа → форум-топики */}
          {isRealChat && chat.type === 'group' && canManageTopics && (
            <div className={s.section}>
              <Text size={14} weight={600} color="var(--tg-accent)" className={s.sectionTitle}>
                {t('Topics')}
              </Text>
              <div className={s.cardPlain}>
                <div
                  className={s.enabledRow}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    const next = !chat.isForum
                    void managers.groups.setForum(Number(chat.id), next).then(() => loadChats(managers))
                  }}
                >
                  <Text size={16} color="var(--tg-textPrimary)" style={{ flex: 1 }}>{t('Topics')}</Text>
                  <TgSwitch checked={!!chat.isForum} />
                </div>
              </div>
            </div>
          )}

          {/* Channel discussions: admin (creator/CHANGE_INFO) toggle / enabled state */}
          {isRealChat && isChannel && canManageDiscussion && (
            <div className={s.section}>
              <Text size={14} weight={600} color="var(--tg-accent)" className={s.sectionTitle}>
                Обсуждения
              </Text>
              <div className={s.cardPlain}>
                {discussionChatId > 0 ? (
                  <div className={s.enabledRow}>
                    <Text size={16} color="var(--tg-textPrimary)" style={{ flex: 1 }}>Обсуждения включены</Text>
                    <TgIcon name="check" size={22} color="var(--tg-accent)" />
                  </div>
                ) : (
                  <div className={s.actionWrap}>
                    <motion.div
                      whileTap={{ scale: 0.98 }}
                      onClick={() => void enableDiscussion()}
                      className={s.actionBtn}
                      style={{ opacity: enablingDiscussion ? 0.6 : 1 }}
                    >
                      Включить обсуждения
                    </motion.div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Real group/channel: pending join requests (admins with INVITE_USERS / creator) */}
          {isRealChat && canInvite && joinRequests.length > 0 && (
            <div className={s.section}>
              <Text size={14} weight={600} color="var(--tg-accent)" className={s.sectionTitle}>
                Заявки на вступление
              </Text>
              <div className={s.cardPlain}>
                {joinRequests.map((req) => (
                  <div key={req.userId} className={s.requestRow}>
                    <Avatar background="var(--tg-accent)" text={req.displayName[0]?.toUpperCase()} size="md" />
                    <div className={s.grow}>
                      <Text noWrap size={16} color="var(--tg-textPrimary)">{req.displayName}</Text>
                    </div>
                    <IconButton
                      aria-label={`Одобрить заявку: ${req.displayName}`}
                      onClick={() => void approveJoinRequest(req.userId)}
                      color="var(--tg-accent)"
                      style={{ flexShrink: 0 }}
                    >
                      <TgIcon name="check" size={22} />
                    </IconButton>
                    <IconButton
                      aria-label={`Отклонить заявку: ${req.displayName}`}
                      onClick={() => void declineJoinRequest(req.userId)}
                      color="#ff595a"
                      style={{ flexShrink: 0 }}
                    >
                      <TgIcon name="close" size={22} />
                    </IconButton>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Shared media: табы Медиа/Файлы/Ссылки/Музыка/Голосовые (tweb sharedMedia).
              Контент пока моковый — реального API истории по типам ещё нет. */}
          {/* isRealChat из useGroupInfo — только группы/каналы; для шаред-медиа
              реальность чата определяем по numeric id (private тоже подходит) */}
          {/* блок не ниже вьюпорта панели — табы всегда доезжают до шапки
              (tweb _searchSuper.scss: min-height var(--super-height)) */}
          <div className={s.sharedWrap}>
          <SharedMedia
            tab={tab}
            onTab={setTab}
            chatId={sharedMediaChatId(chat.id)}
            members={isRealChat && (isGroup || isChannel) ? realMembers ?? [] : undefined}
            savedDialogs={isSaved ? savedDialogs ?? [] : undefined}
            gifts={isUser ? gifts : undefined}
            onOpenGift={setSelectedGift}
            onSendGift={isUser && peerId !== meId ? onSendGift : undefined}
            isChannel={isChannel}
            canManageAdmins={canManageAdmins}
            onOpenPeer={onOpenPeer}
            onEditMember={setEditMember}
            navRef={tabsBarRef}
            stickyTop={0}
            onCount={(name, n) => setTabCounts((c) => (c[name] === n ? c : { ...c, [name]: n }))}
          />
          </div>

          {/* просмотрщик фото профиля (tweb openAvatarViewer) — стартует с
              текущего фото шапки-пейджера (avatarView.index) */}
          {avatarView && headerAvatarSrc && (
            <MediaLightbox
              items={avatarItems.length ? avatarItems : [{ src: headerAvatarSrc }]}
              index={avatarView.index}
              originRect={avatarView.originRect}
              originSrc={curPhoto?.src ?? headerAvatarSrc}
              originEl={avatarView.originEl}
              onClose={closeAvatarViewer}
            />
          )}

          {/* Инфо полученного подарка (tweb PopupStarGiftInfo) */}
          {selectedGift && (
            <GiftInfoPopup
              gift={selectedGift}
              isOwner={peerId === meId}
              onClose={() => setSelectedGift(null)}
              onChanged={loadGifts}
            />
          )}

          {/* Ключ шифрования секретного чата (tweb chatEncryptionKey) */}
          {isSecret && keyPopupOpen != null && (
            <KeyVerificationPopup
              open={keyPopupOpen}
              onClose={() => setKeyPopupOpen(false)}
              onExitComplete={() => setKeyPopupOpen(null)}
              chatId={numericChatId}
            />
          )}

          {/* QR-код ссылки (иконка в инфо-карточке) — tweb-модалка с темами */}
          {inviteUrl && (
            <QrModal
              open={qrOpen}
              onClose={() => setQrOpen(false)}
              url={inviteUrl}
              label={chat.name}
              avatar={{ src: headerAvatarSrc, background: chat.avatar, text: chat.avatarText }}
            />
          )}
        </div>

        {/* Group add-member FAB (tweb btnAddMembers) */}
        {isGroup && canAddMembers && isRealChat && (
          <motion.div
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.92 }}
            className={s.fab}
            onClick={() => setAddingMembers(true)}
          >
            <TgIcon name="adduser" />
          </motion.div>
        )}

        {/* Edit screen overlay */}
        <AnimatePresence>
          {editing && (isGroup && isRealChat
            ? <GroupEditFlow chatId={Number(chat.id)} chat={chat} onClose={() => setEditing(false)} />
            : <EditView chat={chat} onBack={() => setEditing(false)} />)}
          {addingMembers && isRealChat && (
            <AddMembersScreen
              chatId={Number(chat.id)}
              existingIds={(realMembers ?? []).map((m) => m.userId)}
              onClose={() => setAddingMembers(false)}
              onAdded={() => {
                setAddingMembers(false)
                void refreshMembers()
              }}
            />
          )}
        </AnimatePresence>

        {/* Статистика канала/супергруппы (slide-in сабвью, tweb statistics) */}
        <AnimatePresence>
          {showStats && isRealChat && (
            <ChannelStats
              chatId={Number(chat.id)}
              isChannel={isChannel}
              onBack={() => setShowStats(false)}
            />
          )}
        </AnimatePresence>

        {/* Admin-rights editor overlay (slide-in sub-view, mirrors tweb userPermissions) */}
        <AnimatePresence>
          {editMember && (
            <RightsEditor
              key={editMember.userId}
              member={editMember}
              onBack={() => setEditMember(null)}
              onSave={(bitmask) => saveRights(editMember.userId, bitmask)}
              onRemove={() => removeRights(editMember.userId)}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

// Табы шаред-медиа профиля. Набор и порядок — из tweb sharedMedia.tsx
// (media → files → links → music → voice); данные — реальная история чата
// (GET /chats/{id}/media?filter=...), загружается при первом открытии таба.
const SHARED_TABS = ['Media', 'Files', 'Links', 'Music', 'Voice'] as const

// numeric id реального чата (private/группа/канал) либо null для драфтов
function sharedMediaChatId(id: string): number | null {
  const n = Number(id)
  return Number.isFinite(n) && String(n) === id ? n : null
}
const TAB_FILTER: Record<string, 'media' | 'files' | 'links' | 'music' | 'voice'> = {
  Media: 'media', Files: 'files', Links: 'links', Music: 'music', Voice: 'voice',
}


function SharedMedia({ tab, onTab, chatId, members, savedDialogs, gifts, onOpenGift, onSendGift, isChannel, canManageAdmins, onOpenPeer, onEditMember, navRef, stickyTop, onCount }: {
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
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          originRect={lightbox.originRect}
          originSrc={lightbox.originSrc}
          originEl={lightbox.originEl}
          onClosingStart={() => { lightbox.originEl.style.visibility = '' }}
          onClose={() => { lightbox.originEl.style.visibility = ''; setLightbox(null) }}
        />
      )}
    </>
  )
}

/**
 * Admin-rights editor sub-view. Structure ported from tweb
 * `sidebarRight/tabs/userPermissions.tsx` (a member row + one toggle per right);
 * primitives are the repo's own (TgSwitch + kit-style rows) and it slides in with
 * the shared `slideInRight` animation used across the app.
 */
function RightsEditor({
  member,
  onBack,
  onSave,
  onRemove,
}: {
  member: RealMember
  onBack: () => void
  onSave: (bitmask: number) => void | Promise<void>
  onRemove: () => void | Promise<void>
}) {
  const isAdmin = member.role === 'creator' || member.role === 'admin'
  const initial = isAdmin ? RIGHTS.reduce((acc, r) => acc | r.bit, 0) : 0
  const [bits, setBits] = useState(initial)
  const [saving, setSaving] = useState(false)

  const toggle = (bit: number) => setBits((b) => (b & bit ? b & ~bit : b | bit))

  return (
    <motion.div
      variants={slideInRight}
      initial="initial"
      animate="animate"
      exit="exit"
      className={s.rights}
    >
      <div className={s.rightsHeader}>
        <IconButton onClick={onBack} color="var(--tg-textSecondary)">
          <TgIcon name="back" />
        </IconButton>
        <Text noWrap size={19} weight={600} color="var(--tg-textPrimary)" style={{ flex: 1 }}>
          {member.displayName}
        </Text>
      </div>

      <div className={s.body}>
        <div className={s.section} style={{ marginTop: 0 }}>
          <Text size={14} weight={600} color="var(--tg-accent)" className={s.sectionTitle}>
            Права администратора
          </Text>
          <div className={s.cardPlain}>
            {RIGHTS.map((r) => (
              <div key={r.bit} onClick={() => toggle(r.bit)} className={s.rightRow}>
                <Text size={16} color="var(--tg-textPrimary)" style={{ flex: 1 }}>{r.label}</Text>
                <TgSwitch checked={(bits & r.bit) !== 0} />
              </div>
            ))}
          </div>
        </div>

        <div className={s.section} style={{ marginTop: 12 }}>
          <motion.div
            whileTap={{ scale: 0.98 }}
            onClick={async () => {
              if (saving) return
              setSaving(true)
              try {
                await onSave(bits)
              } finally {
                setSaving(false)
              }
            }}
            className={s.saveBtn}
            style={{ opacity: saving ? 0.6 : 1 }}
          >
            Сохранить
          </motion.div>
          {isAdmin && (
            <div
              onClick={async () => {
                if (saving) return
                setSaving(true)
                try {
                  await onRemove()
                } finally {
                  setSaving(false)
                }
              }}
              className={s.removeBtn}
            >
              Снять права
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
