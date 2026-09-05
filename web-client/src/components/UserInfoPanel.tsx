import type { LangPackKey } from '@/lang'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
import {useT} from '../i18n'
import { useGroupInfo } from '../core/hooks/useGroupInfo'
import { useSavedDialogs, useUserProfile, useProfileGifts } from '../core/hooks/useUserProfileData'
import { useMuteToggle } from '../core/hooks/useMuteToggle'
import { useChatsStore } from '../stores/chatsStore'
import { useNavLayer } from '../core/hooks/useNavLayer'
import { useTransitionSlider } from '../core/hooks/useTransitionSlider'
import {} from '../i18n'
import { PeerStatus } from '../shared/ui/peerStatus'
import type { SavedStarGift } from '../core/managers/starsManager'
import GiftInfoPopup from './stars/GiftInfoPopup'
import KeyVerificationPopup from './secret/KeyVerificationPopup'
import SharedMedia from './userInfo/SharedMedia'
import RightsEditor from './userInfo/RightsEditor'
import { membersLabel, chatsLabel, countLabel, sharedMediaChatId, shouldForceFold, HEADER_H, ADDITIONAL_OFFSET, BODY_PADDING, TAB_GAP } from './userInfo/helpers'
import installColumnResize from '../core/dom/installColumnResize'
import { useRightColumnShown } from '../core/hooks/useRightColumnShown'
import animationIntersector from './animationIntersector'
import { NULL_PEER_ID, isUser as isUserPeer } from '../core/peers/peerId'
import { formatBirthday } from '../core/format/birthday'
// Шапка-аватары (tweb peerProfileAvatars) — задача 5: класс на классах tweb,
// вмонтированный через useImperativeIsland (мост не пишем руками), плюс
// реальный useCollapsable(). Мост фактов взят из докблока класса целиком.
import { useImperativeIsland } from '../core/hooks/useImperativeIsland'
import useCollapsable from '../core/hooks/useCollapsable'
import { fastRaf } from '@helpers/schedulers'
import PeerProfileAvatars from './peerProfileAvatars'
import { useManagers } from '../core/hooks/useManagers'

export default function UserInfoPanel({ open, chat, onClose, onOpenPeer, canAddMembers, onEditContact, onSendGift }: { open: boolean; chat: Chat; onClose: () => void; onOpenPeer?: (peer: OpenPeer) => void; canAddMembers?: boolean; onEditContact?: () => void; onSendGift?: () => void }) {
  const t = useT()
  useNavLayer(open, onClose, 'right') // Back закрывает панель профиля (tweb right column)
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

  // ── скролл-поведение шапки: при скролле до табов шаред-медиа шапка
  // заливается и показывает «имя + счётчик активного таба» (tweb sharedMedia.tsx
  // setIsSharedMedia / TransitionSlider) ──
  const [filled, setFilled] = useState(false)
  // tweb setIsSharedMedia (sharedMedia.tsx:505-516): заливку шапки СТАВИТ переход
  // к табам и СНИМАЕТ только клик по «назад» — обратный скролл её не снимает.
  //
  // ЗАДАЧА 5: это ВТОРАЯ, отдельная от класса, половина владения `header-filled`
  // на ТОМ ЖЕ узле (`setCollapsedOnRef`) — сводить с классом нельзя (см. брифа
  // задачи 5, п.3): здесь `header-filled` ставит доезд до табов и снимает клик
  // «назад» (tweb `sharedMedia.tsx:513`/`:547`); класс (`updateHeaderFilled`,
  // ниже) — независимо, по порогам скролла 5/200px (tweb `:949-955`).
  const [headerFilled, setHeaderFilled] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const tabsBarRef = useRef<HTMLDivElement>(null)
  const onBodyScroll = () => {
    const body = bodyRef.current, bar = tabsBarRef.current
    // tweb `:312-320` (`scrollable.onAdditionalScroll` + `fastRaf`) — класс сам
    // на скролл не подписан (докблок `peerProfileAvatars.ts`, «Скролл →
    // updateHeaderFilled»): владелец скролл-узла — эта панель (сама рендерит
    // `bodyRef`, сама уже слушает `onScroll`), поэтому эквивалент — панель зовёт
    // публичный `updateHeaderFilled()` из СВОЕГО обработчика, а не второй
    // слушатель на том же узле.
    fastRaf(() => avatarsRef.current?.updateHeaderFilled())
    if (!body || !bar) return
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

  // счётчики табов шаред-медиа для подзаголовка залитой шапки (tweb onLengthChange)
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({})
  const activeCount = tab === 'PeerMedia.Members'
    ? realMembers?.length
    : tab === 'FilterChats'
      ? savedDialogs?.length
      : tabCounts[tab]

  // Онлайн-статус приватного собеседника — из presence-стора (как в топбаре
  // ChatHeader), а не из статичного chat.status: «в сети» / «был(а) …».
  const peerPresence = useChatsStore((st) => st.presence[peerId])
  const presenceLabel =
    !isSaved && !isGroup && !isChannel
      ? peerPresence
        ? <PeerStatus status={peerPresence} />
        : chat.status
      : null

  const subtitleText = isSaved
    ? chatsLabel(savedDialogs?.length ?? 0)
    : isRealChat && (isGroup || isChannel) && realMembers
      ? membersLabel(realMembers.length, isChannel)
      : presenceLabel ?? chat.status

  // ── шапка-аватары (tweb peerProfileAvatars) — задача 5: класс
  // `PeerProfileAvatars` (`./peerProfileAvatars.ts`, задачи 1-4) владеет ВСЕЙ
  // каруселью (DOM, лента, жесты, `is-collapsed`/`need-white`/`header-filled`
  // по порогам скролла); эта панель — только владелец узла-хозяина и реального
  // `useCollapsable()` (см. «Осознанное отступление» докблока класса). ──
  const managers = useManagers()
  const avatarsRef = useRef<PeerProfileAvatars | null>(null)
  // Узел вкладки (`.profile-container`) — на нём класс вешает `is-collapsed`/
  // `need-white`/`header-filled` (свою половину), а панель — `header-filled`
  // (свою половину, см. onBodyScroll выше) и `can-add-members`/`active` через
  // JSX. Оба владельца толкают классы на ОДИН и тот же узел, `is-collapsed`/
  // `need-white` при этом больше НЕ вычисляются в JSX (полностью у класса) —
  // иначе пересчёт classNames() по несвязанному поводу стирал бы их с DOM.
  const setCollapsedOnRef = useRef<HTMLDivElement>(null)
  // Хост-узел острова — пуст сам по себе, класс вставляет туда СВОЙ
  // `container` (structural DOM, tweb :81-109); контент `.profile-avatars-info`
  // (имя/статус пира) остаётся React-компонентом — портал ниже, в JSX.
  const avatarsHostRef = useRef<HTMLDivElement>(null)
  // Триггер повторного рендера ровно тогда, когда `instance.info` становится
  // доступен (после монтажа острова) — до этого момента порталить некуда.
  const [avatarsInfoEl, setAvatarsInfoEl] = useState<HTMLElement | null>(null)

  // Реальный useCollapsable() (задача 4 подготовила только контракт со стороны
  // класса) — геттеры собраны по списку из докблока `peerProfileAvatars.ts`
  // («Сигналы, которые понадобятся задаче 5»): `scrollable` → тело панели
  // (`bodyRef`, тот же узел, что несёт `scrollableEl` классу ниже),
  // `listenWheelOn`/`container` — узел вкладки / собственный DOM класса.
  const { folded, unfold, fold } = useCollapsable({
    scrollable: () => bodyRef.current,
    listenWheelOn: () => setCollapsedOnRef.current,
    container: () => avatarsRef.current?.container ?? null,
  })

  // Остров — мост НЕ пишем руками (докблок `useImperativeIsland.ts` целиком):
  // `host` — узел рендерит эта панель (`avatarsHostRef`), `mode: 'host'`
  // (дефолт) — `container === host`, класс сам строит поддерево и добавляет
  // его единственным ребёнком; `strays` чистит ИМЕННО его на teardown (узел
  // хоста — не одноразовый, как в `mode: 'own'`, а живёт всё время панели).
  // Deps — `[]`: инстанс переживает смену пира (докблок `setPeer`, класс не
  // пересоздаётся под каждого пира, в отличие от tweb).
  useImperativeIsland((container) => {
    const instance = new PeerProfileAvatars({
      managers,
      setCollapsedOn: setCollapsedOnRef.current!,
      scrollableEl: bodyRef.current!,
      unfold,
    })
    avatarsRef.current = instance
    container.appendChild(instance.container)
    setAvatarsInfoEl(instance.info)
    return () => {
      instance.cleanup()
      avatarsRef.current = null
      setAvatarsInfoEl(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [], { host: avatarsHostRef, strays: '.profile-avatars-container' })

  // Смена пира — тот же инстанс класса просто перегружает ленту (докблок
  // `setPeer`); topicId у единственного вызывающего нет вовсе.
  useEffect(() => {
    void avatarsRef.current?.setPeer(peerId)
  }, [peerId])

  // tweb :340-348 (createEffect), портирован ЦЕЛИКОМ — не только
  // `setCollapsed(folded)`, но и гейт «нет фото → держать свёрнутым»
  // (`hasNoPhoto && !folded() → fold()`): без него шапка пира БЕЗ фото
  // разворачивалась бы колесом в пустоту (находка ревью задачи 4). Сам гейт —
  // чистая функция `shouldForceFold` (`./userInfo/helpers.ts`): эффект
  // нерендерибелен в тестах (см. `UserInfoPanel.shell.test.ts`), а вынесенная
  // логика — протестирована напрямую (`userInfo/helpers.test.ts`), это и есть
  // обязательное покрытие гейта из брифа задачи 5. `useLayoutEffect`, а не
  // `useEffect` — та же layout-фаза, что и у монтажа острова выше (без неё
  // между setPeer/paint и первым эффектом был бы кадр без `is-collapsed` на DOM).
  useLayoutEffect(() => {
    const instance = avatarsRef.current
    if (!instance) return
    if (shouldForceFold(instance.hasPhoto, folded)) {
      fold()
      return
    }
    instance.setCollapsed(folded)
    // `fold`/`unfold` — стабильные ссылки useCollapsable (useCallback от
    // стабильного setProgress, тот же приём эскейпа, что useCollapsable.ts
    // применяет к своему onMove); в deps — только то, что реально должно
    // пересоздавать эффект.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folded])

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
          `.header-filled`), а не на внутренних узлах. `is-collapsed`/
          `need-white` больше НЕ вычисляются здесь (задача 5, см. коммент у
          `setCollapsedOnRef` выше) — их держит класс `PeerProfileAvatars`
          через `ref` на ЭТОТ узел; `header-filled` остаётся React-состоянием
          (вторая половина, сводить нельзя — см. onBodyScroll). */}
      <div className="sidebar-content sidebar-slider tabs-container">
        <div
          ref={setCollapsedOnRef}
          className={classNames(
            'tabs-tab sidebar-slider-item scrollable-y-bordered shared-media-container profile-container active',
            headerFilled ? 'header-filled' : '',
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
        <div ref={bodyRef} className="scrollable scrollable-y" onScroll={onBodyScroll}>
        <div className="profile-content">
          {/* Шапка-аватары (tweb .profile-avatars-container) — задача 5: узел
              класса `PeerProfileAvatars` встаёт СЮДА через useImperativeIsland
              (host: `avatarsHostRef`, см. коммент у объявления выше). Класс сам
              строит DOM/ленту/жесты/is-collapsed/need-white/header-filled(своя
              половина); React по-прежнему владеет ТОЛЬКО контентом
              `.profile-avatars-info` — портал ниже, в тот же узел (`instance.info`,
              публичное поле класса, докблок «кто владеет контентом»). */}
          <div ref={avatarsHostRef} />
          {avatarsInfoEl && createPortal(
            <>
              {/* имя+статус — ОДНИ узлы в обоих состояниях (tweb .profile-avatars-info):
                  collapsed центрирует их transform'ом и меняет цвет с белого на текстовый */}
              <div className="profile-name">
                <span className="peer-title">{chat.name}</span>
                {profile?.user.pFlags?.verified && <VerifiedBadge size={22} />}
                {profile?.user.pFlags?.premium && <PremiumBadge size={22} />}
                {profile?.user.emoji_status_emoticon && <EmojiStatus emoji={profile.user.emoji_status_emoticon} size={22} />}
              </div>
              <div className="profile-subtitle">
                <div className="profile-subtitle-text"><span>{subtitleText}</span></div>
              </div>
            </>,
            avatarsInfoEl,
          )}
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
