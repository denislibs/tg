/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/peerProfile.tsx` — каркас (Task 2) + имя/статус
 * внутри `avatars.info` (Task 3) + строки `MainSection` (Task 4, план
 * `docs/superpowers/plans/2026-09-05-profile-card-solid.md`, «Задача 4»).
 * Читать оригинал `:60-215` (контекст, корень, порядок детей), `:1535-1544`
 * (`renderPeerProfile`), `:217-272` (`Avatar`/`AutoAvatar` — кладут `Name`/
 * `Subtitle` в `avatars.info`), `:273-421` (`Name`/`Subtitle`/`SubtitleStatus`),
 * `:1510-1533` (сборка `MainSection`) и сами строки (адреса — у каждой функции
 * ниже). Наши секции (Statistics/Discussion/JoinRequests/ключ секретного
 * чата) — Task 5 (план, «Задача 5»): перенесены СЮДА, между `<MainSection/>`
 * и `{props.searchSuperContainer}` (см. докблок компонента `PeerProfile`,
 * «Корень и порядок детей», и докблоки самих функций ниже за адресами
 * оригинала и причиной, по которой у нас они не там).
 *
 * ── Task 4: что портировано, что нет (сводная таблица) ──────────────────────
 * Оригинал (`:1517-1529`, порядок строк MainSection): Phone → Username →
 * Location → Bio → Link → Birthday → ContactNote → BusinessHours →
 * BusinessLocation → Notifications → BotAddToChat → BotPrivacyPolicy.
 * Портированы (под них есть предмет — данные из `usePeer`/`useFullPeer`,
 * Task 1): **Phone, Username (+QrButton), Bio, Link, Birthday,
 * Notifications** — см. докблок каждой функции ниже за деталями и частичными
 * расхождениями (у некоторых портирована не вся строка, а её часть с
 * предметом — например, `Username` без `getUsernamesAlso`).
 *
 * НЕ портированы (предмета нет вовсе — таблица адресов оригинала):
 *  • `Location` (`:873-893`) — геолокация канала (`ChannelFull.location`),
 *    поля нет в нашем `ChannelFull` (`core/peers/peer.ts`);
 *  • `ContactNote` (`:833-871`) — заметка о контакте (`UserFull.note`), поля
 *    нет в нашем `UserFull`;
 *  • `BusinessHours` (`:1082-1111`) — часы работы бизнес-аккаунта
 *    (`UserFull.business_work_hours` + `HelpTimezonesList` с сервера), обоих
 *    предметов нет;
 *  • `BusinessLocation` (`:1113-1173`) — адрес бизнес-аккаунта
 *    (`UserFull.business_location`), поля нет;
 *  • `BotAddToChat` (`:1059-1080`) — добавление бота в чат
 *    (`UserFull.bot_info` + `getAddBotToChatAction`), `bot_info` в нашем
 *    `UserFull` нет (только `pFlags.bot` на кратком `User` — самого предмета
 *    «бот-метаданные» нет);
 *  • `BotPrivacyPolicy` (`:1038-1057`) — та же причина, тот же `bot_info`;
 *  • `PersonalChannel` (`:477-595`) — привязанный личный канал пользователя
 *    (`UserFull.personal_channel_id`/`personal_channel_message`), полей нет;
 *  • `PinnedGifts` (`:423-476`) — закреплённые подарки в шапке профиля
 *    (`UserFull.stargifts_count` + `appGiftsManager.getPinnedGifts`), поля
 *    `stargifts_count` в нашем `UserFull` нет (у нас гифты профиля — отдельная
 *    Task 5-секция вне `MainSection`, другой предмет);
 *  • `PinnedMusic` (`:596-630`) — уже разобрано выше по файлу
 *    (`hasSavedMusic`/`saved_music`, «НЕ портированы» в контексте) — тот же
 *    пробел, вторая запись здесь только для полноты таблицы Task 4;
 *  • `StoryPreviews` (`:1355-1479`) — превью историй ВНУТРИ `avatars.info`
 *    (сегменты `StoriesProvider`/`avatarNew.tsx`), у нас нет подсистемы
 *    историй-в-аватарке этого вида (наш `PinnedStoriesSection`, если он есть
 *    на экране, — Task 5, другой предмет и другое место в дереве);
 *  • `BotVerification` (`:1220-1259`) — значок сторонней верификации бота
 *    (`UserFull.bot_verification`), поля нет; официальный `verified`-путь
 *    той же функции — часть значка ИМЕНИ (`Name`, Task 3), не строки;
 *  • `UnofficialWarning` (`:1260-1283`) — предупреждение о поддельном боте
 *    (`UserFull.pFlags.unofficial_security_risk`), поля нет;
 *  • `BotPermissions` (`:1284-1354`) — переключатели доступа бота
 *    (эмодзи-статус/локация, `UserFull.bot_info` + `appBotsManager`
 *    internal-storage), `bot_info` нет (та же причина, что у `BotAddToChat`);
 *  • `BotMainApp` (`:1480-1508`) — кнопка запуска мини-приложения бота
 *    (`UserFull.bot_info.app`), `bot_info` нет.
 * Внешняя обёртка `MainSection` (`<Show when={!(isBotforum && threadId)}>`,
 * `:1517`) не портирована КАК ВЕТВЛЕНИЕ — `isBotforum` у нас всегда `false`
 * (докблок файла выше, «НЕ портированы» у корня), условие оригинала поэтому
 * всегда истинно, и обёртка-Show была бы мёртвым кодом (`<Show when={true}>`).
 *
 * ── Контекст: что портировано и почему ──────────────────────────────────────
 * Оригинал (`:62-82`): peerId, threadId, scrollable, setCollapsedOn, isDialog,
 * onPinnedGiftsChange, onAvatarReady, needWhite/setNeedWhite, peer, fullPeer,
 * canBeDetailed, isSavedDialog, isTopic, isBotforum, hasSavedMusic,
 * getDetailsForUse, verifyContext.
 *
 * Портированы: peerId, threadId, scrollable, setCollapsedOn, isDialog, peer,
 * fullPeer, canBeDetailed, isSavedDialog, isTopic, getDetailsForUse (Task 3 —
 * первый настоящий вызывающий, см. его место в интерфейсе ниже) — ровно то,
 * что под собой имеет предмет и хотя бы одного читателя.
 *
 * НЕ портированы (не заглушки — предмета нет, или нет потребителя):
 *  • `onPinnedGiftsChange`/`onAvatarReady` — колбэки для `AppSearchSuper`
 *    (`setPinnedGifts`) и её же интеграции с аватаркой (tweb :166-169); наш
 *    `SharedMedia` (React) не отдаёт такого API наружу.
 *  • `needWhite`/`setNeedWhite` — у оригинала это ОБЩИЙ Solid-сигнал: секции
 *    читают его, чтобы красить текст в белый над фото профиля, а класс
 *    `PeerProfileAvatars` его же выставляет. Задача 3 — та самая секция,
 *    которую план просил решить, ЗАВЕЛА ли она мост, — и решение НЕТ: у нас
 *    `.need-white .profile-name`/`.profile-subtitle` красит ТЕКСТ имени/
 *    статуса ЧИСТЫМ CSS-каскадом (скопирован из tweb, докблок `Name` ниже),
 *    моста не понадобилось. Остаётся непокрытым цветом только сам бейдж
 *    (SVG/иконка) — тот же пробел, что был ДО этой задачи (React-бейджи тоже
 *    не красились), см. докблок `Name`.
 *  • `isBotforum` — тут читает `(peer as User).pFlags.bot_forum_view`; в нашей
 *    модели (`core/peers/peer.ts`) у `User` такого поля нет вовсе (наши
 *    `pFlags` объявлены только для полей с предметом — см. докблок `UserReal`).
 *  • `hasSavedMusic` — читает `(fullPeer as UserFull).saved_music`; в нашей
 *    `UserFull` этого поля нет (см. `core/peers/peer.ts:235-252`) — соответственно
 *    класс `has-music` на корне тоже никогда не взводится (см. ниже).
 *  • `verifyContext` — опора для защиты от гонки при смене пира у компонентов
 *    (`AutoAvatar`/`avatar_update`), которых у нас нет ни одного (см. «НЕ
 *    входят» ниже про `Avatar`/`AutoAvatar`) — по-прежнему нет потребителя.
 *
 * ── `scrollable: HTMLElement`, а не класс `Scrollable` ──────────────────────
 * Оригинал типизирует поле как `Scrollable` (их класс). У нас `Scrollable`
 * (`components/scrollable.ts`) разрешено инстанцировать РОВНО в одном месте —
 * лента чата (`web-client/CLAUDE.md` § «Скролл») — плюс уже есть прецедент
 * этого же обхода в `peerProfileAvatars.ts` (`scrollableEl: HTMLElement`, тот
 * же докблок объясняет чтение `scrollTop` напрямую вместо
 * `scrollable.scrollPosition`). Здесь то же самое: `props.scrollable` —
 * реальный DOM-узел скролл-контейнера панели (`bodyRef` в `UserInfoPanel.tsx`).
 *
 * ── `peer`/`fullPeer` — Accessor, а не объект-стор ──────────────────────────
 * У оригинала `usePeer`/`useFullPeer` читают Solid `createStore` — свойства
 * прокси остаются реактивными независимо от того, где их прочитали (поэтому
 * `peer: usePeer(props.peerId)` — обычное поле, не геттер). Наш
 * `stores/peers.solid.ts` (Task 1) НАМЕРЕННО не завёл второй стор поверх
 * `core/peerCache.ts` (см. его докблок) — источник обычный JS-объект без
 * прокси-реактивности, и живым остаётся только то, что явно читает сигнал
 * версии зеркала. Поэтому здесь `usePeer` вызывается с АКСЕССОРОМ
 * (`() => props.peerId`, а не голым `props.peerId`) — это переключает
 * `usePeer` в ветку `createMemo` (см. докблок `createMemoOrReturn.ts`) и даёт
 * настоящий `Accessor<User|Chat>`, а `context.peer`/`context.fullPeer` —
 * геттеры, вызывающие этот аксессор заново при каждом чтении: РОВНО тот же
 * контракт живости, что и у `fullPeers.solid.ts` (`useFullPeer(id)()` —
 * «обычный Solid-сигнал в JSX», см. его докблок).
 *
 * ── `meId` — снимок, не подписка ─────────────────────────────────────────────
 * `rootScope.myId` оригинала соответствует `useChatsStore.getState().meId`.
 * Читаем один раз при монтаже (не оборачиваем в `subscribeExternal`): личность
 * зрителя не меняется, пока открыт этот компонент, — залогинился/вышел
 * пользователь означает полную перезагрузку экрана, а не апдейт `meId` под
 * тем же смонтированным деревом.
 *
 * ── Корень и порядок детей ────────────────────────────────────────────────
 * Оригинал (`:194-214`): AutoAvatar, delimiter, UnofficialWarning,
 * PersonalChannel, MainSection, BotMainApp, BotVerification, BotPermissions,
 * `{props.searchSuperContainer}` (последним).
 *
 * Прямыми детьми `.profile-content` здесь — delimiter, `<MainSection />`
 * (Task 4, строки Phone/Username/Bio/Link/Birthday/Notifications — см. её
 * докблок ниже), четыре НАШИХ секции без аналога в оригинале
 * (`<Statistics/>`/`<Discussion/>`/`<JoinRequests/>`/`<EncryptionKey/>`,
 * Task 5 — см. их докблоки за адресами оригинала) и
 * `{props.searchSuperContainer}` (последним, дословно тот же контракт, что и
 * в оригинале). `AutoAvatar` в это дерево вообще НЕ входит — см. докблок
 * `UserInfoPanel.tsx` у `avatarsHostRef` (там же причина: наш класс
 * `PeerProfileAvatars` переживает смену пира, а этот Solid-корень
 * пересоздаётся на каждый peerId, как и в оригинале — см. ниже). Задача 3
 * (`Name`/`Subtitle`) — тоже не прямой ребёнок ЭТОГО узла: она встаёт в
 * `avatars.info`, СОСЕДНИЙ узел класса — см. докблок компонента `PeerProfile`
 * у места монтирования, ниже по файлу.
 *
 * `has-music` (`:199`) не взведён вовсе — см. «НЕ портированы» выше про
 * `hasSavedMusic`.
 *
 * ── Пересоздание на каждый peerId — как в оригинале ──────────────────────────
 * Оригинал НЕ хранит один инстанс `PeerProfile` на смену пира: вызывающий
 * (`sidebarLeft/tabs/settings.tsx::fillProfileElements`) на каждый
 * `tab.peerChanged` гасит прежний Solid-корень (`cleanupHTML()`) и создаёт
 * новый (`createRoot` + `renderPeerProfile`). `UserInfoPanel.tsx` делает то же
 * самое (эффект на `[peerId]`, `mountSolid` в cleanup старого перед новым
 * вызовом) — поэтому `peer`/`fullPeer` не нуждаются в отдельном механизме
 * «пробросить новый peerId в живой корень»: новый peerId — это буквально
 * новый корень с собственными `usePeer`/`useFullPeer`.
 *
 * `props.searchSuperContainer`, в отличие от корня, ЖИВЁТ ДОЛЬШЕ одного
 * peerId — это тот же самый DOM-узел (владеет им `UserInfoPanel.tsx`,
 * создаётся один раз), просто перевстраивается в новый `.profile-content`
 * при каждом пересоздании. Ровно так же ведёт себя `tab.searchSuper.container`
 * оригинала (переживает `fillProfileElements`, встраивается заново).
 */
import { createContext, useContext, createMemo, createSignal, onCleanup, Show, For } from 'solid-js'
import classNames from '../helpers/string/classNames'
import { usePeer } from '../stores/peers.solid'
import { useFullPeer } from '../stores/fullPeers.solid'
import type { PeerFull } from '../core/chatFullCache'
import type { User, Chat, Channel, ChannelFull } from '../core/peers/peer'
import { useChatsStore } from '../stores/chatsStore'
import { mountSolid } from '../shared/solid/mountSolid.solid'
import { subscribeExternal } from '../helpers/solid/subscribeExternal'
import { getPeerTitle, SAVED_MESSAGES_TITLE } from '../core/peers/getPeerTitle'
import { wrapEmojiText, wrapRichText } from '../lib/richtext'
import { isUser, HIDDEN_PEER_ID, NULL_PEER_ID } from '../core/peers/peerId'
import { isBroadcast, isPublic } from '../core/peers/predicates'
import { userStatusLabel } from '../core/presence'
import { membersLabel } from './userInfo/helpers'
import { IconTsx } from './iconTsx.solid'
import { VERIFIED_BADGE_SEAL_PATH, VERIFIED_BADGE_CHECK_PATH } from '../shared/icons/verifiedBadgePath'
import { i18n } from '@lib/langPack'
import typingStyles from './conversation/TypingIndicator.module.scss'
// ── Task 4: строки MainSection ───────────────────────────────────────────────
import Section from './section.solid'
import Row from './rowTsx.solid'
import Button from './buttonTsx.solid'
import CheckboxFieldTsx from './checkboxFieldTsx.solid'
import { copyTextToClipboard } from '../helpers/clipboard'
import { toastNew } from './toast'
import cancelEvent from '../helpers/dom/cancelEvent'
import { formatUserPhone } from '../core/format/phone'
import { formatBirthday } from '../core/format/birthday'
import { isPeerMuted } from '../core/dialogs/notifySettings'
import { startClient } from '../client/bootstrap'
import type { UserFull } from '../core/peers/peer'
import { cachedProfilePhone, subscribeProfilePhoneMirror, profilePhoneMirrorVersion } from '../core/profilePhoneCache'

export type PeerProfileContextValue = {
  peerId: PeerId
  threadId?: number
  scrollable: HTMLElement
  setCollapsedOn: HTMLElement
  isDialog: boolean

  readonly peer: User | Chat | undefined
  readonly fullPeer: PeerFull | undefined
  canBeDetailed: () => boolean
  isSavedDialog: boolean
  readonly isTopic: boolean
  /** Порт `:154-163`. Первый настоящий вызывающий — задача 3 (`Name`, ниже):
   *  Task 2 сознательно не заводила это поле («заводить неиспользуемый
   *  экспорт — заглушка», её докблок), сегодня он появляется. */
  getDetailsForUse: () => { peerId: PeerId; threadId?: number }
  /**
   * Мост Solid → React для QR-попапа (`QrModal.tsx`) — оригинал зовёт
   * `showMyQrCodePopup(peerId)` (глобальная Solid-функция, `:695,736,971`),
   * у нас попап — React-компонент, смонтированный и управляемый состоянием
   * `UserInfoPanel.tsx` (тот же приём проброса узла/колбэка, что и
   * `avatarsInfo`/`searchSuperContainer` в пропах ниже, не второй способ).
   * `undefined` у единственного вызывающего быть не должно (передаётся всегда),
   * опционально — чтобы тесты каркаса (Task 2/3), не знающие про QR, не были
   * обязаны его передавать. */
  onOpenQrCode?: (payload: { url: string; label: string }) => void

  // ── Task 5: наши секции без аналога в оригинале ────────────────────────────
  // Гейты и данные — уже посчитанные значения React `useGroupInfo`
  // (`UserInfoPanel.tsx`, реальные `useState`, а не поля без писателя — проверено
  // грепом перед портом, см. бриф задачи и докблоки функций ниже) и `chat.type
  // === 'secret'`. Второй сетевой поход/второй расчёт этих величин здесь не
  // заводим — Solid только читает то, что посчитал вызывающий, тем же мостом
  // пропов, что `onOpenQrCode` выше (второго способа нет).
  /** Порт `chat/topbar.ts:664` (пункт «Statistics» меню топбара) — см. докблок
   *  функции `Statistics` ниже. Предикат `isRealChat && isChannel &&
   *  canViewStats` свёрнут ВЫЗЫВАЮЩИМ (той же логикой, что была у React-строки). */
  showStatistics?: boolean
  onOpenStatistics?: () => void
  /** Порт `editChat.tsx:362` (строка «Discussion»/«LinkedChannel» вкладки
   *  редактирования) — см. докблок `Discussion` ниже. */
  showDiscussion?: boolean
  discussionPeerId?: PeerId
  enablingDiscussion?: boolean
  onEnableDiscussion?: () => void
  /** Порт `editChat.tsx:227` (+ плашка `chat/requests.tsx`) — см. докблок
   *  `JoinRequests` ниже. */
  showJoinRequests?: boolean
  joinRequests?: { userId: number; title: string }[]
  onApproveJoinRequest?: (userId: number) => void
  onDeclineJoinRequest?: (userId: number) => void
  /** У tweb секретных чатов нет вовсе — эталона не существует, см. докблок
   *  `EncryptionKey` ниже. */
  isSecret?: boolean
  onOpenEncryptionKey?: () => void
}

const PeerProfileContext = createContext<PeerProfileContextValue>()

/** Порт `useContext(PeerProfileContext)` мест оригинала (`:218` и далее) — с
 *  проверкой наличия провайдера: секции задач 3-5 обязаны монтироваться
 *  только внутри `<PeerProfile>`, тихий `undefined` замаскировал бы ошибку
 *  вложенности до первого обращения к полю контекста. */
export function usePeerProfileContext(): PeerProfileContextValue {
  const context = useContext(PeerProfileContext)
  if (!context) throw new Error('usePeerProfileContext: нет PeerProfileContext.Provider выше по дереву')
  return context
}

export type PeerProfileProps = {
  peerId: PeerId
  /** Тема форума — сегодня недостижимо: единственный вызывающий
   *  (`UserInfoPanel.tsx`) threadId не знает вовсе (панель профиля не открывает
   *  тему форума отдельно). Поле оставлено ради `isTopic`/типовой параллели с
   *  оригиналом, а не выдумано под несуществующий сценарий. */
  threadId?: number
  isDialog?: boolean
  scrollable: HTMLElement
  setCollapsedOn: HTMLElement
  /** Контракт оригинала (tweb `:121`, `:211`, `sharedMedia.tsx:166`) — готовый
   *  DOM-узел грида шаред-медиа, отдаётся ПОСЛЕДНИМ ребёнком. У нас его
   *  создаёт и держит `UserInfoPanel.tsx` (React `SharedMedia` рисуется в него
   *  порталом) — см. докблок точки монтирования там же. */
  searchSuperContainer?: HTMLElement
  /** Задача 3. Узел `PeerProfileAvatars.info` (`peerProfileAvatars.ts`,
   *  публичное поле, docblock «кто владеет контентом») — карусель-шапка сама
   *  его не наполняет (структурный DOM — задача класса, контент — этой
   *  Solid-секции, см. докблок ниже у места монтирования). Опционален по той
   *  же причине, что и `searchSuperContainer`: до монтажа острова аватарок
   *  (`UserInfoPanel.tsx`) узла ещё нет. */
  avatarsInfo?: HTMLElement
  /** Задача 4, см. докблок поля `onOpenQrCode` контекста выше — тот же
   *  колбэк, прокинутый пропом (как `avatarsInfo`/`searchSuperContainer`). */
  onOpenQrCode?: (payload: { url: string; label: string }) => void

  // Задача 5 — см. докблоки одноимённых полей контекста выше, они те же
  // пропы, прокинутые дальше без изменений (тот же приём, что у `onOpenQrCode`).
  showStatistics?: boolean
  onOpenStatistics?: () => void
  showDiscussion?: boolean
  discussionPeerId?: PeerId
  enablingDiscussion?: boolean
  onEnableDiscussion?: () => void
  showJoinRequests?: boolean
  joinRequests?: { userId: number; title: string }[]
  onApproveJoinRequest?: (userId: number) => void
  onDeclineJoinRequest?: (userId: number) => void
  isSecret?: boolean
  onOpenEncryptionKey?: () => void
}

/**
 * Строит значение контекста — вынесено ИЗ JSX-компонента отдельной функцией
 * ради теста: `PeerProfile` не принимает `children` (как и оригинал, `:115-124`
 * — фиксированное дерево, а не композиция), поэтому пробе неоткуда прочитать
 * контекст изнутри смонтированного дерева. Сама логика вычисления полей —
 * тут; `PeerProfile` ниже только оборачивает её в `<Provider>` и рисует корень.
 */
export function createPeerProfileContextValue(props: PeerProfileProps): PeerProfileContextValue {
  const peer = usePeer(() => props.peerId)
  const fullPeer = useFullPeer(props.peerId)
  const meId = useChatsStore.getState().meId

  const value: PeerProfileContextValue = {
    peerId: props.peerId,
    threadId: props.threadId,
    scrollable: props.scrollable,
    setCollapsedOn: props.setCollapsedOn,
    isDialog: !!props.isDialog,
    get peer() {
      return peer()
    },
    get fullPeer() {
      return fullPeer()
    },
    // Порт `:153` (`rootScope.myId` → `meId`).
    canBeDetailed: () => value.peerId !== meId || !value.isDialog,
    // Порт `:143` (`props.peerId === rootScope.myId && props.threadId`).
    isSavedDialog: !!(props.peerId === meId && props.threadId),
    // Порт `:144-146`; `Channel.pFlags.forum` — единственный носитель предмета
    // (`isBotforum` в дизъюнкции оригинала опущен, см. докблок файла).
    get isTopic() {
      return !!(value.threadId && (value.peer as Channel | undefined)?.pFlags?.forum)
    },
    // Порт `:154-163`. `!`: `isSavedDialog` истинен, только если `threadId`
    // truthy (см. его определение выше), поэтому в этой ветке `value.threadId`
    // гарантированно есть. НЕДОСТИЖИМО СЕГОДНЯ (Task 2: ни один вызывающий
    // `threadId` не передаёт) — портировано на будущее, тот же режим, что и
    // `isTopic` выше.
    getDetailsForUse: () =>
      value.isSavedDialog
        ? { peerId: value.threadId!, threadId: undefined }
        : { peerId: value.peerId, threadId: value.threadId },
    // НАХОДКА РЕВЬЮ (Critical, финальный раунд волны): `onOpenQrCode` и ВСЕ
    // поля задачи 5 ниже раньше лежали здесь ОБЫЧНЫМИ полями (`x: props.x`) —
    // значение вычислялось РОВНО ОДИН РАЗ, в момент вызова этой функции
    // (первый рендер, ДО того, как `UserInfoPanel.tsx` вообще узнаёт ответы
    // `useGroupInfo`/`useState`). `props` здесь — прокси Solid-стора
    // (`mountSolid.solid.tsx`, единственный вызывающий), и `update(patch)`
    // пишет В ЭТОТ СТОР уже ПОСЛЕ первого рендера — но обычное поле объекта
    // `value` эту запись не видит: оно скопировало значение снимком и больше
    // к `props` не возвращается. `peer`/`fullPeer` выше от этого бага не
    // страдали ТОЛЬКО потому, что уже были геттерами, перечитывающими свой
    // аксессор заново при каждом обращении — тот же приём применён здесь.
    // Живой пример поломки: `showStatistics`/`showDiscussion`/
    // `showJoinRequests` приходят `false`/`undefined` на первом коммите
    // (макет монтируется в layout-фазе, `useGroupInfo` отвечает позже
    // асинхронно) — со снимком секции Statistics/Discussion/JoinRequests не
    // появлялись НИКОГДА, а для статистики канала это ЕДИНСТВЕННЫЙ вход в
    // фичу (в топбаре пункта нет) — пин на факт (не на форму вызова моста) —
    // `peerProfileLiveProps.solid.test.tsx`.
    get onOpenQrCode() {
      return props.onOpenQrCode
    },
    // ── Задача 5 — сквозной проброс, см. докблоки полей контекста выше ──────
    get showStatistics() {
      return props.showStatistics
    },
    get onOpenStatistics() {
      return props.onOpenStatistics
    },
    get showDiscussion() {
      return props.showDiscussion
    },
    get discussionPeerId() {
      return props.discussionPeerId
    },
    get enablingDiscussion() {
      return props.enablingDiscussion
    },
    get onEnableDiscussion() {
      return props.onEnableDiscussion
    },
    get showJoinRequests() {
      return props.showJoinRequests
    },
    get joinRequests() {
      return props.joinRequests
    },
    get onApproveJoinRequest() {
      return props.onApproveJoinRequest
    },
    get onDeclineJoinRequest() {
      return props.onDeclineJoinRequest
    },
    get isSecret() {
      return props.isSecret
    },
    get onOpenEncryptionKey() {
      return props.onOpenEncryptionKey
    },
  }
  return value
}

/** Порт `PeerProfile` (tweb `:115-215`) — каркас без секций, см. докблок файла. */
const PeerProfile = (props: PeerProfileProps) => {
  const value = createPeerProfileContextValue(props)
  // Второй снимок `meId` (первый — внутри `createPeerProfileContextValue`,
  // для `canBeDetailed`/`isSavedDialog`): дублирование ради того, чтобы
  // билдер контекста оставался САМОДОСТАТОЧНОЙ функцией для теста (см. его
  // докблок) — `is-me` считается снаружи, там, где строится корень.
  const meId = useChatsStore.getState().meId

  // ── Задача 3: Name/Subtitle — внутрь `avatars.info`, а не сюда ──────────────
  // Оригинал кладёт `Name`/`Subtitle` ВНУТРЬ `avatars.info` изнутри
  // `PeerProfile.Avatar` (tweb `:217-256`, тот же Solid-корень, что и
  // `.profile-content`, — у них общий владелец). У нас `avatars.info`
  // принадлежит классу `PeerProfileAvatars`, который живёт СНАРУЖИ этого
  // корня и переживает смену пира (React-остров, докблок класса «Осознанное
  // отступление» + докблок `avatarsHostRef` в `UserInfoPanel.tsx`) — прямого
  // JSX-ребёнка туда не положить.
  //
  // Мост — ТОТ ЖЕ `mountSolid`, которым эта панель монтирует ВЕСЬ этот
  // компонент (не второй способ): он создаёт независимый Solid-корень внутри
  // готового узла БЕЗ обёртки (`render()` вставляет детей напрямую,
  // `solid-js/web@1.9.15 dist/web.js:197`) — в отличие от `<Portal>`, который
  // ВСЕГДА заворачивает содержимое в свой `<div>` (`web.js:732`) и сломал бы
  // структуру `avatars.info.append(name, subtitle)` оригинала (прямые дети).
  // Контекст новому корню не наследуется (это ДРУГОЙ `createRoot`) — поэтому
  // `NameAndSubtitle` заново оборачивает его в `PeerProfileContext.Provider`
  // с ТЕМ ЖЕ `value` (геттеры внутри него читают те же сигналы `usePeer`/
  // `useFullPeer`, что и этот корень, — те же живые данные, не снимок).
  //
  // Правило владения узла (шапка файла плана): единственный писатель
  // `avatars.info` — этот мост. React `UserInfoPanel.tsx` в него больше не
  // пишет вовсе (находка Critical прошлого шага волны — см. план, шапка).
  //
  // Пересоздание корня на каждый peerId (см. докблок файла выше) само даёт
  // требуемое поведение «смена пира убирает узлы прежнего»: `mountSolid`
  // дисциплинированно чистит СВОИ узлы через `dispose()` (`element.textContent
  // = ""`) на каждый teardown этого компонента — ни разу не полагаясь на то,
  // что `avatars.info` вообще будет очищен кем-то ещё.
  const NameAndSubtitle = () => (
    <PeerProfileContext.Provider value={value}>
      <Name />
      <Subtitle />
    </PeerProfileContext.Provider>
  )
  if (props.avatarsInfo) {
    // `update` тут не нужен — `NameAndSubtitle` пропов не принимает вовсе,
    // читает контекст напрямую (см. докблок выше, «Задача 3»).
    onCleanup(mountSolid(props.avatarsInfo, NameAndSubtitle, {}).dispose)
  }

  return (
    <PeerProfileContext.Provider value={value}>
      <div class={classNames('profile-content', value.peerId === meId ? 'is-me' : '')}>
        <div class="profile-content-delimiter" />
        <MainSection />
        <Statistics />
        <Discussion />
        <JoinRequests />
        <EncryptionKey />
        {props.searchSuperContainer}
      </div>
    </PeerProfileContext.Provider>
  )
}

export default PeerProfile

// ─────────────────────────────────────────────────────────────────────────────
// Задача 3: имя и статус (tweb `:273-421`)
// ─────────────────────────────────────────────────────────────────────────────
//
// Именование БЕЗ `PeerProfile.Name`/`PeerProfile.Avatar` оригинала: у нас
// `PeerProfile` — `const … = (props) => …`, а не объект-класс с полями,
// присвоить свойство ей значило бы городить TS-декларацию ради чистой
// косметики. Функции ниже — те же тела 1:1, просто отдельными именами;
// поведенческого расхождения нет.
//
// `PeerProfile.Avatar`/`AutoAvatar` (`:217-271`) сюда не входят — у нас
// монтаж класса и `setPeer()` делает React-остров (`UserInfoPanel.tsx`,
// задача 5 программы шапки), это НЕ секция `.profile-content` в принципе.
//
// `SubtitleRating` (`:306-326`) не портирован — рейтинга (`stars_rating`) у
// нас нет как предмета нигде в `UserFull` (`core/peers/peer.ts`); Task 1
// заводила `fullPeers.solid.ts` без этого поля (его докблок перечисляет то,
// что у `PeerFull` есть).

/** Порт `PeerProfile.Name` (tweb `:273-295`).
 *
 * `needWhite` оригинала (окраска бейджей/эмодзи-статуса в белый над фото) не
 * портирован: у нас это поле класса `PeerProfileAvatars`
 * (`onNeedWhiteChanged`, докблок класса) остаётся незаведённым — ТЕКСТ имени/
 * статуса и без моста красится в белый чистым CSS-каскадом (`.need-white
 * .profile-name`/`.profile-subtitle`, `styles/tweb/_profile.scss:560-563`,
 * скопировано из tweb 1:1), а бейджи ниже цвет не меняли и ДО этой задачи (те
 * же React-компоненты, вставлявшиеся порталом из `UserInfoPanel.tsx`, красили
 * иконки фиксированным цветом независимо от `need-white`) — не регресс,
 * известный пробел на будущее, если понадобится точная белизна значков.
 *
 * ── НАХОДКА РЕВЬЮ (Important): «Избранное» подписывалось собственным именем ──
 * `getPeerTitle` (`core/peers/getPeerTitle.ts`) не знает про диалог с самим
 * собой — это дословный порт ВЕНДОРНОГО `wrappers/getPeerTitle.ts`, а не
 * класса `PeerTitle`, и в самом оригинале эта функция SavedMessages тоже не
 * ветвит (проверено по исходнику: ветки `dialog`/`myId` там нет вовсе). Ветка
 * живёт ВЫШЕ, в `PeerTitle.update` (tweb `peerTitle.ts:140-148`:
 * `peerId === rootScope.myId && this.options.dialog` → `i18n('SavedMessages')`
 * / `'Saved'`), и именно оттуда её зовёт `PeerProfile.Name`
 * (`peerProfile.tsx:276`, `dialog: context.isDialog`). Раньше здесь ветки не
 * было вовсе — заголовок «Избранного» строился тем же `getPeerTitle`, что и
 * у любого чужого пользователя, и получал ИМЯ ЗРИТЕЛЯ вместо «Избранное»:
 * регресс и против оригинала, и против снесённого React (`dialogToChat.ts`
 * подставляет `SAVED_MESSAGES_TITLE` в `chat.name` для СПИСКА, но профиль
 * этот путь не разделял). `meAsNotes` (заметки внутри «Избранного» — тред
 * снутри Saved Messages, `:143`) не портирован — предмета «заметки» у нас
 * нет нигде в кодовой базе, а `isSavedDialog`/`getDetailsForUse` (ветка,
 * которая привела бы к этому сценарию) сегодня недостижимы (докблок Task 2).
 */
function Name() {
  const context = usePeerProfileContext()
  const { peerId } = context.getDetailsForUse()
  const meId = useChatsStore.getState().meId

  // Порт `peerId === rootScope.myId && this.options.dialog` — см. докблок
  // функции выше. Бейджи (verified/premium/эмодзи-статус) в этой ветке ТОЖЕ
  // не рисуются: у оригинала генерация иконок (`generateTitleIcons`,
  // `peerTitle.ts:187` и далее) стоит только в ветке ELSE (реальный пир),
  // SavedMessages-ветка обрывается на замене текста раньше.
  const isSavedMessages = createMemo(() => peerId === meId && context.isDialog)

  const titleNode = createMemo(() =>
    isSavedMessages()
      ? wrapEmojiText(SAVED_MESSAGES_TITLE)
      : wrapEmojiText(getPeerTitle({ peerId, peer: context.peer })),
  )
  // Бейджи верификации/премиума/эмодзи-статуса — только у пользователя
  // (`UserReal`), и НЕ у «Избранного» (см. `isSavedMessages` выше); `Chat`/
  // `Channel` бейджей не несут вовсе в нашей модели.
  const user = createMemo(() => {
    if (isSavedMessages()) return undefined
    const peer = context.peer
    return peer && peer._ === 'user' ? peer : undefined
  })

  return (
    <div class="profile-name">
      <span class="peer-title" dir="auto">{titleNode()}</span>
      <Show when={user()?.pFlags?.verified}><VerifiedBadgeIcon size={22} /></Show>
      <Show when={user()?.pFlags?.premium}><PremiumBadgeIcon size={22} /></Show>
      <Show when={user()?.emoji_status_emoticon}>{(emoji) => <EmojiStatusIcon emoji={emoji()} size={22} />}</Show>
    </div>
  )
}

/**
 * Порт `PeerProfile.Subtitle` (tweb `:297-304`) — только `SubtitleStatus`
 * (`SubtitleRating` не портирован, см. докблок раздела выше).
 */
function Subtitle() {
  return (
    <div class="profile-subtitle">
      <SubtitleStatus />
    </div>
  )
}

/** `useTypingLabel.ts` — тот же порог (React-хук ChatHeader, не переиспользуем
 *  из Solid напрямую, см. докблок `SubtitleStatus` ниже), задублирован
 *  константой, а не выдуман заново. */
const TYPING_TTL = 6000

/**
 * Порт `PeerProfile.SubtitleStatus` (tweb `:328-421`) в объёме предмета,
 * который у нас есть.
 *
 * `needStatus`/`needWhen` — порт `:335-339`/`:331-334`. `needWhen` (ссылка
 * «Показать» у скрытого статуса «был(а) в сети», `getStatusHiddenShow`,
 * `:96-113`) не портирован: предмета (`PopupToggleReadDate`, экран управления
 * видимостью read-date) у нас нет нигде в кодовой базе — не заглушка, а
 * реально отсутствующий попап.
 *
 * `isTopic`-ветка (`:347-368`, `wrapTopicNameButton`) не портирована — той же
 * причины, что и остальные топик-ветки этой волны: `isTopic` сегодня
 * НЕДОСТИЖИМ (Task 2), а самого `wrapTopicNameButton` в кодовой базе нет
 * вовсе (в отличие от `isBotforum`/`hasSavedMusic`, это не «поле есть, но
 * всегда false» — тут нет и функции).
 *
 * Дальше `appImManager.getPeerStatus` (`:3152-3162`) ветвится
 * user/chat — оба предмета у нас есть частично:
 *  • пользователь — presence + typing (`UserStatusLine` ниже), ЭТО и есть
 *    предмет брифа задачи («Статус/присутствие»: `shared/ui/peerStatus.tsx`,
 *    presence в `chatsStore`);
 *  • чат/канал — оригинал считает `getChatMembersString` + `getOnlines`
 *    (онлайн-участники, отдельный сетевой поход, `appProfileManager.
 *    getOnlines`) — предмета для онлайн-счётчика у нас нет вовсе. Число
 *    участников (`participants_count`) у нас ЕСТЬ — синхронно на самом пире
 *    (`ChatReal`/`Channel`, `core/peers/peer.ts`) и в `fullPeer`
 *    (`ChannelFull.participants_count`, Task 1) — оставлять секцию пустой для
 *    любой группы/канала значило бы регресс относительно того, что панель
 *    рисовала ДО этой задачи (`membersLabel`, было в `UserInfoPanel.tsx`).
 *    Портирован СЧЁТЧИК (`ChatMembersLabel` ниже) БЕЗ онлайн-числа — тем же
 *    хелпером `membersLabel`, что и раньше (чистая функция, второго способа
 *    считать не заводит).
 *
 * ── ПОТЕРЯ (объявлена, не регресс): подзаголовок «N чатов» у «Избранного» ────
 * Снесённый React-подзаголовок (`subtitleText`, `UserInfoPanel.tsx`, до Task 3)
 * у диалога с самим собой показывал число сгруппированных по источнику
 * сохранённых диалогов («N чатов»). Здесь эта строка не появится вовсе:
 * `needStatus` (см. выше) ложен для own-диалога (`meId === peerId && isDialog`),
 * ровно как в оригинале (`:335-339` — тот же own-диалог гасит ВЕСЬ
 * `SubtitleStatus`, а не только typing/presence-часть, и у `PeerProfile` нет
 * отдельной ветки «N чатов» для Saved Messages ни у одного счётчика). Прав
 * оригинал — счётчика сохранённых диалогов в подзаголовке профиля у tweb нет
 * никогда, это была самодеятельность прежнего React. Заводить эту строку
 * заново значило бы чинить то, что не сломано.
 */
function SubtitleStatus() {
  const context = usePeerProfileContext()
  // Снимок, не подписка — тот же приём и то же основание, что у `meId`
  // `createPeerProfileContextValue` (докблок файла, «meId — снимок»).
  const meId = useChatsStore.getState().meId

  const needStatus = createMemo(() => {
    const { peerId, isDialog } = context
    return !(!peerId || (meId === peerId && isDialog)) && peerId !== HIDDEN_PEER_ID
  })

  return (
    <div class="profile-subtitle-text">
      <Show when={needStatus()}>
        <Show when={isUser(context.peerId)} fallback={<ChatMembersLabel />}>
          <UserStatusLine />
        </Show>
      </Show>
    </div>
  )
}

/** См. докблок `SubtitleStatus` — ветка группы/канала (счётчик участников,
 *  без онлайн-числа). */
function ChatMembersLabel() {
  const context = usePeerProfileContext()
  const count = createMemo(() => {
    // `!isUser(context.peerId)` уже проверено вызывающим (`SubtitleStatus`) —
    // приведение типа отражает ЭТУ проверку, второй раз её не повторяем.
    const peer = context.peer as Chat | undefined
    if (peer?._ === 'channel') {
      return (context.fullPeer as ChannelFull | undefined)?.participants_count ?? peer.participants_count
    }
    if (peer?._ === 'chat') return peer.participants_count
    return undefined
  })

  return (
    <Show when={count() != null}>
      <span>{membersLabel(count()!, isBroadcast(context.peer as Chat | undefined))}</span>
    </Show>
  )
}

/**
 * См. докблок `SubtitleStatus` — ветка пользователя (presence + typing).
 *
 * ── Фактический источник, не второй ─────────────────────────────────────────
 * Оригинал (`:387-401`) слушает СОБЫТИЯ `peer_typings`/`user_update` и
 * периодически (60с) зовёт `refetch()` — у него `appImManager.setPeerStatus`
 * каждый раз идёт в сеть заново. У нас presence/typing УЖЕ реактивное
 * состояние `chatsStore` (`stores/chatsStore.ts`), которое эти самые кадры
 * (`rt:presence`/`rt:typing`) обновляют, — подписка НАПРЯМУЮ на стор
 * (`subscribeExternal` + `useChatsStore.subscribe`) и есть фактический
 * источник, который просит найти бриф задачи: перерисовка происходит РОВНО
 * тогда, когда меняются те же данные, которые в оригинале дёргивали события.
 * Второго зеркала presence здесь нет — читаем то же самое состояние, которым
 * пользуется `shared/ui/peerStatus.tsx` (React).
 *
 * Таймер 60с (`:401`) портирован буквально: подписка на стор не пересчитывает
 * ничего, если объект статуса не менялся (например, «был(а) 5 минут назад»
 * стареет молча) — оригинал решает это тем же интервалом.
 */
function UserStatusLine() {
  const context = usePeerProfileContext()

  const typingEntry = subscribeExternal(
    (onChange) => useChatsStore.subscribe(onChange),
    () => Object.values(useChatsStore.getState().typing[context.peerId] ?? {})[0],
  )
  const presence = subscribeExternal(
    (onChange) => useChatsStore.subscribe(onChange),
    () => useChatsStore.getState().presence[context.peerId],
  )

  const [tick, setTick] = createSignal(0)
  const interval = window.setInterval(() => setTick((t) => t + 1), 60_000)
  onCleanup(() => window.clearInterval(interval))

  // Только `sendMessageTypingAction` — единственный action, у которого есть
  // строка в словаре (`Peer.Activity.User.TypingText`, `src/lang.ts`/
  // `i18n/dict.ru.ts`); остальные (запись/аплоад/…, tweb `:2965-2981`) не
  // портированы — ключей для них нет нигде в словаре (не заглушка, словарь
  // реально не заводил остальные варианты). Непокрытый action просто не
  // считается «печатает» и падает на обычный статус — тот же исход, что у
  // оригинала при `!langPackKey` (`:3029-3033`, `getPeerTyping` возвращает
  // `undefined`).
  const isTyping = createMemo(() => {
    const entry = typingEntry()
    return !!entry && entry.action._ === 'sendMessageTypingAction' && Date.now() - entry.at < TYPING_TTL
  })

  const statusNode = createMemo(() => {
    tick() // читаем сигнал ради подписки — тело не зависит от значения
    return userStatusLabel(presence())
  })

  return (
    <Show when={isTyping()} fallback={<span>{statusNode()}</span>}>
      <span class="online peer-typing-container">
        <TypingDots />
        {i18n('Peer.Activity.User.TypingText')}
      </span>
    </Show>
  )
}

/** Три прыгающие точки — Solid-двойник React `TypingIndicator` (kind='text'
 *  ТОЛЬКО: см. докблок `UserStatusLine` про единственный портированный
 *  action). Тот же CSS-модуль (`TypingIndicator.module.scss`) — не второй
 *  набор keyframes. */
function TypingDots() {
  return (
    <span class={typingStyles.dots}>
      <span /><span /><span />
    </span>
  )
}

/**
 * Solid-двойники `VerifiedBadge.tsx`/`PremiumBadge.tsx`/`EmojiStatus.tsx`
 * (React) — НЕ третий способ рисовать бейдж: та же разметка/тот же источник
 * глифа (`IconTsx`/`@components/icon`, общий с `TgIcon` React-компонента),
 * тот же приём, каким `iconTsx.solid.tsx` уже дублирует `TgIcon.tsx` для
 * Solid-потребителей. React-версии остаются единственным способом там, где
 * бейдж рисует React (список чатов, поиск, настройки, шапка чата — все они
 * НЕ переезжают на Solid этой задачей); здесь Solid-узел нужен внутри
 * `avatars.info`, которым React больше не владеет (см. докблок компонента
 * `PeerProfile` выше), — мостить обратно в React ради трёх строк SVG/иконки
 * было бы отдельным (и более сложным) мостом ради меньшей работы.
 *
 * SVG-путь verified-бейджа (`VerifiedBadgeIcon` ниже) больше НЕ дублирует
 * байты `VerifiedBadge.tsx` — оба читают `shared/icons/verifiedBadgePath.ts`,
 * единственный источник геометрии (найдено ревью задачи 3, см. план «карточка
 * профиля на Solid», Задача 4, п.1).
 */
function VerifiedBadgeIcon(props: { size: number }) {
  return (
    <svg
      width={props.size}
      height={props.size}
      viewBox="0 0 24 24"
      style={{ 'flex-shrink': 0, display: 'block' }}
      aria-label="verified"
    >
      <path fill="var(--primary-color)" d={VERIFIED_BADGE_SEAL_PATH} />
      <path fill="#fff" d={VERIFIED_BADGE_CHECK_PATH} />
    </svg>
  )
}

function PremiumBadgeIcon(props: { size: number }) {
  return <IconTsx icon="premium_badge" style={{ 'font-size': `${props.size}px`, color: '#9275ff', 'line-height': 1 }} />
}

function EmojiStatusIcon(props: { emoji: string; size: number }) {
  return (
    <span aria-label="emoji status" style={{ 'flex-shrink': 0, 'font-size': `${props.size}px`, 'line-height': 1 }}>
      {props.emoji}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Задача 4: строки MainSection (tweb `:633-1218`, сборка `:1510-1533`)
// ─────────────────────────────────────────────────────────────────────────────
//
// Примитивы — те же, что уже возит остальной Solid-порт настроек:
// `section.solid.tsx`/`rowTsx.solid.tsx`/`buttonTsx.solid.tsx`/
// `checkboxFieldTsx.solid.tsx`. Четвёртого способа рисовать строку не заводим.
//
// Контекстное меню (`contextMenu` — «Скопировать», ссылка на fragment.com,
// перевод и т.п. у КАЖДОЙ строки ниже) нигде не портировано: `Row`
// (`rowTsx.solid.tsx`) не несёт проп `contextMenu` вовсе — предмета
// (`helpers/dom/createContextMenu`) нет в репозитории (докблок файла, задача
// #110). Одна и та же причина для Phone/Bio/Birthday/Link — не повторяется у
// каждой функции по отдельности.

/** Порт `PeerProfile.MainSection` (tweb `:1510-1533`) — обёртка
 *  `<Show when={!(isBotforum && threadId)}>` снята как мёртвый код, см.
 *  докблок файла.
 *
 * ── Проверено ревью: пустая карточка у own-диалога («Избранное») — НЕ баг ───
 * У own-диалога (`peerId === meId && isDialog`) гейт `canBeDetailed()` гасит
 * Phone/Username, `Notifications` гасится тем же условием, `Link` не
 * показывается вовсе (это не чат/канал) — при отсутствии своих Bio/Birthday
 * `<Section>` (`section.solid.tsx`) отрисует контейнер БЕЗ единой строки
 * внутри: `Section` не гейтует себя по пустоте детей (`section.solid.tsx`
 * рисует `-container`/`-content` безусловно), `:empty`-CSS в `_section.scss`
 * нет. Это НЕ регресс порта: у tweb `PeerProfile.MainSection` (`:1509-1530`)
 * — ТОТ ЖЕ `<Section noDelimiter>` без гейта по пустоте, и та же цепочка
 * условий (`canBeDetailed`) гасит Phone/Username/Notifications для own-
 * диалога там тоже (`:639`, `:696`, `:1177` оригинала) — при пустых
 * bio/birthday тот же видимый исход (пустая карточка с паддингом) возможен
 * И У ОРИГИНАЛА, поскольку `.sidebar-left-section` (`_section.scss`) красит
 * фон/паддинг безусловно. Добавлять здесь гейт «не рисовать секцию, если
 * дети не дали ни одной строки», которого у оригинала нет, значило бы
 * отсебятина (корневой CLAUDE.md, «без отсебятины») — прав оригинал. */
function MainSection() {
  return (
    <Section noDelimiter>
      <Phone />
      <Username />
      <Bio />
      <Link />
      <Birthday />
      <Notifications />
    </Section>
  )
}

/**
 * Порт `PeerProfile.Phone` (tweb `:633-691`).
 *
 * `isAnonymous`/подпись `AnonymousNumber` (Fragment-купленные анонимные
 * номера, `:650`, `appConfig.fragment_prefixes`) не портированы — предмета
 * (`appConfig`, конфиг с сервера) в кодовой базе нет вовсе. Подпись всегда
 * `i18n('Phone')`.
 *
 * Форматирование — `core/format/phone.ts::formatUserPhone`; деталь и отличие
 * от `formatPhoneNumber.ts` оригинала (нет `HelpCountry`/`help.countriesList`)
 * — в докблоке самого хелпера.
 */
function Phone() {
  const context = usePeerProfileContext()

  // `context.peer.phone` (общее зеркало пиров, `usePeer`/`core/peerCache.ts`)
  // тут НЕ источник: приватность-применённый телефон отдаёт ровно одна ручка
  // (`GET /users/{id}`), а общий путь наполнения зеркала (диалоги, отправители,
  // массовый `/users?ids=`) его вообще не спрашивает — см. докблок
  // `core/profilePhoneCache.ts` целиком («Почему это ОТДЕЛЬНОЕ зеркало»).
  // Пишет его `requestFullPeer` (`fullPeers.solid.ts`) КАК ПОБОЧНЫЙ эффект
  // ТОГО ЖЕ похода, который уже гонит `useFullPeer` этого контекста — второй
  // сетевой поход здесь не нужен, только чтение уже наполненного зеркала.
  const phoneVersion = subscribeExternal(subscribeProfilePhoneMirror, profilePhoneMirrorVersion)
  const phone = createMemo(() => {
    if (!isUser(context.peerId) || !context.canBeDetailed()) return undefined
    phoneVersion()
    // Пустая строка — «приватность скрыла номер», не «номера нет вовсе»
    // (докблок `cachedProfilePhone`); показываем строку только при непустом.
    return cachedProfilePhone(context.peerId) || undefined
  })

  const onClick = () => {
    const value = phone()
    if (!value) return
    void copyTextToClipboard(formatUserPhone(value).replace(/\s/g, ''))
    toastNew({ langPackKey: 'PhoneCopied' })
  }

  return (
    <Show when={phone()}>
      {(value) => (
        <Row clickable={onClick}>
          <Row.Icon icon="phone" />
          <Row.Title>{formatUserPhone(value())}</Row.Title>
          <Row.Subtitle>{i18n('Phone')}</Row.Subtitle>
        </Row>
      )}
    </Show>
  )
}

/**
 * Порт `PeerProfile.Username` (tweb `:693-732`).
 *
 * `getUsernamesAlso` (доп. subtitle «также: @a, @b» у нескольких активных
 * username) не портирован — предмета нет: `User.username` у нас ОДНА строка,
 * схемного `usernames: Username[]` в модели нет (`core/peers/peer.ts`).
 * Subtitle поэтому всегда `i18n('Username')`.
 *
 * URL для QR/копии — `${location.origin}/@username`, а не буквальный
 * `t.me/username` оригинала: у нас нет t.me, та же подмена домена уже принята
 * проектом (`QrModal`/`SettingsView.tsx`/прежний `UserInfoPanel.tsx::inviteUrl`).
 */
function Username() {
  const context = usePeerProfileContext()

  const username = createMemo(() => {
    if (!isUser(context.peerId) || !context.canBeDetailed()) return undefined
    const peer = context.peer
    return (peer && peer._ === 'user' && peer.username) || undefined
  })

  const onClick = () => {
    const value = username()
    if (!value) return
    void copyTextToClipboard('@' + value)
    toastNew({ langPackKey: 'UsernameCopied' })
  }

  return (
    <Show when={username()}>
      {(value) => (
        <Row clickable={onClick}>
          <Row.Icon icon="username" />
          <Row.Title>{value()}</Row.Title>
          <Row.Subtitle>{i18n('Username')}</Row.Subtitle>
          <QrButton url={`${location.origin}/@${value()}`} label={`@${value()}`} />
        </Row>
      )}
    </Show>
  )
}

/**
 * Порт `PeerProfile.QrButton` (tweb `:734-747`) — общий для `Username` и
 * `Link` (как в оригинале). Открытие — не `showMyQrCodePopup` (Solid-функция
 * оригинала), а мост в React (`context.onOpenQrCode`, см. докблок поля
 * контекста): попап QR у нас — React `QrModal.tsx`, которым владеет
 * `UserInfoPanel.tsx`.
 */
function QrButton(props: { url: string; label: string }) {
  const context = usePeerProfileContext()
  const meId = useChatsStore.getState().meId

  return (
    <Show when={context.peerId !== meId}>
      <Row.RightContent>
        <Button.Icon
          icon="qr"
          onClick={(e) => {
            cancelEvent(e)
            context.onOpenQrCode?.({ url: props.url, label: props.label })
          }}
        />
      </Row.RightContent>
    </Show>
  )
}

/**
 * Порт `PeerProfile.Bio` (tweb `:895-967`) — общая строка для bio пользователя
 * И описания канала/группы (`context.fullPeer?.about`: `UserFull.about` и
 * `ChannelFull.about` — одно и то же поле схемы `about`, никакого ветвления
 * по типу пира не требуется, ровно как в оригинале).
 *
 * НЕ гейтится `canBeDetailed()` — оригинал тоже не гейтит (`about()` читается
 * без проверки), поэтому свой bio в «Избранном» (диалог с самим собой) МОЖЕТ
 * показаться, если он есть у полной карточки: расхождение с прежним React,
 * который прятал ВСЮ секцию под `!isSaved`, — здесь прав оригинал.
 *
 * `whitelistedDomains`/премиум-гейт линков в bio (`:910`, `appConfig`) не
 * портирован — предмета (`appConfig`) нет, см. докблок `Phone` выше;
 * `wrapRichText` зовётся без опций (те же ссылки, что разрешает
 * дефолтный allow-list `@core/safeUrl`). Перевод (`usePeerTranslation`,
 * контекстное меню «Перевести») не портирован — предмета (модуль перевода)
 * нет в кодовой базе.
 */
function Bio() {
  const context = usePeerProfileContext()

  const about = createMemo(() => context.fullPeer?.about)
  const wrapped = createMemo(() => {
    const value = about()
    return value ? wrapRichText(value) : undefined
  })

  const onClick = (e: MouseEvent) => {
    // Клик по автоссылке внутри bio — переход, а не копирование (порт `:915-917`).
    if ((e.target as HTMLElement).tagName === 'A') return
    const value = about()
    if (!value) return
    void copyTextToClipboard(value)
    toastNew({ langPackKey: 'BioCopied' })
  }

  return (
    <Show when={wrapped()}>
      <Row clickable={onClick}>
        <Row.Icon icon="info" />
        <Row.Title class="pre-wrap">{wrapped()}</Row.Title>
        <Row.Subtitle>{i18n(isUser(context.peerId) ? 'UserBio' : 'Info')}</Row.Subtitle>
      </Row>
    </Show>
  )
}

/**
 * Порт `PeerProfile.Link` (tweb `:969-1036`) — ТОЛЬКО ветка публичного
 * username (`getPeerActiveUsernames`, первая); фолбэк на `exported_invite`
 * (`:999-1004`, приватная ссылка-приглашение канала/группы БЕЗ публичного
 * username) не портирован — поля `exported_invite` в нашем `ChannelFull`
 * нет (Task 1, `fullPeers.solid.ts`, докблок «что есть у ChannelFull»); у нас
 * это отдельный сетевой поход (`managers.groups.listInvites`,
 * `core/hooks/useGroupInfo.ts`), заводить его в реактивный слой пира —
 * вне объёма этой задачи («новых зеркал не заводить», бриф). Приватная
 * группа/канал БЕЗ публичного username по-прежнему получает свою
 * инвайт-ссылку строкой из React (`UserInfoPanel.tsx`, отмечено там же).
 *
 * ── Разведение владения строкой — ОДНИМ предикатом, не двумя гейтами ────────
 * Раньше здесь стояло «не регресс, временное разделение владения на
 * переходный период» — формулировка была НЕВЕРНОЙ: React-фолбэк проверял
 * `!chat.username`, поле вью-модели (было `data.ts:179`, снесено следующей
 * находкой того же ревью), у которого не было ЧИТАТЕЛЕЙ ни для группы, ни
 * для канала — единственный писатель (`App.tsx`) заполнял его только у
 * приватного черновик-чата, для которого этот гейт вообще не читается —
 * гейт был истинен всегда, и разведения по факту не было: при уже созданной
 * инвайт-ссылке (`useGroupInfo.ts:142-151`) React рисовал свою строку
 * ОДНОВРЕМЕННО с этой (находка ревью Critical, финальный раунд Task 4).
 * Теперь оба места читают ОДИН предикат над ОДНИМ зеркалом пиров —
 * `isPublic` (порт `appChatsManager.isPublic`, `core/peers/predicates.ts:79`)
 * над `context.peer`/`usePeer` здесь и `isPublicPeer`/`cachedChat` в
 * `UserInfoPanel.tsx` — тот же `core/peerCache.ts`. Взаимоисключение теперь
 * СТРУКТУРНОЕ (true/false одного и того же вызова), а не «два признака,
 * которые должны совпадать по построению».
 * `isTopic`-ветка (`:979-989`, ссылка на конкретное сообщение форума) не
 * портирована — `isTopic` у нас недостижим (докблок контекста, Task 2).
 * `getUsernamesAlso` — та же причина, что у `Username` выше.
 *
 * ── Паритет: обычный участник приватной группы БЕЗ прав на инвайт-ссылки ────
 * Проверено по хвосту задачи 5: такой участник не видит ни строку `Link`
 * (username нет — не эта ветка), ни фолбэк `UserInfoPanel.tsx` (прав нет —
 * `inviteLinks` пуст). НАБЛЮДАЕМЫЙ ИСХОД для зрителя тот же, что у оригинала
 * (ссылки не видно), но МЕХАНИЗМ гейта другой, а не «то же самое», — поле
 * `exported_invite` (tweb `:999`, `layer.d.ts:813,866`, `ChatFull.
 * channelFull.exported_invite?: ExportedChatInvite`) в НАШЕЙ модели не
 * существует вовсе (`backend/internal/domain/mtchat.go:853-891`,
 * `chat.go:406-424`) — сравнивать «кладёт/не кладёт сервер это поле» здесь не
 * с чем. У оригинала гейт — ОТСУТСТВИЕ поля В ТОМ ЖЕ ответе `chatFull`
 * (сервер молча не кладёт `exported_invite`, если у зрителя нет права); у нас
 * ссылка — вообще ДРУГОЙ поход, отдельный эндпоинт `GET /chats/{id}/
 * invite_links` (`usecase/chat/group.go:20-31,360-364`), сам гейтованный
 * правом `invite_users` (без права — пустой список, тот же `inviteLinks`,
 * что читает `UserInfoPanel.tsx`). Совпадает только исход для пользователя
 * («ссылки не видно») — не структура ответа. Ни портировать, ни заводить
 * долг за это расхождение МЕХАНИЗМА не нужно (исход и так 1:1).
 */
function Link() {
  const context = usePeerProfileContext()

  const username = createMemo(() => {
    if (isUser(context.peerId)) return undefined
    const peer = context.peer as Channel | undefined
    return isPublic(peer) ? peer!.username : undefined
  })

  const onClick = () => {
    const value = username()
    if (!value) return
    void copyTextToClipboard(`${location.origin}/@${value}`)
    toastNew({ langPackKey: 'LinkCopied' })
  }

  return (
    <Show when={username()}>
      {(value) => (
        <Row clickable={onClick}>
          <Row.Icon icon="link" />
          <Row.Title>{`${location.host}/@${value()}`}</Row.Title>
          <Row.Subtitle>{i18n('SetUrlPlaceholder')}</Row.Subtitle>
          <QrButton url={`${location.origin}/@${value()}`} label={`${location.host}/@${value()}`} />
        </Row>
      )}
    </Show>
  )
}

/**
 * Порт `PeerProfile.Birthday` (tweb `:749-831`).
 *
 * Текст — уже существующий `core/format/birthday.ts::formatBirthday`
 * (использовался прежним React-рядом); он НЕ добавляет 🎂-префикс дню
 * рождения СЕГОДНЯ и суффикс `BirthdayYearsOld` (`differenceInYears`,
 * оригинал `:776-781`) — оба требуют НОВЫЙ лангпак-ключ, а ключи здесь не
 * только словари (`i18n/dict.*.ts`), но и источник для бэкендового генератора
 * (`backend/internal/langsource`, докблок `i18n/dict.ts`) — заводить ключ и
 * трогать бэкенд ради декоративного суффикса вне объёма этой задачи. Условие
 * показа — дословно.
 *
 * `onClick` — оригинал ветвится натрое: владелец профиля → редактор своего
 * дня рождения (`showBirthdayPopup`/`saveMyBirthday`); сегодня чужой день
 * рождения → попап отправки подарка (`PopupSendGift` с `birthday: true`);
 * иначе → копия текста. Ни редактора, ни birthday-режима попапа подарка
 * (`components/stars/SendGiftPopup.tsx` такого пропа не принимает) у нас нет
 * предметом — обе ветки схлопнуты в копию, тот же исход, что у ELSE-ветки
 * оригинала. Тост пропущен (не «TextCopied» оригинала — этого ключа тоже нет,
 * см. абзац выше про генератор): копия происходит молча, без ложной подписи.
 */
function Birthday() {
  const context = usePeerProfileContext()
  const birthday = createMemo(() => (context.fullPeer as UserFull | undefined)?.birthday)

  const onClick = () => {
    const value = birthday()
    if (!value) return
    void copyTextToClipboard(formatBirthday(value))
  }

  return (
    <Show when={birthday()}>
      {(value) => (
        <Row clickable={onClick}>
          <Row.Icon icon="gift" />
          <Row.Title>{formatBirthday(value())}</Row.Title>
          <Row.Subtitle>{i18n('Birthday')}</Row.Subtitle>
        </Row>
      )}
    </Show>
  )
}

/**
 * Порт `PeerProfile.Notifications` (tweb `:1175-1218`).
 *
 * Источник мьюта — ТЕ ЖЕ примитивы, что у React `core/hooks/useMuteToggle.ts`
 * (`core/dialogs/notifySettings.ts::isPeerMuted` + `chatsStore.dialogs` +
 * `managers.groups.setMute`), без обёртки-хука (Solid не читает React-хуки);
 * второго способа мьютить нет — `useMuteToggle` остаётся у `EditContactView`
 * (докблок хука), эта функция и он читают/пишут ОДНО и то же состояние.
 * `managers` — `startClient().managers`, тот же приём, что у Task 1
 * (`fullPeers.solid.ts`, докблок «зачем `managers` параметром»).
 *
 * Условие оригинала — `isDialog && canBeDetailed() && (!muted.loading ||
 * muted.latest !== undefined)`: единственный вызывающий всегда передаёт
 * `isDialog: true` (докблок файла, «Пересоздание на каждый peerId»), и мьют
 * читается СИНХРОННО из уже загруженного `chatsStore` — состояния «загрузки»
 * у этого источника нет вовсе. Условие поэтому схлопывается в
 * `canBeDetailed()` (= `peerId !== meId`, раз `isDialog` истинен всегда).
 */
function Notifications() {
  const context = usePeerProfileContext()
  const meId = useChatsStore.getState().meId

  const muted = subscribeExternal(
    (onChange) => useChatsStore.subscribe(onChange),
    () => {
      const notify = useChatsStore.getState().dialogs.find((d) => d.peerId === context.peerId)?.notify_settings
      return isPeerMuted(notify, Math.floor(Date.now() / 1000))
    },
  )

  const onChange = (checked: boolean) => {
    void startClient().managers.groups.setMute(context.peerId, !checked)
  }

  return (
    <Show when={context.peerId !== meId}>
      <Row>
        <Row.CheckboxFieldToggle>
          <CheckboxFieldTsx checked={!muted()} onChange={onChange} toggle />
        </Row.CheckboxFieldToggle>
        <Row.Icon icon="unmute" />
        <Row.Title>{i18n('Notifications')}</Row.Title>
      </Row>
    </Show>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Задача 5: наши секции без аналога в оригинале
// (план «карточка профиля на Solid», `docs/superpowers/plans/
// 2026-09-05-profile-card-solid.md`, «Задача 5»)
// ─────────────────────────────────────────────────────────────────────────────
//
// У tweb `PeerProfile` этих четырёх секций НЕТ вовсе — они переехали из
// React 1:1 («как есть», перенос без редизайна) в объёме брифа задачи: тот же
// гейт показа, то же действие по клику, тот же визуал (`Section`/`Row` —
// те же Solid-примитивы, что уже несёт `MainSection`, четвёртого способа
// рисовать строку не заводим). Гейты и данные приходят ПРОПОМ из React
// (`UserInfoPanel.tsx`, `useGroupInfo`/`chat.type`) — вторых зеркал/повторных
// сетевых походов эта задача не заводит, только относит уже посчитанные
// значения в правильный узел DOM.
//
// Каждая секция вставлена сюда «как есть» — правильное место (там, где стоит
// в tweb эквивалентный пункт меню/строка вкладки редактирования) остаётся
// долгом: `web-client/backlogs/frontend/profile-sections-misplaced.md`.
//
// Попапы, которые открывают эти строки (`ChannelStats`, `KeyVerificationPopup`)
// — САМИ остаются React-оверлеями СНАРУЖИ `.profile-content` (тот же приём,
// что и у `QrModal` в задаче 4): узел строки рисует Solid целиком (единственный
// писатель), а «открыть попап» — колбэк-мост, а не второй рендер оверлея.

/**
 * Порт пункта «Statistics» меню топбара чата (tweb `chat/topbar.ts:664-671`:
 * `AppStatisticsTab` в правом сайдбаре, гейт `!monoforumThreadId &&
 * canViewStatistics`). У tweb это НЕ строка профиля — этот пункт открывается
 * из меню «⋮» шапки чата, а не из карточки. У нас профиль остаётся
 * единственным местом, где вообще есть доступ к статистике (топбар такого
 * меню/пункта не имеет), поэтому строка живёт здесь — долг на перенос в
 * правильное место (меню топбара) заведён отдельно (см. докблок раздела).
 *
 * `showStatistics` — уже свёрнутый ВЫЗЫВАЮЩИМ предикат `isRealChat &&
 * isChannel && canViewStats` (`useGroupInfo.ts`, реальные `useState`-поля с
 * писателем — `managers.groups.card(...).then(...)`, проверено грепом перед
 * портом). Открытие — мост в React `ChannelStats` (слайд-ин, `UserInfoPanel.tsx`),
 * тот же приём, что `onOpenQrCode` в задаче 4.
 */
function Statistics() {
  const context = usePeerProfileContext()
  return (
    <Show when={context.showStatistics}>
      <Section noDelimiter>
        <Row clickable={() => context.onOpenStatistics?.()}>
          <Row.Icon icon="statistics" />
          <Row.Title>{i18n('Statistics')}</Row.Title>
        </Row>
      </Section>
    </Show>
  )
}

/**
 * Порт строки «Discussion»/«LinkedChannel» вкладки редактирования канала
 * (tweb `editChat.tsx:362-390`: `AppChatDiscussionTab`, подзаголовок —
 * привязанный чат или `PeerInfo.Discussion.Add`). У tweb это строка ВКЛАДКИ
 * `editChat`, а не профиля — у нас вкладки редактирования (752 строки
 * оригинала) нет вовсе, поэтому упрощённый тумблер «включить обсуждение»
 * живёт здесь; полноценный перенос (с привязкой конкретного чата через
 * `AppChatDiscussionTab`) — тот же долг, что и у `Statistics` выше.
 *
 * Текст строк («Discussion enabled»/«Enable discussion») — БЕЗ i18n-ключа, как
 * и в прежнем React (`translate={false}`): ключей для них не заводили ни разу,
 * не заводим и сейчас — не расширять словарь ради переноса разметки.
 *
 * `discussionPeerId !== NULL_PEER_ID` — ЗНАКОВЫЙ ключ группы обсуждения (`0` —
 * обсуждения нет, не `> 0`), тот же предикат, что был у React-строки
 * (`useGroupInfo.ts`, комментарий у поля `discussionPeerId`). «Enabled»-ветка
 * рисует галочку в `titleRight` (порт `selected` прежнего React `Row` —
 * `settings/kit.tsx`, `titleRight = selected ? <TgIcon name="check".../> :
 * …`), «Enable»-ветка красится классом `primary` (порт `accent` того же
 * компонента, `_bridge.scss:282` — общая утилита цвета текста, не завязана на
 * конкретный тип узла) и гасит клик, пока идёт запрос (`enablingDiscussion`),
 * — дословно то же условие, что было у React `onClick`.
 */
function Discussion() {
  const context = usePeerProfileContext()
  return (
    <Show when={context.showDiscussion}>
      <Section noDelimiter name="PeerInfo.Discussion">
        <Show
          when={context.discussionPeerId !== NULL_PEER_ID}
          fallback={
            <Row
              clickable={context.enablingDiscussion ? undefined : () => context.onEnableDiscussion?.()}
              class="primary"
            >
              <Row.Icon icon="comments" />
              <Row.Title>{'Enable discussion'}</Row.Title>
            </Row>
          }
        >
          <Row>
            <Row.Icon icon="comments" />
            <Row.Title titleRight={<IconTsx icon="check" style={{ color: 'var(--primary-color)', 'font-size': '22px' }} />}>
              {'Discussion enabled'}
            </Row.Title>
          </Row>
        </Show>
      </Section>
    </Show>
  )
}

/**
 * Порт строки «MemberRequests»/«SubscribeRequests» вкладки редактирования
 * (tweb `editChat.tsx:227-244`: `AppChatRequestsTab`, счётчик —
 * `chatFull.requests_pending`) плюс плашка топбара `chat/requests.tsx`
 * (карусель аватарок над лентой — не портирована, у нас нет предмета
 * `StackedAvatars`/`recent_requesters`, см. долг раздела). У tweb это
 * отдельная вкладка, открываемая строкой из `editChat`, а не список ВНУТРИ
 * профиля — у нас список рисуется прямо здесь (перенос «как есть» прежнего
 * React-цикла по `joinRequests`, без вкладки).
 *
 * `showJoinRequests`/`joinRequests` — уже посчитанные `useGroupInfo.ts`
 * (реальные `useState`, писатели — `managers.groups.listJoinRequests` +
 * `managers.peers.getUsers`, проверено грепом перед портом). Одобрение/отклонение
 * — те же мутации, что были у React-кнопок (`approveJoinRequest`/
 * `declineJoinRequest`), поданные мостом-колбэком.
 *
 * Аватар заявки — `RequestAvatar` ниже (текстовый инициал, тот же приём, что
 * у React `shared/ui/Avatar`); Solid-порта `Avatar` в кодовой базе нет, а
 * заводить его ради одной буквы в кружке — за пределами этой задачи.
 */
function JoinRequests() {
  const context = usePeerProfileContext()
  return (
    <Show when={context.showJoinRequests && (context.joinRequests?.length ?? 0) > 0}>
      <Section noDelimiter name="SubscribeRequests">
        <For each={context.joinRequests}>
          {(req) => (
            <Row havePadding>
              <div class="row-icon"><RequestAvatar title={req.title} /></div>
              <Row.Title>{req.title}</Row.Title>
              <Row.RightContent>
                <Button.Icon
                  icon="check"
                  aria-label={`Одобрить заявку: ${req.title}`}
                  onClick={() => context.onApproveJoinRequest?.(req.userId)}
                />
                <Button.Icon
                  icon="close"
                  class="danger"
                  aria-label={`Отклонить заявку: ${req.title}`}
                  onClick={() => context.onDeclineJoinRequest?.(req.userId)}
                />
              </Row.RightContent>
            </Row>
          )}
        </For>
      </Section>
    </Show>
  )
}

/** Текстовый аватар заявки (первая буква имени, заглавная) — дословный слепок
 *  no-photo-веток React `shared/ui/Avatar/Avatar.tsx` (`avatar avatar-like
 *  avatar-{N} avatar-gradient`, `size='md'` → 42px, класс `avatar-42` есть в
 *  наборе известных tweb-размеров): фото у заявки нет никогда (сервер отдаёт
 *  только `userId`+`title`), поэтому остальные ветки того компонента (фото/
 *  эмодзи/онлайн-точка) сюда не переносим — предмета нет. */
function RequestAvatar(props: { title: string }) {
  return (
    <div class="avatar avatar-like avatar-42 avatar-gradient" style={{ background: 'var(--primary-color)' }}>
      {props.title[0]?.toUpperCase()}
    </div>
  )
}

/**
 * Ключ шифрования секретного чата (tweb `chatEncryptionKey`, emoji-fingerprint
 * E2E-сессии) — В ОРИГИНАЛЕ ПРЕДМЕТА НЕТ ВООБЩЕ: у tweb секретных чатов не
 * существует (`docs/tweb/...` не описывает их ни разу — это НАША подсистема,
 * `core/secret/*`), поэтому ссылки `file:line` на оригинал у этой секции нет и
 * быть не может. Строка стоит в профиле, потому что это единственное место,
 * где у секретного чата вообще есть info-панель — заводить для него отдельную
 * вкладку ради одной строки не входит в объём этой задачи (тот же долг, что у
 * `Statistics`/`Discussion`/`JoinRequests`, хоть и без адреса оригинала —
 * критерий готовности долга не требует «переехать в tweb-эквивалент», которого
 * нет, только «не жить в профиле»).
 *
 * Открытие — мост в React `KeyVerificationPopup` (`UserInfoPanel.tsx`), тот же
 * приём, что `onOpenQrCode`/`onOpenStatistics` выше: узел эмодзи-отпечатка сам
 * попап не строит, дальше решает React.
 */
function EncryptionKey() {
  const context = usePeerProfileContext()
  return (
    <Show when={context.isSecret}>
      <Section noDelimiter>
        <Row clickable={() => context.onOpenEncryptionKey?.()}>
          <Row.Icon icon="key" />
          <Row.Title>{i18n('SecretChat.EncryptionKey')}</Row.Title>
        </Row>
      </Section>
    </Show>
  )
}
