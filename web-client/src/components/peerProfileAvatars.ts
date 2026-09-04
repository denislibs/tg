// src/components/peerProfileAvatars.ts
//
// Карусель аватаров шапки профиля — порт tweb `src/components/
// peerProfileAvatars.ts` (класс `PeerProfileAvatars`, 974 строки). Разбор с
// адресами — `docs/tweb/right-sidebar.md` § 3.3 и § 5.1.
//
// ЭТО ЗАДАЧА 1 из шести (`docs/superpowers/plans/
// 2026-09-05-profile-avatars-class.md`): только каркас — поля, конструктор,
// DOM, `addTab()`, `setCollapsed`/`isCollapsed`/`updateHeaderFilled`,
// `cleanup()`. Данные (`ListLoader`, `processItem` в полном объёме), жесты
// (клик/свайп) и связка со сворачиванием через `useCollapsable` — задачи 2-4,
// в этом файле их нет. Класс пока никем не монтируется — это нормально,
// встраивание в `UserInfoPanel.tsx` через `useImperativeIsland` — задача 5.
//
// DOM (конструктор, tweb :81-109), порядок детей дословный:
//
//   div.profile-avatars-container
//     ├ div.profile-avatars-avatars       (флекс-лента, задача 2 наполнит)
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
//  • Константы `SCALE`/`TRANSLATE_TEMPLATE`/`LOAD_NEAREST` (tweb :39-41, :38) —
//    объявлены НЕ здесь: TS strict роняет сборку на объявленной, но нигде не
//    прочитанной константе («неиспользуемые переменные не пройдут сборку»,
//    `web-client/CLAUDE.md`), а читают их только `goWithoutTransition`/`onJump`
//    (задача 2) и ленивая загрузка (задача 2). Появятся вместе с кодом,
//    который их использует.
//  • `goWithoutTransition(distance)` объявлен по контракту интерфейса (задачи
//    2-5 на него опираются), тело пустое — наполнит задача 2 (`ListLoader.go`).
//  • Ветка топика (:396-400) — единственная ветка `setPeer`, которую эта
//    задача рисует: у темы форума нет истории фото, поэтому карусели и
//    `ListLoader` нет, только один аватар. СЕГОДНЯ НЕДОСТИЖИМА: ни один
//    вызывающий threadId в `setPeer` не передаёт (`UserInfoPanel.tsx` его не
//    знает вовсе, а класс пока никем не монтируется) — портирована на
//    будущее. Оригинал рисует аватар через `processItem` (:807-861,
//    `avatarNew({size:120,...}).render({peerId, threadId})`) — `threadId`
//    уходит в render и превращает узел в иконку темы форума; у нашего порта
//    `avatarNew` (`components/avatar.ts`) threadId не принимает вовсе и тем
//    форума не знает (уже объявленный вычет в самом avatar.ts: «топики
//    форума... — ни того, ни другого в модели нет»), поэтому у вызова ниже
//    вместо иконки темы встаёт обычный аватар пира — разбор и критерий
//    закрытия у самой строки вызова и в `web-client/backlogs/frontend/
//    profile-topic-avatar.md`. Полный `processItem` (лента,
//    `IntersectionObserver`, полоски) — задача 2.
import { avatarNew, type AvatarManagers } from '@components/avatar'
import Icon from '@components/icon'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'

export default class PeerProfileAvatars {
  // tweb :42.
  private static readonly BASE_CLASS = 'profile-avatars'

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
  private readonly managers: AvatarManagers
  private readonly setCollapsedOn: HTMLElement
  private readonly scrollableEl: HTMLElement

  // См. докблок выше — у нас фон-паттерн профиля не портирован, значение
  // всегда false, но поле реальное: от него зависят пороги ниже (tweb :930).
  private readonly hasBackgroundColor = false

  // this.peerId/this.threadId оригинала (:377-378) здесь не заведены: их
  // читает только processItem/onJump (задача 2) — TS strict роняет сборку на
  // приватном поле, которое ни разу не ПРОЧИТАНО («неиспользуемые переменные
  // не пройдут сборку», web-client/CLAUDE.md), а в этой задаче setPeer их
  // только пишет. Поля появятся вместе с первым читателем.

  public onNeedWhiteChanged?: (needWhite: boolean) => void

  constructor(options: {
    managers: AvatarManagers
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
   * tweb :376-521 в объёме этой задачи: только определение ветки (топик/не
   * топик) и подготовка контейнера. Получение фото пира
   * (`managers.appPeersManager.getPeerPhoto`, :383), фон-паттерн
   * (`applyAppearance`, :390 — см. докблок выше) и сборка `ListLoader` со
   * всеми её ветками (:396-521) — задача 2.
   */
  public async setPeer(peerId: PeerId, threadId?: number): Promise<void> {
    this.middlewareHelper.clean()

    if (!threadId) {
      // Список фото пира/чата и ListLoader — задача 2 (tweb :396-521).
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

  /** Объявлен по контракту интерфейса — наполнит задача 2 (`ListLoader.go`,
   *  сдвиг `this.avatars.style.transform`, tweb :365-374). */
  public goWithoutTransition(_distance: number): void {}

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
    // tweb :931-933 — сброс ленты на первый кадр через `listLoader.index`;
    // самого `ListLoader` в этой задаче нет (задача 2), пропускаем.
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
   * tweb :957-973, в объёме этой задачи: снять слушатели `listenerSetter`
   * (в этой задаче их не регистрируется — появятся вместе со свайпом/видео,
   * задачи 2-3, метод уже готов их принять) и уничтожить `middlewareHelper`
   * (гасит подписку топик-аватара на зеркало пиров, `components/avatar.ts`:
   * `live.delete`). rAF видео-прогресса, регистрация в `animationIntersector`,
   * `swipeHandler` и `intersectionObserver` — их источников в этой задаче нет.
   */
  public cleanup(): void {
    this.listenerSetter.removeAll()
    this.middlewareHelper.destroy()
  }
}
