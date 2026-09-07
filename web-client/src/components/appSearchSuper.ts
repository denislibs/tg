// Порт tweb `src/components/appSearchSuper.ts` (2843) — ЯДРО класса: разметка
// подсистемы, полоса вкладок, слайдер содержимого, ПАМЯТЬ ПОЗИЦИИ СКРОЛЛА,
// свайп между вкладками, очистка и смена пира, плюс ЗАГРУЗКА данных вкладок
// (`load`/`loadType`/`performSearchResult`).
//
// Разбор подсистемы с адресами — `docs/tweb/shared-media.md` § 1.3, § 1.4, § 1.9;
// план этапа — `docs/superpowers/plans/2026-09-07-solid-wave-3-shared-media.md`,
// задачи 5-6. Эталон разметки — живой дамп Telegram
// `docs/tweb/dom/dumps/07-right-sidebar.json:121-308` (дамп — ОДНА физическая
// строка JSON; здесь и ниже нумерация по РАЗВЁРНУТОМУ тексту, где первая
// строка — первая, `json.load(...).split('\n')`).
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО ЗДЕСЬ ЕЩЁ НЕ ЖИВЁТ (и почему это не заглушки, а пропуски)
//
// Класс в оригинале — один файл на всю подсистему, и портируется он этапами
// (задачи 5→14 плана). Рендер конкретного элемента, первый показ вкладок,
// выделение и контекстное меню в этом файле ОТСУТСТВУЮТ — ни полей, ни пустых
// методов: заглушка, которую никто не зовёт, — мёртвый код (`CLAUDE.md`).
// Единственное исключение — `buildItem`: его зовёт уже приехавший
// `performSearchResult`, и он честно отдаёт узел, просто пока пустой.
// Места, где оригинал зовёт ещё не приехавшее, помечены комментарием со
// ссылкой на строку tweb и номер задачи; когда задача приедет, вызов встанет
// ровно туда.
//
//  • `processDocumentFilter`/`processUrlFilter` и клик по документу — задачи
//    8-9 (`tweb:940-1094`, `:770-774`); `processEmptyFilter` (`:826-871`) —
//    левая колонка, в правой его вкладки нет;
//  • `loadFirstTime`/`firstLoad`, предикаты `canView*` — задача 10 (`tweb:2362-2529`);
//  • `SortedUserList`/участники — задача 11 (`tweb:1525-1758`);
//  • `SearchSelection`, `SearchContextMenu` — задача 14 (`tweb:156-345`,
//    `chat/selection.ts:583-763`).
//
// ─────────────────────────────────────────────────────────────────────────────
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//
//  1. `Tabs.MenuGradient` (`tweb/src/components/tabs.tsx:71-95`) не заводится
//     отдельным модулем: у нас нет `components/tabs.tsx`, а у фабрики
//     единственный потребитель — этот класс. Два узла градиента собираются
//     здесь же с ТЕМИ ЖЕ классами, что отдаёт фабрика (сверено с дампом
//     `07-right-sidebar.json:122-123`). Собственных стилей у
//     `menu-horizontal-gradient*` нет ни у нас, ни в tweb — во всём
//     `tweb/src` эти классы встречаются только в самой `tabs.tsx`; видимое
//     правило одно, и оно наше: `.search-super-tabs-gradient-container`
//     (`styles/tweb/_searchSuper.scss:92-98`).
//  2. `createRoot` вокруг `Section` (`tweb:567-576`) у нас ВОЗВРАЩАЕТ dispose,
//     и `destroy()` его зовёт. В оригинале корень не утилизируется никогда —
//     у нас `destroy()` обязан не оставлять следов (DoD 5 спеки волны 3).
//  3. `lazyLoadQueue.lock()`/`unlockAndRefresh()` под `useHeavyAnimationCheck`
//     (`tweb:793-795`) не портированы: наш `core/lazyLoadQueue.ts` — сокращённый
//     порт (`push`/`clear`), ручек паузы у него нет. Гасить очередь на время
//     тяжёлой анимации станет нечем до тех пор, пока очередь не дорастёт; на
//     ядро это не влияет — задачи в неё кладёт рендер (задачи 7-9).
//  4. `searchGroupMedia.clear()` в `cleanupHTML` (`tweb:2791`) пропущен:
//     `searchGroup.tsx` — часть ЛЕВОЙ колонки (`docs/tweb/shared-media.md` § 1.2),
//     в правой этот узел не создаётся и у нас не портирован.
//  5. `slider`/`appSidebarRight` (поле `tweb:432`, опция `:450`, дефолт `:453`)
//     не в опциях: поле нужно только вкладкам «участники»/«похожие каналы»
//     для открытия подэкранов (задачи 11-12).
//  6. `managers` (`tweb:419` — весь `AppManagers`) сужены до двух ручек
//     (`SearchSuperManagers`): подсистема ходит только за списком одного вида и
//     за счётчиками вкладок. Узкий шов и проверяем узко.
//  7. ВЛАДЕНИЕ СКРОЛЛЕРОМ. Правило у нас такое: скроллер уничтожается только
//     если создан и принадлежит классу. Оригинал ему удовлетворяет даром —
//     `this.scrollable.destroy()` (`tweb:2831`) там роняет скроллер, который
//     создан владельцем класса (вкладка сайдбара `SliderSuperTab`) и умирает
//     вместе с ним, третьих читателей у него нет. У нас (задача 13 плана) тот
//     же скроллер будет ОБЩИМ с шапкой профиля и переживёт подсистему, а строка
//     скопирована дословно — то есть ПРАВИЛО СЕЙЧАС НЕ СОБЛЮДЕНО, и это
//     ловушка: `Scrollable.destroy()` лишь снимает слушателей и обнуляет
//     колбэки (`components/scrollable.ts:227-232`) — ни исключения, ни записи
//     в консоль; панель просто перестанет реагировать на прокрутку. Развилка
//     («класс заводит свой скроллер» ИЛИ «уничтожение уходит») закрывается
//     задачей 13 плана, там же предупреждение.
//  8. `destroy()` дополнительно СНИМАЕТ контейнер из DOM (`container.remove()`),
//     чего в оригинале нет вовсе: там узел снимает владелец вместе со своим
//     экраном, у нас его обязан убрать сам класс (DoD 5 — «после destroy() узлов
//     класса в документе нет»). Обратная сторона того же расхождения: `selectTab`
//     мы НЕ обнуляем, хотя оригинал обнуляет (`tweb:2837`) — поле объявлено
//     `selectTab!: SelectTab` и под `strictNullChecks` (в tweb он выключен)
//     присвоение `undefined` не проходит по типу; после `destroy()` вызов
//     `selectTab` безопасен — слушатели сняты, а переключение уже мёртвого
//     дерева ничего не наблюдает.
//  9. `nextRate` (`tweb:2288`, `:2321`) не портирован: это курсор ГЛОБАЛЬНОГО
//     поиска левой колонки (`folderId`), которого в этом порте нет вовсе
//     (см. поправку 3 плана). Вместе с ним отпадает и вторая ветка критерия
//     «всё загружено» (`tweb:2312`) — остаётся первая, `history.length <
//     loadCount`, ровно та, что применима к нашей ручке.
// 10. `filterMessagesByType` (`tweb:822-824`) делегирует в оригинале общей
//     утилите `filterMessagesByInputFilter` (её потребителей у нас нет), и там
//     же выясняется, что фильтр `inputMessagesFilterUrl` смотрит на сущности
//     ЛИБО на `matchUrl` текста. Порта `matchUrl` у нас нет; текст проверяется
//     тем же регекспом, каким его проверяет наш бэкенд
//     (`messagesrepo.go::mediaFilterCond`), — расхождение объявлено в
//     `docs/tweb/shared-media.md` § 3 и снимается задачей 15.
// 11. `searchGroups`/`searchGroupMedia` в `performSearchResult`
//     (`tweb:1106-1128`, `:1189-1194`) пропущены целиком: группы — часть ЛЕВОЙ
//     колонки (`docs/tweb/shared-media.md` § 1.2), в правой их нет.
// 12. Вставка НЕСКОЛЬКИХ узлов в начало (`append: false`) идёт обратным
//     обходом. Оригинал (`tweb:1214-1229`) обходит список вперёд и зовёт
//     `prepend` на каждом — порядок при этом переворачивается. У него это не
//     видно: живой апдейт всегда несёт ровно одно сообщение
//     (`sharedMedia.tsx:247`). Портировать переворот значит закладывать
//     дефект под первый же альбом; правим и объявляем.
// 13. «Чувствительный контент» не портирован: `isMessageSensitive`
//     (`tweb:2371-2373`), `hasSensitiveSpoiler`/`skipSensitive` в клике
//     (`:738-744`, `:757`) и `sensitive` у крышки (`:912-925`). Это отдельная
//     аккаунт-настройка Telegram с проверкой возраста, у нас нет ни её API, ни
//     поля у медиа — та же причина, что в шапке `wrappers/mediaSpoiler.ts`.
//     Крышка ставится ровно по `pFlags.spoiler` (`isMediaSpoiler`).
// 14. Медиавьювер. Оригинал (`tweb:757-766`) заводит `new AppMediaViewer()`,
//     отдаёт ему копию контекста поиска (`setSearchContext`) и `prevTargets`/
//     `nextTargets` из `{element, mid, peerId}` — сообщения вьювер спрашивает у
//     менеджера сам. У нас один живой вьювер (`mediaViewer/openMediaViewer.ts`)
//     с плоским `items` + `index`, и каждая цель — ГОТОВЫЙ `ViewerItem`
//     (`messageToViewerItem`), собранный из кэша вкладки
//     (`getSharedMediaMessage`) — того самого, из которого плитка и нарисована;
//     RPC `getMessageByPeer` (`:737`) сюда не нужен. Роль `setSearchContext`
//     (листать за пределы плиток по тому же фильтру) исполняет `loadMoreMedia`
//     поверх `createMediaNeighboursLoader` на ручке `mediaHistory`; загрузчик
//     живёт одно открытие, как `SearchListLoader` у оригинала, но страницы
//     берёт с сети, а не из кэша менеджера — своего кэша сообщений по
//     `offset_id` у вкладки нет.
// 15. `onMediaClick` — метод класса, а не замыкание конструктора
//     (`tweb:716-767`): в конструкторе остаётся только подписка, тело лежит
//     рядом с `processPhotoVideoFilter`, чтобы задачи 8-9 (документы, ссылки)
//     не правили конструктор одновременно.
// 16. `multiply: 0.3` у `wrapMediaSpoiler` (`tweb:924`) не передаётся: в
//     оригинале он доезжает только до ЗАКОММЕНТИРОВАННОГО `resize`
//     (`tweb/src/components/dotRenderer.ts:331`), у нашего `DotRenderer.create`
//     такого параметра нет.
// 17. `this.log.warn`/`this.log.error` (`tweb:722`, `:1178`) — логгера у
//     подсистемы нет (см. `loadType`); клик без `data-mid` молча игнорируется,
//     ошибка рендера одного сообщения — как в оригинале — не роняет партию, но
//     и не логируется.
import Scrollable, { ScrollableX } from '@components/scrollable'
import { horizontalMenu } from '@components/horizontalMenu'
import type { SelectTab } from '@components/horizontalMenu'
import { createLazyLoadQueue, type LazyLoadQueue } from '@core/lazyLoadQueue'
import { putPreloader } from '@components/putPreloader'
import ripple from '@components/ripple'
import Section from '@components/section.solid'
import { i18n, type LangPackKey } from '@lib/langPack'
import findUpClassName from '@helpers/dom/findUpClassName'
import { getMiddleware } from '@helpers/middleware'
import ListenerSetter from '@helpers/listenerSetter'
import type SwipeHandler from '@core/dom/swipeHandler'
import handleTabSwipe from '@helpers/dom/handleTabSwipe'
import lockTouchScroll from '@helpers/dom/lockTouchScroll'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import safeAssign from '@helpers/object/safeAssign'
import type { ScrollStartCallbackDimensions } from '@helpers/fastSmoothScroll'
import { createRoot } from 'solid-js'
import type { Middleware } from '@helpers/middleware'
import type { Managers } from '@/client/bootstrap'
import type { MyMessage } from '@core/models'
import { getMessageKind } from '@core/messages/messageKind'
import { getSharedMediaMessage, saveSharedMediaMessages } from '@components/sharedMediaHistories'
import { getHeavyAnimationPromise } from '@core/dom/heavyAnimation'
import windowSize from '@helpers/windowSize'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import { choosePhotoSize, getMediaFromMessage, isMediaSpoiler } from '@core/media/messageMedia'
import wrapPhoto, { type WrappedPhoto } from '@components/wrappers/photo'
import wrapVideo from '@components/wrappers/video'
import wrapMediaSpoiler, { onMediaSpoilerClick } from '@components/wrappers/mediaSpoiler'
import { openMediaViewer, type OpenMediaViewerArgs } from '@components/mediaViewer/openMediaViewer'
import { messageToViewerItem, type LightboxCtx } from '@components/mediaViewer/collectLightboxItems'
import type { ViewerItem } from '@components/mediaViewer/appMediaViewer'
import { createMediaNeighboursLoader } from '@components/mediaViewer/mediaNeighbours'
import rootScope from '@lib/rootScope'
import { cachedPeer } from '@core/peerCache'
import { useI18nStore } from '@/i18n'

/**
 * tweb `:111` — фильтр сообщений (`inputMessagesFilterPhotoVideo` и т.п.).
 * В оригинале это алиас `MyInputMessagesFilter` из слоя MTProto; у нас слоя нет,
 * поэтому союз выписан явно теми значениями, которые реально ходят через
 * вкладки правой колонки (`sharedMedia.tsx:604-648`).
 */
export type SearchSuperType =
  'inputMessagesFilterEmpty' |
  'inputMessagesFilterPhotoVideo' |
  'inputMessagesFilterDocument' |
  'inputMessagesFilterUrl' |
  'inputMessagesFilterMusic' |
  'inputMessagesFilterRoundVoice'

/** tweb `:112-124`. `nextRate`/`chatType` — расхождение 9 в шапке. */
export type SearchSuperContext = {
  peerId: PeerId
  inputFilter: { _: SearchSuperType | undefined }
  query?: string
  maxId?: number
  folderId?: number
  threadId?: number
  date?: number
  minDate?: number
  maxDate?: number
}

/** tweb `:126-128` — 16 логических вкладок. */
export type SearchSuperMediaType = 'stories' | 'members' | 'media' |
  'files' | 'links' | 'music' | 'chats' | 'voice' | 'groups' | 'similar' |
  'savedDialogs' | 'saved' | 'channels' | 'apps' | 'gifts' | 'posts'

/**
 * tweb `:129-139` — описание вкладки. Существенное: вкладка НЕСЁТ СВОИ УЗЛЫ и
 * СВОЮ ЗАПОМНЕННУЮ ПОЗИЦИЮ СКРОЛЛА (`scroll`), поэтому переключение вкладок
 * ничего не размонтирует и ничего не теряет.
 */
export type SearchSuperMediaTab = {
  inputFilter?: SearchSuperType
  name: LangPackKey
  type: SearchSuperMediaType
  contentTab?: HTMLElement
  itemsTab?: HTMLElement
  menuTab?: HTMLElement
  menuTabName?: HTMLElement
  scroll?: { scrollTop: number, scrollHeight: number }
  hideOn?: HTMLElement
}

/**
 * tweb `:545-553` — типы, которым НЕ нужна карточка `Section`: они рисуют свою
 * разметку целиком (грид медиа, Solid-вкладки историй/подарков, чатлисты).
 */
const NO_SECTION_TYPES: Set<SearchSuperMediaType> = new Set([
  'stories',
  'media',
  'gifts',
  'chats',
  'channels',
  'apps',
  'posts',
])

/** tweb `:141-147` — что нужно `loadType`, чтобы загрузить ОДНУ вкладку. */
type SearchSuperLoadTypeOptions = {
  mediaTab: SearchSuperMediaTab
  justLoad: boolean
  loadCount: number
  middleware: Middleware
  /** С какого края догружаем. Единственный читатель — `loadSavedDialogs`
   *  (`tweb:2203`, `:2398`), он приезжает задачей 12. */
  side: 'top' | 'bottom'
}

/**
 * tweb `:149-154`. `canAnimateIn` не портирован вместе с группами левой
 * колонки: у оригинала он включает появление ИХ контейнера (`:1115-1128`) и
 * больше нигде не читается — расхождение 11 в шапке.
 */
type PerformSearchResultArgs = {
  messages: MyMessage[]
  mediaTab: SearchSuperMediaTab
  append?: boolean
}

/**
 * tweb `:346-353` — что получает рендерер ОДНОГО сообщения. `elemsToAppend`
 * (накопитель `performSearchResult`, рендереры его не читают) и `searchGroup`
 * (левая колонка, расхождение 11) не портированы.
 */
type ProcessSearchSuperResult = {
  message: MyMessage
  middleware: Middleware
  promises: Promise<unknown>[]
  inputFilter: SearchSuperType
  mediaTab: SearchSuperMediaTab
}

/** tweb `:1173` — узел вкладки вместе с сообщением, из которого он собран. */
type SearchSuperItem = { element: HTMLElement, message: MyMessage }

/** Ручки менеджеров, которыми пользуется подсистема — расхождение 6 в шапке. */
export type SearchSuperManagers = {
  messages: Pick<Managers['messages'], 'mediaHistory' | 'searchCounters'>
}

/** Вид шаред-медиа на проводе (`GET /chats/{id}/media?filter=…`). */
type MediaFilter = Parameters<Managers['messages']['mediaHistory']>[1]

/**
 * Фильтр сообщений → вид шаред-медиа нашей ручки. У оригинала перевода нет:
 * `inputFilter` уходит в `messages.search` как есть (`tweb:2284`); у нас между
 * ними ручка REST, и таблица перевода — единственное место, где они встречаются.
 * `inputMessagesFilterEmpty` не переводится вовсе: это поиск ЛЕВОЙ колонки.
 */
const WIRE_FILTER: Partial<Record<SearchSuperType, MediaFilter>> = {
  inputMessagesFilterPhotoVideo: 'media',
  inputMessagesFilterDocument: 'files',
  inputMessagesFilterUrl: 'links',
  inputMessagesFilterMusic: 'music',
  inputMessagesFilterRoundVoice: 'voice',
}

/**
 * Виды сообщений, которые проходят фильтр (порт таблицы
 * `filterMessagesByInputFilter`, tweb `neededContents`/`neededDocTypes`).
 * `gif` в оригинале — документ с `type === 'video'` (`:47-51`), у нас свой вид,
 * и он тоже медиа: вкладки GIF в правой колонке нет (поправка 2 плана).
 */
const FILTER_KINDS: Partial<Record<SearchSuperType, ReadonlySet<ReturnType<typeof getMessageKind>>>> = {
  inputMessagesFilterPhotoVideo: new Set(['photo', 'video', 'gif'] as const),
  inputMessagesFilterDocument: new Set(['document'] as const),
  inputMessagesFilterMusic: new Set(['audio'] as const),
  inputMessagesFilterRoundVoice: new Set(['voice', 'roundVideo'] as const),
}

/** Расхождение 8 в шапке: тот же регексп, каким ссылки ищет наш бэкенд. */
const URL_IN_TEXT = /https?:\/\//i

export type AppSearchSuperOptions = {
  mediaTabs: SearchSuperMediaTab[]
  /** скроллер приходит СНАРУЖИ: весь профиль скроллится одним контейнером (tweb `:406`) */
  scrollable: Scrollable
  managers: SearchSuperManagers
  hideEmptyTabs?: boolean
  onChangeTab?: (mediaTab: SearchSuperMediaTab) => void
  /** tweb `:428` — «во вкладке стало N элементов»; читает шапка профиля. */
  onLengthChange?: (type: SearchSuperMediaType, length: number) => void
  scrollOffset?: number
}

export default class AppSearchSuper {
  /** tweb `:357` — «фильтр → узел списка»; по нему рендер ищет, куда класть элементы. */
  public tabs: Partial<Record<SearchSuperType, HTMLElement>> = {}

  public mediaTab!: SearchSuperMediaTab

  public container: HTMLElement
  public nav: HTMLElement
  public navScrollableContainer: HTMLElement
  public tabsContainer: HTMLElement
  public navScrollable: ScrollableX
  private tabsMenu: HTMLElement
  private prevTabId = -1

  private lazyLoadQueue: LazyLoadQueue = createLazyLoadQueue()
  public middleware = getMiddleware()

  /**
   * tweb `:372-373`. Кэш сообщений по фильтру ЖИВЁТ СНАРУЖИ класса (владелец —
   * обвязка правой колонки, `sharedMedia.tsx:33-36`) и переживает и `cleanup()`,
   * и смену пира; класс лишь держит ссылку и помечает, сколько он из кэша уже
   * отрисовал.
   */
  public historyStorage: Partial<Record<SearchSuperType, { mid: number, peerId: PeerId }[]>> = {}
  public usedFromHistory: Partial<Record<SearchSuperType, number>> = {}

  public searchContext!: SearchSuperContext

  /**
   * tweb `:376`. Обещание, которое `performSearchResult` ждёт ПЕРЕД тем, как
   * вставить узлы (`:1196-1206`): пока оно не разрешилось, показывать нечего —
   * его ставит обвязка на время своей собственной подготовки
   * (`sharedMedia.tsx:205-207`).
   */
  public loadMutex?: Promise<unknown>

  /** tweb `:379-380` — «этот тип уже грузится» и «этот тип дочитан до конца». */
  private loadPromises: Partial<Record<SearchSuperMediaType, Promise<unknown> | null>> = {}
  private loaded: Partial<Record<SearchSuperMediaType, boolean>> = {}

  /** tweb `:427-428` — число элементов вкладки; читает шапка профиля. */
  public counters: Partial<Record<SearchSuperMediaType, number>> = {}
  public onLengthChange?: (type: SearchSuperMediaType, length: number) => void

  public selectTab!: SelectTab
  public mediaTabsMap: Map<SearchSuperMediaType, SearchSuperMediaTab> = new Map()

  private skipScroll?: boolean

  // * arguments
  public mediaTabs!: SearchSuperMediaTab[]
  public scrollable!: Scrollable
  public managers!: SearchSuperManagers
  public hideEmptyTabs? = true
  public onChangeTab?: (mediaTab: SearchSuperMediaTab) => void
  public scrollOffset?: number

  /** tweb `:416` — назначается потребителем (`sharedMedia.tsx:682-684`). */
  public scrollStartCallback?: (dimensions: ScrollStartCallbackDimensions) => void

  private listenerSetter: ListenerSetter
  private swipeHandler?: SwipeHandler

  /**
   * tweb `:437` — узел градиента (тот, что `Tabs.MenuGradient` отдаёт наружу,
   * то есть КОНТЕЙНЕР, а не внутренний слой: `tabs.tsx:77-93`). Читается при
   * первом показе вкладок: когда доступна ровно одна вкладка, ряд получает
   * `is-single`, а градиент — `hide` (`tweb:2509-2511` и `:2523-2525`).
   * Обе точки приезжают задачей 10; поле заводится здесь, потому что узел
   * создаётся здесь.
   *
   * `public`, а не `private` как в оригинале: у нас включён `noUnusedLocals`
   * (`web-client/tsconfig.json:32`, в tweb выключен), и приватное поле, которое
   * пока только пишется, но ещё не читается, — ошибка TS6133. Соседние узлы
   * подсистемы (`container`, `nav`, `navScrollableContainer`, `tabsContainer`)
   * и так публичные.
   */
  public menuGradient: HTMLElement

  /** см. расхождение 2 в шапке файла */
  private disposeSections: (() => void)[] = []

  constructor(options: AppSearchSuperOptions) {
    safeAssign(this, options)

    this.container = document.createElement('div')
    this.container.classList.add('search-super')

    this.listenerSetter = new ListenerSetter()

    // tweb `:462-472` — липкий ряд вкладок в горизонтальном скроллере.
    const navScrollableContainer = this.navScrollableContainer = document.createElement('div')
    navScrollableContainer.classList.add('search-super-tabs-scrollable', 'menu-horizontal-scrollable', 'sticky')

    const navScrollable = this.navScrollable = new ScrollableX(navScrollableContainer)
    navScrollable.container.classList.add('search-super-nav-scrollable')

    const nav = this.nav = document.createElement('nav')
    nav.classList.add('search-super-tabs', 'menu-horizontal-div')
    this.tabsMenu = nav

    navScrollable.container.append(nav)

    // tweb `:474-493` — по вкладке на строку: подчёркивание (`i`) идёт ПЕРВЫМ,
    // название — вторым (дамп `07-right-sidebar.json:128-130`: ripple, i, span).
    for(const mediaTab of this.mediaTabs) {
      const menuTab = document.createElement('div')
      menuTab.classList.add('menu-horizontal-div-item')
      const span = document.createElement('span')
      span.classList.add('menu-horizontal-div-item-span')
      const i = document.createElement('i')
      i.classList.add('menu-horizontal-div-item-background')

      span.append(mediaTab.menuTabName = i18n(mediaTab.name))

      menuTab.append(i, span)

      ripple(menuTab)

      this.tabsMenu.append(menuTab)

      this.mediaTabsMap.set(mediaTab.type, mediaTab)

      mediaTab.menuTab = menuTab
    }

    this.tabsContainer = document.createElement('div')
    this.tabsContainer.classList.add('search-super-tabs-container', 'tabs-container')

    // tweb `:498-542` — свайп между вкладками. `unlockScroll` объявлен ЗДЕСЬ,
    // а снимается в `onTransitionEnd` слайдера (`tweb:701-704`): замок держится
    // ровно до конца анимации перехода.
    let unlockScroll: ReturnType<typeof lockTouchScroll> | undefined
    if(IS_TOUCH_SUPPORTED) {
      this.swipeHandler = handleTabSwipe({
        element: this.tabsContainer,
        onSwipe: (xDiff) => {
          xDiff *= -1

          const prevId = this.selectTab.prevId()
          const children = Array.from(this.tabsMenu.children) as HTMLElement[]

          // tweb `:508-515` — у вкладок `gifts`/`stories` своя горизонтальная
          // навигация (коллекции/альбомы), и она перехватывает свайп первой.
          // Обе вкладки приезжают задачами 11-12 вместе со своими `*Actions`.

          // Соседняя СКРЫТАЯ вкладка пропускается: `hide` на строке ряда значит
          // «в этом чате такой вкладки нет» (`tweb:517-531`).
          let idx: number | undefined
          if(xDiff > 0) {
            for(let i = prevId + 1; i < children.length; ++i) {
              if(!children[i].classList.contains('hide')) {
                idx = i
                break
              }
            }
          } else {
            for(let i = prevId - 1; i >= 0; --i) {
              if(!children[i].classList.contains('hide')) {
                idx = i
                break
              }
            }
          }

          if(idx !== undefined) {
            unlockScroll = lockTouchScroll(this.tabsContainer)
            this.selectTab(idx)
          }
        },
        verifyTouchTarget: (e) => {
          return !findUpClassName(e.target, 'scrollable-x')
        },
      })
    }

    // tweb `:554-594` — содержимое вкладок (сам набор `noSectionTypes`,
    // `tweb:545-553`, у нас поднят в модульную константу `NO_SECTION_TYPES`).
    for(const mediaTab of this.mediaTabs) {
      const container = document.createElement('div')
      container.classList.add('search-super-tab-container', 'search-super-container-' + mediaTab.type, 'tabs-tab')

      const content = document.createElement('div')
      content.classList.add('search-super-content-container', 'search-super-content-' + mediaTab.type)

      container.append(content)

      const useSection = !NO_SECTION_TYPES.has(mediaTab.type)
      let itemsContainer = content
      if(useSection) {
        const items = document.createElement('div')
        // Карточка секции создаётся СКРЫТОЙ (`class: 'hide'`) и открывается
        // первым же отрисованным элементом; она же — `mediaTab.hideOn`.
        this.disposeSections.push(createRoot((dispose) => {
          Section({
            noDelimiter: true,
            class: 'hide',
            ref: (ref: HTMLDivElement) => {
              content.append(mediaTab.hideOn = ref)
            },
            children: [items],
          })
          return dispose
        }))
        itemsContainer = items
      } else if(mediaTab.type === 'media') {
        const grid = document.createElement('div')
        grid.classList.add('search-super-content-media-grid')
        content.append(grid)
        itemsContainer = grid
      }

      this.tabsContainer.append(container)

      const { inputFilter } = mediaTab
      if(inputFilter) {
        this.tabs[inputFilter] = itemsContainer
      }

      mediaTab.contentTab = content
      mediaTab.itemsTab = itemsContainer
    }

    // tweb `:596-600` — узел градиента и создаётся, и запоминается в поле прямо
    // в `append`.
    this.container.append(
      this.menuGradient = this.createMenuGradient(),
      navScrollableContainer,
      this.tabsContainer,
    )

    // * construct end

    // tweb `:616-621` — доскроллили до низа: догружаем ТЕКУЩУЮ вкладку.
    this.scrollable.onScrolledBottom = () => {
      if(this.mediaTab.contentTab && this.canLoadMediaTab(this.mediaTab)) {
        void this.load(true, undefined, 'bottom')
      }
    }

    this.selectTab = horizontalMenu({
      tabs: this.tabsMenu,
      content: this.tabsContainer,
      // tweb `:624-691`
      onClick: (id, _tabContent, animate) => {
        if(this.prevTabId === id && !this.skipScroll) {
          this.scrollToStart()
          return
        }

        const newMediaTab = this.mediaTabs[id]
        this.onChangeTab?.(newMediaTab)

        const fromMediaTab = this.mediaTab
        this.mediaTab = newMediaTab

        if(this.prevTabId !== -1 && animate) {
          this.onTransitionStart()
        }

        if(this.skipScroll) {
          this.skipScroll = false
        } else {
          const offsetTop = this.container.offsetTop - (this.scrollOffset || 0)
          let scrollTop = this.scrollable.scrollPosition
          if(scrollTop < offsetTop) {
            this.scrollToStart()
            scrollTop = offsetTop
          }

          fromMediaTab.scroll = { scrollTop: scrollTop, scrollHeight: this.scrollable.scrollSize }

          if(newMediaTab.scroll === undefined) {
            // Первый заход на вкладку: её «позиция» — не ноль, а расстояние от
            // верха контейнера подсистемы до верха его родителя, иначе новая
            // вкладка улетела бы вверх мимо шапки профиля (`tweb:653-661`).
            const rect = this.container.getBoundingClientRect()
            const rect2 = this.container.parentElement!.getBoundingClientRect()
            const diff = rect.y - rect2.y

            if(scrollTop > diff) {
              newMediaTab.scroll = { scrollTop: diff, scrollHeight: 0 }
            }
          }

          if(newMediaTab.scroll) {
            const diff = fromMediaTab.scroll.scrollTop - newMediaTab.scroll.scrollTop

            if(diff) {
              // Главный трюк подсистемы (`tweb:673`): физически скролл ещё стоит
              // там, где его оставила УХОДЯЩАЯ вкладка, поэтому приходящую на
              // время анимации сдвигают инлайновым `translateY` на разницу
              // позиций — визуально она «стоит на своём месте». Настоящий
              // `scrollPosition` выставляется по концу перехода (`:693-707`).
              newMediaTab.contentTab!.style.transform = `translateY(${diff}px)`
            }
          }
        }

        // tweb `:686-689` — вкладка пуста и это не первый показ: грузим её.
        if(this.prevTabId !== -1 && !newMediaTab.itemsTab!.childElementCount) {
          void this.load(true)
        }

        this.prevTabId = id
      },
      // tweb `:693-707`
      onTransitionEnd: () => {
        this.scrollable.onScroll()

        if(this.mediaTab.scroll !== undefined) {
          this.mediaTab.contentTab!.style.transform = ''
          this.scrollable.scrollPosition = this.mediaTab.scroll.scrollTop
        }

        if(unlockScroll) {
          unlockScroll()
          unlockScroll = undefined
        }

        this.onTransitionEnd()
      },
      scrollableX: navScrollable,
      listenerSetter: this.listenerSetter,
    })

    // tweb `:709-714` — перехват клика при активном выделении; выделение
    // приезжает задачей 14 вместе с `SearchSelection`.
    // tweb `:768-772` — открытие медиавьювера по клику в грид. Тело
    // обработчика — метод `onMediaClick` (расхождение 15 в шапке). Подписка
    // для документов (`:773-777`) приезжает задачей 8.
    if(this.tabs.inputMessagesFilterPhotoVideo) {
      attachClickEvent(
        this.tabs.inputMessagesFilterPhotoVideo,
        (e) => this.onMediaClick('grid-item', 'grid-item', 'inputMessagesFilterPhotoVideo', e),
        { listenerSetter: this.listenerSetter },
      )
    }

    this.mediaTab = this.mediaTabs[0]

    // tweb `:793-797` — пауза `lazyLoadQueue` на время тяжёлой анимации;
    // см. расхождение 3 в шапке файла.
  }

  /**
   * Градиент, растворяющий содержимое под липким рядом вкладок.
   * Классы — те же, что отдаёт `Tabs.MenuGradient({color: 'background',
   * className: 'search-super-tabs-gradient'})` (`tweb/src/components/tabs.tsx:71-95`),
   * сверено с дампом `07-right-sidebar.json:122-123`. Почему не через фабрику —
   * расхождение 1 в шапке файла.
   */
  private createMenuGradient() {
    const container = document.createElement('div')
    container.classList.add('menu-horizontal-gradient-container', 'search-super-tabs-gradient-container')

    const gradient = document.createElement('div')
    gradient.classList.add(
      'menu-horizontal-gradient',
      'menu-horizontal-gradient-color-background',
      'search-super-tabs-gradient',
    )

    container.append(gradient)
    return container
  }

  /** tweb `:800-807` */
  private scrollToStart() {
    // `void` — наша правка под oxlint (`no-floating-promises`); обещание
    // доводки скролла в оригинале так же никем не ожидается.
    void this.scrollable.scrollIntoViewNew({
      element: this.container,
      position: 'start',
      startCallback: this.scrollStartCallback,
      getElementPosition: this.scrollOffset ?
        ({ elementPosition }) => elementPosition - this.scrollOffset! :
        undefined,
    })
  }

  /** tweb `:809-811` — `sliding` снимает `max-height` с подсистемы на время перехода. */
  private onTransitionStart = () => {
    this.container.classList.add('sliding')
  }

  /** tweb `:813-815` */
  private onTransitionEnd = () => {
    this.container.classList.remove('sliding')
  }

  /** tweb `:817-820` — «во вкладке стало N». */
  public setCounter(type: SearchSuperMediaType, count: number) {
    this.counters[type] = count
    this.onLengthChange?.(type, count)
  }

  /**
   * tweb `:822-824` (через `filterMessagesByInputFilter`) — какие из сообщений
   * относятся к этому фильтру. Спрашивают отсюда двое: рендер из кэша
   * (`:2258`) и живой апдейт (`sharedMedia.tsx:229`), поэтому вывод один.
   * Расхождение 8 в шапке — про ветку ссылок.
   */
  public filterMessagesByType(messages: (MyMessage | undefined)[], type: SearchSuperType): MyMessage[] {
    const kinds = FILTER_KINDS[type]
    return messages.filter((message): message is MyMessage => {
      if(!message) {
        return false
      }

      if(type === 'inputMessagesFilterUrl') {
        const entities = message._ === 'message' ? message.entities : undefined
        return !!entities?.some((e) => e._ === 'messageEntityUrl' || e._ === 'messageEntityTextUrl') ||
          (message._ === 'message' && URL_IN_TEXT.test(message.message))
      }

      return !!kinds?.has(getMessageKind(message))
    })
  }

  /** tweb `:2375-2377` — счётчики нескольких вкладок ОДНИМ запросом. */
  public getSearchCounters(filters: SearchSuperType[]) {
    const { peerId } = this.searchContext
    const wire = filters.map((inputFilter) => WIRE_FILTER[inputFilter]).filter((f): f is MediaFilter => !!f)
    return this.managers.messages.searchCounters(peerId, wire).then((counters) => filters.map((inputFilter) => ({
      inputFilter,
      count: counters.find((c) => c.filter === WIRE_FILTER[inputFilter])?.count ?? 0,
    })))
  }

  /**
   * tweb `:1096-1257`. Собирает узлы по сообщениям и кладёт их в список вкладки
   * — в конец (`append`) при пагинации и в НАЧАЛО при живом апдейте.
   *
   * Расхождение 11 в шапке — про группы левой колонки. Рендер одного
   * элемента — `buildItem` (развилка по фильтру, `tweb:1143-1170`).
   */
  public async performSearchResult({ messages, mediaTab, append = true }: PerformSearchResultArgs) {
    const middleware = this.middleware.get()
    const inputFilter = mediaTab.inputFilter
    const container = inputFilter && this.tabs[inputFilter]
    if(!container) {
      return 0
    }

    await getHeavyAnimationPromise()

    const promises: Promise<unknown>[] = []

    // tweb `:1173-1186` — сообщения рендерятся ПАРАЛЛЕЛЬНО, и ошибка на одном
    // не роняет партию (расхождение 17 в шапке — про её лог).
    const results = messages.map(async(message): Promise<SearchSuperItem | undefined> => {
      try {
        return await this.buildItem({ message, middleware, promises, inputFilter, mediaTab })
      } catch {
        return undefined
      }
    })
    const elemsToAppend = (await Promise.all(results)).filter((item): item is SearchSuperItem => !!item)

    if(this.loadMutex) {
      promises.push(this.loadMutex)
    }

    if(promises.length) {
      await Promise.all(promises)
      if(!middleware()) {
        return 0
      }
    }

    const length = elemsToAppend.length
    if(length) {
      const method = append ? 'append' : 'prepend'
      // При `prepend` порядок сохраняется только обратным обходом: иначе
      // сообщения встали бы в начале списка задом наперёд.
      const ordered = append ? elemsToAppend : [...elemsToAppend].reverse()
      ordered.forEach(({ element, message }) => {
        element.classList.add('search-super-item')
        element.dataset.mid = '' + message.id
        element.dataset.peerId = '' + message.peerId
        container[method](element)
      })
    }

    this.afterPerforming(length, mediaTab)

    return length
  }

  /**
   * tweb `:1143-1170` — выбор рендерера по фильтру (там `switch` стоит прямо в
   * `performSearchResult`; здесь вынесен, чтобы ветки приезжали по одной).
   * `processDocumentFilter` (`:940-962`) и `processUrlFilter` (`:964-1094`) —
   * задачи 8-9; до них их фильтры получают голый узел, а обвязка вокруг
   * (классы, `data-mid`/`data-peer-id`, порядок вставки) уже оригинальная.
   */
  private buildItem(options: ProcessSearchSuperResult): Promise<SearchSuperItem> | SearchSuperItem {
    switch(options.inputFilter) {
      case 'inputMessagesFilterPhotoVideo':
        return this.processPhotoVideoFilter(options)

      default:
        return { element: document.createElement('div'), message: options.message }
    }
  }

  /**
   * tweb `:874-938` — плитка грида. Размер плитке задаёт CSS
   * (`.search-super-content-media-grid .grid-item`), поэтому бокс — нули, а
   * ступень выбирается заранее под 200×200 (`choosePhotoSize`) и уезжает в
   * оба враппера явно (`size`/`photoSize`). Видео — только постер: ни файла
   * (`onlyPreview`), ни кнопки воспроизведения (`noPlayButton`), ни кольца
   * (`withoutPreloader`). Расхождения 13, 16 в шапке — про крышку.
   */
  private async processPhotoVideoFilter({ message, promises, middleware }: ProcessSearchSuperResult): Promise<SearchSuperItem> {
    // фильтр пропускает только фото/видео/gif — файл у вложения есть по построению
    const media = getMediaFromMessage(message)!

    const div = document.createElement('div')
    div.classList.add('grid-item')

    let wrapped: WrappedPhoto | undefined
    const size = choosePhotoSize(media, 200, 200)
    if(media._ !== 'photo') {
      wrapped = (await wrapVideo({
        doc: media,
        message: { mid: message.id, peerId: message.peerId, date: message.date },
        container: div,
        boxWidth: 0,
        boxHeight: 0,
        lazyLoadQueue: this.lazyLoadQueue,
        middleware,
        onlyPreview: true,
        withoutPreloader: true,
        noPlayButton: true,
        photoSize: size,
      })).thumb
    } else {
      wrapped = await wrapPhoto({
        photo: media,
        container: div,
        boxWidth: 0,
        boxHeight: 0,
        lazyLoadQueue: this.lazyLoadQueue,
        middleware,
        withoutPreloader: true,
        noBlur: true,
        size,
      })
    }

    if(isMediaSpoiler(message)) {
      const mediaSpoiler = await wrapMediaSpoiler({
        animationGroup: 'chat',
        media,
        middleware,
        width: 140,
        height: 140,
      })

      // без stripped-ступени крышки нет (`wrapMediaSpoiler` отдаёт `undefined`)
      if(mediaSpoiler) {
        div.append(mediaSpoiler)
      }
    }

    // `thumb` у видео есть всегда: постер в ветке `onlyPreview` строится без
    // условий (`wrappers/video.ts`), а у фото это сам результат `wrapPhoto`
    if(wrapped) {
      [
        wrapped.images.thumb,
        wrapped.images.full,
      ].filter((image): image is NonNullable<typeof image> => !!image).forEach((image) => {
        image.classList.add('grid-item-media')
      })

      promises.push(wrapped.loadPromises.thumb)
    }

    return { element: div, message }
  }

  /**
   * tweb `:716-767` — клик по медиа во вкладке. Крышка спойлера перехватывает
   * первый клик (`:726-733`); иначе открывается вьювер, и ЛИСТАЕТ ОН ПО
   * ЭЛЕМЕНТАМ ЭТОЙ ВКЛАДКИ (`:740-751`), а не по ленте чата. Расхождения
   * 13-15 в шапке.
   */
  private onMediaClick(className: string, targetClassName: string, inputFilter: SearchSuperType, e: MouseEvent) {
    const target = findUpClassName(e.target as HTMLElement, className)
    if(!target) return

    const mid = +target.dataset.mid!
    if(!mid) {
      return
    }

    const mediaSpoiler = target.querySelector<HTMLElement>('.media-spoiler-container')
    if(mediaSpoiler) {
      onMediaSpoilerClick({
        event: e,
        mediaSpoiler,
      })
      return
    }

    const peerId = +target.dataset.peerId!
    const message = getSharedMediaMessage(peerId, mid)
    if(!message) {
      return
    }

    const container = this.tabs[inputFilter]!
    const targets = Array.from(container.querySelectorAll<HTMLElement>('.' + targetClassName)).map((el) => {
      const containerEl = findUpClassName(el, className)!
      return {
        element: el,
        message: getSharedMediaMessage(+containerEl.dataset.peerId!, +containerEl.dataset.mid!),
      }
    }).filter((t): t is { element: HTMLElement, message: MyMessage } => !!t.message)

    const ctx = this.lightboxCtx(targets.map((t) => t.message))
    const items = targets.map((t) => messageToViewerItem(t.message, ctx, t.element))
    const idx = items.findIndex((item) => item.mid === mid)

    void openMediaViewer({
      items,
      index: idx,
      target: items[idx].element!,
      // порядок вкладки — newest-first (`ORDER BY seq DESC`), это и есть
      // порядок листания вьювера (см. докблок `OpenMediaViewerArgs.reverse`)
      reverse: false,
      loadMoreMedia: this.loadMoreMedia(inputFilter, className),
    })
  }

  /**
   * Роль `copySearchContext` → `setSearchContext` (`tweb:757`, `:2795-2801`):
   * за пределы отрисованных плиток вьювер листает той же ручкой, что и
   * вкладка. Расхождение 14 в шапке.
   */
  private loadMoreMedia(inputFilter: SearchSuperType, className: string): OpenMediaViewerArgs['loadMoreMedia'] {
    const { peerId } = this.searchContext
    const wireFilter = WIRE_FILTER[inputFilter]!
    const loader = createMediaNeighboursLoader({
      fetchPage: async(offsetId, limit) =>
        (await this.managers.messages.mediaHistory(peerId, wireFilter, offsetId, limit)).messages,
    })

    return async(older: boolean, anchor: ViewerItem | undefined, loadCount: number) => {
      if(!anchor) return []
      try {
        const slice = await loader.neighbours(anchor.mid, older, loadCount)
        const ctx = this.lightboxCtx(slice)
        const container = this.tabs[inputFilter]!
        // сосед может быть уже отрисован (плитка ниже кликнутой) — тогда полёт
        // закрытия летит в неё; иначе `element: null`, как у tweb `processItem`
        return slice.map((m) => messageToViewerItem(
          m, ctx, container.querySelector<HTMLElement>(`.${className}[data-mid="${m.id}"]`),
        ))
      } catch {
        return [] // ошибка сети = край списка: вьювер листает уже загруженное
      }
    }
  }

  /**
   * Контекст авторов для подписей вьювера — как у ленты
   * (`chat/bubbles.ts::openMediaViewerFor`): карточки пиров точечно из зеркала.
   */
  private lightboxCtx(messages: readonly MyMessage[]): LightboxCtx {
    const peers = new Map<PeerId, NonNullable<ReturnType<typeof cachedPeer>>>()
    for(const m of messages) {
      const fromId = m.fromId
      if(fromId == null || peers.has(fromId)) continue
      const peer = cachedPeer(fromId)
      if(peer) peers.set(fromId, peer)
    }

    return {
      meId: rootScope.myId,
      peers,
      lang: useI18nStore.getState().lang,
    }
  }

  /** tweb `:1259-1283`. */
  private afterPerforming(length: number, mediaTab: SearchSuperMediaTab) {
    const contentTab = mediaTab.contentTab
    if(!contentTab) {
      return
    }

    if(mediaTab.hideOn) {
      mediaTab.hideOn.classList.remove('hide')
    }

    // Всё, что лежит в родителе ПОСЛЕ содержимого вкладки, — это прелоадер и
    // прошлая заглушка «ничего не найдено»; их снимает первый же результат.
    const parent = contentTab.parentElement!
    Array.from(parent.children).slice(1).forEach((child) => {
      child.remove()
    })

    if(!length && !mediaTab.itemsTab!.childElementCount) {
      const div = document.createElement('div')
      div.append(i18n('Chat.Search.NothingFound'))
      div.classList.add('position-center', 'text-center', 'content-empty', 'no-select')

      parent.append(div)
    }
  }

  /**
   * tweb `:2362-2369`. Ветка подарков (`stargiftsStore`) приедет задачей 12.
   */
  private canLoadMediaTab(mediaTab: SearchSuperMediaTab) {
    const inputFilter = mediaTab.inputFilter
    const history = inputFilter && this.historyStorage[inputFilter]
    return !this.loaded[mediaTab.type] ||
      (!!history && !!inputFilter && this.usedFromHistory[inputFilter]! < history.length)
  }

  /**
   * tweb `:2181-2360` — загрузка ОДНОЙ вкладки. Три существенных свойства
   * оригинала, каждое из которых у нас прежде отсутствовало:
   *
   *  1. ДЕДУПЛИКАЦИЯ (`:2192-2195`): пока обещание типа живо, второй запрос не
   *     уходит — возвращается то же обещание.
   *  2. РЕНДЕР ИЗ КЭША (`:2245-2276`): если в списке фильтра есть неотрисованный
   *     хвост, порция берётся ИЗ НЕГО, и сети не будет вовсе.
   *  3. ПАГИНАЦИЯ КУРСОРОМ (`:2278-2291`): следующая страница просится по id
   *     последнего элемента списка, а не по его длине.
   */
  private loadType(options: SearchSuperLoadTypeOptions): Promise<unknown> {
    const { mediaTab, justLoad, loadCount, middleware } = options
    const { type, inputFilter } = mediaTab

    const running = this.loadPromises[type]
    if(running) {
      return running
    }

    // Типы без фильтра сообщений (участники, подарки, сохранённые…) — задачи
    // 11-12; у оригинала здесь развилка `:2197-2227`.
    const wireFilter = inputFilter && WIRE_FILTER[inputFilter]
    if(!inputFilter || !wireFilter) {
      return Promise.resolve()
    }

    const history = this.historyStorage[inputFilter] ??= []

    const promise: Promise<unknown> = this.loadPromises[type] = Promise.resolve().then(async() => {
      // 2 — рендер из кэша
      if(history.length && this.usedFromHistory[inputFilter]! < history.length && !justLoad) {
        const messages: MyMessage[] = []
        let used = Math.max(0, this.usedFromHistory[inputFilter]!)
        let slicedLength = 0

        do {
          const ids = history.slice(used, used + loadCount)
          used += ids.length
          slicedLength += ids.length

          messages.push(...this.filterMessagesByType(
            ids.map((m) => getSharedMediaMessage(m.peerId, m.mid)),
            inputFilter,
          ))
        } while(slicedLength < loadCount && used < history.length)

        this.usedFromHistory[inputFilter] = used
        return this.performSearchResult({ messages, mediaTab }).finally(() => {
          setTimeout(() => {
            this.scrollable.checkForTriggers?.()
          }, 0)
        })
      }

      // 3 — курсор: id последнего уже загруженного (`tweb:2278-2279`)
      const lastItem = history[history.length - 1]
      const offsetId = lastItem?.mid || 0

      const value = await this.managers.messages.mediaHistory(
        this.searchContext.peerId, wireFilter, offsetId, loadCount,
      )
      const messages = value.messages
      saveSharedMediaMessages(messages)

      history.push(...messages.map((m) => ({ mid: m.id, peerId: m.peerId })))

      if(!this.counters[type]) {
        this.setCounter(type, value.count)
      }

      if(!middleware()) {
        return
      }

      // `tweb:2310-2319`, первая ветка — единственная применимая к нашей ручке
      // (расхождение 9 в шапке).
      if(messages.length < loadCount) {
        this.loaded[type] = true
      }

      if(justLoad) {
        return
      }

      this.usedFromHistory[inputFilter] = history.length

      // `tweb:2329-2348` — отложенная предзагрузка следующей страницы: пока
      // пользователь смотрит на эту, следующая уже едет.
      if(!this.loaded[type]) {
        void promise.then(() => {
          setTimeout(() => {
            if(!middleware()) return
            if(this.mediaTab === mediaTab) {
              const preload = this.load(true, true)
              void preload?.then(() => {
                if(!middleware()) return
                setTimeout(() => {
                  this.scrollable.checkForTriggers?.()
                }, 0)
              })
            }
          }, 0)
        })
      }

      return this.performSearchResult({
        messages: this.filterMessagesByType(messages, inputFilter),
        mediaTab,
      })
    }).catch(() => {
      // Оригинал логирует (`:2353-2354`); логгера у подсистемы нет — ошибка
      // сети означает «страница не приехала», и вкладка останется как есть.
    }).finally(() => {
      this.loadPromises[type] = null
    })

    return promise
  }

  /**
   * tweb `:2531-2576`. `single` — только текущая вкладка, иначе все остальные
   * (предзагрузка соседних). `justLoad` — набить кэш, ничего не рисуя.
   *
   * Блок `firstLoad`/`loadFirstTime` (`:2536-2544`) приезжает задачей 10 вместе
   * с самим `loadFirstTime`; сюда встанет ровно перед выбором вкладок.
   */
  public load(single = false, justLoad = false, side: 'top' | 'bottom' = 'bottom') {
    const middleware = this.middleware.get()

    let toLoad = single ? [this.mediaTab] : this.mediaTabs.filter((t) => t !== this.mediaTab)
    toLoad = toLoad.filter((mediaTab) => this.canLoadMediaTab(mediaTab))

    // `tweb:2551-2555` — «участники» у пользователя и «общие группы» у чата
    // выбрасываются здесь; обе вкладки приезжают задачами 11-12.

    if(!toLoad.length) {
      return
    }

    const loadCount = justLoad ? 50 : Math.round((windowSize.height / 130 | 0) * 3 * 1.25)

    const promises = toLoad.map((mediaTab) => this.loadType({
      mediaTab,
      justLoad,
      loadCount,
      middleware,
      side,
    }))

    return Promise.all(promises).then(() => undefined)
  }

  /**
   * tweb `:2714-2754`. Помечает всё загруженное недействительным, НО САМ КЭШ
   * СООБЩЕНИЙ НЕ ТРЁТ: `usedFromHistory[filter] = -1` значит «из кэша ничего не
   * отрисовано», а не «кэша нет» — вернувшись к тому же пиру, вкладки
   * нарисуются без сети (`tweb:2239-2276`).
   *
   * Не портировано (нечего сбрасывать до своих задач): `loadedChats`/
   * `nextRates`/`firstLoad`/`loadFirstTimePromise` (`:2717-2719`, `:2746`) —
   * задача 10 и расхождение 9; отмена выделения (`:2735-2737`) — задача 14;
   * состояние участников (`:2749-2753`) — задача 11.
   */
  public cleanup() {
    this.loadPromises = {}
    this.loaded = {}
    this.prevTabId = -1
    this.counters = {}

    this.lazyLoadQueue.clear()

    this.mediaTabs.forEach((mediaTab) => {
      const { inputFilter } = mediaTab
      if(!inputFilter) {
        return
      }

      this.usedFromHistory[inputFilter] = -1
    })

    this.middleware.clean()
    this.cleanScrollPositions()
  }

  /**
   * tweb `:2756-2760`. Зовётся СНАРУЖИ при выходе из полноэкранного режима
   * shared media (`sharedMedia.tsx:515`): геометрия поменялась, и запомненные
   * позиции больше ни о чём не говорят.
   */
  public cleanScrollPositions() {
    this.mediaTabs.forEach((mediaTab) => {
      mediaTab.scroll = undefined
    })
  }

  /**
   * tweb `:2762-2793`. Возвращает разметку в состояние «ещё ничего не
   * показывали»: списки пусты, карточки секций снова скрыты, у вкладок без
   * кэша крутится прелоадер, скролл — в начало.
   *
   * `searchGroupMedia.clear()` (`:2791`) пропущен — расхождение 4 в шапке.
   */
  public cleanupHTML() {
    this.mediaTabs.forEach((tab) => {
      tab.itemsTab!.replaceChildren()

      if(tab.hideOn) {
        tab.hideOn.classList.add('hide')
      }

      if(this.hideEmptyTabs) {
        this.container.classList.add('hide')
        this.container.parentElement?.classList.add('search-empty')
      }

      if(tab.type === 'chats') {
        return
      }

      if(tab.inputFilter && !this.historyStorage[tab.inputFilter]) {
        const parent = tab.contentTab!.parentElement!
        if(!parent.querySelector('.preloader')) {
          putPreloader(parent, true)
        }

        const empty = parent.querySelector('.content-empty')
        empty?.remove()
      }
    })

    this.scrollable.scrollPosition = 0
  }

  /**
   * tweb `:2803-2826`. Пересобирает контекст поиска, ПОДМЕНЯЕТ кэш на
   * переданный снаружи (кэш принадлежит обвязке и живёт по пирам) и зовёт
   * `cleanup()`. Загрузку НЕ запускает — это ответственность вызывающего.
   */
  public setQuery({ peerId, query, threadId, historyStorage, folderId, minDate, maxDate }: {
    peerId: PeerId
    query?: string
    threadId?: number
    historyStorage?: AppSearchSuper['historyStorage']
    folderId?: number
    minDate?: number
    maxDate?: number
  }) {
    this.searchContext = {
      peerId,
      query: query || '',
      inputFilter: { _: this.mediaTab.inputFilter },
      threadId,
      folderId,
      minDate,
      maxDate,
    }

    this.historyStorage = historyStorage ?? {}

    this.cleanup()
  }

  /**
   * tweb `:2828-2843`.
   *
   * `this.scrollable.destroy()` — дословно как в оригинале (`:2831`), НО у нас
   * скроллер чужой: см. расхождение 7 в шапке файла (правило «уничтожается
   * только если создан и принадлежит классу» сейчас НЕ соблюдено, развилка —
   * задача 13 плана). `container.remove()` и несброшенный `selectTab` —
   * расхождение 8.
   */
  public destroy() {
    this.cleanup()
    this.listenerSetter.removeAll()
    this.scrollable.destroy()
    this.swipeHandler?.removeListeners()

    // Расхождение 2 в шапке: корни Solid-секций утилизируются, чтобы
    // `destroy()` не оставлял следов.
    this.disposeSections.forEach((dispose) => dispose())
    this.disposeSections.length = 0

    this.container.remove()

    this.scrollStartCallback =
      this.onChangeTab =
      this.swipeHandler =
        undefined
  }
}
