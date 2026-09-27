// src/components/avatar.ts
//
// Порт tweb `src/components/avatarNew.tsx` (`AvatarNew` + фабрика `avatarNew`,
// avatarNew.tsx:402-1140) в ванильный модуль: узел
// `div.avatar.avatar-like.avatar-{size}.avatar-gradient`, который сам держит своё
// содержимое — фотографию, stripped-подложку под ней, инициалы или иконку — и
// перерисовывается, когда карточка пира изменилась.
//
// Оригинал написан на solid-js. Solid в проекте нет, и заводить его нельзя,
// поэтому реактивность заменена ровно тем приёмом, которым это уже сделано у
// имени пира (`components/chat/peerTitle.ts`, порт tweb `PeerTitle`): состояние
// живёт полями инстанса, а «эффект» — один метод `apply()`, который
// пересобирает детей узла. Второго механизма не изобретаем.
//
// ─── Откуда берутся факты (ни один не вычисляется здесь второй раз) ─────────
//  • карточка пира — синхронно из зеркала `core/peerCache.ts` (владелец —
//    воркерный `peersManager`), промах объявляется владельцу
//    `managers.peers.fillMirror([peerId])` ровно один раз, как в `peerTitle.ts`;
//  • цвет — `components/peerColor.ts::peerAvatarColorByPeer` (порт
//    `getPeerAvatarColorByPeer`): узел получает `data-color`, градиент собирает
//    CSS из `--peer-avatar-*` (`styles/tweb/_avatar.scss:14-66`);
//  • инициалы — `components/wrappers/getPeerInitials.ts` (порт одноимённого
//    враппера tweb), он же тянет `wrapAbbreviation`;
//  • картинка — `core/media/ensureMediaUrl.ts`, ЕДИНСТВЕННАЯ ванильная точка
//    входа за URL медиа (ванильный близнец React-хука `useMediaUrl`, которым
//    грузит фотографию `shared/ui/Avatar`). Своего похода к владельцу здесь
//    нет — пин `core/noDuplicateMediaUrl.test.ts` его бы и не пропустил.
//
// ─── Обновление по изменению карточки ──────────────────────────────────────
// tweb ловит `avatar_update`/`peer_title_edit` модульным слушателем и находит
// живые инстансы в `avatarsMap` (avatarNew.tsx:56-93). У нас карточка пира
// приезжает движением зеркала, поэтому подписка одна на модуль
// (`subscribePeerMirror`), а реестр живых узлов чистится по `middleware.onClean`
// — ровно как в `peerTitle.ts` и по той же причине: узел бабла существует ДО
// монтирования в документ, и скан `document.querySelectorAll` его бы не нашёл.
// Реестр при этом аватарками НЕ владеет (tweb e19e8831d): держит их слабо,
// а жизнь аватарки определяет её узел — см. `live` ниже.
//
// ─── Что сознательно НЕ портировано (предмет отсутствует) ──────────────────
//  • истории (`StoriesSegments`, `has-stories`, `avatar-stories-*`,
//    avatarNew.tsx:280-400) — подсистемы историй у ленты нет;
//  • видео-аватарки (`loadAvatarVideoOverlay`, :147-186) — `pFlags.has_video`
//    и размеров `photo_video`/`photo_video_full` наша модель фото не объявляет;
//  • топики форума (`threadId` → `wrapTopicIcon`, :773-784), монофорум
//    (:756-760, :806) — ни того, ни другого в модели нет;
//  • `mynotes`/`asAllChats` и `savedAsForum` у «Избранного» (:729-753) —
//    заметок, «всех чатов» и настройки «Избранное как форум» у нас нет; сама
//    ветка «Избранного» (`isDialog` + свой пир → иконка `saved`) портирована
//    для чипа пира глобального поиска (`components/selectorEntity.ts`);
//  • `lazyLoadQueue` (:917-945) и реестр `believeMe` — очереди ленивой
//    загрузки у ленты нет (её `LazyLoadQueue` не портирован);
//  • `autoDeletePeriod` (:445-472, :1029-1045), `isSubscribed`
//    (`avatar-star`), premium-звезда — предметов нет;
//  • `REPLIES_PEER_ID` (:831-834) — служебного пира «Replies» у нас нет,
//    константы тоже (`core/peers/peerId.ts` объявляет только NULL/SERVICE/HIDDEN);
//  • `props.isBig` (:804, :817, :644-655 — выбор `photo_big`/`photo_small` и
//    видео-оверлея по ступеням) и `props.accountNumber` (мультиаккаунт) —
//    у нашей карточки пира ОДИН `photo_id` без ступеней (`core/peers/peer.ts:80`),
//    решать в `putAvatar` нечего — предмета нет, а не забыто.
//
// Задача 7 (`docs/superpowers/plans/2026-09-05-profile-avatars-class.md`)
// портировала `size: 'full'` (класс `avatar-full`, :1073 — тот же шаблон
// `avatar-${size}`, строкой он и так работал) и `noFadeIn` (:409, :549 —
// глушит анимацию проявления фотографии, см. `putAvatar`). Единственный
// вызывающий — `peerProfileAvatars.ts::processItem`, первый элемент ленты.
//
// ─── Известный долг разметки (НЕ чинится здесь) ────────────────────────────
// Класс `avatar-{size}` ставится безусловно, как в оригинале (:1073), а
// `--size`/`--multiplier` под него объявлены только для перечисленных в
// `_avatar.scss:279-421` размеров. Размер, которого там нет, останется на
// дефолтных 54px — это свойство оригинала, а не наше упрощение.
import Icon from '@components/icon'
import getPeerInitials from '@components/wrappers/getPeerInitials'
import { peerAvatarColorByPeer, type PeerColorName } from '@components/peerColor'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import { renderImageFromUrlPromise } from '@helpers/dom/renderImageFromUrl'
import liteMode from '@helpers/liteMode'
import type { Middleware, MiddlewareHelper } from '@helpers/middleware'
import { cachedMediaUrl } from '@core/mediaCache'
import type { MyPhoto } from '@core/media/messageMedia'
import wrapPhoto from '@components/wrappers/photo'
import { ensureMediaUrl } from '@core/media/ensureMediaUrl'
import { getPreviewURLFromStrippedThumb } from '@core/media/getStrippedThumbIfNeeded'
import { cachedPeer, subscribePeerMirror } from '@core/peerCache'
import { getPeerPhoto, getPeerPhotoId, getPeerPhotoStrippedThumb } from '@core/peers/peer'
import { HIDDEN_PEER_ID, NULL_PEER_ID, isUser } from '@core/peers/peerId'
import { wrapAbbreviation } from '@lib/richtext/abbreviation'
import type { IconName } from '@core/tgico-icons'
import rootScope from '@lib/rootScope'
import { MOUNT_CLASS_TO } from '@config/debug'

/** tweb avatarNew.tsx:52 — та же длительность, что у `.fade-in` в `_avatar.scss:126`. */
const FADE_IN_DURATION = 200

/**
 * Значения `data-color`, которыми пользуется аватарка. Семь цветов пира —
 * `PEER_COLOR_NAMES` (порт `DialogColors`), плюс `archive`: его ставит ветка
 * удалённого аккаунта (avatarNew.tsx:789) в обход палитры пиров, и правило под
 * него в `_avatar.scss:54-57` есть. Остальные значения партиала (`premium`,
 * `stars`, `saved`) выставляют не портированные ветки — см. шапку.
 */
type AvatarColorName = PeerColorName | 'archive'

/** Срез менеджеров, который нужен аватарке: объявить пробел зеркала карточек.
 *  Форма — та же, что у `PeerTitleManagers` (`chat/peerTitle.ts`), и это один и
 *  тот же метод владельца. */
export interface AvatarManagers {
  peers: { fillMirror(ids: number[]): Promise<void> }
}

export interface AvatarOptions {
  /** знаковый ключ пира; карточка берётся из зеркала */
  peerId?: PeerId
  /** готовое имя строкой — карточки пира нет и быть не может (порт `peerTitle`
   *  оригинала, avatarNew.tsx:410; там же он уводит `peerId` в `NULL_PEER_ID`) */
  peerTitle?: string
  /** размер в пикселях, либо `'full'` — уезжает в класс `avatar-{size}` (:417,
   *  :1073) буквально тем же шаблоном; `avatar-full` (`_avatar.scss:447`)
   *  растягивает узел на 100% родителя вместо фиксированного `--size`. */
  size: number | 'full'
  /** гасит анимацию проявления фотографии (:409, :549) — см. `putAvatar`. */
  noFadeIn?: boolean
  /** свой пир рисуется «Избранным» (иконка `saved`, :735-738), а не
   *  собственной фотографией — как строка списка чатов. */
  isDialog?: boolean
  middleware: Middleware
  managers: AvatarManagers
}

// Живые аватарки, ждущие движения зеркала карточек. Аналог `avatarsMap` +
// модульных слушателей `avatar_update`/`peer_title_edit` (avatarNew.tsx:56-120):
// подписка одна на модуль, а не по одной на узел.
//
// tweb e19e8831d — реестр НЕ владеет тем, что отслеживает. Раньше он держал
// аватарки сильно и отпускал только по `middleware.onClean`, поэтому
// аватарка, чей владелец мидлварь не погасил (вызов вне зоны актуальности,
// мидлварь, которая не выстрелила), держала всё отсоединённое поддерево до
// закрытия вкладки. Теперь аватаркой владеет её УЗЕЛ (`avatarByElement`), а
// реестр указывает на неё слабо: аватарка с достижимым узлом — смонтированным
// или отложенным на перемонтаж, как строки списка чатов, — продолжает
// обновляться, а выброшенная насовсем уносит свою запись с собой.
const live = new Set<WeakRef<Avatar>>()
const avatarByElement = new WeakMap<HTMLElement, Avatar>()
const collectedAvatars = new FinalizationRegistry<WeakRef<Avatar>>((ref) => {
  live.delete(ref)
})

// Обход заодно выбрасывает ссылки, чья аватарка уже собрана, а финализатор
// ещё не отработал.
subscribePeerMirror(() => {
  for (const ref of live) {
    const avatar = ref.deref()
    if (!avatar) {
      live.delete(ref)
      continue
    }

    avatar.render()
  }
})

// Для диагностики (tweb — то же имя): размер реестра — самый дешёвый способ
// понять, отпускаются ли аватарки.
if (MOUNT_CLASS_TO) MOUNT_CLASS_TO.avatarsMap = live

class Avatar {
  public readonly node: HTMLDivElement
  /** Порт `readyThumbPromise` (avatarNew.tsx:475). Его ждёт серия баблов
   *  (`chat/bubbleGroups.ts::createAvatar`, tweb bubbleGroups.ts:150). */
  public readonly readyThumbPromise: CancellablePromise<void>

  private readonly middlewareHelper: MiddlewareHelper
  /** пробел зеркала объявляем один раз на промах — как в `peerTitle.ts` */
  private declaredGap = false

  // Состояние, которое в оригинале держат сигналы solid (:429-437).
  private icon?: IconName
  private media?: HTMLElement
  private thumb?: HTMLElement
  private abbreviature?: Node[]
  private color?: AvatarColorName
  private isForum = false

  constructor(private readonly options: AvatarOptions) {
    // tweb :479 — дочерний scope: `render()` гасит прошлое поколение своим
    // `clean()`, а смерть вызывающего гасит всё.
    this.middlewareHelper = options.middleware.create()
    this.readyThumbPromise = deferredPromise<void>()

    const node = this.node = document.createElement('div')
    // :1073 — четыре класса безусловно, ровно в этом порядке.
    node.className = `avatar avatar-like avatar-${options.size} avatar-gradient`
    if (options.peerId !== undefined) {
      node.dataset.peerId = '' + options.peerId // :1076
    }

    // :1113-1119 — рендер запускается сразу, если есть чем рисовать.
    if (options.peerId !== undefined || options.peerTitle !== undefined) {
      this.render()
    }

    // Имя строкой измениться не может — такому узлу реестр не нужен.
    if (options.peerTitle === undefined && options.peerId !== undefined) {
      const selfRef = new WeakRef<Avatar>(this)
      live.add(selfRef)
      collectedAvatars.register(this, selfRef, this)
      options.middleware.onClean(() => {
        live.delete(selfRef)
        collectedAvatars.unregister(this) // уже не в реестре — финализатору делать нечего
      })
    }

    // Сильное ребро, на которое опирается слабый реестр: пока достижим узел,
    // достижима и его аватарка (tweb e19e8831d).
    avatarByElement.set(node, this)
  }

  /**
   * Порт `render` (:891-975) в применимом объёме: сброс поколения + `_render` +
   * `processResult`.
   *
   * У оригинала `render` асинхронный, потому что `_render` ждёт топики, сегменты
   * историй и связанный монофорум — ни одной из этих веток здесь нет, и всё, что
   * осталось, считается синхронно. Поэтому `processResult` (:876-883) —
   * «фотографии нет, показать то, что уже выставлено, и отпустить ждущих» —
   * применяется тоже синхронно, а не после `await`.
   */
  public render(): void {
    this.middlewareHelper.clean()
    const middleware = this.middlewareHelper.get()

    if (!this.renderInner(middleware)) {
      // :877-879 — `if(!result) _setMedia()`: фотографии нет, ждущих отпускаем.
      this.setMedia(undefined)
    }
  }

  /** Порт `_render` (:719-885). Возвращает «загрузка фотографии запущена» —
   *  это и есть `result` оригинала в нашем объёме. */
  private renderInner(middleware: Middleware): boolean {
    const { peerTitle: title, managers } = this.options
    // :725-727 — имя строкой означает «пира нет», и ключ уходит в NULL.
    const peerId = title !== undefined ? NULL_PEER_ID : this.options.peerId

    if (title) {
      // :763-771. Цвет там — `getPeerAvatarColorByPeer(peer)` по карточке
      // NULL_PEER_ID, то есть `undefined`: узел остаётся без `data-color`.
      this.set({ abbreviature: wrapAbbreviation(title) })
      return false
    }

    if (peerId === undefined) {
      return false
    }

    // :735-738 — «Избранное». `meAsNotes`/`savedAsForum` — см. шапку.
    if (peerId === rootScope.myId && this.options.isDialog) {
      this.set({ icon: 'saved_filled' })
      return false
    }

    // Скрытая атрибуция пересылки — не пир: карточки для этого ключа не
    // существует и появиться не может, спрашивать зеркало не о чем (тот же
    // порядок, что у `peerTitle.ts` для `HIDDEN_PEER_ID`).
    const peer = peerId === HIDDEN_PEER_ID || peerId === NULL_PEER_ID ? undefined : cachedPeer(peerId)
    if (!peer && peerId !== HIDDEN_PEER_ID && peerId !== NULL_PEER_ID && !this.declaredGap) {
      // Гейт `!declaredGap` — ровно как в `peerTitle.ts:131-134`: пробел
      // объявляется ОДИН раз. Без него каждый промах зеркала слал бы новый
      // `fillMirror` за той же карточкой, а промахов подряд столько же, сколько
      // перерисовок: узел перерисовывается на КАЖДОЕ движение зеркала (:111),
      // в том числе на чужое.
      this.declaredGap = true
      managers.peers.fillMirror([peerId]).catch(() => { this.declaredGap = false })
    }

    // :788-791 — удалённый аккаунт: серая подложка и своя иконка, инициалов нет.
    if (peerId !== NULL_PEER_ID && isUser(peerId) && peer?._ === 'user' && peer.pFlags?.deleted) {
      this.set({ color: 'archive', icon: 'deletedaccount_filled' })
      return false
    }

    const isForum = peer?._ === 'channel' && !!peer.pFlags?.forum // :794

    const photo = getPeerPhoto(peer)
    const photoId = getPeerPhotoId(photo)
    const avatarAvailable = !!photoId // :808
    // :809 — фотография уже нарисована: инициалы поверх неё не выставляем.
    const avatarRendered = avatarAvailable && !!this.media
    // :811 `apiManagerProxy.isAvatarCached(peerId, size)`. У нас попадание в
    // зеркало URL медиа (`core/mediaCache.ts`) — тот же вопрос: байты уже есть,
    // значит подложка с инициалами мигнёт зря.
    const isAvatarCached = avatarAvailable && cachedMediaUrl(photoId) !== undefined

    let isSet = false
    if (!avatarRendered && !isAvatarCached) {
      // :826-828. Терм `peerId !== myId || !isDialog` не нужен: свой пир с
      // `isDialog` уже ушёл веткой «Избранного» выше.
      const color = peerId ? peerAvatarColorByPeer(peerId, !!peer) : undefined

      if (peerId === HIDDEN_PEER_ID) { // :836-838
        this.set({ color: 'violet', icon: 'author_hidden' })
        return false
      }

      this.set({ abbreviature: getPeerInitials(peer), color, isForum }) // :842-849
      isSet = true
    }

    if (avatarAvailable) {
      const loadThumbPromise = this.putAvatar(photoId, getPeerPhotoStrippedThumb(photo), middleware)
      if (isSet) {
        return true // :859-861
      }

      // :863-875 — фотография УЖЕ показана (перерисовка той же аватарки): форму
      // узла меняем только после того, как новая картинка доехала, иначе
      // круг/квадрат прыгнет под ещё старым изображением.
      if (isForum !== this.isForum) {
        void loadThumbPromise.then(() => {
          if (!middleware()) return
          this.isForum = isForum
          this.apply()
        })
      }

      return true
    }

    return false
  }

  /**
   * Порт `putAvatar` (:530-660) в применимом объёме.
   *
   * Лестницы размеров (`photo_small`/`photo_big` и предзагрузка малого перед
   * большим, :566-573) у нас нет: фотография пира — ОДИН `photo_id`
   * (`core/peers/peer.ts:80`), а `isBig` не портирован вместе с профилем.
   *
   * @returns аналог `loadThumbPromise` (:653) — «подложка либо сама фотография
   *          доехали»; на нём висит отложенная смена формы узла выше.
   */
  private putAvatar(photoId: number, strippedThumb: string, middleware: Middleware): Promise<void> {
    // :549 `cached = !(result instanceof Promise)` — попадание в зеркало URL:
    // байтов ждать не надо, значит и анимации проявления быть не должно.
    const cached = cachedMediaUrl(photoId) !== undefined
    // :549 `!props.noFadeIn` — вызывающий явно просит без анимации (задача 7:
    // первый элемент карусели профиля меняет маленький кэшированный кружок на
    // большую фотографию, и проявление сквозь него дало бы «мигание» цветом).
    const animate = !cached && liteMode.isAvailable('animations') && !this.options.noFadeIn // :551

    const image = document.createElement('img') // :552
    image.className = animate ? 'avatar-photo fade-in' : 'avatar-photo' // :554

    let renderThumbPromise: Promise<void> | undefined
    if (!cached && strippedThumb) { // :574-589
      const thumbImage = document.createElement('img')
      thumbImage.className = 'avatar-photo avatar-photo-thumbnail'
      renderThumbPromise = renderImageFromUrlPromise(
        thumbImage,
        getPreviewURLFromStrippedThumb(strippedThumb),
      ).then(() => {
        // :584 — полная картинка успела приехать раньше подложки: подложка уже
        // не нужна, показывать её значит мигнуть назад.
        if (this.media || !middleware()) return
        this.setThumb(thumbImage)
      })
    }

    const callback = () => { // :592-606
      if (!middleware()) return

      this.setMedia(image)
      if (animate) {
        // :599-602 — снимаем `fade-in` и подложку ПО ТАЙМЕРУ, а не по
        // `animationend`: так класс уходит даже если анимация не отыграла.
        setTimeout(() => {
          image.classList.remove('fade-in')
          this.setThumb(undefined)
        }, FADE_IN_DURATION)
      } else {
        this.setThumb(undefined)
      }
    }

    const renderPromise = ensureMediaUrl(photoId, { middleware })
      .then((url) => renderImageFromUrlPromise(image, url))
      .then(callback, () => {
        // :609-618 — загрузка провалилась (404 протухшего photo_id, сеть, смерть
        // поколения): остаёмся на подложке с инициалами, НО ждущих отпускаем.
        // Серия баблов ждёт `readyThumbPromise` — оставить его висеть значит
        // подвесить открытие чата.
        if (middleware()) this.readyThumbPromise.resolve!()
      })

    return cached ? renderPromise : renderThumbPromise ?? Promise.resolve() // :653
  }

  /** Порт `set` (:663-705): состояние выставляется ЦЕЛИКОМ, прежние фотография
   *  и подложка сбрасываются. */
  private set(state: {
    abbreviature?: DocumentFragment
    icon?: IconName
    color?: AvatarColorName
    isForum?: boolean
  }): void {
    this.thumb = undefined
    this.media = undefined
    this.icon = state.icon
    // `documentFragmentToNodes` оригинала (:766, :843): фрагмент одноразовый —
    // вставка выносит из него детей, и повторный `apply()` дал бы пустой узел.
    this.abbreviature = state.abbreviature ? Array.from(state.abbreviature.childNodes) : undefined
    this.color = state.color
    this.isForum = !!state.isForum
    this.apply()
  }

  /** Порт `setIcon` (:430, :1093) — сигнал оригинала: меняется ТОЛЬКО иконка,
   *  остальное состояние остаётся. Им чип даты ставит `calendarfilter` на
   *  аватар без пира (`selectorSearch.ts:385`). */
  public setIcon(icon?: IconName): void {
    this.icon = icon
    this.apply()
  }

  /** Порт `_setMedia` (:492-497). */
  private setMedia(media?: HTMLElement): void {
    this.media = media
    this.apply()
    this.readyThumbPromise.resolve!()
  }

  /** Порт `_setThumb` (:499-503). */
  private setThumb(thumb?: HTMLElement): void {
    this.thumb = thumb
    this.apply()
    this.readyThumbPromise.resolve!()
  }

  /** Роль JSX-выражения оригинала (:1022-1027 — дети, :1007-1011 — классы,
   *  :1075 — `data-color`): пересобрать узел под текущее состояние. */
  private apply(): void {
    const children: Node[] = []
    if (this.icon) {
      children.push(Icon(this.icon, 'avatar-icon', 'avatar-icon-' + this.icon)) // :1024
    }
    if (this.thumb) {
      children.push(this.thumb) // :1025
    }
    // :1026 `[media(), abbreviature()].find(Boolean)` — фотография ВМЕСТО
    // инициалов, а не поверх них.
    if (this.media) children.push(this.media)
    else if (this.abbreviature) children.push(...this.abbreviature)

    this.node.replaceChildren(...children)

    if (this.color) this.node.dataset.color = this.color
    else delete this.node.dataset.color

    this.node.classList.toggle('is-forum', this.isForum) // :997
    // :1003 — подложка и фотография стакаются только когда обе в дереве.
    this.node.classList.toggle('avatar-relative', !!this.thumb)
  }
}

/**
 * Порт `wrapPhotoToAvatar` (avatarNew.tsx:223-268): отдельное ФОТО (не
 * аватарка пира) в узел аватарки — `wrapPhoto` в круге. Нужен служебному
 * баблу смены фото чата (`chat/serviceMediaBubble.ts`): у действия своё фото,
 * а не текущая аватарка группы.
 *
 * Классы медиа меняются на классы аватарки так же, как у оригинала:
 * `media-container` → `avatar-relative`, `media-photo` → `avatar-photo`,
 * подложка — ещё и `avatar-photo-thumbnail`; размеры, которые выставил
 * `wrapPhoto`, снимаются — круг задаёт класс `avatar-{size}`.
 *
 * Отличия: мидлварь приходит параметром (у оригинала — `avatarElem.
 * getMiddleware()`, у нашей фабрики поколения наружу нет); видео-вариант
 * (`video_sizes`, :260-264) не портирован — в нашей модели фото его нет (см.
 * шапку файла).
 */
export function wrapPhotoToAvatar(
  avatarElem: { node: HTMLDivElement },
  photo: MyPhoto,
  boxSize: number,
  middleware: Middleware,
): Promise<unknown> {
  return wrapPhoto({
    container: avatarElem.node,
    photo,
    boxHeight: boxSize,
    boxWidth: boxSize,
    withoutPreloader: true,
    // :230-234 — фото уже на руках: проявление не проигрываем.
    noFadeIn: cachedMediaUrl(photo.id) !== undefined,
    middleware,
  }).then((result) => {
    avatarElem.node.classList.replace('media-container', 'avatar-relative')
    avatarElem.node.style.width = avatarElem.node.style.height = ''
    for (const image of [result.images.thumb, result.images.full]) {
      image?.classList.replace('media-photo', 'avatar-photo')
    }
    result.images.thumb?.classList.add('avatar-photo-thumbnail')
    return result.loadPromises.thumb
  })
}

/**
 * Порт фабрики `avatarNew` (avatarNew.tsx:1132-1139) — точка входа для
 * императивного кода. Форма результата — та, которую ждёт серия баблов
 * (`GroupAvatar` в `chat/bubbleGroups.ts`).
 */
export function avatarNew(options: AvatarOptions): {
  node: HTMLDivElement
  readyThumbPromise: Promise<void>
  setIcon: (icon?: IconName) => void
} {
  const avatar = new Avatar(options)
  return {
    node: avatar.node,
    readyThumbPromise: avatar.readyThumbPromise,
    setIcon: (icon) => avatar.setIcon(icon),
  }
}
