/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/peerProfile.tsx` — КАРКАС (Task 2, план
 * `docs/superpowers/plans/2026-09-05-profile-card-solid.md`, «Задача 2»).
 * Читать оригинал `:60-215` (контекст, корень, порядок детей) и `:1535-1544`
 * (`renderPeerProfile`). Секции (имя/статус — Task 3, строки MainSection —
 * Task 4, наши секции — Task 5) сюда ещё НЕ перенесены — этот файл только
 * заводит контекст и структуру `.profile-content`, которую они заполнят.
 *
 * ── Контекст: что портировано и почему ──────────────────────────────────────
 * Оригинал (`:62-82`): peerId, threadId, scrollable, setCollapsedOn, isDialog,
 * onPinnedGiftsChange, onAvatarReady, needWhite/setNeedWhite, peer, fullPeer,
 * canBeDetailed, isSavedDialog, isTopic, isBotforum, hasSavedMusic,
 * getDetailsForUse, verifyContext.
 *
 * Портированы: peerId, threadId, scrollable, setCollapsedOn, isDialog, peer,
 * fullPeer, canBeDetailed, isSavedDialog, isTopic — ровно те, что бриф задачи
 * прямо называет и под которые есть предмет.
 *
 * НЕ портированы (не заглушки — предмета нет, или нет потребителя):
 *  • `onPinnedGiftsChange`/`onAvatarReady` — колбэки для `AppSearchSuper`
 *    (`setPinnedGifts`) и её же интеграции с аватаркой (tweb :166-169); наш
 *    `SharedMedia` (React) не отдаёт такого API наружу.
 *  • `needWhite`/`setNeedWhite` — у оригинала это ОБЩИЙ Solid-сигнал: секции
 *    читают его, чтобы красить текст в белый над фото профиля, а класс
 *    `PeerProfileAvatars` его же выставляет. У НАС `need-white` — задача
 *    ЦЕЛИКОМ класса `PeerProfileAvatars` (см. его докблок, поле
 *    `hasBackgroundColor`) — он не Solid и в этот контекст не пишет; заводить
 *    сигнал, который никто не читает и никто не пишет, — мёртвый код. Когда
 *    задача 3+ породит секцию, которой нужен именно этот сигнал, ей и решать
 *    мост класс→контекст.
 *  • `isBotforum` — тут читает `(peer as User).pFlags.bot_forum_view`; в нашей
 *    модели (`core/peers/peer.ts`) у `User` такого поля нет вовсе (наши
 *    `pFlags` объявлены только для полей с предметом — см. докблок `UserReal`).
 *  • `hasSavedMusic` — читает `(fullPeer as UserFull).saved_music`; в нашей
 *    `UserFull` этого поля нет (см. `core/peers/peer.ts:235-252`) — соответственно
 *    класс `has-music` на корне тоже никогда не взводится (см. ниже).
 *  • `getDetailsForUse`/`verifyContext` — вычислимы из уже портированных полей
 *    (isSavedDialog/threadId/peer), но сегодня их не зовёт НИКТО: в оригинале
 *    это опоры для переключения между избранным/темой форума и защиты от
 *    гонки при смене пира у компонентов, которых у нас пока нет ни одного.
 *    Заводить неиспользуемый экспорт — то же самое, что заглушка (CLAUDE.md:
 *    «мёртвый код удалять агрессивно»); добавит их та задача, которой они
 *    впервые понадобятся.
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
 * Здесь — только delimiter и `{props.searchSuperContainer}` (последним,
 * дословно тот же контракт, что и в оригинале): секции между ними — задачи
 * 3-5. `AutoAvatar` в это дерево вообще НЕ входит — см. докблок
 * `UserInfoPanel.tsx` у `avatarsHostRef` (там же причина: наш класс
 * `PeerProfileAvatars` переживает смену пира, а этот Solid-корень
 * пересоздаётся на каждый peerId, как и в оригинале — см. ниже).
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
import { createContext, useContext } from 'solid-js'
import classNames from '../helpers/string/classNames'
import { usePeer } from '../stores/peers.solid'
import { useFullPeer } from '../stores/fullPeers.solid'
import type { PeerFull } from '../core/chatFullCache'
import type { User, Chat, Channel } from '../core/peers/peer'
import { useChatsStore } from '../stores/chatsStore'

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
