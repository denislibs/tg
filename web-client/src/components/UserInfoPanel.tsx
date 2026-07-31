import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import QrModal from './QrModal'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE, DUR } from '../motion'
import TgIcon from './TgIcon'
import ChannelStats from './ChannelStats'
import Avatar from '../shared/ui/Avatar'
import { useAvatarSrc } from './useAvatarSrc'
import VerifiedBadge from './VerifiedBadge'
import PremiumBadge from './PremiumBadge'
import EmojiStatus from './EmojiStatus'
import GroupEditFlow from './group/GroupEditFlow'
import AddMembersScreen from './group/AddMembersScreen'
import { Section, Row } from './settings/kit'
import PinnedStoriesSection from './PinnedStoriesSection'
import classNames from '../shared/lib/classNames'
import type { Chat, OpenPeer } from '../data'
import { useT } from '../i18n'
import { useGroupInfo } from '../core/hooks/useGroupInfo'
import { useSavedDialogs, useUserProfile, useProfileGifts, useProfilePhotos, type HeaderPhoto } from '../core/hooks/useUserProfileData'
import { useMuteToggle } from '../core/hooks/useMuteToggle'
import { useChatsStore } from '../stores/chatsStore'
import { useNavLayer } from '../core/hooks/useNavLayer'
import { useLang } from '../i18n'
import { lastSeenLabel } from '../core/presence'
// MediaLightbox грузится лениво; тип — type-only импорт (стирается, статической связи не создаёт)
import type { LightboxItem } from './messages/MediaLightbox'
const MediaLightbox = lazy(() => import('./messages/MediaLightbox'))
import { clampIndex, pickZone, stepIndex, indexAfterSwipe } from '../core/photoPager'
import s from './UserInfoPanel.module.scss'
import useMediaQuery from '../shared/lib/useMediaQuery'
import type { GiftInfo } from '../core/managers/starsManager'
import GiftInfoPopup from './stars/GiftInfoPopup'
import KeyVerificationPopup from './secret/KeyVerificationPopup'
import SharedMedia from './userInfo/SharedMedia'
import RightsEditor from './userInfo/RightsEditor'
import { membersLabel, chatsLabel, countLabel, sharedMediaChatId, HEADER_H, TAB_GAP } from './userInfo/helpers'

export default function UserInfoPanel({ chat, onClose, onOpenPeer, canAddMembers, onEditContact, onSendGift }: { chat: Chat; onClose: () => void; onOpenPeer?: (peer: OpenPeer) => void; canAddMembers?: boolean; onEditContact?: () => void; onSendGift?: () => void }) {
  const t = useT()
  const narrow = useMediaQuery('(max-width:900px)')
  useNavLayer(true, onClose) // Back закрывает панель профиля (tweb right column)
  const isSaved = chat.type === 'saved'
  // группы — таб «Участники», избранное — «Чаты» (tweb savedDialogs first), остальные — «Медиа»
  const [tab, setTab] = useState(chat.type === 'group' ? 'Members' : isSaved ? 'Chats' : 'Media')

  // «Избранное»: сохранённые диалоги (группировка по источнику пересылки)
  const savedDialogs = useSavedDialogs(isSaved)
  const [editing, setEditing] = useState(false)
  const [addingMembers, setAddingMembers] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const headerAvatarSrc = useAvatarSrc(chat.avatarUrl)

  // Чужой профиль с применённой конфиденциальностью (GET /users/{id}):
  // телефон/bio/день рождения приходят пустыми, если скрыты правилами.
  const peerId = chat.peerId
  const profile = useUserProfile(peerId, isSaved)

  // Тумблер Notifications = per-chat mute (tweb PeerProfile: checked = !muted,
  // переключение — togglePeerMute напрямую, без попапа длительности)
  const numericChatId = Number(chat.id)
  const { muted, toggle: toggleNotifications } = useMuteToggle(numericChatId, chat.muted)

  const {
    isRealChat,
    isChannel,
    isGroup,
    realMembers,
    canManageAdmins,
    canInvite,
    canManageDiscussion,
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
    setFilled(top <= HEADER_H + TAB_GAP + 1)
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
  const photos = useProfilePhotos({ peerId, isSaved, expanded, headerAvatarSrc })
  const [photoIndex, setPhotoIndex] = useState(0)
  // Смена собеседника — сбрасываем позицию (кэш галереи сбрасывает хук).
  useEffect(() => { setPhotoIndex(0) }, [peerId])
  // Сворачивание шапки возвращает к первому фото (tweb setCollapsed → go first).
  useEffect(() => { if (!expanded) setPhotoIndex(0) }, [expanded])

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
  const { gifts, reload: loadGifts } = useProfileGifts(isUser, peerId)
  const [selectedGift, setSelectedGift] = useState<GiftInfo | null>(null)

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
            {/* Ключ шифрования (tweb chatEncryptionKey) — emoji-fingerprint
                секретного чата; в той же секции, что и уведомления */}
            {isSecret && (
              <Row
                icon={<TgIcon name="key" size={24} />}
                label="Encryption Key"
                onClick={() => setKeyPopupOpen(true)}
              />
            )}
          </Section>
          )}

          {/* Закреплённые в профиле истории (tweb profile stories) — только у пользователя */}
          {isUser && peerId != null && <PinnedStoriesSection peerId={peerId} />}

          {/* Статистика — только канал (у групп не показываем) */}
          {isRealChat && isChannel && canViewStats && (
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

          {/* Форум-топики группы («Обсуждения») перенесены в «Изменить группу». */}

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
            stickyTop={TAB_GAP}
            onCount={(name, n) => setTabCounts((c) => (c[name] === n ? c : { ...c, [name]: n }))}
          />
          </div>

          {/* просмотрщик фото профиля (tweb openAvatarViewer) — стартует с
              текущего фото шапки-пейджера (avatarView.index) */}
          {avatarView && headerAvatarSrc && (
            <Suspense fallback={null}>
              <MediaLightbox
                items={avatarItems.length ? avatarItems : [{ src: headerAvatarSrc }]}
                index={avatarView.index}
                originRect={avatarView.originRect}
                originSrc={curPhoto?.src ?? headerAvatarSrc}
                originEl={avatarView.originEl}
                onClose={closeAvatarViewer}
              />
            </Suspense>
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
          {editing && isRealChat && (isGroup || isChannel) && (
            <GroupEditFlow chatId={Number(chat.id)} chat={chat} onClose={() => setEditing(false)} />
          )}
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
