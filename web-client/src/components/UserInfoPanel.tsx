import type { LangPackKey } from '@/lang'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import IconButton from '../shared/ui/IconButton'
import QrModal from './QrModal'
import rootScope from '@lib/rootScope'
import TgIcon from './TgIcon'
import ChannelStats from './ChannelStats'
import Avatar from '../shared/ui/Avatar'
import { useMediaUrl } from '../core/hooks/useMediaUrl'
import VerifiedBadge from './VerifiedBadge'
import PremiumBadge from './PremiumBadge'
import EmojiStatus from './EmojiStatus'
import GroupEditFlow from './group/GroupEditFlow'
import AddMembersScreen from './group/AddMembersScreen'
import { Row } from './settings/kit'
import SidebarSection from '../shared/ui/SidebarSection'
import PinnedStoriesSection from './PinnedStoriesSection'
import classNames from '../shared/lib/classNames'
import type { Chat, OpenPeer } from '../data'
import { useT } from '../i18n'
import { useGroupInfo } from '../core/hooks/useGroupInfo'
import { useSavedDialogs, useUserProfile, useProfileGifts, useProfilePhotos, type HeaderPhoto } from '../core/hooks/useUserProfileData'
import { useMuteToggle } from '../core/hooks/useMuteToggle'
import { useChatsStore } from '../stores/chatsStore'
import { useNavLayer } from '../core/hooks/useNavLayer'
import { useTransitionSlider } from '../core/hooks/useTransitionSlider'
import { useLang } from '../i18n'
import { userStatusLabel } from '../core/presence'
// Просмотрщик фото профиля — vanilla-вьювер (Task 16, замена MediaLightbox)
import { openMediaViewer } from './mediaViewer/openMediaViewer'
import type { ViewerItem } from './mediaViewer/appMediaViewer'
import { clampIndex, pickZone, stepIndex, indexAfterSwipe } from '../core/photoPager'
import type { SavedStarGift } from '../core/managers/starsManager'
import GiftInfoPopup from './stars/GiftInfoPopup'
import KeyVerificationPopup from './secret/KeyVerificationPopup'
import SharedMedia from './userInfo/SharedMedia'
import RightsEditor from './userInfo/RightsEditor'
import { membersLabel, chatsLabel, countLabel, sharedMediaChatId, HEADER_H, ADDITIONAL_OFFSET, BODY_PADDING, TAB_GAP } from './userInfo/helpers'
import installColumnResize from '../core/dom/installColumnResize'
import { useRightColumnShown } from '../core/hooks/useRightColumnShown'
import animationIntersector from './animationIntersector'
import { NULL_PEER_ID, isUser as isUserPeer } from '../core/peers/peerId'
import { formatBirthday } from '../core/format/birthday'

/**
 * Видео-аватарка профиля — порт tweb `loadAvatarVideoOverlay` (avatarNew.tsx:150-190)
 * в части УЧЁТА: зацикленный muted-клип отдаётся общему `animationIntersector`
 * (`type: 'video'`, наблюдается сам `<video>`), а не крутится сам по себе.
 * Без учёта его нечем остановить: правая колонка закрывается ТРАНСФОРМОМ,
 * узел остаётся в DOM, и наблюдатель считает его видимым — клип декодируется
 * в закрытой панели (см. `animationIntersector.toggleVideosUnder`).
 * Снятие с учёта на размонтировании — та же `middleware.onDestroy`-ветка
 * оригинала (:182-188): залоченный элемент сам из реестра не уходит.
 */
function AvatarVideo({ src, poster }: { src: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    animationIntersector.addAnimation({ animation: video, observeElement: video, type: 'video' })
    return () => {
      animationIntersector.removeAnimationByPlayer(video)
      video.pause()
      video.src = ''
      video.load()
    }
  }, [src])

  // tweb `createLoopingMutedVideo(url, 'avatar-photo avatar-video')` — класс
  // `avatar-video` адресуемый: по нему оригинал находит клипы аватарок в DOM.
  return <video ref={ref} className="avatar-photo avatar-video" src={src} poster={poster} autoPlay muted loop playsInline />
}

export default function UserInfoPanel({ open, chat, onClose, onOpenPeer, canAddMembers, onEditContact, onSendGift }: { open: boolean; chat: Chat; onClose: () => void; onOpenPeer?: (peer: OpenPeer) => void; canAddMembers?: boolean; onEditContact?: () => void; onSendGift?: () => void }) {
  const t = useT()
  useNavLayer(open, onClose) // Back закрывает панель профиля (tweb right column)
  // tweb body.is-right-column-shown: пока правая колонка открыта и не «плавает»
  // над чатом, #column-center сдвигает свою translateX-центровку (_chat.scss:439).
  // Счётчик (useRightColumnShown), а не булев toggle: экран поиска правой
  // колонки (RightSearchTab — «Поиск стикеров»/«Поиск GIF») пользуется тем же
  // классом и может быть открыт одновременно с этой панелью (композер, из
  // которого он открывается, доступен независимо от профиля) — булев toggle
  // в двух местах гасил бы класс раньше времени.
  useRightColumnShown(open)
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
  // tweb `appSidebarRight.hide()`/`toggleSidebar()` (sidebarRight/index.ts:98,132):
  // закрытая колонка уезжает ТРАНСФОРМОМ и остаётся смонтированной, поэтому
  // видео внутри неё останавливает не наблюдатель, а явная команда.
  useEffect(() => {
    animationIntersector.toggleVideosUnder(columnRef.current, !open)
  }, [open])
  const isSaved = chat.type === 'saved'
  // группы — таб «Участники», избранное — «Чаты» (tweb savedDialogs first), остальные — «Медиа»
  const [tab, setTab] = useState<LangPackKey>(chat.type === 'group' ? 'PeerMedia.Members' : isSaved ? 'FilterChats' : 'SharedMediaTab2')

  // «Избранное»: сохранённые диалоги (группировка по источнику пересылки)
  const savedDialogs = useSavedDialogs(isSaved)
  const [editing, setEditing] = useState(false)
  const [addingMembers, setAddingMembers] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const headerAvatarSrc = useMediaUrl(chat.photoId ?? null)

  // Чужой профиль с применённой конфиденциальностью (GET /users/{id}):
  // телефон/bio/день рождения приходят пустыми, если скрыты правилами.
  // Ключ пира ЗНАКОВЫЙ и лежит в самом `chat.id` — отдельного поля
  // «собеседник приватного чата» больше нет: у приватного диалога ключ и есть
  // id собеседника.
  const peerId = Number(chat.id)
  // `/users/{id}` и галерея фото профиля есть ТОЛЬКО у человека. Прежде отбор
  // делался самим существованием поля (`chat.peerId` заполнялся лишь у
  // приватного диалога) — теперь ключ есть у любого пира, и вид спрашивают
  // предикатом: без него панель группы ушла бы за профилем по отрицательному id.
  const userPeerId = isUserPeer(peerId) ? peerId : null
  const profile = useUserProfile(userPeerId, isSaved)

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
    discussionPeerId,
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

  const title = isSaved ? 'SavedMessages' : isChannel ? 'Profile.Info.Channel' : isGroup ? 'Profile.Info.Group' : 'Profile.Info.User'

  // ── аватар (tweb peerProfileAvatars): по дефолту свёрнут в круг (collapsed);
  // клик разворачивает в большое фото на всю ширину (unfold), скролл вниз
  // сворачивает обратно ──
  const [expanded, setExpanded] = useState(false)

  // ── скролл-поведение шапки: при скролле до табов шаред-медиа шапка
  // заливается и показывает «имя + счётчик активного таба» (tweb sharedMedia.tsx
  // setIsSharedMedia / TransitionSlider) ──
  const [filled, setFilled] = useState(false)
  // tweb setIsSharedMedia (sharedMedia.tsx:505-516): заливку шапки СТАВИТ переход
  // к табам и СНИМАЕТ только клик по «назад» — обратный скролл её не снимает.
  const [headerFilled, setHeaderFilled] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const tabsBarRef = useRef<HTMLDivElement>(null)
  const onBodyScroll = () => {
    const body = bodyRef.current, bar = tabsBarRef.current
    if (!body || !bar) return
    // скролл вниз сворачивает развёрнутое фото обратно в круг (tweb collapse)
    if (body.scrollTop > 4) setExpanded(false)
    // порог tweb: верх таб-плашки доехал до низа шапки (top <= OFFSET) — смена
    // заголовка на «имя + счётчик» (не связано с фоном шапки)
    // порог 1:1 с tweb: OFFSET(56+16) + BODY_PADDING(16), top = rect.top - 1
    const top = bar.getBoundingClientRect().top - body.getBoundingClientRect().top - 1
    const isSharedMedia = top <= HEADER_H + ADDITIONAL_OFFSET + BODY_PADDING
    setFilled(isSharedMedia)
    if (isSharedMedia) setHeaderFilled(true)
  }
  // клик по «назад» в залитой шапке — к началу профиля (tweb closeBtn: scrollIntoView profile-content)
  const scrollBackToProfile = () => {
    bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    setHeaderFilled(false) // tweb: closeBtn снимает заливку вместе с возвратом заголовка
  }

  // колёсико по телу панели (tweb useCollapsable.onMove): вверх при scrollTop=0
  // разворачивает шапку, вниз — сворачивает (не дожидаясь скролла)
  const onBodyWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!headerAvatarSrc) return
    if (e.deltaY < 0 && e.currentTarget.scrollTop === 0 && !expanded) setExpanded(true)
    else if (e.deltaY > 0 && expanded) setExpanded(false)
  }

  // счётчики табов шаред-медиа для подзаголовка залитой шапки (tweb onLengthChange)
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({})
  const activeCount = tab === 'PeerMedia.Members'
    ? realMembers?.length
    : tab === 'FilterChats'
      ? savedDialogs?.length
      : tabCounts[tab]

  // Онлайн-статус приватного собеседника — из presence-стора (как в топбаре
  // ChatHeader), а не из статичного chat.status: «в сети» / «был(а) …».
  const [lang] = useLang()
  const peerPresence = useChatsStore((st) => st.presence[peerId])
  const presenceLabel =
    !isSaved && !isGroup && !isChannel
      ? peerPresence
        ? userStatusLabel(peerPresence, lang)
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
  const photos = useProfilePhotos({ peerId: userPeerId, isSaved, expanded, headerAvatarSrc })
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
  // «Это человек» — вопрос к ЗНАКУ ключа, а не связка трёх отрицаний по виду
  // диалога (`peerId != null` там же было мёртвым: ключ есть у любого пира).
  const isUser = !isSaved && isUserPeer(peerId)

  // «Ключ шифрования» (tweb chatEncryptionKey) — только для секретного чата.
  const isSecret = chat.type === 'secret'
  const [keyPopupOpen, setKeyPopupOpen] = useState<boolean | null>(null)
  const { gifts, reload: loadGifts } = useProfileGifts(isUser, peerId)
  const [selectedGift, setSelectedGift] = useState<SavedStarGift | null>(null)

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
  const copyInfo = (value: string, toastKey: LangPackKey) => {
    void navigator.clipboard.writeText(value)
    rootScope.dispatchEvent('ui:toast', t(toastKey))
  }
  const infoPhone = profile?.user.phone
  const infoUsername = profile?.user.username ?? chat.username
  const infoBio = profile?.fullUser.about

  // Шапка прозрачная (белые иконки) над развёрнутым фото до заливки скроллом.
  const overPhoto = expanded && !filled && !!headerAvatarSrc
  // Заголовок шапки: 0 — название раздела, 1 — «имя + счётчик таба» (tweb
  // sharedMedia.setIsSharedMedia переключает тот же TransitionSlider).
  const headerSlider = useTransitionSlider(filled && activeCount != null ? 1 : 0)

  return createPortal(
    // tweb #column-right (`_rightSidebar.scss`): панель ширины
    // --right-column-width, absolute у правого края; закрытая уехала
    // translate3d'ом за край, открытая — на месте. Открытие переключает НЕ
    // класс панели, а `body.is-right-column-shown` (эффект выше) — как в tweb.
    // Панель остаётся смонтированной; закрытая — inert (недоступна фокусу/AT).
    // Портал в #main-columns: в tweb #column-right — СОСЕДНЯЯ колонка (§1), а не
    // потомок #column-center; внутри него панель ловила бы его transform
    // (translateX-центровку чата) и уезжала бы за край экрана.
    <div
      id="column-right"
      ref={columnRef}
      inert={!open}
      className="tabs-tab sidebar sidebar-right main-column"
    >
      {/* Вкладка-слайдер правой колонки (дамп 07-right-sidebar):
          `div.sidebar-content.sidebar-slider.tabs-container` > сама вкладка
          профиля. Состояния шапки-аватаров — классами НА ВКЛАДКЕ, как в tweb
          (`_profile.scss`: `.profile-container.is-collapsed`, `.need-white`,
          `.header-filled`), а не на внутренних узлах. */}
      <div className="sidebar-content sidebar-slider tabs-container">
        <div
          className={classNames(
            'tabs-tab sidebar-slider-item scrollable-y-bordered shared-media-container profile-container active',
            expanded && headerAvatarSrc ? '' : 'is-collapsed',
            headerFilled ? 'header-filled' : '',
            overPhoto ? 'need-white' : '',
            isGroup && canAddMembers && isRealChat ? 'can-add-members' : '',
          )}
        >
        {/* Шапка: absolute поверх контента (`.profile-container .sidebar-header`).
            Над фото — прозрачная с белыми иконками (`:not(.header-filled)` +
            `.need-white`); у табов — заливка, X→назад, «имя + счётчик таба»
            слайд-фейдом (tweb setIsSharedMedia + TransitionSlider slide-fade). */}
        <div className={classNames('sidebar-header', filled ? 'hide-border' : '')}>
          {/* X ⇄ «назад» — не смена иконки, а поворот трёх полосок
              (`.animated-close-icon.state-back`, `_animatedIcon.scss`). */}
          <button
            type="button"
            className="btn-icon sidebar-close-button"
            onClick={filled ? scrollBackToProfile : onClose}
            aria-label={t(filled ? 'Common.Back' : 'Close')}
          >
            <div className={classNames('animated-close-icon', filled ? 'state-back' : '')} />
          </button>
          {/* Заголовок раздела ⇄ «имя + счётчик активного таба»: два
              `.transition-item` в `.transition.slide-fade`, как у tweb
              (sharedMedia.setIsSharedMedia → TransitionSlider). */}
          <div className={classNames('transition slide-fade', headerSlider.containerClass)}>
            <div className={classNames('transition-item', headerSlider.itemClass(0))}>
              <div className="sidebar-header__title">{t(title)}</div>
              {(isGroup || isChannel) && (
                <IconButton onClick={() => setEditing(true)}>
                  <TgIcon name="edit" />
                </IconButton>
              )}
              {/* Приватный чат: карандаш открывает экран «Изменить контакт»
                  (редактируемые поля живут там, инфо-панель — только просмотр). */}
              {isUser && peerId !== meId && onEditContact && (
                <IconButton onClick={onEditContact}>
                  <TgIcon name="edit" />
                </IconButton>
              )}
            </div>
            <div className={classNames('transition-item', headerSlider.itemClass(1))}>
              <div className="sidebar-header__rows">
                <div className="sidebar-header__title">
                  <span className="peer-title">{isSaved ? t('SavedMessages') : chat.name}</span>
                </div>
                <div className="sidebar-header__subtitle">
                  {activeCount != null ? countLabel(tab, activeCount, isChannel) : ''}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Тело — тоже глобальные классы tweb: `div.sidebar-content` (позиционный
            предок, `_sidebar.scss`) > `div.scrollable.scrollable-y`
            (`position:absolute; inset:0; overflow-y:auto` из `_scrollable.scss`). */}
        <div className="sidebar-content">
        <div ref={bodyRef} className="scrollable scrollable-y" onScroll={onBodyScroll} onWheel={onBodyWheel}>
        <div className="profile-content">
          {/* Шапка-аватары (tweb .profile-avatars-container): ЕДИНЫЙ DOM-контейнер,
              collapsed ↔ expanded морфится классом is-collapsed чистыми CSS
              transition'ами — padding-bottom 100%↔66%, активный слайд
              translateY(-3%) scale(120/400) + border-radius 50%, имя/статус
              центрируются transform'ом и меняют цвет. Клик по свёрнутому кружку
              разворачивает; скролл сворачивает (onBodyScroll). */}
          <div
            ref={avatarWrapRef}
            className={classNames('profile-avatars-container', canPage ? '' : 'is-single', dragging ? 'is-swiping' : '')}
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
              className="profile-avatars-avatars"
              style={{
                transform: `translateX(calc(${-curIndex * 100}% + ${dragDx}px))`,
                transition: dragging ? 'none' : undefined,
              }}
            >
              {headerPhotos.length > 0 ? (
                headerPhotos.map((p, i) => (
                  <div key={i} className={classNames('profile-avatars-avatar media-container', i === curIndex ? 'active' : '')}>
                    {/* tweb: фото лежит в `.avatar.avatar-like.avatar-full` —
                        оттуда и круг в collapsed, и object-fit у `.avatar-photo`. */}
                    <div className="avatar avatar-like avatar-full avatar-gradient profile-avatars-avatar-first">
                      {expanded && p.isVideo && p.videoSrc && i === curIndex ? (
                        <AvatarVideo src={p.videoSrc} poster={p.src} />
                      ) : (
                        <img className="avatar-photo" src={p.src} alt="" draggable={false} />
                      )}
                    </div>
                  </div>
                ))
              ) : (
                /* без фото — аватар-120 по центру, без морфа (tweb .is-topic) */
                <div className="profile-avatars-avatar media-container active">
                  <Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} size="profile" />
                </div>
              )}
            </div>
            <div className="profile-avatars-gradient" />
            <div className="profile-avatars-gradient profile-avatars-gradient-top" />
            {/* сегментная полоска-пейджер (tweb .profile-avatars-tabs); при одном
                фото её скрывает сам `.is-single`, ветвление в JS не нужно */}
            <div className="profile-avatars-tabs">
              {headerPhotos.map((_, i) => (
                <div key={i} className={classNames('profile-avatars-tab', i === curIndex ? 'active' : '')} />
              ))}
            </div>
            <div className="profile-avatars-arrow">
              <span className="tgico profile-avatars-arrow-icon" />
            </div>
            <div className="profile-avatars-arrow profile-avatars-arrow-next">
              <span className="tgico profile-avatars-arrow-icon" />
            </div>
            {/* имя+статус — ОДНИ узлы в обоих состояниях (tweb .profile-avatars-info):
                collapsed центрирует их transform'ом и меняет цвет с белого на текстовый */}
            <div className="profile-avatars-info">
              <div className="profile-name">
                <span className="peer-title">{chat.name}</span>
                {profile?.user.pFlags?.verified && <VerifiedBadge size={22} />}
                {profile?.user.pFlags?.premium && <PremiumBadge size={22} />}
                {profile?.user.emoji_status_emoticon && <EmojiStatus emoji={profile.user.emoji_status_emoticon} size={22} />}
              </div>
              <div className="profile-subtitle">
                <div className="profile-subtitle-text"><span>{subtitleText}</span></div>
              </div>
            </div>
          </div>
          <div className="profile-content-delimiter" />

          {/* Info card — те же секции, что в настройках (settings/kit Section+Row).
              В «Избранном» её нет вовсе (tweb: свой профиль без phone/username/bio). */}
          {!isSaved && (
          <SidebarSection noDelimiter>
            {isChannel ? (
              <>
                {/* Описание канала — обычная `.row` с иконкой (tweb PeerProfile
                    MainSection: Info-строка), многострочная через `pre-wrap`. */}
                <Row
                  icon={<TgIcon name="info" size={24} />}
                  label={chat.description ?? t('Profile.ChannelDescription')}
                  sublabel={t('Info')}
                  translate={false}
                  multiline
                />
                {/* клик по ссылке канала — копирование + тост (tweb PeerProfile.Link) */}
                {linkText?.map((l) => (
                  <Row
                    key={l.label}
                    icon={<TgIcon name="link" size={24} />}
                    label={l.value}
                    sublabel={l.label}
                    translate={false}
                    onClick={() => copyInfo(l.value, 'LinkCopied')}
                  />
                ))}
              </>
            ) : isGroup ? (
              // Ссылка группы: `.row.row-grid` с QR-кнопкой в `.row-right`
              // (дамп 15-right-11). Клик копирует + тост (tweb PeerProfile.Link).
              inviteUrl && (
                <Row
                  icon={<TgIcon name="link" size={24} />}
                  label={inviteShort}
                  sublabel={t('SetUrlPlaceholder')}
                  translate={false}
                  onClick={() => copyInfo(inviteUrl, 'LinkCopied')}
                  right={
                    <button
                      type="button"
                      className="btn-icon qr rp"
                      aria-label="QR"
                      onClick={(e) => { e.stopPropagation(); setQrOpen(true) }}
                    >
                      <TgIcon name="qr" size={22} />
                    </button>
                  }
                />
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
                    onClick={() => copyInfo(infoPhone, 'PhoneCopied')}
                  />
                )}
                {infoUsername && (
                  <Row
                    icon={<TgIcon name="mention" size={24} />}
                    label={`@${infoUsername}`}
                    sublabel={t('Username')}
                    translate={false}
                    onClick={() => copyInfo(`@${infoUsername}`, 'UsernameCopied')}
                  />
                )}
                {infoBio && (
                  <Row
                    icon={<TgIcon name="info" size={24} />}
                    label={infoBio}
                    sublabel={t('UserBio')}
                    translate={false}
                    multiline
                    onClick={() => copyInfo(infoBio, 'BioCopied')}
                  />
                )}
                {profile?.fullUser.birthday && (
                  <Row
                    icon={<TgIcon name="gift" size={24} />}
                    label={formatBirthday(profile.fullUser.birthday)}
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
                label="SecretChat.EncryptionKey"
                onClick={() => setKeyPopupOpen(true)}
              />
            )}
          </SidebarSection>
          )}

          {/* Закреплённые в профиле истории (tweb profile stories) — только у пользователя */}
          {isUser && <PinnedStoriesSection peerId={peerId} />}

          {/* Статистика — только канал (у групп не показываем) */}
          {isRealChat && isChannel && canViewStats && (
            <SidebarSection noDelimiter>
              <Row
                icon={<TgIcon name="statistics" size={24} />}
                label="Statistics"
                onClick={() => setShowStats(true)}
              />
            </SidebarSection>
          )}

          {/* Форум-топики группы («Обсуждения») перенесены в «Изменить группу». */}

          {/* Channel discussions: admin (creator/CHANGE_INFO) toggle / enabled state */}
          {isRealChat && isChannel && canManageDiscussion && (
            <SidebarSection noDelimiter title={t('PeerInfo.Discussion')}>
              {/* ЗНАКОВЫЙ ключ: у чата он ОТРИЦАТЕЛЬНЫЙ, и прежнее «> 0»
                  выключило бы обсуждение ровно наоборот. */}
              {discussionPeerId !== NULL_PEER_ID ? (
                <Row
                  icon={<TgIcon name="comments" size={24} />}
                  label="Discussion enabled"
                  translate={false}
                  selected
                />
              ) : (
                <Row
                  icon={<TgIcon name="comments" size={24} />}
                  label="Enable discussion"
                  translate={false}
                  accent
                  onClick={enablingDiscussion ? undefined : () => void enableDiscussion()}
                />
              )}
            </SidebarSection>
          )}

          {/* Real group/channel: pending join requests (admins with INVITE_USERS / creator) */}
          {isRealChat && canInvite && joinRequests.length > 0 && (
            <SidebarSection noDelimiter title={t('SubscribeRequests')}>
              {joinRequests.map((req) => (
                <Row
                  key={req.userId}
                  icon={<Avatar background="var(--primary-color)" text={req.title[0]?.toUpperCase()} size="md" />}
                  label={req.title}
                  translate={false}
                  right={
                    <>
                      <button
                        type="button"
                        className="btn-icon rp"
                        aria-label={`Одобрить заявку: ${req.title}`}
                        onClick={() => void approveJoinRequest(req.userId)}
                      >
                        <TgIcon name="check" size={22} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon rp danger"
                        aria-label={`Отклонить заявку: ${req.title}`}
                        onClick={() => void declineJoinRequest(req.userId)}
                      >
                        <TgIcon name="close" size={22} />
                      </button>
                    </>
                  }
                />
              ))}
            </SidebarSection>
          )}

          {/* Shared media: табы Медиа/Файлы/Ссылки/Музыка/Голосовые (tweb sharedMedia).
              Контент пока моковый — реального API истории по типам ещё нет. */}
          {/* isRealChat из useGroupInfo — только группы/каналы; для шаред-медиа
              реальность чата определяем по numeric id (private тоже подходит) */}
          {/* блок не ниже вьюпорта панели — табы всегда доезжают до шапки
              (tweb _searchSuper.scss: min-height var(--super-height)) */}
          <div className="search-super">
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
              date={selectedGift.date}
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
        </div>{/* /.profile-content */}
        </div>
        </div>

        {/* Group add-member FAB (tweb btnAddMembers): `.btn-circle.btn-corner`
            внутри самой вкладки — её `.can-add-members` и поднимает
            (`_profile.scss` → `.shared-media-container.can-add-members`). */}
        {isGroup && canAddMembers && isRealChat && (
          <button type="button" className="btn-circle btn-corner rp" onClick={() => setAddingMembers(true)}>
            <TgIcon name="adduser" />
          </button>
        )}
        </div>{/* /.profile-container */}

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
      </div>{/* /.sidebar-slider */}
    </div>,
    document.getElementById('main-columns') ?? document.body,
  )
}
