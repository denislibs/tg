import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import IconButton from '../shared/ui/IconButton'
import QrModal from './QrModal'
import TgIcon from './TgIcon'
import ChannelStats from './ChannelStats'
import { useMediaUrl } from '../core/hooks/useMediaUrl'
import GroupEditFlow from './group/GroupEditFlow'
import AddMembersScreen from './group/AddMembersScreen'
import PinnedStoriesSection from './PinnedStoriesSection'
import classNames from '../shared/lib/classNames'
import type { Chat, OpenPeer } from '../data'
import { useT } from '../i18n'
import { useGroupInfo } from '../core/hooks/useGroupInfo'
import { useChatsStore } from '../stores/chatsStore'
import { useNavLayer } from '../core/hooks/useNavLayer'
import { useTransitionSlider } from '../core/hooks/useTransitionSlider'
import KeyVerificationPopup from './secret/KeyVerificationPopup'
import RightsEditor from './userInfo/RightsEditor'
import { countLabel, isSharedMediaReached, shouldForceFold } from './userInfo/helpers'
import installColumnResize from '../core/dom/installColumnResize'
import { useRightColumnShown } from '../core/hooks/useRightColumnShown'
import animationIntersector from './animationIntersector'
import { isUser as isUserPeer } from '../core/peers/peerId'
import { cachedUser } from '../core/peerCache'
import { getUserTitle } from '../core/peers/getPeerTitle'
import { getPeerPhotoId } from '../core/peers/peer'
import { getParticipantPeerId, isParticipantAdmin, isParticipantCreator } from '../core/peers/participant'
import type { RealMember } from '../core/hooks/useGroupInfo'
// Шапка-аватары (tweb peerProfileAvatars) — задача 5: класс на классах tweb,
// плюс реальный useCollapsable(). Мост фактов взят из докблока класса целиком.
// С задачи 13 плана shared media узел класса едет в Solid-корень пропом
// `avatarsContainer` (первым ребёнком `.profile-content`, tweb `:196`), а не
// стоит соседом в React-хосте — см. докблок у `avatars` ниже.
import useCollapsable from '../core/hooks/useCollapsable'
import { fastRaf } from '@helpers/schedulers'
import PeerProfileAvatars from './peerProfileAvatars'
import { useManagers } from '../core/hooks/useManagers'
// Каркас карточки (Task 2, план `docs/superpowers/plans/
// 2026-09-05-profile-card-solid.md`): `.profile-content` теперь рисует Solid,
// смонтированный мостом `mountSolid` — см. докблок у `profileContentHostRef`.
import PeerProfile, { type PeerProfileProps } from './peerProfile.solid'
import { mountSolid } from '../shared/solid/mountSolid.solid'
// Шаред-медиа (tweb `sharedMedia.tsx` + `AppSearchSuper`) — задача 13 плана
// `docs/superpowers/plans/2026-09-07-solid-wave-3-shared-media.md`: класс
// въезжает через хук-шов `useSearchSuper` (роль `AppSharedMediaTab`), панель
// исполняет только контракт шапки (`sharedMedia.tsx:484-517`) — см. эффект у
// `setIsSharedMedia` ниже.
import { useSearchSuper } from '../core/hooks/useSearchSuper'
import type { SearchSuperMediaType } from './appSearchSuper'

export default function UserInfoPanel({ open, chat, onClose, onOpenPeer, canAddMembers, onEditContact }: { open: boolean; chat: Chat; onClose: () => void; onOpenPeer?: (peer: OpenPeer) => void; canAddMembers?: boolean; onEditContact?: () => void }) {
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
  // «Ключ шифрования» (tweb chatEncryptionKey, Task 5 плана «карточка профиля
  // на Solid» — секции без аналога в оригинале) — только для секретного чата.
  // Объявлено выше прежнего места (было — рядом с `keyPopupOpen`) ради
  // мостового эффекта `mountSolid` ниже (deps `[…, isSecret]`): в JS/TS
  // `const` не хостится, а этот эффект читает `isSecret` до её прежней строки.
  const isSecret = chat.type === 'secret'
  // Активная вкладка шаред-медиа — её выбирает КЛАСС (первый показ,
  // `appSearchSuper.ts::loadFirstTime`, tweb `:2478-2495`) и сообщает сюда
  // `onChangeTab` (`sharedMedia.tsx:650-668`); панель только показывает её
  // счётчик в залитой шапке.
  const [tab, setTab] = useState<SearchSuperMediaType | null>(null)
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

  const numericChatId = Number(chat.id)

  const {
    isRealChat,
    isChannel,
    isGroup,
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
  } = useGroupInfo(chat)

  const title = isSaved ? 'SavedMessages' : isChannel ? 'Profile.Info.Channel' : isGroup ? 'Profile.Info.Group' : 'Profile.Info.User'

  // ── скролл-поведение шапки: при доезде до ряда вкладок шаред-медиа шапка
  // заливается и показывает «имя + счётчик активной вкладки» (tweb
  // sharedMedia.tsx:484-517 — `onAdditionalScroll` скроллера вкладки +
  // `setIsSharedMedia` + TransitionSlider). Сам обработчик — эффект у
  // `setIsSharedMedia` ниже, после хука-шва: ему нужен класс. ──
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

  // счётчики вкладок для подзаголовка залитой шапки — `onLengthChange` класса
  // (tweb sharedMedia.tsx:669-676: `item[2].compareAndUpdate({key, args: [length]})`)
  const [counters, setCounters] = useState<Partial<Record<SearchSuperMediaType, number>>>({})
  const activeCount = tab ? counters[tab] : undefined

  // Присутствие/статус приватного собеседника и счётчик участников группы/
  // канала — раньше считались ЗДЕСЬ (`subtitleText`) для React-портала в
  // `instance.info`. Задача 3 профиля на Solid перенесла ИМЯ И СТАТУС пира
  // внутрь `avatars.info` Solid-компонентом (`peerProfile.solid.tsx`,
  // `SubtitleStatus`/`ChatMembersLabel`) — второго писателя `info` не должно
  // быть (докблок `avatars` ниже, «правило владения»), поэтому эта
  // ветка вычислений отсюда убрана целиком, а не просто перестала
  // использоваться.

  // ── шапка-аватары (tweb peerProfileAvatars) — задача 5: класс
  // `PeerProfileAvatars` (`./peerProfileAvatars.ts`, задачи 1-4) владеет ВСЕЙ
  // каруселью (DOM, лента, жесты, `is-collapsed`/`need-white`/`header-filled`
  // по порогам скролла); эта панель — только хозяин инстанса и реального
  // `useCollapsable()` (см. «Осознанное отступление» докблока класса). ──
  const managers = useManagers()
  const avatarsRef = useRef<PeerProfileAvatars | null>(null)
  // Узел вкладки (`.profile-container`) — на нём класс вешает `is-collapsed`/
  // `need-white`/`header-filled` (свою половину) через `classList.toggle`,
  // МИМО React.
  //
  // НАХОДКА РЕВЬЮ (Critical, раунд правок 3): раньше панельная половина
  // (`header-filled`, `can-add-members`) писалась через `classNames()` в
  // JSX — а React НЕ мержит атрибут `className`: при смене ВЫЧИСЛЕННОЙ
  // строки (например, когда `headerFilled` взводится доездом до табов) он
  // присваивает `node.className` ЦЕЛИКОМ, стирая `is-collapsed`/`need-white`
  // /половину класса, выставленные НЕ им. Сценарий обычный: свернули шапку →
  // доскроллили до табов → `headerFilled` стал `true` → React переписал
  // className → is-collapsed/need-white исчезли из живого DOM → шапка
  // «раскрылась» сама во время скролла (колесом вернуть нельзя, пока
  // scrollTop>0 — `useCollapsable.onMove` гасит смену `folded`).
  //
  // Правило проекта — «узлом владеет тот, кто решает, когда узел меняется»:
  // сведено к ОДНОМУ писателю-МЕХАНИЗМУ. И класс, и панель пишут classList
  // ИМПЕРАТИВНО (`classList.toggle`, два эффекта ниже, после эффекта
  // `folded → setCollapsed`) — JSX ниже держит ТОЛЬКО статическую часть
  // строки, которая никогда не меняется, поэтому React больше НИКОГДА не
  // трогает `className` этого узла после первого рендера.
  const setCollapsedOnRef = useRef<HTMLDivElement>(null)
  // Инстанс класса как СОСТОЯНИЕ — триггер повторного рендера ровно тогда,
  // когда его узлы (`container`, `info`) готовы: до этого отдавать Solid-мосту
  // (`profileContentHostRef` ниже) нечего. Узел класса (structural DOM, tweb
  // :81-109) React-хоста не имеет: он уходит в Solid-корень пропом
  // `avatarsContainer` и встаёт ПЕРВЫМ ребёнком `.profile-content` (место
  // `AutoAvatar`, tweb `:196`) — тем же контрактом узла-пропа, что и
  // `searchSuperContainer` класса шаред-медиа; корень пересоздаётся на каждый
  // peerId, узел переезжает в новый, инстанс живёт (докблок
  // `peerProfile.solid.tsx`, «Корень и порядок детей»: там же — почему это
  // несущее для геометрии `AppSearchSuper`, а не косметика; бэклог
  // `profile-avatar-inside-solid-root.md` закрыт). Контент
  // `.profile-avatars-info` (имя/статус пира) с задачи 3 — Solid
  // (`peerProfile.solid.tsx`, `Name`/`Subtitle`), НЕ React: `instance.info`
  // уходит туда пропом `avatarsInfo` — единственный писатель узла с этой
  // задачи Solid, React в него не пишет вовсе (правило владения, план
  // «карточка профиля на Solid», шапка).
  const [avatars, setAvatars] = useState<PeerProfileAvatars | null>(null)

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

  // Инстанс — один на всю жизнь панели (deps `[]`: переживает смену пира,
  // докблок `setPeer`, класс не пересоздаётся под каждого пира, в отличие от
  // tweb). `useImperativeIsland` здесь больше не подходит — у него узел класса
  // кладётся В React-хост, а наш узел уходит в ЧУЖОЙ (Solid) корень (та же
  // причина, что у `useSearchSuper`). Узлы за собой снимает dispose корня
  // (`mountSolid`), инстанс — `cleanup()` здесь.
  useLayoutEffect(() => {
    const instance = new PeerProfileAvatars({
      managers,
      setCollapsedOn: setCollapsedOnRef.current!,
      scrollableEl: bodyRef.current!,
      unfold,
    })
    avatarsRef.current = instance
    setAvatars(instance)
    return () => {
      instance.cleanup()
      avatarsRef.current = null
      setAvatars(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // НАХОДКА ФИНАЛЬНОГО РЕВЬЮ ВЕТКИ (Important, п.1): tweb создаёт под КАЖДОГО
  // пира НОВЫЙ инстанс `PeerProfileAvatars`, и последняя строка его
  // конструктора — `this.setCollapsed(true)` (tweb :309) — новый пир ВСЕГДА
  // открывается свёрнутым, а гейт «нет фото» (createEffect :341-344, эффект
  // ВЫШЕ) пересчитывается заново на свежем инстансе. У нас инстанс переживает
  // смену пира (докблок `setPeer` в `peerProfileAvatars.ts`) — свёрнутость
  // сама себя не восстанавливала: `useCollapsable()` хранит `folded` по СВОЕЙ
  // шкале (эффект выше реагирует только на её смену), а `setPeer` меняет
  // `currentHasPhoto`, но это никто не перечитывал для уже развёрнутой шапки.
  // Дыра была такой: развернули пира С фото → переключили на пира БЕЗ фото →
  // шапка осталась развёрнутой (360×360 с кружком-инициалами), а клик её не
  // сворачивал (`if (!this.currentHasPhoto) return` в клик-хендлере класса
  // гасит клик целиком) — для пира С фото тоже расхождение, tweb всегда
  // открывает свёрнутым. Фикс — свернуть явно здесь, на смене peerId, а не
  // полагаться на эффект `[folded]` выше: `fold()` возвращает
  // `useCollapsable()` к исходному `folded=true` (симметрично новому
  // инстансу tweb), `instance.setCollapsed(true)` — тот же вызов, каким
  // оканчивается конструктор оригинала, применённый немедленно (если
  // `folded` уже был `true`, `fold()` не меняет состояние и не переиграет
  // эффект `[folded]` сам по себе — DOM обновляем здесь напрямую). Порядок
  // деклараций (после эффекта `[folded]`, а не до) не влияет на поведение —
  // эффекты реагируют на СВОИ deps независимо от порядка объявления, — важен
  // только для пина `UserInfoPanel.shell.test.ts` («первый useLayoutEffect в
  // файле» — эффект `[folded]`). `useLayoutEffect`, а не `useEffect`, — та же
  // причина, что у эффекта выше: без layout-фазы между setPeer/paint и
  // приведением DOM в порядок был бы кадр с чужим (прежним) состоянием
  // `is-collapsed`. Гейт «нет фото» (эффект выше) продолжает решать за
  // ПОСЛЕДУЮЩИЕ попытки развернуть колесом — здесь он не нужен:
  // `setCollapsed(true)` не читает `hasPhoto`.
  useLayoutEffect(() => {
    const instance = avatarsRef.current
    if (!instance) return
    fold()
    instance.setCollapsed(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId])

  // ── шаред-медиа: класс `AppSearchSuper` через хук-шов (задача 13). Хук —
  // хозяин скроллера вкладки (роль tweb `SliderSuperTab`, `sliderTab.ts:66`) и
  // самого класса; создаются один раз на панель, узел класса переживает смену
  // пира (переезжает в новый Solid-корень пропом `searchSuperContainer`).
  // Колбэки — контракт хоста из `sharedMedia.tsx:650-676` и расхождение 33
  // класса (`openPeer`/`openUserPermissions` вместо `slider`/`appImManager`). ──
  // Карточка из зеркала (`core/peerCache.ts`); `userEmpty` полей не несёт.
  const realUser = (id: PeerId) => {
    const user = cachedUser(id)
    return user?._ === 'user' ? user : undefined
  }
  const seam = useSearchSuper({
    scrollableRef: bodyRef,
    setCollapsedOnRef,
    peerId,
    managers,
    onChangeTab: (mediaTab) => setTab(mediaTab.type),
    onLengthChange: (type, length) => setCounters((c) => (c[type] === length ? c : { ...c, [type]: length })),
    // `appSearchSuper.ts:1569` оригинала — `appImManager.setInnerPeer({peerId})`;
    // у нас та же навигация — `onOpenPeer` (`core/navigation/openPeer.ts`), ей
    // нужна карточка из зеркала: класс объявил пробел `peers.fillMirror` до клика.
    openPeer: (id) => {
      const user = realUser(id)
      onOpenPeer?.({ id, title: getUserTitle(user), username: user?.username, photoId: getPeerPhotoId(user?.photo) || undefined })
    },
    // Меню участника → экран прав (`RightsEditor`, порт `userPermissions.tsx`):
    // у оригинала `openUserPermissionsTab(slider, chatId, peerId, isAdmin)`,
    // у нас строка участника собирается из `Participant` и зеркала карточек.
    openUserPermissions: (participant) => {
      const userId = getParticipantPeerId(participant)
      const user = realUser(userId)
      const member: RealMember = {
        userId,
        role: isParticipantCreator(participant) ? 'creator' : isParticipantAdmin(participant) ? 'admin' : 'member',
        status: user?.status,
        title: getUserTitle(user),
        username: user?.username,
        photoId: getPeerPhotoId(user?.photo) || undefined,
      }
      setEditMember(member)
    },
  })
  const searchSuper = seam?.searchSuper ?? null

  // tweb sharedMedia.tsx:505-517. Заливку и режим `is-full-viewport` ставит
  // доезд до ряда вкладок (и `scrollStartCallback` класса — прокрутка к
  // вкладке, `:682-684`), а выход из режима сбрасывает память позиций вкладок:
  // геометрия поменялась, запомненные позиции больше ни о чём не говорят.
  // `animated-close-icon.state-back`/`hide-border`/переход заголовка — React-
  // состояние `filled` (JSX ниже); `is-full-viewport` — на узле КЛАССА, туда
  // пишет хост и в оригинале.
  const setIsSharedMedia = (isSharedMedia: boolean) => {
    if (!searchSuper) return
    setFilled(isSharedMedia)
    searchSuper.container.classList.toggle('is-full-viewport', isSharedMedia)
    if (isSharedMedia) {
      setHeaderFilled(true)
    } else {
      searchSuper.cleanScrollPositions()
    }
  }
  const setIsSharedMediaRef = useRef(setIsSharedMedia)
  setIsSharedMediaRef.current = setIsSharedMedia

  // tweb sharedMedia.tsx:484-493 — декоратор `onAdditionalScroll` скроллера
  // вкладки (цепочка: `attachBorderListeners` → этот) + `:682-684`
  // (`scrollStartCallback`). Сюда же — `fastRaf(updateHeaderFilled)` класса
  // аватарок (tweb `peerProfileAvatars.ts:312-320`, у нас класс на скролл сам
  // не подписан — докблок `peerProfileAvatars.ts`, «Скролл → updateHeaderFilled»).
  useLayoutEffect(() => {
    if (!seam) return
    const { scrollable, searchSuper } = seam
    const cb = scrollable.onAdditionalScroll
    scrollable.onAdditionalScroll = () => {
      cb?.()
      fastRaf(() => avatarsRef.current?.updateHeaderFilled())
      const reached = isSharedMediaReached(searchSuper)
      if (reached === undefined) return
      setIsSharedMediaRef.current(reached)
    }
    searchSuper.scrollStartCallback = () => setIsSharedMediaRef.current(true)
    return () => {
      scrollable.onAdditionalScroll = cb
      searchSuper.scrollStartCallback = undefined
    }
  }, [seam])

  // tweb sharedMediaTab.tsx:106-108 (`onOpenAfterTimeout` → `scrollable.onScroll()`):
  // открывшаяся панель пересчитывает триггеры скроллера — пока она была
  // закрыта (`inert`), догрузка по низу могла не сработать.
  useEffect(() => {
    if (open) seam?.scrollable.onScroll()
  }, [open, seam])

  // Клик по «назад» в залитой шапке — к началу профиля (tweb sharedMedia.tsx:
  // 537-552: `scrollIntoViewNew({element: '.profile-content', position:
  // 'start'})`, `transition(Profile)`, снятие `header-filled`).
  const scrollBackToProfile = () => {
    const element = bodyRef.current?.querySelector<HTMLElement>('.profile-content')
    if (element && seam) void seam.scrollable.scrollIntoViewNew({ element, position: 'start' })
    setFilled(false)
    setHeaderFilled(false)
  }

  // ── каркас карточки (задача 2 плана `2026-09-05-profile-card-solid.md`) ──
  // `.profile-content` (делимитер + грид шаред-медиа) теперь рисует Solid
  // (`peerProfile.solid.tsx`), смонтированный сюда мостом `mountSolid` — БЕЗ
  // `useImperativeIsland`, потому что этот остров, В ОТЛИЧИЕ от инстансов
  // классов выше, обязан ПЕРЕСОЗДАВАТЬСЯ на каждый peerId (deps `[peerId]`):
  // ровно так ведёт себя оригинал (`sidebarLeft/tabs/settings.tsx::
  // fillProfileElements` гасит прежний Solid-корень и создаёт новый на каждый
  // `peerChanged`, докблок `peerProfile.solid.tsx` § «Пересоздание на каждый
  // peerId»), а не переживает смену пира, как наш класс `PeerProfileAvatars`
  // (осознанное отступление ИМЕННО у класса, см. его докблок — сюда оно не
  // распространяется).
  //
  // `searchSuperContainer` — контракт оригинала (tweb `peerProfile.tsx:121,211`,
  // `sharedMedia.tsx:166`): готовый DOM-узел, который Solid вставляет
  // ПОСЛЕДНИМ ребёнком `.profile-content`. Узел создаёт и уничтожает КЛАСС
  // `AppSearchSuper` (хук-шов `useSearchSuper` выше, задача 13): один на весь
  // срок жизни панели — это и позволяет пересоздавать Solid-корень на каждый
  // peerId, не теряя ни вкладок класса, ни их DOM: узел просто перевстраивается
  // в новый `.profile-content`, ровно как `tab.searchSuper.container` оригинала
  // переживает `fillProfileElements`. React к атрибутам узла не прикасается.
  // Хост — пустой узел-обёртка (расхождение с оригиналом, где корень —
  // прямой ребёнок скроллера: `render()` вставляет узлы ВНУТРЬ хоста, а не
  // вместо него).
  const profileContentHostRef = useRef<HTMLDivElement>(null)
  // `avatars` — инстанс класса аватарок: его `container` (первый ребёнок
  // корня, место AutoAvatar) и `info` (задача 3: КУДА Solid-корень монтирует
  // имя/статус пира) уходят в корень ПРОПАМИ — владеет узлами эта панель
  // (`avatarsRef`), а не файл Solid-компонента. В зависимостях — та же
  // логика, что и у `peerId`/`searchSuper`: оба инстанса появляются ПОСЛЕ
  // первого маунта (эффект аватарок и `useSearchSuper` выше), поэтому самый
  // первый прогон этого эффекта видит `null` и монтирует корень, как только
  // оба появятся, — единственный лишний цикл за всё время жизни панели (узлы
  // после этого не меняются: инстансы переживают смену пира — докблок
  // `setPeer` и шапка `useSearchSuper.ts`).
  // Задача 5.5 плана «карточка профиля на Solid»: находка ревью задачи 5 —
  // `mountSolid` не умел живых пропов, поэтому единственным способом доставить
  // изменившееся значение уже смонтированному дереву было пересоздать корень
  // целиком (внести поле в deps ЭТОГО эффекта). За одно открытие панели корень
  // пересоздавался минимум 4 раза (маунт → готовность аватарок → ответ
  // карточки чата → ответ списка заявок), плюс по разу на каждый клик
  // одобрить/отклонить заявку и дважды на «включить обсуждение» — с побочным
  // перезапуском минутного таймера статуса (`peerProfile.solid.tsx`,
  // `UserStatusLine`) и потерей фокуса на узлах строк. Мост (докблок
  // `mountSolid.solid.tsx`) теперь возвращает `update(patch)` поверх одного
  // стора — гейты/данные/колбэки Task 5 (плюс `onOpenQrCode`) едут туда, а
  // структурными зависимостями, которые ДЕЙСТВИТЕЛЬНО обязаны пересоздавать
  // корень, остаются только `peerId`/`searchSuper`/
  // `avatars` — величины, под которые построены `usePeer`/`useFullPeer`
  // внутри `PeerProfile` (Solid не умеет переподписать уже созданный
  // `createMemo` на другой `peerId` без пересоздания, докблок
  // `peerProfile.solid.tsx` § «Пересоздание на каждый peerId»).
  //
  // `buildProfilePatch` — общий строитель патча для ОБОИХ эффектов ниже
  // (структурного маунта и апдейта): не второй способ считать те же поля, а
  // общая функция, вызванная дважды (на маунте — внутри самого `mountSolid`,
  // на каждое изменение — через `update`).
  const buildProfilePatch = () => ({
    // Task 4: мост QR-попапа для Solid-строк `Username`/`Link`
    // (`peerProfile.solid.tsx`, докблок поля контекста `onOpenQrCode`).
    onOpenQrCode: openQrCode,
    // Task 5 (наши секции без аналога в оригинале, `peerProfile.solid.tsx`
    // «Задача 5»): гейты — те же предикаты, что были у снесённой React-
    // разметки ниже по файлу (см. `git blame`/докблоки Solid-функций), сюда
    // приходят уже свёрнутыми (`isRealChat`/`isChannel` сложены в один
    // булев на месте вызова — второго вычисления в Solid не заводим).
    showStatistics: isRealChat && isChannel && canViewStats,
    onOpenStatistics: () => setShowStats(true),
    showDiscussion: isRealChat && isChannel && canManageDiscussion,
    discussionPeerId,
    enablingDiscussion,
    onEnableDiscussion: () => void enableDiscussion(),
    showJoinRequests: isRealChat && canInvite,
    joinRequests,
    onApproveJoinRequest: (userId: number) => void approveJoinRequest(userId),
    onDeclineJoinRequest: (userId: number) => void declineJoinRequest(userId),
    isSecret,
    onOpenEncryptionKey: () => setKeyPopupOpen(true),
    // tweb `Link` `:999-1004` — см. докблок у `qrPayload` ниже
    exportedInviteUrl: inviteLinks[0] ? `${location.origin}/join/${inviteLinks[0].token}` : undefined,
  })
  // `update` живого корня — записан структурным эффектом ниже, прочитан
  // эффектом апдейта. `null` между dispose старого корня и маунтом нового
  // (тот же кадр, layout-эффекты синхронны) — апдейт в этом окне невозможен
  // физически, эффект апдейта в нём и не запускается (React зовёт cleanup
  // прежде следующего прогона той же зависимости).
  const profileUpdateRef = useRef<((patch: Partial<PeerProfileProps>) => void) | null>(null)

  useLayoutEffect(() => {
    const host = profileContentHostRef.current
    if (!host || !searchSuper || !avatars) return
    // Дженерик — ЯВНО `PeerProfileProps`, не по умолчанию (inference из
    // литерала пропов ниже даёт УЖЕ конкретные типы полей — например,
    // `onEnableDiscussion: () => undefined` вместо объявленного в
    // `PeerProfileProps` `() => void` — и `profileUpdateRef` выше перестаёт
    // собираться): `update` обязан остаться типизирован ИМЕННО контрактом
    // `PeerProfileProps`, который читает `PeerProfile`.
    const { dispose, update } = mountSolid<PeerProfileProps>(host, PeerProfile, {
      peerId,
      isDialog: true, // панель — всегда диалог зрителя (tweb: оба известных вызывающих передают true)
      scrollable: bodyRef.current!,
      setCollapsedOn: setCollapsedOnRef.current!,
      avatarsContainer: avatars.container,
      searchSuperContainer: searchSuper.container,
      avatarsInfo: avatars.info,
      ...buildProfilePatch(),
    })
    profileUpdateRef.current = update
    return () => {
      profileUpdateRef.current = null
      dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId, searchSuper, avatars])

  // Гейты/данные Task 5 — НЕ производные от `peerId`/`searchSuper`/
  // `avatars` (deps эффекта выше): `useGroupInfo` грузит их асинхронно
  // ПОСЛЕ первого монтажа (см. докблок функций в `peerProfile.solid.tsx`,
  // «показывается ровно при своём условии») — без доставки сюда Solid-корень
  // навсегда видел бы значения самого первого прогона (`false`/`[]`, до
  // ответа сети), и ни одна из четырёх секций не показалась бы никогда.
  // Раньше это тоже был структурный deps эффекта выше (пересоздание корня) —
  // теперь `update(patch)` того же живого корня: ни один узел строки не
  // уничтожается и не создаётся заново (фокус не слетает), минутный таймер
  // статуса (`peerProfile.solid.tsx`, `UserStatusLine`) не перезапускается.
  useLayoutEffect(() => {
    profileUpdateRef.current?.(buildProfilePatch())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isRealChat, isChannel, canViewStats, canManageDiscussion, discussionPeerId, enablingDiscussion,
    canInvite, joinRequests, isSecret, inviteLinks,
  ])

  // Панельная половина `header-filled` (tweb sharedMedia.tsx:513/:547 — ставит
  // доезд до табов, снимает клик «назад», см. onBodyScroll/scrollBackToProfile
  // выше) — ТЕМ ЖЕ механизмом, что и класс: `classList.toggle`, а не пересчёт
  // `className` в JSX (находка ревью Critical, коммент у `setCollapsedOnRef`).
  useLayoutEffect(() => {
    const el = setCollapsedOnRef.current
    if (!el) return
    el.classList.toggle('header-filled', headerFilled)
  }, [headerFilled])

  // `can-add-members` (`_profile.scss`: `.shared-media-container.can-add-members`
  // поднимает FAB добавления участников) — статическая по факту (меняется
  // только сменой самого чата, не скроллом/сворачиванием), но ЭТОТ узел
  // больше не отдан React на пересчёт целиком — тот же classList.toggle,
  // чтобы не заводить второй, «немного другой» механизм записи на нём же.
  useLayoutEffect(() => {
    const el = setCollapsedOnRef.current
    if (!el) return
    el.classList.toggle('can-add-members', isGroup && !!canAddMembers && isRealChat)
  }, [isGroup, canAddMembers, isRealChat])

  const meId = useChatsStore((st) => st.meId)
  // «Это человек» — вопрос к ЗНАКУ ключа, а не связка трёх отрицаний по виду
  // диалога (`peerId != null` там же было мёртвым: ключ есть у любого пира).
  const isUser = !isSaved && isUserPeer(peerId)

  const [keyPopupOpen, setKeyPopupOpen] = useState<boolean | null>(null)

  // Инвайт-ссылка группы/канала БЕЗ публичного username (tweb `Link`, ветка
  // `exported_invite` `:999-1004`) — с задачи 13 плана shared media строку
  // целиком рисует Solid-`Link` (`peerProfile.solid.tsx`), а панель отдаёт ему
  // только URL живым пропом `exportedInviteUrl` (`buildProfilePatch` выше):
  // у Solid-версии предмета `exported_invite` нет, ссылку знает `useGroupInfo`
  // (`listInvites`, право `invite_links`; создаётся лениво). Прежний
  // React-фолбэк стоял сиблингом ПОСЛЕ Solid-корня — под absolute-узлом
  // шаред-медиа — и снесён; гейт «username есть → ссылка на username» живёт
  // в одном месте (`isPublic` над зеркалом пиров), а не в двух.
  // QR-попап (`QrModal.tsx`) — один на панель, открывается Solid-строками
  // `Username`/`Link` через мост `onOpenQrCode` (проп
  // `mountSolid` ниже): `qrPayload` несёт url/label конкретного клика,
  // `qrOpen` — только видимость (та же пара состояний, что раньше держала
  // одна константная `inviteUrl` персистентным пропом).
  const [qrOpen, setQrOpen] = useState(false)
  const [qrPayload, setQrPayload] = useState<{ url: string; label: string } | null>(null)
  const openQrCode = (payload: { url: string; label: string }) => {
    setQrPayload(payload)
    setQrOpen(true)
  }

  // Заголовок шапки: 0 — название раздела, 1 — «имя + счётчик вкладки» (tweb
  // sharedMedia.tsx:495-503 `getTitleIndex` — тот же TransitionSlider).
  const headerSlider = useTransitionSlider(filled ? 1 : 0)

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
          `.header-filled`), а не на внутренних узлах. НИ ОДИН из четырёх
          динамических классов (`is-collapsed`/`need-white`/`header-filled`/
          `can-add-members`) больше НЕ вычисляется здесь строкой (находка
          ревью Critical, коммент у `setCollapsedOnRef` выше) — className
          ниже СТАТИЧЕСКИЙ и не меняется никогда, все писатели идут
          `classList.toggle` (класс `PeerProfileAvatars` — свою половину,
          два эффекта выше — панельную). */}
      <div className="sidebar-content sidebar-slider tabs-container">
        <div
          ref={setCollapsedOnRef}
          className="tabs-tab sidebar-slider-item scrollable-y-bordered shared-media-container profile-container active"
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
                  {/* tweb sharedMedia.tsx:474-479: пока счётчика нет — «Loading» */}
                  {tab && activeCount != null ? countLabel(tab, activeCount, isChannel) : t('Loading')}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Тело — тоже глобальные классы tweb: `div.sidebar-content` (позиционный
            предок, `_sidebar.scss`) > `div.scrollable.scrollable-y`
            (`position:absolute; inset:0; overflow-y:auto` из `_scrollable.scss`). */}
        <div className="sidebar-content">
        {/* Скролл слушает `Scrollable` хозяина (хук-шов `useSearchSuper`
            поверх ЭТОГО узла, tweb `sliderTab.ts:66`), React-обработчика нет. */}
        <div ref={bodyRef} className="scrollable scrollable-y">
          {/* Каркас карточки (задача 2, `peerProfile.solid.tsx`) — `.profile-content`
              рисует Solid, смонтированный сюда мостом `mountSolid` (эффект выше,
              у `profileContentHostRef`). Порядок детей корня — как в оригинале
              (tweb `:194-214`): узел карусели `PeerProfileAvatars.container`
              (проп `avatarsContainer`, задача 13 — раньше стоял здесь
              соседом в React-хосте, см. докблок у `avatars`), делимитер,
              секции, `searchSuperContainer` последним. Хост — пустой
              узел-обёртка (расхождение с оригиналом: `render()` вставляет узлы
              ВНУТРЬ хоста). Тот же вызов `mountSolid` (проп `avatarsInfo`)
              кладёт имя/статус пира ВНУТРЬ `instance.info` узла карусели —
              задача 3, см. докблок `peerProfile.solid.tsx` у компонента
              `PeerProfile`. */}
          <div ref={profileContentHostRef} />

          {/* Строки info-карточки (tweb MainSection, `:1510-1533`) теперь
              рисует Solid ВНУТРИ `.profile-content` (`peerProfile.solid.tsx`,
              Task 4 плана «карточка профиля на Solid»): Phone/Username(+QR)/
              Bio/Link/Birthday/Notifications — дословно, со своими условиями
              показа. Наши секции (Statistics/Discussion/JoinRequests/ключ
              шифрования секретного чата) — Task 5 ТОГО ЖЕ плана: теперь тоже
              Solid, ДЕТИ `.profile-content` (между `MainSection` и
              `searchSuperContainer`, см. докблок `peerProfile.solid.tsx`) —
              гейты и данные едут туда пропами `mountSolid` выше
              (`showStatistics`/`showDiscussion`/`showJoinRequests`/
              `isSecret` и соседние поля), сама разметка полностью снесена
              отсюда. Долг на перенос каждой в правильное место оригинала —
              `backlogs/frontend/profile-sections-misplaced.md`. */}

          {/* Инвайт-ссылка группы/канала без username — строка Solid-`Link`
              внутри `.profile-content` (проп `exportedInviteUrl`, см.
              `buildProfilePatch`); React-фолбэка здесь больше нет (задача 13). */}

          {/* Закреплённые в профиле истории (tweb profile stories) — только у
              пользователя. Та же находка ревью, что у фолбэк-ссылки выше:
              был ребёнком React-владетого `.profile-content` на `main`,
              теперь — сиблинг Solid-хоста (`backlogs/frontend/
              profile-content-sibling-nodes.md`). */}
          {isUser && <PinnedStoriesSection peerId={peerId} />}

          {/* Shared media (tweb sharedMedia, `_searchSuper.scss`: min-height
              var(--super-height)) — узел класса `AppSearchSuper` стоит последним
              ребёнком `.profile-content` внутри Solid-корня выше (проп
              `searchSuperContainer`), здесь только ориентир по месту в
              разметке оригинала. */}

          {/* Ключ шифрования секретного чата (tweb chatEncryptionKey) */}
          {isSecret && keyPopupOpen != null && (
            <KeyVerificationPopup
              open={keyPopupOpen}
              onClose={() => setKeyPopupOpen(false)}
              onExitComplete={() => setKeyPopupOpen(null)}
              chatId={numericChatId}
            />
          )}

          {/* QR-код (tweb-модалка с темами) — общий попап для фолбэк-ссылки
              выше И Solid-строк `Username`/`Link` (мост `openQrCode`,
              `qrPayload` несёт конкретные url/label клика). */}
          {qrPayload && (
            <QrModal
              open={qrOpen}
              onClose={() => setQrOpen(false)}
              url={qrPayload.url}
              label={qrPayload.label}
              avatar={{ src: headerAvatarSrc, background: chat.avatar, text: chat.avatarText }}
            />
          )}
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
        {/* Список участников после добавления перечитает сам класс
            (`rt:chat_update`, расхождение 32 `appSearchSuper.ts`). */}
        {addingMembers && isRealChat && (
          <AddMembersScreen
            chatId={Number(chat.id)}
            onClose={() => setAddingMembers(false)}
            onAdded={() => setAddingMembers(false)}
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
