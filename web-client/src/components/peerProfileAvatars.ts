// src/components/peerProfileAvatars.ts
//
// Карусель аватаров шапки профиля — порт tweb `src/components/
// peerProfileAvatars.ts` (класс `PeerProfileAvatars`, 974 строки). Разбор с
// адресами — `docs/tweb/right-sidebar.md` § 3.3 и § 5.1.
//
// ЭТО ЗАДАЧИ 1-6 из шести (`docs/superpowers/plans/
// 2026-09-05-profile-avatars-class.md`): каркас (поля, конструктор, DOM,
// `addTab()`, `setCollapsed`/`isCollapsed`/`updateHeaderFilled`, `cleanup()`,
// задача 1) плюс данные и лента (`ListLoader`, `processItem`, ленивая
// догрузка, `onJump`, `goWithoutTransition`, задача 2) плюс жесты (задача 3):
// зоны клика (`attachClickEvent`, зоны `SWITCH_ZONE`, закольцовывание,
// открытие просмотрщика через общий `openMediaViewer`), свайп через порт
// `SwipeHandler` (`core/dom/swipeHandler.ts`) и rAF-цикл прогресса полоски у
// видео-аватара. Плюс контракт сворачивания под внешний `useCollapsable`
// (задача 4): конструктор принимает `unfold` (ОБЯЗАТЕЛЬНЫЙ, см. докблок поля
// ниже), клик при `is-collapsed` зовёт его, а НЕ трогает `is-collapsed` сам —
// это делает владелец состояния СНАРУЖИ (см. «Осознанное отступление» и
// докблок клика).
// Задача 5 смонтировала класс: `UserInfoPanel.tsx` через `useImperativeIsland`
// (host: чужой ref, `strays` чистит `instance.container` на teardown) плюс
// реальный `useCollapsable()` — эффект `folded → setCollapsed(folded)` (с
// гейтом «нет фото → держать свёрнутым», см. геттер `hasPhoto` ниже) живёт
// снаружи, в панели. Задача 6 (последняя из плана, не код) — долги/
// документация/живая проверка на стенде. Задача 7 (добавлена ПОСЛЕ живой
// проверки, живьём «minor»-долг оказался видимой поломкой шапки) закрыла один
// из долгов, найденных задачей 6: первый элемент ленты рисует `avatarNew` c
// `size: 'full'` (было `120` — квадрат 360×360 показывал фото 120×120 по
// центру), см. `processItem` ниже.
//
// ─── Осознанное отступление: кто владеет useCollapsable (задача 4) ─────────
// В tweb хук — на Solid и создаётся ПРЯМО В КОНСТРУКТОРЕ через `createRoot`
// (tweb :322-348): `const {folded, unfold, fold} = useCollapsable({...})`,
// класс сохраняет `unfold`/`fold` СЕБЕ (`:63,67`) и эффектом же
// (`createEffect(() => this.setCollapsed(folded()))`, :340-348) приводит DOM
// в соответствие. Наш `useCollapsable` (`core/hooks/useCollapsable.ts`, 229
// строк) — React-хук (`useState`/`useRef`, строка 21): он писался под
// React-потребителя `components/StoriesRow.tsx`, и класс на Solid не сидит.
// Поэтому здесь хук зовёт ВНЕШНИЙ React-компонент (обёртка правой панели,
// задача 5) и толкает состояние в класс через уже публичный `setCollapsed`
// (см. его докблок), а `unfold` он же передаёт СЮДА через конструктор готовой
// функцией — класс её только использует, не создаёт. `fold` внутрь класса
// сознательно НЕ заведён — см. докблок поля `unfold` в теле класса, там же
// причина и отсылка к задаче 5. Сведение к устройству оригинала (хук внутри
// Solid-компонента-владельца) — шаг 2 этапа 2 (Solid-порт `peerProfile.tsx`);
// долг — `web-client/backlogs/frontend/collapsable-solid-owner.md`.
//
// Сигналы, из которых задача 5 собрала `useCollapsable(...)` в `UserInfoPanel.tsx`
// (прочитаны из `core/hooks/useCollapsable.ts` целиком, `CollapsableOptions`)
// и как они легли на ЭТОТ класс (tweb :322-348 — та же связка):
//   • `scrollable: () => HTMLElement | null`      → `() => scrollableEl`
//     (в конструктор приходит уже готовый DOM-узел, см. ниже);
//   • `listenWheelOn: () => HTMLElement | null`   → `() => setCollapsedOn`
//     (tweb передаёт то же самое: `listenWheelOn: this.setCollapsedOn`);
//   • `container: () => HTMLElement | null`       → `() => instance.container`
//     (публичное поле этого класса — на нём хук слушает transitionstart/end);
//   • `shouldIgnore?: () => boolean`               → у нас предмета нет
//     (в tweb — `this.uploadInProgress`, прогресс своей загрузки не
//     портирован, см. таблицу «Что не портируем» плана этапа); можно не
//     передавать вовсе.
//
// DOM (конструктор, tweb :81-109), порядок детей дословный:
//
//   div.profile-avatars-container
//     ├ div.profile-avatars-avatars       (флекс-лента фото, наполняет processItem)
//     ├ div.profile-avatars-gradient
//     ├ div.profile-avatars-gradient-top
//     ├ div.profile-avatars-tabs          (полоски-индикаторы; `addTab()`)
//     ├ div.profile-avatars-arrow         (prev)
//     ├ div.profile-avatars-arrow-next
//     └ div.profile-avatars-info          (пустой узел; контент — Solid,
//                                          см. ниже про владельца контента)
//
// ─── Зависимости через конструктор ──────────────────────────────────────────
// Как у `components/avatar.ts:104` — `managers` приходит опцией, тип узкий
// (`AvatarManagers`, а не весь фасад `AppManagers`). `setCollapsedOn` — узел,
// на который вешаются `is-collapsed`/`need-white`/`header-filled` (у tweb это
// `tab.container`, у нас — узел вкладки правой панели); `scrollableEl` — DOM
// узел скролл-контейнера, а НЕ инстанс нашего `components/scrollable.ts`:
// `Scrollable` разрешено инстанцировать РОВНО в одном месте (лента чата,
// `web-client/CLAUDE.md` § «Скролл»), заводить второй владелец скролла здесь
// нельзя. Оригинал читает `this.scrollable.scrollPosition`
// (`scrollable.ts:370-375` — это и есть `container[scrollPositionProperty]`,
// для вертикального скроллера `scrollTop`, `scrollable.ts:440`), поэтому чтение
// сырого `scrollableEl.scrollTop` даёт то же значение без второго инстанса.
// `unfold` (задача 4, обязателен начиная с задачи 5) — единственный источник
// разворачивания при клике по свёрнутой шапке, приходит готовой функцией из
// `useCollapsable()` владельца (`UserInfoPanel.tsx`), см. докблок клика в
// конструкторе ниже. `fold` не заведён вовсе — см. докблок поля `unfold` в
// теле класса.
//
// ─── Что НЕ портировано в этой задаче (и почему) ───────────────────────────
//  • Фон-паттерн профиля (`_applyAppearance`/`applyAppearance`, :652-793,
//    вызов в `setPeer` :390) — у нас нет ни `wrapEmojiPattern`, ни
//    `profile_color`; долг — `web-client/backlogs/frontend/
//    profile-appearance-emoji-pattern.md` (заведёт задача 6). Поле
//    `hasBackgroundColor` при этом остаётся — от него зависят пороги
//    `updateHeaderFilled`/`need-white`, — просто у нас оно всегда `false`.
//  • `changeTitleEmojiColor(this.info, …)` (:940) — красит кастом-эмодзи в
//    имени пира при смене `need-white`; функция ещё не портирована
//    (tweb `peerTitle.ts:236`) — не портирована сама функция (кастом-эмодзи
//    в имени пира красить нечем), а не то, что в `.info` нечего красить: имя/
//    статус там ЕСТЬ (задача 5 портальнула их туда React'ом из `UserInfoPanel.
//    tsx` — см. докблок поля `info` выше), просто без этой конкретной покраски.
//    Строка не вызывается, а не заглушена.
//  • Ветка топика (:396-400) — единственная ветка `setPeer`, которую задача 1
//    рисует: у темы форума нет истории фото, поэтому карусели и `ListLoader`
//    нет, только один аватар. СЕГОДНЯ НЕДОСТИЖИМА: ни один вызывающий threadId
//    в `setPeer` не передаёт (`UserInfoPanel.tsx` его не знает вовсе) —
//    портирована на будущее. Оригинал рисует
//    аватар через `processItem` (:807-861, `avatarNew({size:120,...}).render(
//    {peerId, threadId})`) — `threadId` уходит в render и превращает узел в
//    иконку темы форума; у нашего порта `avatarNew` (`components/avatar.ts`)
//    threadId не принимает вовсе и тем форума не знает (уже объявленный вычет
//    в самом avatar.ts: «топики форума... — ни того, ни другого в модели
//    нет»), поэтому у вызова ниже вместо иконки темы встаёт обычный аватар
//    пира — разбор и критерий закрытия у самой строки вызова и в
//    `web-client/backlogs/frontend/profile-topic-avatar.md`.
//  • Задача 2 (данные и лента, `setPeer` без threadId): история фото
//    группы/канала (ручки нет вовсе, tweb :443-499) — показываем только
//    текущее фото, долг `web-client/backlogs/frontend/
//    profile-chat-photo-history.md`; видео-аватар в галерее (провод теряет
//    `videoMediaId`, см. комментарий у ветки в `processItem`); пагинация — `loadMore` отдаёт одну
//    страницу (ручка не постраничная).
//  • Задача 3 (жесты, tweb :127-298):
//    — `uploadInProgress`/`fakeAvatar`/`has-stories` (:160-179, :271-274)
//      клика не портированы — предмета (прогресс своей загрузки, кольца
//      историй) нет вовсе, это уже объявленные вычеты выше и в плане этапа
//      («Что НЕ портируем» плана `2026-09-05-profile-avatars-class.md`);
//    — `findUpClassName(_e.target, 'profile-subtitle-rating' | 'emoji-status')`
//      (tweb :143-148) не портирован: ни рейтинга в подзаголовке, ни
//      custom-emoji статуса в шапке у нас нет вовсе — узлов с этими классами
//      не существует НИГДЕ в дереве, и мёртвая ветка-guard нарушала бы
//      «мёртвый код удалять агрессивно» (корневой CLAUDE.md), в отличие от
//      ветки топика (задача 1), которая жива через собственный параметр
//      `setPeer(peerId, threadId)`. Если рейтинг/статус появятся — guard
//      возвращается вместе с ними;
//    — `freeze` (tweb :141, :150-153, :212-221) не портирован: в оригинале
//      это synchronous true→false БЕЗ единого await между ними (сам вызов
//      `openAvatarViewer` не awaited) — понаблюдать значение `true` неоткуда,
//      это уже мёртвая в самом tweb защита от несуществующей реентерабельности
//      (наш `openMediaViewer.ts` и так не даёт открыть второй вьювер —
//      модульный синглтон `if (current) return`, `openMediaViewer.ts:40`);
//    — `hasNoPhoto` (:170-172, `= !photo` из `getPeerPhoto` пира, :380) —
//      портирован полем `currentHasPhoto` (см. докблок поля): читает ЛОКАЛЬНОЕ
//      зеркало пиров (`getPeerPhoto`/`getPeerPhotoId`, тот же путь, каким
//      `avatarNew`/`putAvatar` решает «фото или кружок с инициалами»,
//      `components/avatar.ts:220-221`), а НЕ `listLoader.current === undefined`
//      — РАУНД ПРАВОК 1 нашёл эту более раннюю версию неверной: для
//      группы/канала (`setPeer` без threadId, не-пользователь) исторической
//      галереи нет вовсе (`items = []` всегда, ручки нет, tweb :443-499), то
//      есть `listLoader.current` там ВСЕГДА `undefined` — ДАЖЕ когда у чата
//      реально ЕСТЬ аватар (isFirst-ветка `processItem` рисует его зеркалом);
//      прежний гейт гасил клик для любого такого чата целиком (не
//      разворачивал свёрнутую шапку, не открывал вьювер). Открытие вьювера
//      для пира без галереи (но с фото) — тоже РАУНД ПРАВОК 1, единственный
//      элемент собирается из ТЕКУЩЕГО фото пира (`openViewer`/
//      `buildViewerItemFromCurrentPhoto`), а не из `ProfilePhoto` галереи;
//    — «трети» экрана НЕ требуют отдельных JS-обработчиков на
//      `.profile-avatars-arrow`/`-arrow-next`: стрелки СТРОГО декоративны и
//      позиционированы CSS по краям контейнера (`_profile.scss:330-372`,
//      `left:0`/`right:0`), видимость — тоже CSS (`is-single`/`is-swiping`/
//      hover, `_profile.scss:26-42`); клик по стрелке доходит до ТОГО ЖЕ
//      контейнерного слушателя зон, что и клик по остальной трети;
//    — `openAvatarViewer(...)` (:185-221) — специализированного вьювера
//      аватаров у нас нет, общий `openMediaViewer` (см. `openViewer()` ниже);
//    — checkScrollTop (:127-137) не зовёт второй `Scrollable` (докблок класса
//      выше запрещает второй инстанс) — `scrollableEl.scrollTo(...)`, нативный
//      API, а не буквальная запись `scrollTop =` (`core/scrollWriters.test.ts`
//      сканирует только последнюю форму).
import { avatarNew, type AvatarManagers } from '@components/avatar'
import Icon from '@components/icon'
import animationIntersector from '@components/animationIntersector'
import ListLoader from '@components/mediaViewer/listLoader'
import { openMediaViewer } from '@components/mediaViewer/openMediaViewer'
import type { ViewerItem } from '@components/mediaViewer/appMediaViewer'
import SwipeHandler from '@core/dom/swipeHandler'
import ListenerSetter from '@helpers/listenerSetter'
import { fastRaf } from '@helpers/schedulers'
import { renderImageFromUrlPromise } from '@helpers/dom/renderImageFromUrl'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import cancelEvent from '@helpers/dom/cancelEvent'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import { isUser, toUserId } from '@core/peers/peerId'
import { getPeerPhoto, getPeerPhotoId } from '@core/peers/peer'
import { cachedPeer, peerTitle } from '@core/peerCache'
import { ensureMediaUrl } from '@core/media/ensureMediaUrl'
import { resolveStreamUrl } from '@core/mediaUrl'
import type { ProfilePhoto } from '@core/managers/profileManager'

// tweb :38-39 — модульные константы. `LOAD_NEAREST` читает ленивая
// догрузка (processItem/loadNearestToTarget), `SHOW_NO_AVATAR` — setPeer;
// оба заводит эта задача (первый читатель, см. докблок класса выше).
const LOAD_NEAREST = 3
/** tweb :39 — захардкожено `true` и в оригинале: ветка `!SHOW_NO_AVATAR`
 *  ниже недостижима и там же, это не наше упрощение. */
const SHOW_NO_AVATAR = true

/**
 * Срез менеджеров задачи 2 — расширяет `AvatarManagers` (аватар пира,
 * `components/avatar.ts`) списком фотогалереи пользователя. URL КОНКРЕТНОЙ
 * исторической фотографии/видео-аватарки в этот срез НЕ входит: `avatarNew`
 * их нарисовать не может (он всегда зеркалит ТЕКУЩИЙ аватар пира, см. докблок
 * `processItem`), но и напрямую `managers.media.*` за ними ходить нельзя —
 * `web-client/CLAUDE.md` § «Медиа-слой» отводит это владельцу через
 * ЕДИНСТВЕННЫЕ точки входа: `core/media/ensureMediaUrl` (картинки,
 * `core/noDuplicateMediaUrl.test.ts` держит список) и `core/mediaUrl`
 * (`resolveStreamUrl`, видео/аудио-стрим) — их и зовёт `processItem` напрямую.
 */
export interface PeerProfileAvatarsManagers extends AvatarManagers {
  profile: { listPhotos(userId: number): Promise<ProfilePhoto[]> }
}

export default class PeerProfileAvatars {
  // tweb :42.
  private static readonly BASE_CLASS = 'profile-avatars'
  // tweb :43-44 — статические поля класса (в отличие от LOAD_NEAREST/
  // SHOW_NO_AVATAR, которые у оригинала модульные, см. выше).
  private static readonly SCALE = 1
  private static readonly TRANSLATE_TEMPLATE = 'translate({x}, 0)'

  public readonly container: HTMLElement
  private readonly avatars: HTMLElement
  private readonly gradient: HTMLElement
  private readonly gradientTop: HTMLElement
  // Публичный (как tweb `:49`, `public info`) — узел пуст, класс сам его не
  // наполняет (имени/статуса пира здесь предмета нет — `chat.name`/бейджи
  // живут во ViewModel панели, не в этом классе). Содержимое (`.profile-name`/
  // `.profile-subtitle`) сюда кладёт Solid-компонент `peerProfile.solid.tsx`
  // (`Name`/`Subtitle`) через мост `mountSolid` — узел передаётся туда пропом
  // `avatarsInfo` из `UserInfoPanel.tsx` (докблок `avatarsHostRef` там же);
  // ЕДИНСТВЕННЫЙ писатель узла — этот мост, React в `info` не пишет вовсе
  // (правило владения узла, план «карточка профиля на Solid», шапка; было
  // React-порталом до задачи 3 профиля на Solid — с неё владелец сменился).
  // Класс владеет ТОЛЬКО структурным DOM (tweb :81-109), контент пира —
  // по-прежнему не его забота.
  public readonly info: HTMLElement
  private readonly tabs: HTMLDivElement
  private readonly arrowPrevious: HTMLElement
  private readonly arrowNext: HTMLElement

  private readonly listenerSetter: ListenerSetter
  private readonly middlewareHelper: MiddlewareHelper
  private readonly managers: PeerProfileAvatarsManagers
  private readonly setCollapsedOn: HTMLElement
  private readonly scrollableEl: HTMLElement

  // tweb :63 (`private unfold`) — там поле СОЗДАЁТ сам класс (`createRoot` в
  // конструкторе, :322-348); у нас useCollapsable — React-хук, которым
  // владеет ВНЕШНИЙ React-компонент (см. докблок класса, «Осознанное
  // отступление»), поэтому функция приходит СЮДА уже готовой через
  // конструктор — класс её только вызывает, не создаёт. ОБЯЗАТЕЛЬНЫЙ параметр
  // начиная с задачи 5 (`UserInfoPanel.tsx` встраивает класс через
  // `useImperativeIsland` вместе с реальным `useCollapsable()` и передаёт её
  // `unfold` сюда безусловно) — временная ветка клик-хендлера «без unfold»
  // (жила в задаче 4, класс разворачивал себя сам) снесена вместе со своим
  // тестом, единственный вызывающий (`UserInfoPanel.tsx`) всегда её передаёт.
  //
  // `fold` (tweb :67, `private fold`) — брифом задачи 4 предлагался как
  // симметричный параметр, но СОЗНАТЕЛЬНО не заведён: у оригинала единственный
  // вызов `this.fold?.()` живёт в `showUploadProgress` (:567) — прогресс своей
  // загрузки не портирован (докблок класса выше); а реактивный гейт
  // `hasNoPhoto && !folded() → fold()` (createEffect, tweb :341-344) — часть
  // ИМЕННО того эффекта, которым владеет внешний React-компонент (задача 5,
  // `UserInfoPanel.tsx`, см. «Осознанное отступление»), а не этот класс: гейт
  // читает публичный геттер `hasPhoto` этого класса (см. ниже) и сам решает,
  // звать ли `fold()` своего `useCollapsable()`. Внутри класса вызывающего для
  // `fold` нет и не появится в объёме этой задачи — сохранённое, но никогда не
  // читаемое поле было бы ровно тем стабом, который запрещает корневой
  // CLAUDE.md («не оставлять заглушки»), и его же ловит tsc (`noUnusedLocals`
  // красит непрочитанное `private`-поле классов). Если класс когда-нибудь
  // заведёт собственный вызывающий — параметр добавляется одной строкой; до
  // тех пор владелец хука держит свой `fold` сам и вызывает его напрямую,
  // минуя класс.
  private readonly unfold: (e?: { preventDefault: () => void; stopPropagation: () => void }) => void

  // tweb :56 — общий на всю ленту, создаётся один раз в конструкторе (не
  // per-setPeer): наблюдает узлы, ждущие ленивой догрузки (processItem),
  // колбэк — loadNearestToTarget.
  private readonly intersectionObserver: IntersectionObserver
  // tweb :57 (this.loadCallbacks) — узел ленивого элемента → его загрузчик;
  // снимается по мере догрузки (loadNearestToTarget) и целиком на cleanup
  // через смену пира (полностью новая Map при каждом setPeer).
  private readonly loadCallbacks = new Map<Element, () => void | Promise<void>>()
  // tweb :49 (this.listLoader) — задаётся заново каждым непустым setPeer;
  // goWithoutTransition читает текущий.
  private listLoader?: ListLoader<ProfilePhoto, ProfilePhoto>

  // См. докблок выше — у нас фон-паттерн профиля не портирован, значение
  // всегда false, но поле реальное: от него зависят пороги ниже (tweb :930).
  private readonly hasBackgroundColor = false

  // this.threadId оригинала (:378) здесь НЕ заведён и задачей 3 тоже — на
  // него читателя нет (топик-ветка `setPeer` не хранит его дальше своего
  // тела). this.peerId (:377) — ЗАВЕДЁН задачей 3 (`currentPeerId` ниже):
  // клику/свайпу нужен peerId «что СЕЙЧАС показано» (просмотрщик, тесты
  // ниже), а не «чей был КОНКРЕТНЫЙ вызов setPeer» (тот случай по-прежнему
  // закрывают локальные параметры/замыкания внутри самого setPeer, см. его
  // тело). Гонки нет: как и в оригинале (:377-378), присваивание —
  // синхронная первая строка setPeer, до единого await.
  private currentPeerId?: PeerId

  // tweb :384 (`this.hasNoPhoto = !photo`, photo — из `getPeerPhoto` пира,
  // :380). РАУНД ПРАВОК 1: раньше здесь читали `listLoader.current !==
  // undefined` — казалось эквивалентом (см. был докблок класса), но это
  // НЕВЕРНО для группы/канала: `setPeer` без threadId для НЕ-пользователя
  // всегда даёт `items = []` (нет ручки истории фото, tweb :443-499), значит
  // `listLoader.current` там ВСЕГДА `undefined` — даже когда у чата ЕСТЬ
  // аватар (isFirst-ветка `processItem` рисует его зеркалом). Это гасило клик
  // для ЛЮБОГО чата с фото. Настоящий tweb-эквивалент — «есть ли у пира
  // текущее фото», а не «непуста ли историческая галерея»: `getPeerPhoto`/
  // `getPeerPhotoId` читают ЛОКАЛЬНОЕ зеркало пиров (тот же путь, каким
  // `avatarNew`/`putAvatar` решает, рисовать фото или кружок с инициалами,
  // `components/avatar.ts:220-221`) — синхронно, без сети.
  private currentHasPhoto = false

  // tweb :55 (this.swipeHandler) — свайп ленты, порт `core/dom/swipeHandler.ts`
  // (см. конструктор). `!`: создаётся синхронно в конструкторе, до первого
  // чтения; снимается в cleanup() (tweb :969).
  private readonly swipeHandler: SwipeHandler

  // tweb :61 (this.videoProgressRAF) — id текущего кадра rAF-цикла прогресса
  // полоски видео-аватара (0 — цикл не идёт: самоприостановлен или ещё не
  // запущен). `0`, а не `undefined`/`-1`: `cancelAnimationFrame(0)` — безвредный
  // no-op (спецификация requestAnimationFrame резервирует id > 0), поэтому
  // `cleanup()` может звать его безусловно, не проверяя, шёл ли цикл вообще.
  private videoProgressRAF = 0

  public onNeedWhiteChanged?: (needWhite: boolean) => void

  constructor(options: {
    managers: PeerProfileAvatarsManagers
    setCollapsedOn: HTMLElement
    scrollableEl: HTMLElement
    unfold: (e?: { preventDefault: () => void; stopPropagation: () => void }) => void
  }) {
    this.managers = options.managers
    this.setCollapsedOn = options.setCollapsedOn
    this.scrollableEl = options.scrollableEl
    this.unfold = options.unfold

    // DOM конструктора — tweb :81-109, порядок append (:107) дословный.
    this.container = document.createElement('div')
    this.container.classList.add(PeerProfileAvatars.BASE_CLASS + '-container')

    this.avatars = document.createElement('div')
    this.avatars.classList.add(PeerProfileAvatars.BASE_CLASS + '-avatars')

    this.gradient = document.createElement('div')
    this.gradient.classList.add(PeerProfileAvatars.BASE_CLASS + '-gradient')

    this.gradientTop = this.gradient.cloneNode() as HTMLElement
    this.gradientTop.classList.add(PeerProfileAvatars.BASE_CLASS + '-gradient-top')

    this.tabs = document.createElement('div')
    this.tabs.classList.add(PeerProfileAvatars.BASE_CLASS + '-tabs')

    this.arrowPrevious = document.createElement('div')
    this.arrowPrevious.classList.add(PeerProfileAvatars.BASE_CLASS + '-arrow')
    this.arrowPrevious.append(Icon('avatarprevious', PeerProfileAvatars.BASE_CLASS + '-arrow-icon'))

    this.arrowNext = document.createElement('div')
    this.arrowNext.classList.add(PeerProfileAvatars.BASE_CLASS + '-arrow', PeerProfileAvatars.BASE_CLASS + '-arrow-next')
    this.arrowNext.append(Icon('avatarnext', PeerProfileAvatars.BASE_CLASS + '-arrow-icon'))

    this.info = document.createElement('div')
    this.info.classList.add(PeerProfileAvatars.BASE_CLASS + '-info')

    this.container.append(this.avatars, this.gradient, this.gradientTop, this.tabs, this.arrowPrevious, this.arrowNext, this.info)

    this.listenerSetter = new ListenerSetter()
    this.middlewareHelper = getMiddleware()

    // tweb :119-125 — 'play' НЕ всплывает (bubbles: false у media-событий),
    // поэтому слушаем на CAPTURE-фазе контейнера: она видит событие на пути
    // ВНИЗ к цели независимо от всплытия. Будит rAF-цикл прогресса, когда
    // видео-аватар (пере)стартует — например, после возврата в свёрнутое/
    // развёрнутое состояние (animationIntersector.toggleVideosUnder) или
    // после скролла обратно во вьюпорт. Скоуп — именно `.avatar-video`: другие
    // `<video>`, которые могут появиться в контейнере, цикл не касаются.
    this.listenerSetter.add(this.container)('play', (e) => {
      const target = e.target as HTMLElement | null
      if (target?.classList?.contains('avatar-video') && !this.videoProgressRAF) {
        this.startVideoProgressLoop()
      }
    }, { capture: true })

    // ─── Клик — зоны/закольцовывание/просмотрщик (tweb :127-233) ───────────
    // Расхождения от буквального текста оригинала объявлены докблоком класса
    // выше (`uploadInProgress`/`fakeAvatar`/`profile-subtitle-rating`/
    // `emoji-status`/`freeze` не портированы, `hasNoPhoto` → `currentHasPhoto`
    // — см. докблок поля, РАУНД ПРАВОК 1; `openAvatarViewer` → `openViewer()`).
    const SWITCH_ZONE = 1 / 3
    let cancel = false
    attachClickEvent(this.container, (e) => {
      if (cancel) {
        cancel = false
        return
      }

      if (!this.checkScrollTop()) return

      if (!this.currentHasPhoto) return // tweb :170-172 (hasNoPhoto) — см. докблок поля `currentHasPhoto`

      if (this.isCollapsed()) {
        // tweb :174-182 (`this.unfold(_e)`) — унифицированный источник
        // разворачивания: `unfold` приходит из `useCollapsable`, которым
        // владеет ВНЕШНИЙ React-компонент правой панели (`UserInfoPanel.tsx`,
        // задача 5, докблок класса выше). Класс сам НЕ трогает `is-collapsed`
        // — DOM в соответствие приведёт эффект хука (`folded → setCollapsed`,
        // аналог tweb createEffect :340-348). Временная ветка «без unfold»
        // (класс разворачивал себя сам, задача 4) снесена вместе со своим
        // тестом — `unfold` теперь обязателен (см. докблок поля).
        this.unfold(e)
        return
      }

      // `listLoader` заведён ЛЮБЫМ завершённым `setPeer` без threadId (даже
      // для группы/канала с пустой галереей — `current` там `undefined`,
      // но сам loader есть); topic-ветка (сегодня недостижима) его не
      // трогает вовсе — страховка на случай, если клик прилетел раньше.
      const loader = this.listLoader
      if (!loader) return

      const rect = this.container.getBoundingClientRect()
      const x = e.pageX
      const clickX = x - rect.left

      if ((!loader.previous.length && !loader.next.length) ||
        (clickX > rect.width * SWITCH_ZONE && clickX < rect.width - rect.width * SWITCH_ZONE)) {
        this.openViewer(loader)
      } else {
        const centerX = rect.right - rect.width / 2
        const toRight = x > centerX
        // tweb :227-228 читает `this.listLoader.count` напрямую — к моменту
        // клика он уже определён (`load(true)` из setPeer успевает отработать
        // до первого пользовательского взаимодействия); фолбэк на сумму длин
        // окон нужен только на случай гонки, тем же значением, каким `count`
        // станет сам, как только `load()` дотечёт.
        //
        // СОЗНАТЕЛЬНО НЕПОКРЫТО (норма `web-client/CLAUDE.md`): чтобы
        // наблюдать `loader.count === undefined` в тесте, пришлось бы кликать
        // МЕЖДУ `setPeer()`/резолвом первого элемента и завершением
        // `load(true)` — то есть гонять реальный `vi.waitFor` наоборот
        // (ловить окно ДО заполнения), что делает тест хрупким к таймингам
        // раннера, а не к строке кода. Подмена на заведомо неверное число
        // (999999) ничего не красит именно поэтому — оба выражения дают один
        // результат ПОСЛЕ `load()`, различие видно только в этом узком окне.
        const count = loader.count ?? loader.previous.length + loader.next.length + 1
        let distance: number
        if (loader.index === 0 && !toRight) distance = count - 1
        else if (loader.index === count - 1 && toRight) distance = -(count - 1)
        else distance = toRight ? 1 : -1

        this.goWithoutTransition(distance)
      }
    }, { listenerSetter: this.listenerSetter })

    // ─── Свайп — ТОЛЬКО через порт SwipeHandler (tweb :243-298) ─────────────
    const cancelNextClick = () => {
      cancel = true
      // tweb :236-240 (`getOverlayRoot()`) — appWindow/Document PiP не
      // портированы (тот же приём уже принят в `mediaViewer/base.ts:43`),
      // слушаем напрямую `document.body`.
      document.body.addEventListener(IS_TOUCH_SUPPORTED ? 'touchend' : 'click', () => {
        cancel = false
      }, { once: true })
    }

    let width = 0
    let x = 0
    let lastDiffX = 0
    let minX = 0
    this.swipeHandler = new SwipeHandler({
      element: this.avatars,
      // `yDiff` оригинала (:245, `yDiff *= -1`) не портирован: карусель горизонтальная,
      // вертикальный компонент свайпа нигде дальше не читается — присваивание
      // мертво и в самом tweb (никогда не пропадает никуда после строки).
      onSwipe: (xDiff, _yDiff) => {
        xDiff *= -1

        lastDiffX = xDiff
        let lastX = x + xDiff * -PeerProfileAvatars.SCALE
        if (lastX > 0) lastX = 0
        else if (lastX < minX) lastX = minX

        this.avatars.style.transform = PeerProfileAvatars.TRANSLATE_TEMPLATE.replace('{x}', lastX + 'px')
        return false
      },
      verifyTouchTarget: (e) => {
        if (!this.checkScrollTop()) {
          cancelNextClick()
          cancelEvent(e as unknown as Event)
          return false
        } else if (this.isCollapsed()) {
          return false
        } else if (this.container.classList.contains('is-single')) {
          return false
        }

        return true
      },
      onFirstSwipe: () => {
        const rect = this.avatars.getBoundingClientRect()
        width = rect.width
        minX = -width * (this.tabs.childElementCount - 1)
        x = rect.left - this.container.getBoundingClientRect().left

        this.avatars.style.transform = PeerProfileAvatars.TRANSLATE_TEMPLATE.replace('{x}', x + 'px')

        this.container.classList.add('is-swiping')
        this.avatars.classList.add('no-transition')
        void this.avatars.offsetLeft // reflow
      },
      onReset: () => {
        const addIndex = Math.ceil(Math.abs(lastDiffX) / (width / PeerProfileAvatars.SCALE)) * (lastDiffX >= 0 ? 1 : -1)
        cancelNextClick()

        this.avatars.classList.remove('no-transition')
        fastRaf(() => {
          this.listLoader?.go(addIndex)
          this.container.classList.remove('is-swiping')
        })
      },
    })

    // tweb :300-307 — колбэк наблюдателя зовёт loadNearestToTarget на самой
    // пересёкшейся entry, ничего больше.
    this.intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) this.loadNearestToTarget(entry.target)
      }
    })
  }

  /**
   * tweb :127-137. Возвращает `false` и скроллит шапку в начало, если
   * `scrollableEl` сейчас прокручен, — вызывающий (клик/свайп) обязан
   * погасить своё действие в этом случае. `scrollTo(...)` — нативный API
   * (анимированный, порождает настоящие 'scroll'-события), а НЕ буквальная
   * запись `scrollTop = ` — второй `Scrollable`/`ScrollSaver`-конкурент
   * заводить здесь нельзя (докблок класса выше), и `core/scrollWriters.test.ts`
   * сканирует только буквальную форму записи, не `scrollTo`.
   */
  private checkScrollTop(): boolean {
    if (this.scrollableEl.scrollTop !== 0) {
      this.scrollableEl.scrollTo({ top: 0, behavior: 'smooth' })
      return false
    }

    return true
  }

  /** tweb :795-805. */
  public addTab(): void {
    const tab = document.createElement('div')
    tab.classList.add(PeerProfileAvatars.BASE_CLASS + '-tab')
    this.tabs.append(tab)

    if (this.tabs.childElementCount === 1) {
      tab.classList.add('active')
    }

    this.container.classList.toggle('is-single', this.tabs.childElementCount <= 1)
  }

  /**
   * tweb :376-521. Фон-паттерн (`applyAppearance`, :390) — не портирован, см.
   * докблок класса. Фолбэк-фото (:422-431), кольца историй (:852-880) и
   * прогресс-загрузка своей аватарки (:545-590) — из таблицы «Что НЕ
   * портируем» плана этапа, тоже вне периметра.
   *
   * Инстанс переживает смену пира (в отличие от tweb, где под новый пир
   * создаётся НОВЫЙ инстанс класса целиком, см. докблок полей выше) — задача
   * 5 встраивает класс ОДИН раз на время жизни правой панели через
   * `useImperativeIsland`. Поэтому здесь, в отличие от оригинала, ЯВНО чистим
   * DOM ленты прежнего пира: без этого фото накапливались бы поверх новых
   * при повторном вызове.
   */
  public async setPeer(peerId: PeerId, threadId?: number): Promise<void> {
    // tweb :377 (`this.peerId = peerId`) — задача 3 заводит `currentPeerId`
    // (см. докблок поля выше): синхронно, ДО единого await, как и в
    // оригинале, поэтому гонки со сменой пира нет — клик/свайп всегда читают
    // peerId ленты, которая реально сейчас в DOM.
    this.currentPeerId = peerId
    // tweb :380-384 (hasNoPhoto = !photo) — см. докблок поля `currentHasPhoto`
    // выше: РАУНД ПРАВОК 1, синхронное чтение зеркала, до единого await.
    this.currentHasPhoto = getPeerPhotoId(getPeerPhoto(cachedPeer(peerId))) !== 0
    this.middlewareHelper.clean()

    if (!threadId) {
      // НАХОДКА ФИНАЛЬНОГО РЕВЬЮ ВЕТКИ (Important, п.3) — см. докблок
      // `releaseVideoAvatars()`: ДО того, как `replaceChildren()` ниже
      // выбросит узлы прежнего пира из DOM, снимаем видео-аватарки с учёта
      // в `animationIntersector` — иначе залоченный (панель была закрыта)
      // элемент утёк бы: `cleanup()` (единственное прежнее место вызова)
      // у нас не зовётся никогда, инстанс переживает смену пира.
      this.releaseVideoAvatars()
      this.avatars.replaceChildren()
      this.tabs.replaceChildren()
      this.container.classList.remove('is-single')
      // НАХОДКА ФИНАЛЬНОГО РЕВЬЮ ВЕТКИ (Minor, п.4): симметрично `is-single`
      // выше — топик-ветка (см. дальше по методу) вешает `is-topic` и никогда
      // не снимала его на возврат в обычную (не-топиковую) ленту.
      this.container.classList.remove('is-topic')
      this.loadCallbacks.clear()
      this.intersectionObserver.disconnect() // старые узлы всё равно удалены выше, но снимаем и наблюдение явно
      this.listLoader = undefined

      // Гонка «переключили пира, пока грузилось»: `middleware` — токен
      // ИМЕННО этого вызова setPeer, инвалидируется следующим вызовом через
      // `middlewareHelper.clean()` выше (web-client/CLAUDE.md § «Асинхронщина
      // и актуальность»). Проверяем его после КАЖДОГО await ниже и внутри
      // processItem — так протухший ответ сети не долетает до `this.avatars`/
      // `this.tabs` (они общие на весь инстанс).
      const middleware = this.middlewareHelper.get()

      // Группа/канал: истории фото у ручки нет вовсе (в оригинале — getHistory
      // c inputMessagesFilterChatPhotos, tweb :443-499) — единственный видимый
      // элемент это ТЕКУЩЕЕ фото пира, а его и без явного фетча рисует
      // isFirst-ветка processItem через avatarNew (зеркало пиров, тот же путь,
      // что и у SHOW_NO_AVATAR ниже). Долг и критерий закрытия —
      // web-client/backlogs/frontend/profile-chat-photo-history.md (заведёт
      // задача 6).
      const items: ProfilePhoto[] = isUser(peerId)
        ? await this.managers.profile.listPhotos(toUserId(peerId)).catch(() => [])
        : []

      // ЯКОРЬ ДОЛГА (НАХОДКА ФИНАЛЬНОГО РЕВЬЮ ВЕТКИ, Minor, п.8 — у файла
      // долга не было адреса в коде): здесь tweb резолвит `fallbackPhotoId`
      // (:422-431, только для СВОЕГО профиля и только если фото вообще есть)
      // и `loadMore` (:443-451) дописывает его последним элементом карусели.
      // У нас `fallback_photo` нет ни в модели, ни на проводе — резолвить
      // нечего, поэтому строки нет вовсе, а не заглушки. Разбор и критерий
      // закрытия — web-client/backlogs/frontend/profile-fallback-photo.md.

      if (!middleware()) return // протух, пока грузился список фото

      // tweb :384-386 — SHOW_NO_AVATAR захардкожен true и там же: ветка
      // недостижима и в оригинале, порт сохраняет её как есть.
      if (!items.length && !SHOW_NO_AVATAR) return

      const [current, ...rest] = items
      let restServed = false

      const listLoader: ListLoader<ProfilePhoto, ProfilePhoto> = this.listLoader = new ListLoader({
        loadCount: 50,
        loadMore: (_anchor, older) => {
          // Плановое расхождение задачи 2 («Что НЕ портируем» плана этапа,
          // строка «Пагинация»): ручка `GET /users/{id}/photos`
          // (profileManager.ts:110) отдаёт ВЕСЬ список одним ответом, без
          // курсора/offset — в отличие от постраничной tweb :433-521
          // (`appPhotosManager.getUserPhotos`). ListLoader подключаем как в
          // оригинале, но loadMore отдаёт РОВНО ОДНУ страницу; повторный вызов
          // (например, из loadWhenLeft) сеть не бьёт заново.
          if (!older || restServed) return Promise.resolve({ count: items.length, items: [] })
          restServed = true
          return Promise.resolve({ count: items.length, items: rest })
        },
        // `?? item`: `ListLoader<ProfilePhoto, ProfilePhoto>` (T=P без undefined
        // в потоке из `rest` — там элементов-`undefined` не бывает) типизирует
        // processItem как `(item) => T | Promise<T>`; `this.processItem` шире —
        // принимает и возвращает `ProfilePhoto | undefined` (тот же метод
        // обслуживает и «текущий» вызов ниже, где photo может отсутствовать,
        // SHOW_NO_AVATAR). На практике для айтемов из `rest` он всегда
        // возвращает свой же аргумент — фолбэк чисто для типов, не для рантайма.
        processItem: (item) => this.processItem(item, peerId, middleware).then((result) => result ?? item),
        onJump: (item, older) => this.onJump(item, older),
      })

      listLoader.current = current

      await this.processItem(current, peerId, middleware)
      if (!middleware()) return

      // tweb НЕ ждёт `listLoader.load(true)` (:530, комментарий
      // «listLoader.loaded») — панель профиля обязана открыться сразу, лента
      // дозаполняется по мере прихода ответов. Список метаданных (`items`)
      // уже получен ВЫШЕ одним запросом, но БАЙТЫ ещё нет: `load(true)` внутри
      // себя await-ит `processItem` для элементов 1 и 2 (LOAD_NEAREST=3, 0-й
      // уже отрисован строкой выше) — `ensureMediaUrl`/`renderImageFromUrlPromise`
      // по сети. `await` здесь заставил бы `setPeer()` (а значит и открытие
      // панели, задача 5) ждать загрузки ещё двух фотографий — расхождение с
      // оригиналом, которое нигде не объявлено. `void` — как и ниже в самом
      // `ListLoader.go()` (`void this.load(!this.reverse)`).
      void listLoader.load(true)

      // tweb :534-537 (хвост `setPeer`, `if(photo?.pFlags?.has_video)
      // this.startVideoProgressLoop()`) — НАХОДКА ФИНАЛЬНОГО РЕВЬЮ ВЕТКИ
      // (Important, п.2), второй пропущенный вызывающий. `current` — тот же
      // «текущий» элемент оригинала (`photo` там), `videoMediaId` — наш
      // эквивалент `pFlags.has_video` (докблок `processItem`, ветка видео).
      //
      // СОЗНАТЕЛЬНО НЕПОКРЫТО функционально (но покрыто ФАКТОМ вызова,
      // `peerProfileAvatars.test.ts`, describe «rAF-прогресс…»): элемент #0
      // («текущий») у нашего порта ВСЕГДА рисуется через `avatarNew`
      // (isFirst-ветка `processItem`), у него никогда не бывает
      // `<video class="avatar-video">` — тот же структурный пробел, что
      // объясняет докблок `updateActiveTabProgress` про фолбэк tweb для
      // i===0. Поэтому здесь цикл СТАРТУЕТ (кадр планируется), но гасится на
      // первом же тике (`updateActiveTabProgress` не находит играющее видео
      // на активном индексе 0) — ровно как в оригинале, у которого та же
      // структурная дыра (см. тот же докблок).
      if (current?.videoMediaId) this.startVideoProgressLoop()

      return
    }

    // tweb :396-400 — у темы форума нет истории фото: контейнер получает
    // is-topic, а вместо карусели — один статичный аватар без ListLoader.
    this.container.classList.add('is-topic')

    // ВЕТКА СЕГОДНЯ НЕДОСТИЖИМА, портирована на будущее: единственный
    // вызывающий `setPeer` (`UserInfoPanel.tsx`, задача 5) передаёт peerId БЕЗ
    // threadId вовсе (грепом по `UserInfoPanel.tsx` — ни одного упоминания
    // threadId). Как только появится вызывающий с threadId — читай это ПЕРЕД
    // тем, как трогать код ниже.
    //
    // ЭТО НЕ ИКОНКА ТЕМЫ, А ОБЫЧНЫЙ АВАТАР ПИРА — предмет подменён сознательно,
    // не «упрощённая, но корректная» реализация. В оригинале это
    // `avatarNew({size:120, wrapOptions:{customEmojiSize,...}}).render({peerId,
    // threadId})` (tweb :836-841 внутри `processItem`, :807-861) — `threadId`
    // уходит В render, и именно он превращает узел в иконку темы форума
    // (`wrapTopicIcon`). Наш `avatarNew` (`components/avatar.ts`) threadId не
    // принимает вовсе и тем форума не знает — это унаследованный, уже
    // объявленный пробел модели (`components/avatar.ts:42`: «топики форума...
    // — ни того, ни другого в модели нет»), а не новая недоделка этой задачи.
    // Поэтому ниже — обычный `avatarNew({peerId, size:120})` БЕЗ threadId:
    // если бы ветка сегодня выполнялась, пользователь увидел бы в шапке темы
    // круглый аватар ЧАТА, а не квадратную иконку темы с её эмодзи/цветом.
    // Долг и критерий готовности — `web-client/backlogs/frontend/
    // profile-topic-avatar.md`; заводить его вместе с проводкой threadId в
    // `UserInfoPanel` (когда она появится), не раньше.
    const avatar = avatarNew({
      peerId,
      size: 120,
      middleware: this.middlewareHelper.get(),
      managers: this.managers,
    })
    avatar.node.classList.add(PeerProfileAvatars.BASE_CLASS + '-avatar')
    await avatar.readyThumbPromise
    this.avatars.append(avatar.node)
    // НАХОДКА ФИНАЛЬНОГО РЕВЬЮ ВЕТКИ (Minor, п.4): в оригинале один статичный
    // аватар темы форума всё равно проходит через `processItem(undefined)`
    // (tweb :807-861), а тот вызывает `addTab()` для КАЖДОГО элемента ленты —
    // топик-ветка здесь его не звала вовсе, поэтому `this.tabs` оставался
    // пуст и `is-single` (единственное место, где он взводится, см.
    // `addTab()` ниже) никогда не вставал: декоративные стрелки
    // (`_profile.scss`, видимость — CSS по отсутствию `is-single`) были бы
    // видны у темы форума, у которой листать нечего. Ветка недостижима
    // (см. комментарий выше) — почищено на будущее.
    this.addTab()
  }

  /** tweb :365-374. */
  public goWithoutTransition(distance: number): void {
    this.avatars.classList.add('no-transition')
    void this.avatars.offsetLeft // reflow — без него transition-класс не успеет примениться до go()

    this.listLoader?.go(distance)

    fastRaf(() => {
      this.avatars.classList.remove('no-transition')
    })
  }

  /**
   * tweb :185-221 (`openAvatarViewer(...)`). Специализированного вьювера
   * аватаров у нас нет — общий `components/mediaViewer/openMediaViewer.ts:39`
   * (`ViewerItem`-модель, докблок `openMediaViewer.ts:31-33` объясняет
   * `reverse: false`: галерея профиля newest-first, как и grid shared media,
   * а не «по возрастанию seq» — тот случай только у окна чата). Из-за этого
   * нет и раздельных `prevTargets`/`nextTargets` (:196-209) — общий вьювер
   * принимает один плоский `items` + `index`, сам умеет листать вокруг него.
   *
   * Вызывается ТОЛЬКО когда `loader.current` определён (гейт — в клик-
   * хендлере, `hasNoPhoto`-эквивалент, см. докблок класса), поэтому здесь
   * повторной проверки нет.
   */
  private openViewer(loader: ListLoader<ProfilePhoto, ProfilePhoto>): void {
    const peerId = this.currentPeerId
    if (peerId === undefined) return

    // РАУНД ПРАВОК 1: группа/канал (и вообще любой пир без исторической
    // галереи — `loader.current === undefined`, но `currentHasPhoto` уже
    // проверен true клик-хендлером выше) не имеют ни одного `ProfilePhoto` —
    // единственный элемент собирается из ТЕКУЩЕГО фото пира напрямую
    // (`buildViewerItemFromCurrentPhoto`), а не из галереи, которой для этого
    // пира попросту нет (tweb :443-499, долг
    // `backlogs/frontend/profile-chat-photo-history.md`).
    const items: ViewerItem[] = loader.current
      ? [...loader.previous, loader.current, ...loader.next].map((photo, idx) => this.buildViewerItem(photo, idx, peerId))
      : [this.buildViewerItemFromCurrentPhoto(peerId)]
    const index = loader.current ? loader.previous.length : 0 // tweb :211 — this.listLoader.previous.length, он же loader.index

    void openMediaViewer({
      items,
      index,
      target: this.avatars.children[index] as HTMLElement,
      reverse: false,
    })
  }

  /** Элемент вьювера из КОНКРЕТНОЙ фотографии галереи. */
  private buildViewerItem(photo: ProfilePhoto, idx: number, peerId: PeerId): ViewerItem {
    const el = this.avatars.children[idx] as HTMLElement | undefined
    const rect = el?.getBoundingClientRect()
    const isVideo = !!photo.videoMediaId

    return {
      element: el ?? null,
      mid: 0, // не сообщение — forward/delete/jump не пробрасываются (как и в снесённой UserInfoPanel.tsx::openAvatarViewer)
      media: {
        mediaId: photo.mediaId,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0, // avatarWrap уже в DOM для ЛЮБОГО элемента ленты (processItem всегда создаёт узел синхронно) — 0 недостижим, кроме гонки layout
        kind: isVideo ? 'video' : 'photo',
        gif: isVideo || undefined, // видео-аватар — автоплей-цикл без плеера, как обычный GIF-документ вьювера
        // Ленивый резолв (`ViewerMedia.url` — `() => Promise<string>`): те же
        // единственные ванильные точки входа за байты, что и у `processItem`
        // (докблок `PeerProfileAvatarsManagers`), не `managers.media.*` напрямую.
        url: isVideo
          ? () => Promise.resolve(resolveStreamUrl(photo.videoMediaId!))
          : () => ensureMediaUrl(photo.mediaId),
      },
      // Даты у фото профиля нет (ViewerAuthor.date опционален) — подпись
      // вьювер просто не рисует, как и у снесённой самоделки.
      author: { peerId, name: peerTitle(peerId) },
    }
  }

  /**
   * РАУНД ПРАВОК 1 (баг с мёртвым кликом группы/канала). Пир без
   * исторической галереи (не-пользователь, `setPeer :479-481`, ручки нет
   * вовсе) — единственный элемент строится из ТЕКУЩЕГО фото пира
   * (`getPeerPhoto`/`getPeerPhotoId`, тот же путь, что `avatarNew`/`putAvatar`
   * используют для решения «рисовать фото или кружок с инициалами»,
   * `components/avatar.ts:220-221`), а НЕ из `ProfilePhoto` — такого объекта
   * для этого пира просто не существует. Видео здесь недостижимо: без
   * галереи взять `videoMediaId` неоткуда (то же основание, что у ветки
   * `processItem` ниже).
   */
  private buildViewerItemFromCurrentPhoto(peerId: PeerId): ViewerItem {
    const mediaId = getPeerPhotoId(getPeerPhoto(cachedPeer(peerId)))
    const el = this.avatars.children[0] as HTMLElement | undefined
    const rect = el?.getBoundingClientRect()

    return {
      element: el ?? null,
      mid: 0,
      media: {
        mediaId,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
        kind: 'photo',
        url: () => ensureMediaUrl(mediaId),
      },
      author: { peerId, name: peerTitle(peerId) },
    }
  }

  /**
   * tweb :807-912 в объёме задачи 2 (без историй/паттерна фона, см. докблок
   * класса). Один узел `.profile-avatars-avatar` на элемент ленты.
   *
   * Элемент #0 ленты («текущий» аватар — из галереи ИЛИ полностью
   * синтетический при SHOW_NO_AVATAR/группе-канале) всегда рисуется через
   * `avatarNew` — тот же зеркальный путь, что рисует аватар пира везде в
   * приложении (мгновенно, без похода за конкретным фото; tweb :863-875
   * «фотография УЖЕ показана» — та же идея, что рендерить заново не нужно).
   * Именно так поступает и оригинал: `isFirst` там ВСЕГДА уходит в
   * `avatarElem.render({peerId, threadId})`, даже если `photo` для этого
   * элемента известен (:836-841) — фотография элемента используется, только
   * если !isFirst (:843-861).
   *
   * Остальные элементы — КОНКРЕТНАЯ историческая фотография этого пира:
   * `avatarNew` её нарисовать не может (зеркальный путь — всегда текущий
   * аватар пира, `components/avatar.ts`: «карточка пира — синхронно из
   * зеркала»). Оригинал здесь — `wrapPhotoToAvatar` (`@components/avatarNew`,
   * ступени размеров tweb-фото); у нас такого помощника нет, поэтому узел
   * строится напрямую — `<img>`/`<video>` по `mediaId`/`videoMediaId`, тем же
   * приёмом, что использовала снесённая самоделка
   * (`core/hooks/useUserProfileData.ts:80-100`,
   * `UserInfoPanel.tsx::AvatarVideo`, ныне удалены).
   *
   * `middleware` — токен КОНКРЕТНОГО вызова `setPeer`; гейт стоит и в начале,
   * и после каждого await, чтобы протухший (по смене пира) отклик сети не
   * долетел до `this.avatars`/`this.tabs` — они общие на весь инстанс,
   * который у нас (в отличие от tweb) переживает смену пира.
   */
  private async processItem(
    photo: ProfilePhoto | undefined,
    peerId: PeerId,
    middleware: Middleware,
  ): Promise<ProfilePhoto | undefined> {
    if (!middleware()) return photo // протухший вызов — не трогаем DOM вовсе

    const avatarWrap = document.createElement('div')
    avatarWrap.classList.add(PeerProfileAvatars.BASE_CLASS + '-avatar', 'media-container', 'hide')

    const isFirst = this.avatars.childElementCount === 0
    this.avatars.append(avatarWrap)

    const loadCallback = async () => {
      try {
        if (isFirst || !photo) {
          // tweb :824-833 (внутри `processItem` :807-865, не топик-ветка,
          // `isTopic` у нас недостижима — см. докблок `setPeer` ниже): size:
          // 'full' — масштабируется под `.profile-avatars-avatar` через
          // CSS-класс `avatar-full` (`_avatar.scss:447`), а не фиксированный
          // кружок. Задача 7 расширила `avatarNew` до `size: 'full'` (был
          // компромисс `120` — файл долга `profile-avatars-full-size.md`
          // существовал между задачами 6 и 7 и снесён вместе с закрытием;
          // упоминание здесь — исторический факт, не адрес живого файла).
          // `noFadeIn: true` — тот же приём, что у оригинала: заменяем
          // маленький кэшированный кружок на большую фотографию БЕЗ проявления,
          // иначе сквозь fade-in на миг просвечивает цветная подложка.
          // `isBig: true` не портирован НАМЕРЕННО — у нас нет пары
          // `photo_big`/`photo_small` (`components/avatar.ts::putAvatar`
          // докблок: «isBig не портирован вместе с профилем»), эквивалента нет.
          const avatarElem = avatarNew({
            peerId,
            size: 'full',
            noFadeIn: true,
            middleware,
            managers: this.managers,
          })
          if (isFirst) avatarElem.node.classList.add(PeerProfileAvatars.BASE_CLASS + '-avatar-first') // tweb :847
          await avatarElem.readyThumbPromise
          if (!middleware()) return
          avatarWrap.append(avatarElem.node)
        } else if (photo.videoMediaId) {
          // ВЕТКА СЕГОДНЯ НЕДОСТИЖИМА: `mapProfilePhoto`
          // (core/managers/profileManager.ts:143) жёстко пишет
          // `videoMediaId: undefined`, а провод (`galleryPhoto`,
          // backend/internal/adapter/delivery/http/profile_handler.go:404-405)
          // вообще не несёт `video_sizes` — видео теряется на бэке, а не в
          // клиентском мапере. Портирована на будущее: как только провод
          // почитают, ветка оживёт без переделки (см. отчёт задачи 2 плана
          // `docs/superpowers/plans/2026-09-05-profile-avatars-class.md`).
          const video = document.createElement('video')
          video.className = 'avatar-photo avatar-video' // адресуемый класс — tweb createLoopingMutedVideo
          video.autoplay = true
          video.muted = true
          video.loop = true
          video.playsInline = true
          // `resolveStreamUrl` — единственная ванильная точка входа за
          // стрим-URL видео/аудио (`web-client/CLAUDE.md` § «Медиа-слой»,
          // токен-механизм); `managers.media.contentUrl(...)` напрямую отсюда
          // звать нельзя — этот же путь использовала снесённая самоделка
          // (`UserInfoPanel.tsx::AvatarVideo`, там были и managers-обёртки).
          const src = await Promise.resolve(resolveStreamUrl(photo.videoMediaId))
          if (!middleware()) return
          await renderImageFromUrlPromise(video, src)
          if (!middleware()) return
          // tweb регистрирует видео в animationIntersector НЕЯВНО — через
          // avatarNew/loadAvatarVideoOverlay, которых у нашего avatar.ts нет
          // (его докблок: «видео-аватарки... предмета нет»). Явную проводку
          // берём из снесённой самоделки (UserInfoPanel.tsx::AvatarVideo) —
          // тот же учёт, снятие — в cleanup().
          animationIntersector.addAnimation({ animation: video, observeElement: video, type: 'video' })
          avatarWrap.append(video)
        } else {
          const img = document.createElement('img')
          img.className = 'avatar-photo'
          // `ensureMediaUrl` — ЕДИНСТВЕННАЯ ванильная точка входа за URL
          // картинки (тот же путь, что `components/avatar.ts::putAvatar`);
          // попадание в зеркало разруливает конвейер сам — повторное открытие
          // профиля не бьёт сеть заново. Метод менеджера-владельца (скачивание
          // байтов) напрямую отсюда звать нельзя — `core/noDuplicateMediaUrl.
          // test.ts` держит список тех, кому можно.
          const src = await ensureMediaUrl(photo.mediaId, { middleware })
          if (!middleware()) return
          await renderImageFromUrlPromise(img, src)
          if (!middleware()) return
          avatarWrap.append(img)
        }
      } catch {
        // Сеть подвела (404 протухшего id, офлайн) либо протухла зона
        // актуальности (`ensureMediaUrl` отклоняет MIDDLEWARE_ERROR на
        // `middleware.onClean`) — тот же фолбэк, что у `components/avatar.ts::
        // putAvatar` на такой же случай: не роняем `processItem` дальше,
        // просто оставляем элемент пустым вместо вечно висящего промиса.
      }

      avatarWrap.classList.remove('hide')
    }

    // tweb :898-905 — первые LOAD_NEAREST элементов грузятся сразу, остальные
    // ждут появления в IntersectionObserver.
    if (this.avatars.childElementCount <= LOAD_NEAREST) {
      await loadCallback()
    } else {
      this.intersectionObserver.observe(avatarWrap)
      this.loadCallbacks.set(avatarWrap, loadCallback)
    }

    // Найдено раундом правок 1 (после перевода `listLoader.load(true)` на
    // `void`, см. setPeer): `await loadCallback()` выше может протухнуть
    // (гейты `middleware()` ВНУТРИ loadCallback выходят только из САМОГО
    // loadCallback, а не из processItem) — без повторной проверки здесь
    // протухший вызов ВСЁ РАВНО добавил бы вкладку в `this.tabs` уже ПОСЛЕ
    // того, как новый setPeer его очистил (`this.tabs.replaceChildren()`),
    // подмешивая счётчик вкладок прежнего пира в ленту текущего.
    if (!middleware()) return photo

    this.addTab()
    if (this.tabs.childElementCount === 1) avatarWrap.classList.add('active')

    return photo
  }

  /** tweb :914-927. */
  private loadNearestToTarget(target: Element): void {
    const parent = target.parentElement
    if (!parent) return

    const children = Array.from(parent.children)
    const idx = children.indexOf(target)
    const slice = children.slice(Math.max(0, idx - LOAD_NEAREST), Math.min(children.length, idx + LOAD_NEAREST))

    for (const el of slice) {
      const callback = this.loadCallbacks.get(el)
      if (callback) {
        void callback()
        this.loadCallbacks.delete(el)
        this.intersectionObserver.unobserve(el)
      }
    }
  }

  /**
   * tweb :500-520, включая хвост :517-520 (`if(!this.videoProgressRAF)
   * this.startVideoProgressLoop()`) — НАХОДКА ФИНАЛЬНОГО РЕВЬЮ ВЕТКИ
   * (Important, п.2): раньше здесь стоял комментарий «startVideoProgressLoop
   * не существует» — метод завела задача 3 (`:1076` ниже), но к этому месту
   * так и не вернулась, из-за чего у него был ОДИН вызывающий (capture-
   * слушатель 'play' в конструкторе) против ТРЁХ в оригинале. Листание
   * (клик/свайп/goWithoutTransition → `ListLoader.go` → `onJump`) НЕ рождает
   * событие 'play' на видео, в которое прыгнули, — оно уже играет (автоплей),
   * просто цикл прогресса мог быть самоприостановлен (предыдущий активный
   * элемент — не видео, или видео тоже было на паузе) и без явного будильника
   * здесь остался бы замороженным до следующего случайного 'play'.
   *
   * ВЕТКА С ДВУМЯ РЕАЛЬНЫМИ ВИДЕО В ЛЕНТЕ ОДНОВРЕМЕННО — единственная, где
   * это наблюдаемо (`peerProfileAvatars.test.ts`, describe «rAF-прогресс
   * полоски видео-аватара»); сегодня видео-аватар в принципе недостижим на
   * проводе (см. докблок класса, «videoMediaId»), поэтому живьём эта строка
   * не сработает ни разу — портирована на будущее, тем же основанием, что и
   * сама ветка `photo.videoMediaId` в `processItem`.
   */
  private onJump(_item: ProfilePhoto | undefined, _older: boolean): void {
    const listLoader = this.listLoader
    if (!listLoader) return

    const id = listLoader.index
    const x = 100 * PeerProfileAvatars.SCALE * id
    this.avatars.style.transform = PeerProfileAvatars.TRANSLATE_TEMPLATE.replace('{x}', `-${x}%`)

    for (const container of [this.tabs, this.avatars]) {
      const activeTab = container.querySelector('.active')
      activeTab?.classList.remove('active')
      const tab = container.children[id] as HTMLElement | undefined
      tab?.classList.add('active')
    }

    this.loadNearestToTarget(this.avatars.children[id])

    // tweb :517-520 — см. докблок метода выше.
    if (!this.videoProgressRAF) this.startVideoProgressLoop()
  }

  /**
   * tweb :929-944. `is-collapsed`/`need-white` вешаются на `setCollapsedOn`
   * (узел вкладки панели), а НЕ на собственный `container` — иначе классы
   * профиля не видны CSS-правилам шапки сайдбара, которые их ждут снаружи.
   *
   * В оригинале метод `private` — вызывающий (createEffect `folded →
   * setCollapsed`, tweb :340-348) живёт ВНУТРИ того же класса, потому что там
   * useCollapsable создаётся в конструкторе этого же класса. У нас хук —
   * React-хук, которым владеет ВНЕШНИЙ React-компонент (задача 4, докблок
   * класса, «Осознанное отступление»), поэтому именно ЕГО эффект (задача 5,
   * `UserInfoPanel.tsx`) зовёт `setCollapsed` СНАРУЖИ, приводя DOM в
   * соответствие с состоянием хука, — метод расширен обратно до `public` ради
   * этого вызывающего (был сужен до `private` в задаче 3, когда клик стал
   * внутренним вызывающим сам по себе). Клик САМ этот метод больше не зовёт
   * вовсе (задача 5 снесла временную ветку без `unfold` — см. докблок клика) —
   * единственный вызывающий теперь внешний эффект.
   */
  public setCollapsed(collapsed: boolean): void {
    // tweb :931-933 — сворачивание (не наоборот) возвращает ленту на первый
    // кадр, если сейчас показан не он, тем же `goWithoutTransition`, что и
    // клик/свайп (задача 3). `ListLoader` заводит эта задача — вызов ниже
    // безопасен и для случаев без него (`setPeer` ещё не звали): `?.index`
    // тогда `undefined`, условие ложно.
    if (!this.isCollapsed() && collapsed && this.listLoader?.index) {
      this.goWithoutTransition(-this.listLoader.index)
    }

    this.setCollapsedOn.classList.toggle('is-collapsed', collapsed)

    const needWhite = this.hasBackgroundColor || !collapsed
    if (this.setCollapsedOn.classList.contains('need-white') !== needWhite) {
      this.setCollapsedOn.classList.toggle('need-white', needWhite)
      this.onNeedWhiteChanged?.(needWhite)
      // tweb :940 — changeTitleEmojiColor(this.info, ...); см. докблок выше.
    }

    this.updateHeaderFilled()
  }

  /** tweb :945-948. */
  private isCollapsed(): boolean {
    return this.setCollapsedOn.classList.contains('is-collapsed')
  }

  /**
   * Публичное чтение `currentHasPhoto` (см. докблок поля, РАУНД ПРАВОК 1) —
   * заведено задачей 5 для внешнего эффекта `UserInfoPanel.tsx`, который
   * приводит `useCollapsable()` в соответствие классу (аналог tweb createEffect
   * `:340-348`): `if(this.hasNoPhoto && !folded()) fold()` — у нас гейт читает
   * ИМЕННО через этот геттер, `!hasPhoto`, а не заводит второе приватное поле.
   * Названо по смыслу оригинала (`hasNoPhoto = !photo`), но в ПОЛОЖИТЕЛЬНОЙ
   * форме — под имя уже заведённого поля `currentHasPhoto`, без двойного
   * отрицания у вызывающего.
   */
  public get hasPhoto(): boolean {
    return this.currentHasPhoto
  }

  /** tweb :949-955 — двусторонний класс: снимается тем же порогом, которым
   *  взводится, а не только выставляется один раз. */
  public updateHeaderFilled = (): void => {
    this.setCollapsedOn.classList.toggle(
      'header-filled',
      (!this.hasBackgroundColor && this.isCollapsed() && this.scrollableEl.scrollTop >= 5) ||
        this.scrollableEl.scrollTop >= 200,
    )
  }

  /**
   * tweb :597-611 (`startVideoProgressLoop`). Не самозапускается на монтаже —
   * его будит либо capture-слушатель 'play' в конструкторе (см. там), либо
   * повторный вызов из самого себя же не нужен: цикл сам себя перепланирует,
   * пока видео играет, и сам гасится, когда играть перестало (см. `tick`).
   */
  private startVideoProgressLoop(): void {
    cancelAnimationFrame(this.videoProgressRAF)

    // Токен ИМЕННО этого запуска: протухает на следующем `setPeer`
    // (`middlewareHelper.clean()`) или на `cleanup()` — цикл прежнего пира не
    // может утечь и молотить DOM, пока грузится следующий (tweb-комментарий:
    // «robust to transient DOM detachment, unlike an isConnected check»).
    const middleware = this.middlewareHelper.get()
    const tick = () => {
      if (!middleware()) {
        this.videoProgressRAF = 0
        return
      }

      // Самоприостановка в момент, когда активное видео перестало двигаться
      // (пауза: правая панель закрыта / проскроллено мимо / простаивает /
      // lite-mode) — анимировать нечего, не молотим rAF просто так. Будит
      // захваченный в конструкторе 'play'.
      if (!this.updateActiveTabProgress()) {
        this.videoProgressRAF = 0
        return
      }

      this.videoProgressRAF = requestAnimationFrame(tick)
    }
    this.videoProgressRAF = requestAnimationFrame(tick)
  }

  /**
   * tweb :613-644. Возвращает, играет ли СЕЙЧАС активное видео-аватар (нужно
   * циклу выше, чтобы знать, стоит ли планировать следующий кадр).
   *
   * tweb-фолбэк для i===0 (:625-627, `this.fakeAvatar?.node.querySelector(...)`)
   * здесь не нужен структурно: `fakeAvatar` — отдельный оверлей-узел ПЕРЕД
   * лентой (историй/collapsed-круга, которых у нас нет вовсе, докблок класса
   * выше), а у нашего порта элемент #0 и так лежит ВНУТРИ `this.avatars`
   * (`processItem`, isFirst-ветка задачи 2) — второго узла для того же кадра
   * не существует, смотреть больше негде.
   */
  private updateActiveTabProgress(): boolean {
    const activeIndex = this.listLoader?.index ?? 0
    const tabs = this.tabs.children
    const avatars = this.avatars.children
    let activePlaying = false

    for (let i = 0; i < tabs.length; ++i) {
      const tab = tabs[i] as HTMLElement
      const avatar = avatars[i] as HTMLElement | undefined
      const video = avatar?.querySelector('video.avatar-video') as HTMLVideoElement | null
      const isPlaying = tab.classList.contains('is-playing')

      if (i === activeIndex && video && video.duration && !video.paused) {
        activePlaying = true
        // Трогаем DOM, только если что-то реально изменилось — переустановка
        // класса/стиля каждый кадр стоит стиль-рекалька и перерисовки почём
        // зря и может подмигнуть грузящейся аватаркой под полоской.
        if (!isPlaying) tab.classList.add('is-playing')
        const value = Math.min(100, (video.currentTime / video.duration) * 100).toFixed(1) + '%'
        if (tab.style.getPropertyValue('--progress') !== value) {
          tab.style.setProperty('--progress', value)
        }
      } else if (isPlaying) {
        tab.classList.remove('is-playing')
        tab.style.removeProperty('--progress')
      }
    }

    return activePlaying
  }

  /**
   * tweb :963-969 — снятие учёта видео-аватарок в `animationIntersector` +
   * освобождение декодера (`pause`/`src=''`/`load()`). Оригинал зовёт это
   * ТОЛЬКО из `cleanup()`, потому что там под КАЖДОГО пира — НОВЫЙ инстанс
   * класса (докблок `setPeer` выше): смена пира === `cleanup()` прежнего
   * инстанса целиком. У нас инстанс переживает смену пира, а
   * `this.avatars.replaceChildren()` (см. `setPeer`) выбрасывает
   * `<video class="avatar-video">` прежнего пира из DOM БЕЗ снятия учёта —
   * залоченный элемент (`toggleVideosUnder`, пока правая панель была
   * закрыта) не снимается с учёта сам по себе при уходе из DOM
   * (`checkAnimation` игнорирует `locked` ДО проверки `isInDOM`,
   * `animationIntersector.ts:347-353`), декодер продолжал бы жить и после
   * того, как узел исчез из дерева.
   *
   * НАХОДКА ФИНАЛЬНОГО РЕВЬЮ ВЕТКИ (Important, п.3): раньше это стояло
   * ТОЛЬКО в `cleanup()`, которую у нас никто не зовёт при смене пира
   * (панель не размонтирует инстанс) — вынесено в общий метод, зовётся и
   * отсюда, и из `setPeer` (перед `replaceChildren()`, пока узлы ещё в DOM).
   */
  private releaseVideoAvatars(): void {
    this.container.querySelectorAll<HTMLVideoElement>('video.avatar-video').forEach((video) => {
      animationIntersector.removeAnimationByPlayer(video)
      video.pause()
      video.src = ''
      video.load()
    })
  }

  /**
   * tweb :957-973. rAF видео-прогресса и `swipeHandler` — задача 3, снимаются
   * здесь же (`cancelAnimationFrame`/`swipeHandler.removeListeners()`).
   */
  public cleanup(): void {
    // tweb :957 — ПЕРВАЯ строка cleanup: гасим rAF-цикл прогресса ДО снятия
    // видео-регистрации ниже (иначе цикл, всё ещё владеющий middleware этого
    // же вызова, мог бы отработать ещё один кадр над уже отсоединяемым видео).
    cancelAnimationFrame(this.videoProgressRAF)

    this.releaseVideoAvatars()
    this.listenerSetter.removeAll()
    this.swipeHandler.removeListeners()
    this.intersectionObserver.disconnect()
    // Наблюдатель уже отключён (строка выше) — колбэки выстрелить не могут,
    // но Map держала бы ссылки на отсоединённые узлы `.profile-avatars-avatar`
    // до следующего setPeer(); симметрично тому, что setPeer() делает при
    // смене пира (`this.loadCallbacks.clear()`).
    this.loadCallbacks.clear()
    this.middlewareHelper.destroy()
  }
}
