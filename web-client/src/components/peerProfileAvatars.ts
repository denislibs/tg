// src/components/peerProfileAvatars.ts
//
// Карусель аватаров шапки профиля — порт tweb `src/components/
// peerProfileAvatars.ts` (класс `PeerProfileAvatars`, 974 строки). Разбор с
// адресами — `docs/tweb/right-sidebar.md` § 3.3 и § 5.1.
//
// ЭТО ЗАДАЧИ 1-2 из шести (`docs/superpowers/plans/
// 2026-09-05-profile-avatars-class.md`): каркас (поля, конструктор, DOM,
// `addTab()`, `setCollapsed`/`isCollapsed`/`updateHeaderFilled`, `cleanup()`,
// задача 1) плюс данные и лента (`ListLoader`, `processItem`, ленивая
// догрузка, `onJump`, `goWithoutTransition`, задача 2). Жесты (клик/свайп) и
// связка со сворачиванием через `useCollapsable` — задачи 3-4, в этом файле
// их нет. Класс пока никем не монтируется — это нормально, встраивание в
// `UserInfoPanel.tsx` через `useImperativeIsland` — задача 5.
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
//     └ div.profile-avatars-info          (задача 5 положит Name/Subtitle)
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
//    (tweb `peerTitle.ts:236`), а красить в `this.info` пока нечего: имя/статус
//    кладёт туда задача 5. Строка не вызывается, а не заглушена.
//  • Ветка топика (:396-400) — единственная ветка `setPeer`, которую задача 1
//    рисует: у темы форума нет истории фото, поэтому карусели и `ListLoader`
//    нет, только один аватар. СЕГОДНЯ НЕДОСТИЖИМА: ни один вызывающий threadId
//    в `setPeer` не передаёт (`UserInfoPanel.tsx` его не знает вовсе, а класс
//    пока никем не монтируется) — портирована на будущее. Оригинал рисует
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
//    `videoMediaId`, см. комментарий у ветки в `processItem`); первый элемент
//    ленты рисуется размером 120 вместо `avatar-full` (наш `avatarNew` не
//    принимает `size:'full'`), долг `web-client/backlogs/frontend/
//    profile-avatars-full-size.md`; пагинация — `loadMore` отдаёт одну
//    страницу (ручка не постраничная).
import { avatarNew, type AvatarManagers } from '@components/avatar'
import Icon from '@components/icon'
import animationIntersector from '@components/animationIntersector'
import ListLoader from '@components/mediaViewer/listLoader'
import ListenerSetter from '@helpers/listenerSetter'
import { fastRaf } from '@helpers/schedulers'
import { renderImageFromUrlPromise } from '@helpers/dom/renderImageFromUrl'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import { isUser, toUserId } from '@core/peers/peerId'
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
  public readonly info: HTMLElement
  private readonly tabs: HTMLDivElement
  private readonly arrowPrevious: HTMLElement
  private readonly arrowNext: HTMLElement

  private readonly listenerSetter: ListenerSetter
  private readonly middlewareHelper: MiddlewareHelper
  private readonly managers: PeerProfileAvatarsManagers
  private readonly setCollapsedOn: HTMLElement
  private readonly scrollableEl: HTMLElement

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

  // this.peerId/this.threadId оригинала (:377-378) здесь НЕ заведены и
  // задачей 2 тоже: она вместо этого замыкает `peerId`/`threadId` —
  // параметры КОНКРЕТНОГО вызова setPeer — прямо в loadMore/processItem/
  // onJump, которые собираются внутри самого setPeer (см. его тело). Так
  // надёжнее, чем общее мутируемое поле: у нас (в отличие от tweb, где под
  // новый пир создаётся НОВЫЙ инстанс класса) один инстанс переживает смену
  // пира, и протухший вызов, читающий `this.peerId`, рисковал бы получить
  // peerId уже СЛЕДУЮЩЕГО пира. Поля появятся, когда настоящий инстанс-
  // уровневый читатель появится (клик/свайп задачи 3 — им нужен peerId
  // «что сейчас показано», а не «чей был этот конкретный вызов»).

  public onNeedWhiteChanged?: (needWhite: boolean) => void

  constructor(options: {
    managers: PeerProfileAvatarsManagers
    setCollapsedOn: HTMLElement
    scrollableEl: HTMLElement
  }) {
    this.managers = options.managers
    this.setCollapsedOn = options.setCollapsedOn
    this.scrollableEl = options.scrollableEl

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

    // tweb :300-307 — колбэк наблюдателя зовёт loadNearestToTarget на самой
    // пересёкшейся entry, ничего больше.
    this.intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) this.loadNearestToTarget(entry.target)
      }
    })
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
    this.middlewareHelper.clean()

    if (!threadId) {
      this.avatars.replaceChildren()
      this.tabs.replaceChildren()
      this.container.classList.remove('is-single')
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
      return
    }

    // tweb :396-400 — у темы форума нет истории фото: контейнер получает
    // is-topic, а вместо карусели — один статичный аватар без ListLoader.
    this.container.classList.add('is-topic')

    // ВЕТКА СЕГОДНЯ НЕДОСТИЖИМА, портирована на будущее: единственный
    // конструктор `UserInfoPanel` (`components/Chat.tsx:1427`) вызывает панель
    // БЕЗ threadId вовсе (грепом по `UserInfoPanel.tsx` — ни одного упоминания
    // threadId), а сам класс пока никем не монтируется (задача 5). Как только
    // появится вызывающий с threadId — читай это ПЕРЕД тем, как трогать код
    // ниже.
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
          // tweb :822-841 — size:'full' (масштабируется под .profile-avatars-
          // avatar через CSS-класс `avatar-full`, `_avatar.scss:447`). Наш
          // avatarNew принимает только фиксированное число размера (его же
          // докблок: «size:'full' — вызывающих нет»); 120 — визуальный
          // компромисс, расхождение и критерий закрытия —
          // web-client/backlogs/frontend/profile-avatars-full-size.md.
          const avatarElem = avatarNew({
            peerId,
            size: 120,
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
   * tweb :500-520. Видео-прогресс rAF («будим самоприостановленный цикл»,
   * :519-520) — задача 3, здесь не трогаем: `startVideoProgressLoop` не
   * существует.
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
  }

  /**
   * tweb :929-944. `is-collapsed`/`need-white` вешаются на `setCollapsedOn`
   * (узел вкладки панели), а НЕ на собственный `container` — иначе классы
   * профиля не видны CSS-правилам шапки сайдбара, которые их ждут снаружи.
   *
   * В оригинале метод `private` — вызывающий живёт внутри того же класса
   * (клик/свайп, :310, :771). Здесь он `public`: клик/свайп и связка со
   * сворачиванием — задачи 3-4, до них вызывающего внутри класса нет, а
   * TS strict роняет сборку на приватном методе без единого вызова
   * («неиспользуемые переменные не пройдут сборку», web-client/CLAUDE.md).
   * Сузить обратно до `private` можно будет вместе с задачей 3/4, когда
   * появится внутренний вызывающий.
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
   * tweb :957-973 в объёме задачи 2: снятие видео-регистрации и наблюдателя
   * ленивой загрузки. rAF видео-прогресса и `swipeHandler` — задача 3, их
   * источников в этом файле пока нет.
   */
  public cleanup(): void {
    // tweb :963-969 — освобождаем зарегистрированные в animationIntersector
    // видео-аватарки: пока правая панель была закрыта, toggleVideosUnder мог
    // их ЗАЛОЧИТЬ, а залоченный элемент не снимается с учёта сам по себе при
    // уходе из DOM (checkAnimation игнорирует locked) — снимаем и освобождаем
    // декодер явно.
    this.container.querySelectorAll<HTMLVideoElement>('video.avatar-video').forEach((video) => {
      animationIntersector.removeAnimationByPlayer(video)
      video.pause()
      video.src = ''
      video.load()
    })
    this.listenerSetter.removeAll()
    this.intersectionObserver.disconnect()
    // Наблюдатель уже отключён (строка выше) — колбэки выстрелить не могут,
    // но Map держала бы ссылки на отсоединённые узлы `.profile-avatars-avatar`
    // до следующего setPeer(); симметрично тому, что setPeer() делает при
    // смене пира (`this.loadCallbacks.clear()`).
    this.loadCallbacks.clear()
    this.middlewareHelper.destroy()
  }
}
