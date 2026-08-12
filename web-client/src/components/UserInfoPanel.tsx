import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import QrModal from './QrModal'
import rootScope from '@lib/rootScope'
import TgIcon from './TgIcon'
import AnimatedSuper from './conversation/AnimatedSuper'
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
// Просмотрщик фото профиля — vanilla-вьювер (Task 16, замена MediaLightbox)
import { openMediaViewer } from './mediaViewer/openMediaViewer'
import type { ViewerItem } from './mediaViewer/appMediaViewer'
import { clampIndex, pickZone, stepIndex, indexAfterSwipe } from '../core/photoPager'
import s from './UserInfoPanel.module.scss'
import useMediaQuery from '../shared/lib/useMediaQuery'
import type { GiftInfo } from '../core/managers/starsManager'
import GiftInfoPopup from './stars/GiftInfoPopup'
import KeyVerificationPopup from './secret/KeyVerificationPopup'
import SharedMedia from './userInfo/SharedMedia'
import RightsEditor from './userInfo/RightsEditor'
import { membersLabel, chatsLabel, countLabel, sharedMediaChatId, HEADER_H, TAB_GAP } from './userInfo/helpers'
import installColumnResize from '../core/dom/installColumnResize'

export default function UserInfoPanel({ open, chat, onClose, onOpenPeer, canAddMembers, onEditContact, onSendGift }: { open: boolean; chat: Chat; onClose: () => void; onOpenPeer?: (peer: OpenPeer) => void; canAddMembers?: boolean; onEditContact?: () => void; onSendGift?: () => void }) {
  const t = useT()
  const narrow = useMediaQuery('(max-width:900px)')
  useNavLayer(open, onClose) // Back закрывает панель профиля (tweb right column)
  // Класс открытия ставим ПОСЛЕ первого коммита (эффект) — первый кадр панель
  // отрисована сдвинутой за край, и появление играет CSS-transition transform
  // (tweb body.is-right-column-shown на постоянно смонтированном #column-right).
  const [shown, setShown] = useState(false)
  useEffect(() => { setShown(open) }, [open])
  // tweb body.is-right-column-shown: пока правая колонка открыта и не «плавает»
  // над чатом, #column-center сдвигает свою translateX-центровку (_chat.scss:439).
  useEffect(() => {
    document.body.classList.toggle('is-right-column-shown', open)
    return () => document.body.classList.remove('is-right-column-shown')
  }, [open])
  // Правая колонка тоже тянется ручкой (tweb sidebarRight/index.ts:40
  // `installColumnResize({columnEl: this.sidebarEl, side: 'right'})`): ширина
  // без свёрнутого состояния, зажата в MIN/MAX. `.sidebar-resize-handle-right`
  // скрыт до 925px, кроме non-touch (styles/tweb/_leftSidebar.scss:1330).
  const columnRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const columnEl = columnRef.current
    if (!columnEl) return
    return installColumnResize({ columnEl, side: 'right' })
  }, [])
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

  // колёсико по телу панели (tweb useCollapsable.onMove): вверх при scrollTop=0
  // разворачивает шапку, вниз — сворачивает (не дожидаясь скролла)
  const onBodyWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!headerAvatarSrc) return
    if (e.deltaY < 0 && e.currentTarget.scrollTop === 0 && !expanded) setExpanded(true)
    else if (e.deltaY > 0 && expanded) setExpanded(false)
  }

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

  // Просмотрщик фото профиля (tweb openAvatarViewer: клик по центру фото
  // открывает полноэкранно) — vanilla-вьювер (Task 16). Натуральных размеров
  // модель галереи не знает — премеряем still-картинки (мгновенно: их src уже
  // показан шапкой, кэш браузера); видео-аватар (tweb photo_video) играет в
  // gif-режиме вьювера (muted-loop без плеера), бокс — по размерам still'а.
  const openAvatarViewer = (startIndex: number) => {
    const el = avatarWrapRef.current
    if (!el || !headerAvatarSrc) return
    const photos: HeaderPhoto[] = headerPhotos.length ? headerPhotos : [{ src: headerAvatarSrc, isVideo: false }]
    const index = clampIndex(startIndex, photos.length)
    const measure = (src: string) => new Promise<{ w: number; h: number } | null>((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => resolve(null)
      img.src = src
    })
    void Promise.all(photos.map((p) => measure(p.src))).then((sizes) => {
      const items: ViewerItem[] = photos.map((p, i) => ({
        // цель полёта закрытия есть только у открытого фото — пролистанные
        // гаснут opacity (как вёл себя и старый лайтбокс)
        element: i === index ? el : null,
        mid: 0, // не сообщение: forward/delete/jump не пробрасываются
        media: {
          mediaId: 0,
          width: sizes[i]?.w ?? 0,
          height: sizes[i]?.h ?? 0, // 0×0 → контроллер подставит бокс миниатюры
          kind: p.isVideo ? 'video' : 'photo',
          gif: p.isVideo || undefined,
          // готовый URL мимо конвейера (ViewerMedia.url): still — blob
          // конвейера, видео — токенный URL (useProfilePhotos)
          url: p.isVideo ? p.videoSrc : p.src,
        },
        author: { peerId: peerId ?? 0, name: chat.name, date: '' },
      }))
      void openMediaViewer({ items, index, target: el })
    })
  }

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
  // Клик по единому контейнеру: свёрнутый кружок разворачивается (tweb unfold),
  // развёрнутое фото — краевые трети листают / центр открывает просмотрщик.
  const onContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!expanded) {
      if (headerAvatarSrc) setExpanded(true)
      return
    }
    onAvatarsClick(e)
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
  const [qrOpen, setQrOpen] = useState(false)

  const linkText = chat.links?.length ? chat.links : null

  // Клик по инфо-строке копирует значение + глобальный тост (tweb peerProfile:
  // copyTextToClipboard + toast(PhoneCopied/UsernameCopied/BioCopied)).
  const copyInfo = (value: string, toastKey: string) => {
    void navigator.clipboard.writeText(value)
    rootScope.dispatchEvent('ui:toast', t(toastKey))
  }
  const infoPhone = profile?.phone
  const infoUsername = profile?.username ?? chat.username
  const infoBio = profile?.bio

  // Шапка прозрачная (белые иконки) над развёрнутым фото до заливки скроллом.
  const overPhoto = expanded && !filled && !!headerAvatarSrc

  return createPortal(
    // tweb #column-right: панель ФИКСИРОВАННОЙ ширины, absolute у правого края,
    // ЗАКРЫТА = translate3d(100% + отступ), ОТКРЫТА = translate3d(0,0,0);
    // transition transform (in .3s / out .25s, cb(.4,0,.2,1)), без opacity-фейда.
    // Панель остаётся смонтированной; закрытая — inert (недоступна фокусу/AT).
    // Портал в #main-columns: в tweb #column-right — СОСЕДНЯЯ колонка (§1), а не
    // потомок #column-center; внутри него панель ловила бы его transform
    // (translateX-центровку чата) и уезжала бы за край экрана.
    <div
      id="column-right"
      ref={columnRef}
      inert={!open}
      className={classNames('tabs-tab', 'sidebar', 'sidebar-right', 'main-column', s.panel, narrow ? s.panelNarrow : s.panelWide, shown ? s.panelOpen : '')}
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
          <IconButton onClick={filled ? scrollBackToProfile : onClose} color={overPhoto ? '#fff' : 'var(--secondary-text-color)'}>
            <TgIcon name={filled ? 'back' : 'close'} />
          </IconButton>
          <div className={s.headerTitles}>
            {/* Смена заголовка — вертикальный слайд tweb `AnimatedSuper`
                (порт `components/animatedSuper.ts` + `_animatedSuper.scss`):
                уходящий ряд уезжает вверх/вниз с фейдом за --pm-transition.
                Индекс 1 (имя собеседника) больше индекса 0 (название раздела),
                поэтому «вниз по списку» = уходящий ряд наверх, как в tweb. */}
            <AnimatedSuper index={filled && activeCount != null ? 1 : 0} rowClassName={s.headerTitleItem}>
              {filled && activeCount != null ? (
                <>
                  <Text noWrap size={16} weight={600} color="var(--primary-text-color)">{isSaved ? t('Saved Messages') : chat.name}</Text>
                  <Text noWrap size={13} color="var(--secondary-text-color)">{countLabel(tab, activeCount, isChannel)}</Text>
                </>
              ) : (
                <Text noWrap size={19} weight={600} color={overPhoto ? '#fff' : 'var(--primary-text-color)'}>{t(title)}</Text>
              )}
            </AnimatedSuper>
          </div>
          {(isGroup || isChannel) && (
            <IconButton onClick={() => setEditing(true)} color={overPhoto ? '#fff' : 'var(--secondary-text-color)'}>
              <TgIcon name="edit" />
            </IconButton>
          )}
          {/* Приватный чат: карандаш открывает экран «Изменить контакт»
              (редактируемые поля живут там, инфо-панель — только просмотр). */}
          {isUser && peerId !== meId && onEditContact && (
            <IconButton onClick={onEditContact} color={overPhoto ? '#fff' : 'var(--secondary-text-color)'}>
              <TgIcon name="edit" />
            </IconButton>
          )}
        </div>

        <div ref={bodyRef} className={s.body} onScroll={onBodyScroll} onWheel={onBodyWheel}>
          {/* Шапка-аватары (tweb .profile-avatars-container): ЕДИНЫЙ DOM-контейнер,
              collapsed ↔ expanded морфится классом is-collapsed чистыми CSS
              transition'ами — padding-bottom 100%↔66%, активный слайд
              translateY(-3%) scale(120/400) + border-radius 50%, имя/статус
              центрируются transform'ом и меняют цвет. Клик по свёрнутому кружку
              разворачивает; скролл сворачивает (onBodyScroll). */}
          <div
            ref={avatarWrapRef}
            className={classNames(s.avatarsContainer, expanded && headerAvatarSrc ? '' : s.isCollapsed)}
            onClick={onContainerClick}
            onPointerDown={expanded ? onAvatarsPointerDown : undefined}
            onPointerMove={expanded ? onAvatarsPointerMove : undefined}
            onPointerUp={expanded ? onAvatarsPointerUp : undefined}
            onPointerCancel={expanded ? onAvatarsPointerUp : undefined}
            style={headerAvatarSrc ? undefined : { cursor: 'default' }}
          >
            {/* дорожка фото: перевод по индексу + live-смещение при свайпе
                (tweb .profile-avatars-avatars translate). Видео играем только у
                активного слайда в развёрнутом состоянии, иначе — still-постер. */}
            <div
              className={s.avatarsTrack}
              style={{
                transform: `translateX(calc(${-curIndex * 100}% + ${dragDx}px))`,
                transition: dragging ? 'none' : undefined,
              }}
            >
              {headerPhotos.length > 0 ? (
                headerPhotos.map((p, i) => (
                  <div key={i} className={classNames(s.avatarsSlide, i === curIndex ? s.avatarsSlideActive : '')}>
                    {expanded && p.isVideo && p.videoSrc && i === curIndex ? (
                      <video className={s.profilePhoto} src={p.videoSrc} poster={p.src} autoPlay muted loop playsInline />
                    ) : (
                      <img className={s.profilePhoto} src={p.src} alt="" draggable={false} />
                    )}
                  </div>
                ))
              ) : (
                /* без фото — фиксированный аватар-120 по центру, без морфа
                   (tweb .profile-avatars-container.is-topic) */
                <div className={classNames(s.avatarsSlide, s.avatarsSlideActive, s.avatarsSlideNoPhoto)}>
                  <Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} size="profile" />
                </div>
              )}
            </div>
            {/* сегментная полоска-пейджер (tweb .profile-avatars-tabs) — только N≥2;
                в collapsed прячется opacity */}
            {canPage && (
              <div className={s.avatarsTabs}>
                {headerPhotos.map((_, i) => (
                  <div key={i} className={classNames(s.avatarsTab, i === curIndex ? s.avatarsTabActive : '')} />
                ))}
              </div>
            )}
            <div className={s.avatarsGradient} />
            <div className={classNames(s.avatarsGradient, s.avatarsGradientTop)} />
            {/* имя+статус — ОДНИ узлы в обоих состояниях (tweb .profile-avatars-info):
                collapsed центрирует их transform'ом и меняет цвет с белого на текстовый */}
            <div className={s.avatarsInfo}>
              <div className={s.profileName}>
                <span className={s.profileNameText}>{chat.name}</span>
                {profile?.verified && <VerifiedBadge size={22} />}
                {profile?.premium && <PremiumBadge size={22} />}
                {profile?.emojiStatus && <EmojiStatus emoji={profile.emojiStatus} size={22} />}
              </div>
              <div className={s.profileSubtitle}>{subtitleText}</div>
            </div>
          </div>

          {/* Info card — те же секции, что в настройках (settings/kit Section+Row).
              В «Избранном» её нет вовсе (tweb: свой профиль без phone/username/bio). */}
          {!isSaved && (
          <Section>
            {isChannel ? (
              <div className={s.channelRow}>
                <TgIcon name="info" size={24} color="var(--secondary-text-color)" style={{ marginTop: 4 }} />
                <div className={s.grow}>
                  <Text size={15.5} color="var(--primary-text-color)" style={{ marginBottom: linkText ? '12px' : 0 }}>
                    {chat.description ?? t('Channel description.')}
                  </Text>
                  {/* клик по ссылке канала — копирование + тост (tweb PeerProfile.Link) */}
                  {linkText?.map((l) => (
                    <div
                      key={l.label}
                      style={{ marginBottom: '10px', cursor: 'pointer' }}
                      onClick={() => copyInfo(l.value, 'Link copied to clipboard.')}
                    >
                      <Text size={15.5} color="var(--primary-text-color)">{l.label}:</Text>
                      <Text size={15.5} color="var(--link-color)" style={{ wordBreak: 'break-all' }}>
                        {l.value}
                      </Text>
                    </div>
                  ))}
                  <Text size={13.5} color="var(--secondary-text-color)">{t('Info')}</Text>
                </div>
              </div>
            ) : isGroup ? (
              // клик копирует ссылку + глобальный тост (tweb PeerProfile.Link:
              // copyTextToClipboard + toast(LinkCopied))
              inviteUrl && (
                <div className={s.linkRow} onClick={() => copyInfo(inviteUrl, 'Link copied to clipboard.')}>
                  <TgIcon name="link" size={24} color="var(--secondary-text-color)" />
                  <div className={s.grow}>
                    <Text size={16} color="var(--primary-text-color)" style={{ wordBreak: 'break-all' }}>{inviteShort}</Text>
                    <Text size={13.5} color="var(--secondary-text-color)">{t('Link')}</Text>
                  </div>
                  <IconButton
                    size="small"
                    color="var(--secondary-text-color)"
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
                    применённой конфиденциальностью: скрытое сюда не приходит.
                    Клик по строке копирует значение + тост (tweb Row clickable). */}
                {infoPhone && (
                  <Row
                    icon={<TgIcon name="phone" size={24} />}
                    label={infoPhone}
                    sublabel={t('Phone')}
                    translate={false}
                    onClick={() => copyInfo(infoPhone, 'Phone copied to clipboard')}
                  />
                )}
                {infoUsername && (
                  <Row
                    icon={<TgIcon name="mention" size={24} />}
                    label={`@${infoUsername}`}
                    sublabel={t('Username')}
                    translate={false}
                    onClick={() => copyInfo(`@${infoUsername}`, 'Username copied to clipboard')}
                  />
                )}
                {infoBio && (
                  <Row
                    icon={<TgIcon name="info" size={24} />}
                    label={infoBio}
                    sublabel={t('Bio')}
                    translate={false}
                    multiline
                    onClick={() => copyInfo(infoBio, 'Bio copied to clipboard')}
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
                  <TgIcon name="statistics" size={24} color="var(--secondary-text-color)" />
                  <Text size={16} color="var(--primary-text-color)" style={{ flex: 1 }}>
                    {t('Statistics')}
                  </Text>
                  <TgIcon name="next" size={20} color="var(--secondary-text-color)" />
                </div>
              </div>
            </div>
          )}

          {/* Форум-топики группы («Обсуждения») перенесены в «Изменить группу». */}

          {/* Channel discussions: admin (creator/CHANGE_INFO) toggle / enabled state */}
          {isRealChat && isChannel && canManageDiscussion && (
            <div className={s.section}>
              <Text size={14} weight={600} color="var(--primary-color)" className={s.sectionTitle}>
                Обсуждения
              </Text>
              <div className={s.cardPlain}>
                {discussionChatId > 0 ? (
                  <div className={s.enabledRow}>
                    <Text size={16} color="var(--primary-text-color)" style={{ flex: 1 }}>Обсуждения включены</Text>
                    <TgIcon name="check" size={22} color="var(--primary-color)" />
                  </div>
                ) : (
                  <div className={s.actionWrap}>
                    {/* tweb не даёт кнопкам press-scale: отклик — ripple и фон
                        (_button.scss:75-77), поэтому whileTap снят. */}
                    <div
                      onClick={() => void enableDiscussion()}
                      className={s.actionBtn}
                      style={{ opacity: enablingDiscussion ? 0.6 : 1 }}
                    >
                      Включить обсуждения
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Real group/channel: pending join requests (admins with INVITE_USERS / creator) */}
          {isRealChat && canInvite && joinRequests.length > 0 && (
            <div className={s.section}>
              <Text size={14} weight={600} color="var(--primary-color)" className={s.sectionTitle}>
                Заявки на вступление
              </Text>
              <div className={s.cardPlain}>
                {joinRequests.map((req) => (
                  <div key={req.userId} className={s.requestRow}>
                    <Avatar background="var(--primary-color)" text={req.displayName[0]?.toUpperCase()} size="md" />
                    <div className={s.grow}>
                      <Text noWrap size={16} color="var(--primary-text-color)">{req.displayName}</Text>
                    </div>
                    <IconButton
                      aria-label={`Одобрить заявку: ${req.displayName}`}
                      onClick={() => void approveJoinRequest(req.userId)}
                      color="var(--primary-color)"
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
          <div className={s.fab} onClick={() => setAddingMembers(true)}>
            <TgIcon name="adduser" />
          </div>
        )}

        {/* Оверлеи-подэкраны: въезд справа играет CSS самого экрана, обёртки-
            презенсы не нужны. */}
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

        {/* Статистика канала/супергруппы (slide-in сабвью, tweb statistics) */}
        {showStats && isRealChat && (
          <ChannelStats
            chatId={Number(chat.id)}
            isChannel={isChannel}
            onBack={() => setShowStats(false)}
          />
        )}

        {/* Admin-rights editor overlay (slide-in sub-view, mirrors tweb userPermissions) */}
        {editMember && (
          <RightsEditor
            key={editMember.userId}
            member={editMember}
            onBack={() => setEditMember(null)}
            onSave={(bitmask) => saveRights(editMember.userId, bitmask)}
            onRemove={() => removeRights(editMember.userId)}
          />
        )}
    </div>,
    document.getElementById('main-columns') ?? document.body,
  )
}
