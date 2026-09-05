/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/peerProfile.tsx` — каркас (Task 2) + имя/статус
 * внутри `avatars.info` (Task 3, план
 * `docs/superpowers/plans/2026-09-05-profile-card-solid.md`, «Задача 3»).
 * Читать оригинал `:60-215` (контекст, корень, порядок детей), `:1535-1544`
 * (`renderPeerProfile`), `:217-272` (`Avatar`/`AutoAvatar` — кладут `Name`/
 * `Subtitle` в `avatars.info`), `:273-421` (`Name`/`Subtitle`/`SubtitleStatus`).
 * Строки MainSection — Task 4, наши секции — Task 5: они по-прежнему НЕ
 * перенесены сюда.
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
 * Прямыми детьми `.profile-content` здесь — только delimiter и
 * `{props.searchSuperContainer}` (последним, дословно тот же контракт, что и
 * в оригинале): строки MainSection/наши секции — задачи 4-5, им ещё предстоит
 * встать МЕЖДУ. `AutoAvatar` в это дерево вообще НЕ входит — см. докблок
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
import { createContext, useContext, createMemo, createSignal, onCleanup, Show } from 'solid-js'
import classNames from '../helpers/string/classNames'
import { usePeer } from '../stores/peers.solid'
import { useFullPeer } from '../stores/fullPeers.solid'
import type { PeerFull } from '../core/chatFullCache'
import type { User, Chat, Channel, ChannelFull } from '../core/peers/peer'
import { useChatsStore } from '../stores/chatsStore'
import { mountSolid } from '../shared/solid/mountSolid.solid'
import { subscribeExternal } from '../helpers/solid/subscribeExternal'
import { getPeerTitle } from '../core/peers/getPeerTitle'
import { wrapEmojiText } from '../lib/richtext'
import { isUser, HIDDEN_PEER_ID } from '../core/peers/peerId'
import { isBroadcast } from '../core/peers/predicates'
import { userStatusLabel } from '../core/presence'
import { membersLabel } from './userInfo/helpers'
import { IconTsx } from './iconTsx.solid'
import { i18n } from '@lib/langPack'
import typingStyles from './conversation/TypingIndicator.module.scss'

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
    onCleanup(mountSolid(props.avatarsInfo, NameAndSubtitle, {}))
  }

  return (
    <PeerProfileContext.Provider value={value}>
      <div class={classNames('profile-content', value.peerId === meId ? 'is-me' : '')}>
        <div class="profile-content-delimiter" />
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
 */
function Name() {
  const context = usePeerProfileContext()
  const { peerId } = context.getDetailsForUse()

  const titleNode = createMemo(() => wrapEmojiText(getPeerTitle({ peerId, peer: context.peer })))
  // Бейджи верификации/премиума/эмодзи-статуса — только у пользователя
  // (`UserReal`); `Chat`/`Channel` их не несут вовсе в нашей модели.
  const user = createMemo(() => {
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
      <path
        fill="var(--primary-color)"
        d="M12.3 2.9c.1.1.2.1.3.2.7.6 1.3 1.1 2 1.7.3.2.6.4.9.4.9.1 1.7.2 2.6.2.5 0 .6.1.7.7.1.9.1 1.8.2 2.6 0 .4.2.7.4 1 .6.7 1.1 1.3 1.7 2 .3.4.3.5 0 .8-.5.6-1.1 1.3-1.6 1.9-.3.3-.5.7-.5 1.2-.1.8-.2 1.7-.2 2.5 0 .4-.2.5-.6.6-.8 0-1.6.1-2.5.2-.5 0-1 .2-1.4.5-.6.5-1.3 1.1-1.9 1.6-.3.3-.5.3-.8 0-.7-.6-1.4-1.2-2-1.8-.3-.2-.6-.4-.9-.4-.9-.1-1.8-.2-2.7-.2-.4 0-.5-.2-.6-.5 0-.9-.1-1.7-.2-2.6 0-.4-.2-.8-.4-1.1-.6-.6-1.1-1.3-1.6-2-.4-.4-.3-.5 0-1 .6-.6 1.1-1.3 1.7-1.9.3-.3.4-.6.4-1 0-.8.1-1.6.2-2.5 0-.5.1-.6.6-.6.9-.1 1.7-.1 2.6-.2.4 0 .7-.2 1-.4.7-.6 1.4-1.2 2.1-1.7.1-.2.3-.3.5-.2z"
      />
      <path
        fill="#fff"
        d="M16.4 10.1l-.2.2-5.4 5.4c-.1.1-.2.2-.4 0l-2.6-2.6c-.2-.2-.1-.3 0-.4.2-.2.5-.6.7-.6.3 0 .5.4.7.6l1.1 1.1c.2.2.3.2.5 0l4.3-4.3c.2-.2.4-.3.6 0 .1.2.3.3.4.5.2 0 .3.1.3.1z"
      />
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
