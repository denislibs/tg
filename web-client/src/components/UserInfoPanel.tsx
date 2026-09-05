import type { LangPackKey } from '@/lang'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import IconButton from '../shared/ui/IconButton'
import QrModal from './QrModal'
import rootScope from '@lib/rootScope'
import TgIcon from './TgIcon'
import ChannelStats from './ChannelStats'
import { useMediaUrl } from '../core/hooks/useMediaUrl'
import GroupEditFlow from './group/GroupEditFlow'
import AddMembersScreen from './group/AddMembersScreen'
import { Row } from './settings/kit'
import SidebarSection from '../shared/ui/SidebarSection'
import PinnedStoriesSection from './PinnedStoriesSection'
import classNames from '../shared/lib/classNames'
import type { Chat, OpenPeer } from '../data'
import {useT} from '../i18n'
import { useGroupInfo } from '../core/hooks/useGroupInfo'
import { useSavedDialogs, useProfileGifts } from '../core/hooks/useUserProfileData'
import { useChatsStore } from '../stores/chatsStore'
import { useNavLayer } from '../core/hooks/useNavLayer'
import { useTransitionSlider } from '../core/hooks/useTransitionSlider'
import type { SavedStarGift } from '../core/managers/starsManager'
import GiftInfoPopup from './stars/GiftInfoPopup'
import KeyVerificationPopup from './secret/KeyVerificationPopup'
import SharedMedia from './userInfo/SharedMedia'
import RightsEditor from './userInfo/RightsEditor'
import { countLabel, sharedMediaChatId, shouldForceFold, HEADER_H, ADDITIONAL_OFFSET, BODY_PADDING, TAB_GAP } from './userInfo/helpers'
import installColumnResize from '../core/dom/installColumnResize'
import { useRightColumnShown } from '../core/hooks/useRightColumnShown'
import animationIntersector from './animationIntersector'
import { isUser as isUserPeer } from '../core/peers/peerId'
import { usePeers } from '../core/hooks/usePeers'
import { isPublicPeer } from '../core/peerCache'
// Шапка-аватары (tweb peerProfileAvatars) — задача 5: класс на классах tweb,
// вмонтированный через useImperativeIsland (мост не пишем руками), плюс
// реальный useCollapsable(). Мост фактов взят из докблока класса целиком.
import { useImperativeIsland } from '../core/hooks/useImperativeIsland'
import useCollapsable from '../core/hooks/useCollapsable'
import { fastRaf } from '@helpers/schedulers'
import PeerProfileAvatars from './peerProfileAvatars'
import { useManagers } from '../core/hooks/useManagers'
// Каркас карточки (Task 2, план `docs/superpowers/plans/
// 2026-09-05-profile-card-solid.md`): `.profile-content` теперь рисует Solid,
// смонтированный мостом `mountSolid` — см. докблок у `profileContentHostRef`.
import PeerProfile, { type PeerProfileProps } from './peerProfile.solid'
import { mountSolid } from '../shared/solid/mountSolid.solid'

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
  // «Ключ шифрования» (tweb chatEncryptionKey, Task 5 плана «карточка профиля
  // на Solid» — секции без аналога в оригинале) — только для секретного чата.
  // Объявлено выше прежнего места (было — рядом с `keyPopupOpen`) ради
  // мостового эффекта `mountSolid` ниже (deps `[…, isSecret]`): в JS/TS
  // `const` не хостится, а этот эффект читает `isSecret` до её прежней строки.
  const isSecret = chat.type === 'secret'
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

  const numericChatId = Number(chat.id)

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

  // Присутствие/статус приватного собеседника и счётчик участников группы/
  // канала — раньше считались ЗДЕСЬ (`subtitleText`) для React-портала в
  // `instance.info`. Задача 3 профиля на Solid перенесла ИМЯ И СТАТУС пира
  // внутрь `avatars.info` Solid-компонентом (`peerProfile.solid.tsx`,
  // `SubtitleStatus`/`ChatMembersLabel`) — второго писателя `info` не должно
  // быть (докблок `avatarsHostRef` ниже, «правило владения»), поэтому эта
  // ветка вычислений отсюда убрана целиком, а не просто перестала
  // использоваться.

  // ── шапка-аватары (tweb peerProfileAvatars) — задача 5: класс
  // `PeerProfileAvatars` (`./peerProfileAvatars.ts`, задачи 1-4) владеет ВСЕЙ
  // каруселью (DOM, лента, жесты, `is-collapsed`/`need-white`/`header-filled`
  // по порогам скролла); эта панель — только владелец узла-хозяина и реального
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
  // Хост-узел острова — пуст сам по себе, класс вставляет туда СВОЙ
  // `container` (structural DOM, tweb :81-109). Контент `.profile-avatars-info`
  // (имя/статус пира) с задачи 3 — Solid (`peerProfile.solid.tsx`, `Name`/
  // `Subtitle`), НЕ React: `instance.info` уходит туда пропом `avatarsInfo`
  // (см. `profileContentHostRef` ниже) — единственный писатель узла с этой
  // задачи Solid, React в него не пишет вовсе (правило владения, план
  // «карточка профиля на Solid», шапка).
  const avatarsHostRef = useRef<HTMLDivElement>(null)
  // Триггер повторного рендера ровно тогда, когда `instance.info` становится
  // доступен (после монтажа острова) — до этого момента отдавать Solid-мосту
  // (`profileContentHostRef` ниже) нечего.
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

  // ── каркас карточки (задача 2 плана `2026-09-05-profile-card-solid.md`) ──
  // `.profile-content` (делимитер + грид шаред-медиа) теперь рисует Solid
  // (`peerProfile.solid.tsx`), смонтированный сюда мостом `mountSolid` — БЕЗ
  // `useImperativeIsland`, потому что этот остров, В ОТЛИЧИЕ от острова
  // аватарок выше, обязан ПЕРЕСОЗДАВАТЬСЯ на каждый peerId (deps `[peerId]`):
  // ровно так ведёт себя оригинал (`sidebarLeft/tabs/settings.tsx::
  // fillProfileElements` гасит прежний Solid-корень и создаёт новый на каждый
  // `peerChanged`, докблок `peerProfile.solid.tsx` § «Пересоздание на каждый
  // peerId»), а не переживает смену пира, как наш класс `PeerProfileAvatars`
  // (осознанное отступление ИМЕННО у класса, см. его докблок — сюда оно не
  // распространяется).
  //
  // `searchSuperContainer` — контракт оригинала (tweb `peerProfile.tsx:121,211`,
  // `sharedMedia.tsx:166`): готовый DOM-узел, который Solid вставляет
  // ПОСЛЕДНИМ ребёнком `.profile-content`, а наш React-`SharedMedia`
  // рисуется В НЕГО порталом (см. JSX ниже). Узел создаётся ЗДЕСЬ, в React,
  // ОДИН РАЗ на весь срок жизни панели (лениво, `useState`) — это то, что
  // позволяет пересоздавать Solid-корень на каждый peerId, не теряя состояние
  // `SharedMedia` (вкладку/скролл шаред-медиа): узел просто перевстраивается
  // в новый `.profile-content`, React его не пересоздаёт и не размонтирует
  // содержимое портала. Ровно так же `tab.searchSuper.container` оригинала
  // переживает `fillProfileElements`.
  const [searchSuperContainer] = useState(() => {
    const el = document.createElement('div')
    el.className = 'search-super'
    return el
  })
  // Хост — пустой узел-обёртка (тот же приём и то же расхождение с оригиналом,
  // что у `avatarsHostRef` выше, см. его докблок: `render()` вставляет узлы
  // ВНУТРЬ хоста, а не вместо него).
  const profileContentHostRef = useRef<HTMLDivElement>(null)
  // `avatarsInfoEl` — задача 3: узел `instance.info` класса аватарок (см. его
  // докблок, поле `info`), КУДА Solid-корень монтирует имя/статус пира —
  // передаётся сюда ПРОПОМ (не читается классом внутри `peerProfile.solid.tsx`
  // напрямую), потому что владеет узлом эта панель (`avatarsRef`), а не файл
  // Solid-компонента. В зависимостях — та же логика, что и у `peerId`/
  // `searchSuperContainer`: узел появляется ПОСЛЕ первого маунта острова
  // аватарок (эффект `useImperativeIsland` выше), поэтому самый первый прогон
  // этого эффекта видит `null` и пересоздаст корень ещё раз, как только
  // `setAvatarsInfoEl` его выставит, — единственный лишний цикл за всё время
  // жизни панели (сам узел `instance.info` после этого не меняется, инстанс
  // класса переживает смену пира — докблок `setPeer`).
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
  // корень, остаются только `peerId`/`searchSuperContainer`/
  // `avatarsInfoEl` — величины, под которые построены `usePeer`/`useFullPeer`
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
  })
  // `update` живого корня — записан структурным эффектом ниже, прочитан
  // эффектом апдейта. `null` между dispose старого корня и маунтом нового
  // (тот же кадр, layout-эффекты синхронны) — апдейт в этом окне невозможен
  // физически, эффект апдейта в нём и не запускается (React зовёт cleanup
  // прежде следующего прогона той же зависимости).
  const profileUpdateRef = useRef<((patch: Partial<PeerProfileProps>) => void) | null>(null)

  useLayoutEffect(() => {
    const host = profileContentHostRef.current
    if (!host) return
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
      searchSuperContainer,
      avatarsInfo: avatarsInfoEl ?? undefined,
      ...buildProfilePatch(),
    })
    profileUpdateRef.current = update
    return () => {
      profileUpdateRef.current = null
      dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId, searchSuperContainer, avatarsInfoEl])

  // Гейты/данные Task 5 — НЕ производные от `peerId`/`searchSuperContainer`/
  // `avatarsInfoEl` (deps эффекта выше): `useGroupInfo` грузит их асинхронно
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
    canInvite, joinRequests, isSecret,
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

  // Подарки в профиле (tweb Gifts tab) — только для пользователя (private).
  const meId = useChatsStore((st) => st.meId)
  // «Это человек» — вопрос к ЗНАКУ ключа, а не связка трёх отрицаний по виду
  // диалога (`peerId != null` там же было мёртвым: ключ есть у любого пира).
  const isUser = !isSaved && isUserPeer(peerId)

  const [keyPopupOpen, setKeyPopupOpen] = useState<boolean | null>(null)
  const { gifts, reload: loadGifts } = useProfileGifts(isUser, peerId)
  const [selectedGift, setSelectedGift] = useState<SavedStarGift | null>(null)

  // Ссылка группы/канала БЕЗ публичного username — фолбэк на первую
  // инвайт-ссылку (tweb `chatFull.exported_invite`). Публичный username
  // (`t.me/username`-эквивалент) теперь рисует Solid (`peerProfile.solid.tsx`
  // `PeerProfile.Link`, Task 4 плана «карточка профиля на Solid») — оттуда
  // ушла ветка «есть username», здесь остаётся ТОЛЬКО ветка «username нет,
  // есть инвайт-ссылка»: у Solid-версии предмета `exported_invite` нет
  // (докблок `Link` в том файле).
  //
  // НАХОДКА РЕВЬЮ (Critical, финальный раунд Task 4): гейт раньше читал
  // `chat.username` — поле вью-модели (`data.ts:179`), которое НИКТО не
  // пишет (`core/dialogToChat.ts` его не выставляет ни для одного вида чата,
  // синтетический тред-`Chat` `App.tsx:169-175` тоже) — было мертво, и гейт
  // был истинен ВСЕГДА. У публичного канала/группы с уже созданной лениво
  // инвайт-ссылкой (`useGroupInfo.ts:142-151`, право `invite_links`) поэтому
  // рисовались ОБЕ строки разом: эта (инвайт) и Solid-`Link` (публичный
  // username), с разными URL и двумя QR-кнопками. Это НЕ было «явно
  // разведённым владением на переходный период» — раздел был мнимым, поле
  // с самого начала не имело писателя.
  //
  // Фикс — свести к ОДНОМУ источнику истины: тому же предикату и тому же
  // зеркалу пиров, что читает Solid (`isPublicPeer`, `core/peerCache.ts`, порт
  // `appChatsManager.isPublic`). `usePeers` ниже — не второй запрос карточки,
  // а объявление того же пробела зеркала (докблок `usePeers.ts`) плюс подписка
  // на его движение: без неё гейт не увидел бы, что username появился, пока
  // панель уже открыта.
  usePeers([peerId])
  const fallbackInviteUrl = !isPublicPeer(peerId) && inviteLinks[0]
    ? `${location.origin}/join/${inviteLinks[0].token}`
    : null
  const fallbackInviteShort = fallbackInviteUrl?.replace(/^https?:\/\//, '') ?? ''
  // QR-попап (`QrModal.tsx`) — один на панель, открывается ЛИБО этим фолбэком,
  // ЛИБО Solid-строками `Username`/`Link` через мост `onOpenQrCode` (проп
  // `mountSolid` ниже): `qrPayload` несёт url/label конкретного клика,
  // `qrOpen` — только видимость (та же пара состояний, что раньше держала
  // одна константная `inviteUrl` персистентным пропом).
  const [qrOpen, setQrOpen] = useState(false)
  const [qrPayload, setQrPayload] = useState<{ url: string; label: string } | null>(null)
  const openQrCode = (payload: { url: string; label: string }) => {
    setQrPayload(payload)
    setQrOpen(true)
  }

  // Клик по инфо-строке копирует значение + глобальный тост (tweb peerProfile:
  // copyTextToClipboard + toast(PhoneCopied/UsernameCopied/BioCopied)) —
  // остаётся только у фолбэк-ссылки выше: Phone/Username/Bio/Birthday теперь
  // строки Solid (`peerProfile.solid.tsx`, Task 4), со своим копированием.
  const copyInfo = (value: string, toastKey: LangPackKey) => {
    void navigator.clipboard.writeText(value)
    rootScope.dispatchEvent('ui:toast', t(toastKey))
  }

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
          {/* Шапка-аватары (tweb .profile-avatars-container) — задача 5 плана
              аватарок: узел класса `PeerProfileAvatars` встаёт СЮДА через
              useImperativeIsland (host: `avatarsHostRef`). Класс сам строит
              DOM/ленту/жесты/is-collapsed/need-white/header-filled (своя
              половина); контентом `.profile-avatars-info` с задачи 3 владеет
              Solid (`peerProfile.solid.tsx`, `Name`/`Subtitle`) — узел
              `instance.info` уходит туда пропом `avatarsInfo` у
              `profileContentHostRef` ниже, а не порталом ЗДЕСЬ: React больше
              не пишет в `info` вовсе (было — портал `<> <div className=
              "profile-name">…`, снесён этой задачей вместе с `PeerStatus`/
              `VerifiedBadge`/`PremiumBadge`/`EmojiStatus`, которые его
              питали).

              РАСХОЖДЕНИЕ С TWEB (Minor, было ещё до Task 2): этот `<div>` —
              ЛИШНИЙ уровень DOM вокруг `.profile-avatars-container`, которого у
              оригинала нет (там узел класса — прямой ребёнок `.profile-content`).
              `useImperativeIsland` в режиме `host` (наш выбор) всегда даёт
              такой уровень — см. докблок хука.

              ВТОРОЕ РАСХОЖДЕНИЕ С TWEB (Task 2 профиля на Solid, тоже Minor):
              этот узел — БОЛЬШЕ НЕ ребёнок `.profile-content` (в оригинале
              AutoAvatar — первый ребёнок, tweb `:203`), а СОСЕДНИЙ узел ПЕРЕД
              Solid-корнем `.profile-content` (см. `profileContentHostRef`
              ниже). Причина — конфликт двух реальных решений, оба уже приняты
              РАНЬШЕ этой задачи и оба менять не входит в её объём: наш класс
              `PeerProfileAvatars` переживает смену пира (не пересоздаётся,
              см. его докблок «Осознанное отступление»), а Solid-корень
              `.profile-content`, наоборот, ПЕРЕСОЗДАЁТСЯ на каждый peerId (как
              и в оригинале — см. докблок `peerProfile.solid.tsx`). Если бы
              `avatarsHostRef` был ребёнком пересоздаваемого корня, каждая
              смена пира отрывала бы живой инстанс от DOM. Проверено по
              `styles/tweb/_profile.scss`: правила на `.profile-avatars-container`
              бьют через `.profile-container` (`setCollapsedOnRef`), не через
              `.profile-content`, кроме `.has-music .profile-avatars-info` — а
              `has-music` у нас НИКОГДА не взводится (нет поля `saved_music`,
              см. докблок `fullPeers.solid.ts`), так что сегодня визуально
              безвредно. Сведение (сделать AutoAvatar настоящим Solid-ребёнком)
              требует сперва решить именно этот конфликт персистентности —
              долг `web-client/backlogs/frontend/profile-avatar-inside-solid-root.md`. */}
          <div ref={avatarsHostRef} />

          {/* Каркас карточки (задача 2, `peerProfile.solid.tsx`) — `.profile-content`
              (делимитер + `searchSuperContainer` последним ребёнком) рисует
              Solid, смонтированный сюда мостом `mountSolid` (эффект выше, у
              `profileContentHostRef`). Хост — пустой узел-обёртка, тот же
              приём и то же расхождение с оригиналом, что у `avatarsHostRef`
              выше. Тот же вызов `mountSolid` (проп `avatarsInfo`, эффект
              выше) кладёт имя/статус пира ВНУТРЬ `instance.info` соседнего
              узла — задача 3, см. докблок `peerProfile.solid.tsx` у
              компонента `PeerProfile`. */}
          <div ref={profileContentHostRef} />
          {createPortal(
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
            />,
            searchSuperContainer,
          )}

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

          {/* Фолбэк-строка ссылки: группа/канал БЕЗ публичного username
              (Solid `PeerProfile.Link` показывает строку только когда
              username есть — докблок там же). Клик копирует + тост (tweb
              PeerProfile.Link), QR — тот же мост `openQrCode`, которым
              пользуются Solid-строки `Username`/`Link`. */}
          {(isGroup || isChannel) && fallbackInviteUrl && (
          <SidebarSection noDelimiter>
            <Row
              icon={<TgIcon name="link" size={24} />}
              label={fallbackInviteShort}
              sublabel={t('SetUrlPlaceholder')}
              translate={false}
              onClick={() => copyInfo(fallbackInviteUrl, 'LinkCopied')}
              right={
                <button
                  type="button"
                  className="btn-icon qr rp"
                  aria-label="QR"
                  onClick={(e) => {
                    e.stopPropagation()
                    openQrCode({ url: fallbackInviteUrl, label: chat.name })
                  }}
                >
                  <TgIcon name="qr" size={22} />
                </button>
              }
            />
          </SidebarSection>
          )}

          {/* Закреплённые в профиле истории (tweb profile stories) — только у пользователя */}
          {isUser && <PinnedStoriesSection peerId={peerId} />}

          {/* Shared media: табы Медиа/Файлы/Ссылки/Музыка/Голосовые (tweb sharedMedia).
              Контент пока моковый — реального API истории по типам ещё нет.
              Сам `<SharedMedia>` теперь рисуется ВЫШЕ, порталом в
              `searchSuperContainer` (см. каркас карточки) — второго рендера
              здесь нет, это только комментарий-ориентир по месту в разметке
              оригинала (tweb `sharedMedia.tsx`, `_searchSuper.scss`:
              min-height var(--super-height)). */}

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
