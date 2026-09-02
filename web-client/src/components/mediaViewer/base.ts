// Каркас vanilla-ядра медиавьювера — порт tweb `src/components/mediaViewer/base.ts`
// (константы :81-105, конструктор DOM :318-445, листенеры/жесты `setListeners`
// :447-587, зум/пан `onSwipeFirst`/`onSwipeReset`/`onZoom` и математика
// :589-833, transform-стопка контейнера `buildMoversTransform` и поворот
// :835-966, клик/клавиатура `onClick`/`onKeyDown`/`onKeyUp` :1058-1174,
// глобальные листенеры :1036-1053, полёт открытия/закрытия `setMoverToTarget`
// :1176-1798 + `waitForMoverTransition` :1800-1845, toggleWholeActive
// :1847-1856, setFullAspect :1858-1882, removeCenterFromMover :1912-1926,
// moveTheMover :1928-1956, setNewMover :1958-1980, радиусы :2066-2114,
// floatings :2124-2193, center-стили :2236-2265, монтирование :2452-2455).
// Task 13 довёз наполнение медиа: `_openMedia` (порт tweb :2320-3005 в объёме
// фото), Task 15 — видео-ветку (tweb :2557-2896 + createPlayer :2627-2740,
// vanilla-плеер `@lib/mediaPlayer`, буферизация, updateVideoControlsLock
// :958-968), setAuthorInfo/caption как
// React-острова (createRoot), прелоадер на мувере, полный close()
// (tweb :975-1024) и layout-методы (:2195-2235). Message-подкласс —
// `appMediaViewer.ts` (Task 14, он же зовёт setListeners, как tweb
// index.ts:166); точки входа приложения — Task 16.
//
// Порядок append детей `.media-viewer-whole` — load-bearing: правила партиала
// `styles/tweb/_mediaViewer.scss` построены на соседях
// (`.zoom-container.is-visible ~ .media-viewer-caption`, `~ .media-viewer-movers`,
// tweb mediaViewer.scss:725,730) — не переставлять (пин — base.test.ts).
//
// Адаптации (поведение не менялось):
//   • Icon tweb (`icon.ts`) — общий модуль `@components/icon` (был локальной
//     копией `iconSpan` прямо здесь; копий было три — вынесены в один порт, как
//     в оригинале). ButtonIcon (`button.ts`/`buttonIcon.ts`) → локальный
//     `btnIcon`: та же разметка `button.btn-icon > span.tgico.button-icon`,
//     глифы — из нашей карты `@core/tgico-icons` (шрифт tgico); свап иконки
//     zoomin↔zoomout — локальный `replaceButtonIcon` (порт tweb button.ts:48-53
//     поверх `Icon`). Ripple у mobile-close (в tweb ButtonIcon без noRipple
//     вешает `rp` + `div.c-ripple`) не портирован: наш ripple — React-хук
//     (`shared/ui/Ripple`), vanilla-порт поедет вместе с оживлением кнопок в Task 13
//   • onClick: ветки live-стрима (PiP по клику в фон, admin-popup-container)
//     не портированы — RTMP-стримов нет (фичи не существует)
//   • Esc в tweb закрывает вьювер не клавиатурным листенером, а
//     `appNavigationController` (navigationItem в _openMedia :2429-2450). Сам
//     `navigationItem` (постановка, снятие, вето на снятие во время полёта
//     мувера, пауза на время картинки-в-картинке) живёт ЗДЕСЬ, как в оригинале;
//     наружу вынесена только механика стека — контроллер openMediaViewer.ts
//     (Task 16) отдаёт её инъекцией `navigation` (pushEsc + pushLayer)
//   • `getOverlayRoot()` в tweb (`helpers/appWindow.ts:33`) возвращает body
//     АКТИВНОГО окна (приложение целиком умеет переезжать в Document-PiP);
//     у нас в PiP уходит только видео (`core/pip.ts`) — всегда body главного
//     документа
//   • `lazyLoadQueue` tweb не портирован — понадобится только соседям по
//     листанию (Task 14); load в _openMedia запускается напрямую
//   • `middlewareHelper` мувера в tweb лежит прямо на HTMLElement (global.d.ts);
//     у нас HTMLElement не аугментирован — локальный тип `MoverElement`
import { createElement, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { formatFullSentTime } from '@helpers/date'
import EventListenerBase from '@helpers/eventListenerBase'
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'
import deferredPromise from '@helpers/cancellablePromise'
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent, hasMouseMovedSinceDown } from '@helpers/dom/clickEvent'
import findUpAsChild from '@helpers/dom/findUpAsChild'
import findUpClassName from '@helpers/dom/findUpClassName'
// Была локальная 16-строчная копия прямо в этом файле — вынесена в общий порт
// (`helpers/dom/createVideo.ts`), чтобы у императивной ленты и вьювера был один
// и тот же элемент, а не два разных набора атрибутов.
import createVideo from '@helpers/dom/createVideo'
import { isFullScreen } from '@helpers/dom/fullScreen'
import getVisibleRect from '@helpers/dom/getVisibleRect'
import liteMode from '@helpers/liteMode'
import { MediaSize } from '@helpers/mediaSize'
import mediaSizes, { setAttachmentSize } from '@helpers/mediaSizes'
import clamp from '@helpers/number/clamp'
import isBetween from '@helpers/number/isBetween'
import { doubleRaf, fastRaf } from '@helpers/schedulers'
import debounce, { type DebounceReturnType } from '@helpers/schedulers/debounce'
import windowSize from '@helpers/windowSize'
import blur from '@helpers/blur'
import renderImageFromUrl, { renderImageFromUrlPromise } from '@helpers/dom/renderImageFromUrl'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { type IconName } from '@core/tgico-icons'
import Icon from '@components/icon'
import { calcImageInBox } from '@core/dom/calcImageInBox'
import SwipeHandler, { type ZoomDetails } from '@core/dom/swipeHandler'
import { cachedMediaUrl } from '@core/mediaCache'
import { resolveStreamUrl } from '@core/mediaUrl'
import VideoPlayer from '@lib/mediaPlayer'
import { startClient } from '@/client/bootstrap'
import animationIntersector from '../animationIntersector'
import ProgressivePreloader from '../preloader'
import RangeSelector from '../rangeSelector'
import ViewerAuthorAvatar from './authorIsland'
import getMediaViewerClipPath from './clipPath'
import getMediaViewerSnapshotSize from './snapshotSize'
import type ListLoader from './listLoader'

// Константы tweb base.ts:81-105. Экспортированы: потребители внутри класса
// появляются по мере порта (открытие — Task 11, зум — Task 12, видео — Task 15),
// а снаружи их уже сейчас читают тесты.
export const ZOOM_STEP = 0.5
export const ZOOM_INITIAL_VALUE = 1
export const ZOOM_MIN_VALUE = 0.5
export const ZOOM_MAX_VALUE = 4

export const OPEN_TRANSITION_TIME = 200
export const MOVE_TRANSITION_TIME = 350
export const USE_MEDIA_VIEWER_CLIP_PATH = true
export const NO_MEDIA_VIEWER_CLIP_PATH = 'inset(0px)'

// Вертикальные резервы вокруг медиа (px). Единственный источник правды для
// layout — из них считается mediaBoxSize и инлайн-позиционирование (Task 11/13).
export const RESERVE_TOP_DESKTOP = 80
export const RESERVE_BOTTOM_DESKTOP = 110
// На мобильном плеер занимает весь вьюпорт (резерва нет): топбар/контролы
// плавают поверх медиа и автоскрываются вместе.
export const RESERVE_TOP_MOBILE = 0
export const RESERVE_BOTTOM_MOBILE = 0

// Минимальная отображаемая ширина видео, получающего UI плеера.
export const VIDEO_MIN_WIDTH = 420

export const MEDIA_VIEWER_CLASSNAME = 'media-viewer'

// Мувер несёт свой MiddlewareHelper (tweb global.d.ts:27 кладёт его на все
// HTMLElement) — уничтожается вместе с мувером при уходе (`moveTheMover`, tweb :1952).
export type MoverElement = HTMLElement & { middlewareHelper: MiddlewareHelper }

// Дескриптор медиа вьювера (Task 13) — наш аналог tweb `MyPhoto | MyDocument`
// в _openMedia: воркерный конвейер адресует медиа по id (downloadMediaURL),
// натуральные размеры и stripped-превью приезжают из payload сообщения.
export type ViewerMedia = {
  mediaId: number
  width: number
  height: number
  /** stripped-превью (base64 JPEG, как `blur` бабла) — канвас-блюр в ghost */
  blurPreview?: string
  kind: 'photo' | 'video'
  /** GIF-режим (tweb `document.type === 'gif'`): автоплей-цикл без плеера.
   * Заполняется ровно этим — типом документа сообщения, выведенным
   * `saveDocument` (collectLightboxItems) */
  gif?: boolean
  /** длительность видео в секундах (tweb `media.duration` = `doc.duration`);
   * < 60 → loop. Атрибута видео у медиа может не быть — тогда 0/undefined
   * трактуется как «короткое» (loop), безвредно */
  duration?: number
  /** Адаптация Task 16: источник байтов МИМО воркерного конвейера —
   * downloadMediaURL/resolveStreamUrl не зовутся. Секретные E2E-медиа
   * (расшифровка возможна только на вкладке — getSecretMediaUrl, ветку
   * заполняет collectLightboxItems) и фото профиля (URL уже отрезолвлен
   * вызывающим). Строка — готовый URL (у секретных она же ghost-подложка),
   * функция — ленивый резолв (скачать+расшифровать по факту показа) */
  url?: string | (() => Promise<string>)
}

// Автор медиа (tweb setAuthorInfo(fromId, timestamp) резолвит имя/дату через
// wrapPeerTitle/formatFullSentTime; у нас готовые строки собирает вызывающий —
// message-вариант, Task 14).
export type ViewerAuthor = {
  peerId: string | number
  name: string
  /** СЕКУНДЫ эпохи (`message.date`); отсутствует у не-сообщений (фото профиля).
   *  Подпись строит вьювер узлом `formatFullSentTime` (tweb :2043) — готовую
   *  строку сюда больше не кладут: она застывала в языке момента сборки. */
  date?: number
  /** stripped `avatar_preview` пира (Task 9) — слой под полной аватаркой */
  avatarPreview?: string
}

/**
 * Слой Esc/Back вьювера — порт tweb `NavigationItem` (appNavigationController.ts:10-22)
 * в объёме одного поля. `onPop` возвращает `false` — ВЕТО: слой отказывается
 * сниматься (tweb base.ts:2434-2436 — пока летит мувер), и стек обязан вернуть
 * его на место (tweb appNavigationController.ts:290-296).
 *
 * Полей `type`/`onEscape`/`noHistory`/`noBlurOnPop` здесь нет: тип записи
 * (`media`) ставит контроллер вьювера (`openMediaViewer.ts`), а остальные три
 * оригиналу в медиавьювере не нужны — он их не задаёт. ОСТАТОК #108: у tweb
 * `base.ts` зовёт `appNavigationController` напрямую, у нас механика приезжает
 * инъекцией (`navigation`) — шов остался с тех пор, когда контроллера не было
 * вовсе; снимается вместе со следующим касанием этого файла, там же ждёт
 * ветка `canAnimate` (:2438-2440).
 */
export type ViewerNavigationItem = { onPop: () => boolean | void }

/**
 * Механика стека, которую вьюверу отдаёт контроллер (`openMediaViewer.ts`) —
 * в tweb это глобальный `appNavigationController` (pushItem/removeItem), и с
 * задачи #108 за инъекцией стоит он же. Инъекция, а не импорт: у вьювера уже есть
 * контроллер-владелец, и второй источник Esc/Back означал бы два слоя на один
 * вьювер.
 */
export type ViewerNavigation = {
  pushItem(item: ViewerNavigationItem): void
  removeItem(item: ViewerNavigationItem): void
}

// tweb base.ts:107-111 — стопка зум/пан (живёт на moversContainer,
// НЕЗАВИСИМО от transform'а полёта на самом мувере).
type Transform = {
  x: number
  y: number
  scale: number
}

// tweb global.d.ts:295-296 — как и в getVisibleRect.ts, весь global.d.ts ради
// двух ambient-типов не тащим, объявлены локально.
type DOMRectMinified = { top: number, right: number, bottom: number, left: number }
type DOMRectEditable = DOMRectMinified & { width: number, height: number }

// Адаптация Task 16: готовый источник байтов (ViewerMedia.url, см. тип) —
// undefined значит «обычное медиа, иди в конвейер».
function resolveDirectMediaUrl(media: ViewerMedia): Promise<string> | undefined {
  const { url } = media
  if (url === undefined) return undefined
  return Promise.resolve(typeof url === 'function' ? url() : url)
}

// button.btn-icon > span.tgico.button-icon — порт tweb `ButtonIcon()` в объёме
// вьювера (все кнопки топбара в tweb идут с `noRipple: true`; про mobile-close
// см. шапку файла). `onlyMobile` → `only-handhelds` (button.ts:33-35).
export function btnIcon(icon: IconName, options: { onlyMobile?: boolean } = {}): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'btn-icon'
  if (options.onlyMobile) {
    button.classList.add('only-handhelds')
  }
  button.append(Icon(icon, 'button-icon'))
  return button
}

// Порт tweb `replaceButtonIcon` (button.ts:48-53) поверх общего `Icon`:
// свап глифа кнопки заменой span.button-icon (зум-кнопка zoomin↔zoomout).
// Экспорт: VolumeSelector/VideoPlayer (Task 15) свапают иконки тем же путём —
// в tweb хелпер живёт в components/button.ts, у нас порт остался здесь; цикл
// модулей base ↔ mediaPlayer идентичен tweb (их VideoPlayer тоже импортирует
// mediaViewer/base ради типа), исполнение везде отложено до рантайма.
export function replaceButtonIcon(element: HTMLElement, icon: IconName) {
  const newIcon = Icon(icon, 'button-icon')
  const oldIcon = element.querySelector('.button-icon')
  if (oldIcon) oldIcon.replaceWith(newIcon)
  else element.append(newIcon)
  return newIcon
}

export default class AppMediaViewerBase<
  ContentAdditionType extends string,
  ButtonsAdditionType extends string,
  TargetType extends { element: HTMLElement },
> extends EventListenerBase<{
  setMoverBefore: () => void
  setMoverAfter: () => void
}> {
  protected wholeDiv: HTMLElement
  protected overlaysDiv: HTMLElement
  // avatarEl tweb (avatarNew → `.media-viewer-userpic`, prepend в container,
  // base.ts:2035-2048) у нас — React-остров: authorRoot/authorHost ниже,
  // монтирует setAuthorInfo.
  protected author: {
    container: HTMLElement
    nameEl: HTMLElement
    date: HTMLElement
  } = {} as AppMediaViewerBase<ContentAdditionType, ButtonsAdditionType, TargetType>['author']
  // 'caption' в базовой карте — адаптация: в tweb его добавляет message-подкласс
  // (index.ts:112 через ContentAdditionType), но у нас caption-слот живёт в base —
  // сюда же Task 14 привезёт RichText-остров (captionRoot ниже).
  protected content: { [k in 'main' | 'container' | 'media' | 'mover' | 'caption' | ContentAdditionType]: HTMLElement } =
    {} as AppMediaViewerBase<ContentAdditionType, ButtonsAdditionType, TargetType>['content']
  protected buttons: {
    [k in 'download' | 'close' | 'prev' | 'next' | 'mobile-close' | 'zoomin' | 'rotate' | ButtonsAdditionType]: HTMLElement
  } = {} as AppMediaViewerBase<ContentAdditionType, ButtonsAdditionType, TargetType>['buttons']
  protected topbar: HTMLElement
  protected moversContainer: HTMLElement

  protected tempId = 0
  protected preloader: ProgressivePreloader
  protected preloaderStreamable: ProgressivePreloader

  // Vanilla-плеер текущего видео (tweb base.ts:238) — создаётся в createPlayer
  // видео-ветки _openMedia, умирает по setMoverBefore (once-подписка там же).
  protected videoPlayer?: VideoPlayer

  protected isFirstOpen = true

  // Цель полёта закрытия и текущий элемент листания — геттер/сеттер поверх
  // listLoader.current (порт tweb :290-296): go() перекладывает current между
  // previous/next, поэтому цель обязана жить именно там — иначе просмотренный
  // элемент выпадал бы из списка при листании.
  protected get target(): TargetType | undefined {
    return this.listLoader.current
  }

  protected set target(value: TargetType | undefined) {
    this.listLoader.current = value
  }

  // React-острова (решение программы: ядро vanilla, React — только через
  // createRoot). Аватарка автора: ОДИН root на жизнь вьювера — повторный
  // setAuthorInfo только ре-рендерит (пин — base.open.test.ts); хост
  // display:contents, чтобы `.media-viewer-userpic` остался визуальным
  // ребёнком `.media-viewer-author` (правила партиала целы).
  private authorRoot: Root | null = null
  private authorHost: HTMLElement | null = null
  protected authorInfo: ViewerAuthor | null = null
  // Caption-остров: root над scrollable-слотом; RichText рендерит подкласс.
  protected captionRoot: Root | null = null
  protected captionScrollable!: HTMLElement

  // Колбэки наружу: клик по автору (закрыть и перейти к сообщению — проброс в
  // Task 14) и завершение close() (контроллер openMediaViewer.ts снимает
  // Esc/Back-слои и отпускает синглтон; миниатюру источника никто не прятал —
  // как в tweb, её накрывает сам вьювер).
  public onAuthorClick?: (author: ViewerAuthor) => void
  public onClose?: () => void

  // Слой Esc/Back (tweb `navigationItem`, base.ts:270 + :2432-2447). САМ стек
  // вьювер не знает — его даёт контроллер (openMediaViewer.ts) через
  // `navigation`; здесь живёт то, что в tweb лежит прямо в base: момент
  // постановки/снятия слоя и ВЕТО на снятие.
  public navigation?: ViewerNavigation
  protected navigationItem?: ViewerNavigationItem

  // Промис полёта закрытия: повторный close() возвращает его же (tweb :984
  // отдаёт setMoverAnimationPromise — тот же deferred по часам; у нас
  // сохранённый объект, чтобы повторные зовы получали стабильную ссылку).
  private closePromise: Promise<void> | null = null

  protected setMoverPromise: Promise<void> | null = null
  protected setMoverAnimationPromise: Promise<void> | null = null
  // Ожидатели transition мувера (tweb :229): у каждого мувера максимум один
  // живой ожидатель — новый снимает предыдущий (cancelMoverTransition).
  private moverTransitionCancels = new WeakMap<HTMLElement, () => void>()

  // Состояние зум/пан/поворота (tweb :256-266).
  protected transform: Transform = { x: 0, y: 0, scale: ZOOM_INITIAL_VALUE }
  // Накопленный поворот в градусах (кратные 90, против часовой — отрицательные).
  // Живёт на moversContainer вместе с зум/пан-трансформом; сбрасывается
  // пер-медиа (resetRotationForNav).
  protected rotation = 0
  protected isZooming = false
  // write-only после сноса мёртвого getZoomBounce (его единственного читателя,
  // мёртв и в tweb): записи — часть 1:1-портированных тел onSwipeFirst/onSwipeReset
  protected isGesturingNow = false
  protected isZoomingNow = false
  protected draggingType?: 'wheel' | 'touchmove' | 'mousemove'
  protected initialContentRect: DOMRect | null = null

  protected ctrlKeyDown = false
  // Флаг закрытия (tweb :275): полный close — Task 14; уже сейчас его читает
  // onSwipeReset (гейт клампа во время закрытия).
  protected closing = false

  // Разводка жестов по wholeDiv (tweb :522-587, setListeners).
  protected swipeHandler: SwipeHandler | null = null

  // tweb :281-284: все четыре стартуют АЛИАСОМ на transform (одна и та же
  // ссылка) — до первого onSwipeFirst/adjustPosition, которые перезапишут их
  // собственными объектами, читаются только нулевые x/y.
  protected lastTransform: Transform = this.transform
  protected lastZoomCenter: { x: number, y: number } = this.transform
  protected lastDragOffset: { x: number, y: number } = this.transform
  protected lastDragDelta: { x: number, y: number } = this.transform
  protected lastGestureTime = 0
  // Создаётся в setListeners (tweb :521); до него хендлеры RangeSelector
  // (onScrub → addZoom) могут честно застать undefined — вызовы через `?.`
  // (в tweb strict выключен, там та же прореха прикрыта `?.` лишь в onScrub).
  protected clampZoomDebounced?: DebounceReturnType<() => void>
  protected ignoreNextClick = false
  protected highlightSwitchersTimeout = 0

  protected zoomElements: {
    container: HTMLElement
    btnOut: HTMLElement
    btnIn: HTMLElement
    rangeSelector: RangeSelector
  } = {} as AppMediaViewerBase<ContentAdditionType, ButtonsAdditionType, TargetType>['zoomElements']

  protected middlewareHelper: MiddlewareHelper

  protected overlayActive: boolean

  constructor(
    protected listLoader: ListLoader<TargetType, TargetType>,
    // имена кнопок = имена глифов tgico, как и в tweb (там topButtons типизирован
    // ключами карты buttons, а Icon берётся из имени)
    topButtons: ButtonsAdditionType[],
    protected extraHeightPadding = 0,
  ) {
    super(false)

    this.middlewareHelper = getMiddleware()

    this.preloader = new ProgressivePreloader()
    this.preloaderStreamable = new ProgressivePreloader({
      cancelable: false,
      streamable: true,
    })
    this.preloader.construct?.()
    this.preloaderStreamable.construct?.()

    this.wholeDiv = document.createElement('div')
    this.wholeDiv.classList.add(MEDIA_VIEWER_CLASSNAME + '-whole')

    this.overlaysDiv = document.createElement('div')
    this.overlaysDiv.classList.add('overlays')
    this.overlayActive = false

    const mainDiv = document.createElement('div')
    mainDiv.classList.add(MEDIA_VIEWER_CLASSNAME)

    const topbar = this.topbar = document.createElement('div')
    topbar.classList.add(MEDIA_VIEWER_CLASSNAME + '-topbar', MEDIA_VIEWER_CLASSNAME + '-appear')

    const topbarLeft = document.createElement('div')
    topbarLeft.classList.add(MEDIA_VIEWER_CLASSNAME + '-topbar-left')

    this.buttons['mobile-close'] = btnIcon('close', { onlyMobile: true })

    // * author
    this.author.container = document.createElement('div')
    this.author.container.classList.add(MEDIA_VIEWER_CLASSNAME + '-author', 'no-select')
    const authorRight = document.createElement('div')
    authorRight.classList.add(MEDIA_VIEWER_CLASSNAME + '-author-right')

    this.author.nameEl = document.createElement('div')
    this.author.nameEl.classList.add(MEDIA_VIEWER_CLASSNAME + '-name')

    this.author.date = document.createElement('div')
    this.author.date.classList.add(MEDIA_VIEWER_CLASSNAME + '-date')

    authorRight.append(this.author.nameEl, this.author.date)

    this.author.container.append(authorRight)

    // * buttons
    const buttonsDiv = document.createElement('div')
    buttonsDiv.classList.add(MEDIA_VIEWER_CLASSNAME + '-buttons')

    topButtons.concat(['download', 'rotate', 'zoomin', 'close'] as ButtonsAdditionType[]).forEach((name) => {
      // Кнопка rotate крутит картинку против часовой (как Telegram Desktop) —
      // несёт левый глиф, оставаясь в this.buttons под простым ключом `rotate`.
      const icon = (name === 'rotate' ? 'rotate_left' : name) as IconName
      const button = btnIcon(icon)
      this.buttons[name] = button
      buttonsDiv.append(button)
    })

    // * zoom
    this.zoomElements.container = document.createElement('div')
    this.zoomElements.container.classList.add('zoom-container')

    this.zoomElements.btnOut = btnIcon('zoomout')
    attachClickEvent(this.zoomElements.btnOut, () => this.addZoomStep(false))
    this.zoomElements.btnIn = btnIcon('zoomin')
    attachClickEvent(this.zoomElements.btnIn, () => this.addZoomStep(true))

    this.zoomElements.rangeSelector = new RangeSelector({
      step: 0.01,
      min: ZOOM_MIN_VALUE,
      max: ZOOM_MAX_VALUE,
      withTransition: true,
    }, ZOOM_INITIAL_VALUE)
    this.zoomElements.rangeSelector.setListeners()
    this.zoomElements.rangeSelector.setHandlers({
      onScrub: (value) => {
        const add = value - this.transform.scale
        this.addZoom(add)
        this.clampZoomDebounced?.clearTimeout()
      },
      onMouseDown: () => {
        this.onSwipeFirst()
      },
      onMouseUp: () => {
        this.onSwipeReset()
      },
    })

    this.zoomElements.container.append(this.zoomElements.btnOut, this.zoomElements.rangeSelector.container, this.zoomElements.btnIn)

    if (!IS_TOUCH_SUPPORTED) {
      this.wholeDiv.append(this.zoomElements.container)
    }

    // * content
    this.content.main = document.createElement('div')
    this.content.main.classList.add(MEDIA_VIEWER_CLASSNAME + '-content')

    this.content.container = document.createElement('div')
    this.content.container.classList.add(MEDIA_VIEWER_CLASSNAME + '-container')

    // layout-ghost: невидимый якорь центрального бокса (visibility:hidden —
    // из партиала `_mediaViewer.scss`, правило `&-media`), по нему считается
    // целевой rect полёта мувера (Task 11)
    this.content.media = document.createElement('div')
    this.content.media.classList.add(MEDIA_VIEWER_CLASSNAME + '-media')

    this.content.container.append(this.content.media)

    this.content.main.append(this.content.container)
    mainDiv.append(this.content.main)
    this.overlaysDiv.append(mainDiv)
    // * overlays end

    topbarLeft.append(this.buttons['mobile-close'], this.author.container)
    topbar.append(topbarLeft, buttonsDiv)

    this.buttons.prev = document.createElement('div')
    this.buttons.prev.className = `${MEDIA_VIEWER_CLASSNAME}-switcher ${MEDIA_VIEWER_CLASSNAME}-switcher-left`
    this.buttons.prev.append(Icon('previous', `${MEDIA_VIEWER_CLASSNAME}-sibling-button`, `${MEDIA_VIEWER_CLASSNAME}-prev-button`))

    this.buttons.next = document.createElement('div')
    this.buttons.next.className = `${MEDIA_VIEWER_CLASSNAME}-switcher ${MEDIA_VIEWER_CLASSNAME}-switcher-right`
    this.buttons.next.append(Icon('next', `${MEDIA_VIEWER_CLASSNAME}-sibling-button`, `${MEDIA_VIEWER_CLASSNAME}-next-button`))

    this.moversContainer = document.createElement('div')
    this.moversContainer.classList.add(MEDIA_VIEWER_CLASSNAME + '-movers')

    this.moversContainer.append(this.buttons.prev, this.buttons.next)

    this.wholeDiv.append(this.overlaysDiv, this.topbar, this.moversContainer)

    // caption — порт tweb index.ts:112-141 (в tweb создаёт message-подкласс,
    // у нас слот в base — см. комментарий у карты content). Порядок append —
    // load-bearing: ПОСЛЕ movers (tweb index.ts:139 `wholeDiv.append(caption)`
    // идёт после конструктора base), CSS-соседи партиала
    // (`.zoom-container.is-visible ~ .media-viewer-caption`) построены на нём.
    this.content.caption = document.createElement('div')
    this.content.caption.classList.add(MEDIA_VIEWER_CLASSNAME + '-caption', 'spoilers-container')
    // в tweb классы scrollable приходят от `new Scrollable(caption)`
    // (index.ts:137); наш Scrollable инстанцирован ровно один раз (норма
    // web-client/CLAUDE.md, «Скролл») — здесь визуальный слепок классов, живой
    // Scrollable для caption — отдельная задача из TODO rootClasses.ts
    this.captionScrollable = document.createElement('div')
    this.captionScrollable.classList.add('scrollable', 'scrollable-y')
    this.content.caption.append(this.captionScrollable)
    this.wholeDiv.append(this.content.caption)

    // * constructing html end

    this.listLoader.onLoadedMore = () => {
      this.buttons.prev.classList.toggle('hide', !this.listLoader.previous.length)
      this.buttons.next.classList.toggle('hide', !this.listLoader.next.length)
    }

    this.setNewMover()
  }

  // Порт tweb base.ts:447-587 (зовёт конструктор подкласса — tweb index.ts:166,
  // у нас appMediaViewer.ts). Не портированы здесь:
  //   • download-кнопка (attachClickEvent + меню качества ButtonMenuToggle,
  //     tweb :448-459) — onDownloadClick вешает подкласс (setListeners);
  //   • listLoader.onJump → onPrevClick/onNextClick (tweb :485-489) — поля
  //     message-подкласса, вешает он же.
  protected setListeners() {
    ;[this.buttons.close, this.buttons['mobile-close'], this.preloaderStreamable.preloader].forEach((el) => {
      attachClickEvent(el, this.close.bind(this))
    })

    ;([[-1, this.buttons.prev], [1, this.buttons.next]] as [number, HTMLElement][]).forEach(([moveLength, button]) => {
      // tweb :464-465: сырой addEventListener, не attachClickEvent — тот на
      // таче (mousedown) отменял бы slide-жест
      button.addEventListener('click', (e) => {
        cancelEvent(e)
        if (this.setMoverPromise) return

        this.listLoader.go(moveLength)
      })
    })

    attachClickEvent(this.buttons.zoomin, () => {
      if (this.isZooming) this.resetZoom()
      else {
        this.addZoomStep(true)
      }
    })

    attachClickEvent(this.buttons.rotate, () => this.rotateMedia())

    // Клик по автору → колбэк наружу (закрыть и перейти к сообщению — проброс
    // в Task 14). Гейт closing — как у onClick tweb: во время полёта закрытия
    // контролы уже мертвы.
    attachClickEvent(this.author.container, () => {
      if (this.closing || !this.authorInfo) return
      this.onAuthorClick?.(this.authorInfo)
    })

    // ! нельзя через attachClickEvent — на тач-устройствах он отменит
    // slide-событие (tweb :486-488)
    this.wholeDiv.addEventListener('click', this.onClick)

    const adjustPosition = (xDiff: number, yDiff: number) => {
      const [x, y] = [xDiff - this.lastDragOffset.x, yDiff - this.lastDragOffset.y]
      const [transform, inBoundsX, inBoundsY] = this.calculateOffsetBoundaries({
        x: this.transform.x + x,
        y: this.transform.y + y,
        scale: this.transform.scale,
      })

      this.lastDragDelta = {
        x,
        y,
      }

      this.lastDragOffset = {
        x: xDiff,
        y: yDiff,
      }

      this.setTransform(transform)

      return { inBoundsX, inBoundsY }
    }

    const setLastGestureTime = debounce(() => {
      this.lastGestureTime = Date.now()
    }, 500, false, true)

    // Кламп-дебаунс 300 мс: после серии addZoom (кнопки/слайдер/колесо) зум,
    // ушедший в bounce-зону за ZOOM_MAX, доводится onSwipeReset'ом обратно.
    this.clampZoomDebounced = debounce(() => {
      this.onSwipeReset()
    }, 300, false, true)

    this.swipeHandler = new SwipeHandler({
      element: this.wholeDiv,
      onReset: this.onSwipeReset,
      onFirstSwipe: this.onSwipeFirst,
      onSwipe: (xDiff, yDiff, e, cancelDrag) => {
        if (isFullScreen()) {
          return
        }

        if (this.isZooming && !this.isZoomingNow) {
          void setLastGestureTime() // void: fire-and-forget как в tweb (oxlint no-floating-promises)

          this.draggingType = (e as { type?: string }).type as AppMediaViewerBase<
            ContentAdditionType, ButtonsAdditionType, TargetType
          >['draggingType']
          const { inBoundsX, inBoundsY } = adjustPosition(xDiff, yDiff)
          cancelDrag?.(!inBoundsX, !inBoundsY)

          return
        }

        if (this.isZoomingNow || !IS_TOUCH_SUPPORTED) {
          return
        }

        const percents = Math.abs(xDiff) / windowSize.width
        if (percents > .2 || Math.abs(xDiff) > 125) {
          if (xDiff > 0) {
            this.buttons.prev.click()
          } else {
            this.buttons.next.click()
          }

          return true
        }

        const percentsY = Math.abs(yDiff) / windowSize.height
        if (percentsY > .2 || Math.abs(yDiff) > 125) {
          void this.close() // void: fire-and-forget как в tweb (oxlint no-floating-promises)
          return true
        }

        return false
      },
      onZoom: this.onZoom,
      onDoubleClick: ({ centerX, centerY }) => {
        if (this.isZooming) {
          this.resetZoom()
        } else {
          const scale = ZOOM_INITIAL_VALUE + 2
          this.changeZoomByPosition(centerX, centerY, scale)
        }
      },
      verifyTouchTarget: (e) => {
        // * Fix for seek input
        if (isFullScreen() ||
          findUpAsChild(e.target as HTMLElement, this.zoomElements.container) ||
          findUpClassName(e.target, 'ckin__controls') ||
          findUpClassName(e.target, 'media-viewer-caption') ||
          (findUpClassName(e.target, 'media-viewer-topbar') && e.type !== 'wheel')) {
          return false
        }

        return true
      },
      cursor: '',
    })
  }

  // Порт tweb base.ts:589-604.
  protected onSwipeFirst = (e?: { type?: string }) => {
    this.lastDragOffset = this.lastDragDelta = { x: 0, y: 0 }
    this.lastTransform = { ...this.transform }
    if (e?.type !== 'wheel' || !this.ctrlKeyDown) { // сохранить transition для настоящего колеса мыши
      this.moversContainer.classList.add('no-transition')
      this.zoomElements.rangeSelector.container.classList.remove('with-transition')
    }
    this.isGesturingNow = true
    this.lastGestureTime = Date.now()
    this.clampZoomDebounced?.clearTimeout()

    if (!this.lastTransform.x && !this.lastTransform.y && !this.isZooming) {
      this.initialContentRect = this.content.media.getBoundingClientRect()
    }
  }

  // Порт tweb base.ts:606-656.
  protected onSwipeReset = (e?: Event) => {
    // move
    this.moversContainer.classList.remove('no-transition')
    this.zoomElements.rangeSelector.container.classList.add('with-transition')
    this.clampZoomDebounced?.clearTimeout()

    if (e?.type === 'mouseup' && this.draggingType === 'mousemove') {
      this.ignoreNextClick = true
    }

    const { draggingType } = this
    this.isZoomingNow = false
    this.isGesturingNow = false
    this.draggingType = undefined

    if (this.closing) {
      return
    }

    if (this.transform.scale > ZOOM_INITIAL_VALUE) {
      // Текущие границы контента
      const s1 = Math.min(this.transform.scale, ZOOM_MAX_VALUE)
      const scaleFactor = s1 / this.transform.scale

      // Новая позиция от последнего зум-центра: точка под пальцами остаётся
      // на месте при отскоке от максимального зума
      let x1 = this.transform.x * scaleFactor + (this.lastZoomCenter.x - scaleFactor * this.lastZoomCenter.x)
      let y1 = this.transform.y * scaleFactor + (this.lastZoomCenter.y - scaleFactor * this.lastZoomCenter.y)

      // Масштаб не менялся — жесту пана добавляется инерция
      if (draggingType && draggingType !== 'wheel' && this.lastTransform.scale === this.transform.scale) {
        // Подобранный коэффициент скорости пана
        const k = 0.1

        // Скорость жеста пользователя
        const elapsedTime = Math.max(1, Date.now() - this.lastGestureTime)
        const Vx = Math.abs(this.lastDragOffset.x) / elapsedTime
        const Vy = Math.abs(this.lastDragOffset.y) / elapsedTime

        // Дополнительная дистанция от скорости жеста и последней дельты пана
        x1 -= Math.abs(this.lastDragOffset.x) * Vx * k * -this.lastDragDelta.x
        y1 -= Math.abs(this.lastDragOffset.y) * Vy * k * -this.lastDragDelta.y
      }

      const [transform] = this.calculateOffsetBoundaries({ x: x1, y: y1, scale: s1 })
      this.lastTransform = transform
      this.setTransform(transform)
    } else if (this.transform.scale < ZOOM_INITIAL_VALUE) {
      this.resetZoom()
    }
  }

  // Порт tweb base.ts:658-701.
  protected onZoom = ({
    initialCenterX,
    initialCenterY,
    zoom,
    zoomAdd,
    currentCenterX,
    currentCenterY,
    dragOffsetX,
    dragOffsetY,
    zoomFactor,
  }: ZoomDetails) => {
    initialCenterX ||= windowSize.width / 2
    initialCenterY ||= windowSize.height / 2
    currentCenterX ||= windowSize.width / 2
    currentCenterY ||= windowSize.height / 2

    this.isZoomingNow = true

    // Bounce headroom: во время жеста зум может уходить за ZOOM_MAX_VALUE до
    // тройного значения — обратно к максимуму его доведёт onSwipeReset
    // (clampZoomDebounced после кнопок/колеса, конец жеста на таче).
    const zoomMaxBounceValue = ZOOM_MAX_VALUE * 3
    const scale = zoomAdd !== undefined ?
      clamp(this.lastTransform.scale + zoomAdd, ZOOM_MIN_VALUE, zoomMaxBounceValue) :
      // zoomFactor есть всегда, когда нет ни zoomAdd, ни zoom (пинч-ветка
      // SwipeHandler) — в tweb это гарантирует построение ZoomDetails
      (zoom ?? clamp(this.lastTransform.scale * zoomFactor!, ZOOM_MIN_VALUE, zoomMaxBounceValue))
    const scaleFactor = scale / this.lastTransform.scale
    const offsetX = Math.abs(Math.min(this.lastTransform.x, 0))
    const offsetY = Math.abs(Math.min(this.lastTransform.y, 0))

    // Последний зум-центр запоминается для отскока (bounce back)
    this.lastZoomCenter = {
      x: currentCenterX,
      y: currentCenterY,
    }

    // Новый центр относительно сдвинутой картинки
    const scaledCenterX = offsetX + initialCenterX
    const scaledCenterY = offsetY + initialCenterY

    const { scaleOffsetX, scaleOffsetY } = this.calculateScaleOffset({ x: scaledCenterX, y: scaledCenterY, scale: scaleFactor })

    const [transform] = this.calculateOffsetBoundaries({
      x: this.lastTransform.x + scaleOffsetX + dragOffsetX,
      y: this.lastTransform.y + scaleOffsetY + dragOffsetY,
      scale,
    })

    this.setTransform(transform)
  }

  // Порт tweb base.ts:703-712 — зум в точку (дабл-клик/дабл-тап).
  protected changeZoomByPosition(x: number, y: number, scale: number) {
    const { scaleOffsetX, scaleOffsetY } = this.calculateScaleOffset({ x, y, scale })
    const transform = this.calculateOffsetBoundaries({
      x: scaleOffsetX,
      y: scaleOffsetY,
      scale,
    })[0]

    this.setTransform(transform)
  }

  // Порт tweb base.ts:714-717.
  protected setTransform(transform: Transform) {
    this.transform = transform
    this.changeZoom(transform.scale)
  }

  // Порт tweb base.ts:720-729: насколько сдвинуть картинку, чтобы зум-центр
  // остался на месте.
  protected calculateScaleOffset({ x, y, scale }: {
    x: number,
    y: number,
    scale: number
  }) {
    return {
      scaleOffsetX: x - scale * x,
      scaleOffsetY: y - scale * y,
    }
  }

  // Порт tweb base.ts:731-756.
  protected toggleZoom(enable?: boolean) {
    const isVisible = this.isZooming
    const auto = enable === undefined
    if (this.zoomElements.rangeSelector.mousedown || this.ctrlKeyDown) {
      enable = true
    }

    enable ??= !isVisible

    if (isVisible === enable) {
      return
    }

    replaceButtonIcon(this.buttons.zoomin, !enable ? 'zoomin' : 'zoomout')
    this.zoomElements.container.classList.toggle('is-visible', this.isZooming = enable)
    this.wholeDiv.classList.toggle('is-zooming', enable)

    if (auto || !enable) {
      const zoomValue = enable ? this.transform.scale : ZOOM_INITIAL_VALUE
      this.setZoomValue(zoomValue)
      this.zoomElements.rangeSelector.setProgress(zoomValue)
    }

    this.updateVideoControlsLock() // tweb :755
  }

  // Порт tweb base.ts:758-760.
  protected addZoomStep(add: boolean) {
    this.addZoom(ZOOM_STEP * (add ? 1 : -1))
  }

  // Порт tweb base.ts:762-768.
  protected resetZoom() {
    this.setTransform({
      x: 0,
      y: 0,
      scale: ZOOM_INITIAL_VALUE,
    })
  }

  // Порт tweb base.ts:770-774.
  protected changeZoom(value = this.transform.scale) {
    this.transform.scale = value
    this.zoomElements.rangeSelector.setProgress(value)
    this.setZoomValue(value)
  }

  // Порт tweb base.ts:776-789.
  protected addZoom(value: number) {
    this.lastTransform = this.transform
    this.onZoom({
      zoomAdd: value,
      currentCenterX: 0,
      currentCenterY: 0,
      initialCenterX: 0,
      initialCenterY: 0,
      dragOffsetX: 0,
      dragOffsetY: 0,
    })
    this.lastTransform = this.transform
    void this.clampZoomDebounced?.() // void: fire-and-forget как в tweb (oxlint no-floating-promises)
  }

  // getZoomBounce (tweb base.ts:791-793) НЕ портирован: мёртв и в референсе
  // (объявлен, нигде не вызывается — исторический хвост зум-порта из WebZ);
  // снесён финальной сверкой Task 17 по норме «мёртвый код удалять».

  // Порт tweb base.ts:795-813.
  protected calculateOffsetBoundaries = (
    { x, y, scale }: Transform,
    offsetTop = 0,
  ): [Transform, boolean, boolean] => {
    if (!this.initialContentRect) return [{ x, y, scale }, true, true]
    // Текущие границы контента
    let inBoundsX = true
    let inBoundsY = true

    const { minX, maxX, minY, maxY } = this.getZoomBoundaries(scale, offsetTop)

    inBoundsX = isBetween(x, maxX, minX)
    x = clamp(x, maxX, minX)

    inBoundsY = isBetween(y, maxY, minY)
    y = clamp(y, maxY, minY)

    return [{ x, y, scale }, inBoundsX, inBoundsY]
  }

  // Порт tweb base.ts:815-833.
  protected getZoomBoundaries(scale = this.transform.scale, offsetTop = 0) {
    if (!this.initialContentRect) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
    }

    const centerX = (windowSize.width - windowSize.width * scale) / 2
    const centerY = (windowSize.height - windowSize.height * scale) / 2

    // Пан/зум действуют на повёрнутый+refit бокс в экранном пространстве,
    // поэтому границы считаются от него (= initialContentRect без поворота).
    const rect = this.getDisplayRect()
    const minX = Math.max(-rect.left * scale, centerX)
    const maxX = windowSize.width - rect.right * scale

    const minY = Math.max(-rect.top * scale + offsetTop, centerY)
    const maxY = windowSize.height - rect.bottom * scale

    return { minX, maxX, minY, maxY }
  }

  // Порт tweb base.ts:835-850.
  protected setZoomValue = (value = this.transform.scale) => {
    this.initialContentRect ??= this.content.media.getBoundingClientRect()

    if (value === ZOOM_INITIAL_VALUE) {
      this.transform.x = 0
      this.transform.y = 0
    }

    this.applyMoversTransform(value)

    this.zoomElements.btnOut.classList.toggle('inactive', value <= ZOOM_MIN_VALUE)
    this.zoomElements.btnIn.classList.toggle('inactive', value >= ZOOM_MAX_VALUE)

    this.toggleZoom(value !== ZOOM_INITIAL_VALUE)
  }

  // Порт tweb base.ts:852-854. Зум/пан/поворот живут на moversContainer —
  // НЕ на мувере: его transform занят полётом открытия/закрытия/листания
  // (setMoverToTarget/moveTheMover), две стопки независимы.
  protected applyMoversTransform(scaleValue = this.transform.scale) {
    this.moversContainer.style.transform = this.buildMoversTransform(scaleValue)
  }

  // Порт tweb base.ts:856-873 — сборка transform'а moversContainer. Порядок
  // важен: зум/пан (origin 0 0) — ВНЕШНИЕ (экранные) трансформы, а
  // rotate+orientation-refit — ВНУТРЕННИЙ, применяется к медиа вокруг его
  // собственного центра. Пан/зум в экранном пространстве означают, что драг
  // ложится прямо на экранные оси даже в повороте (боковая→горизонтальная
  // фотка панится влево-вправо, а не вверх-вниз), а математике границ нужен
  // только повёрнутый bbox (getDisplayRect). Rotate-обёртка эмитится ВСЕГДА
  // (identity при rotation 0 — пара translate(C)…translate(-C) сокращается
  // через неё на каждом шаге интерполяции, так что зум анимируется и
  // рендерится ровно как раньше), чтобы ПЕРВЫЙ поворот интерполировался
  // пофункционально, а не через matrix-декомпозицию от голого зума (та
  // уводила картинку в сторону до доводки).
  protected buildMoversTransform(scaleValue = this.transform.scale) {
    const { x, y } = this.transform
    const fit = this.getRotationFitScale()
    const { x: cx, y: cy } = this.getMediaCenter()
    return `translate3d(${x.toFixed(3)}px, ${y.toFixed(3)}px, 0px) scale(${scaleValue.toFixed(3)}) ` +
      `translate(${cx.toFixed(3)}px, ${cy.toFixed(3)}px) rotate(${this.rotation}deg) scale(${fit.toFixed(5)}) translate(${(-cx).toFixed(3)}px, ${(-cy).toFixed(3)}px)`
  }

  // Порт tweb base.ts:875-884: центр медиа на экране в покое (до зум/пана).
  // Поворот — внутренний transform, так что это пивот вращения — константа,
  // не зависящая от текущего зума/пана.
  protected getMediaCenter() {
    const rect = this.initialContentRect ?? this.content.media.getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }
  }

  // Порт tweb base.ts:906-930: экранный bbox медиа ПОСЛЕ поворота +
  // orientation-refit (всё ещё в до-зумном фрейме). Пан/зум действуют на ЭТОТ
  // бокс в экранном пространстве, поэтому границы зума выводятся прямо из
  // него. Без поворота → просто initialContentRect.
  protected getDisplayRect(): DOMRectMinified & { width: number, height: number } {
    const rect = this.initialContentRect ?? this.content.media.getBoundingClientRect()
    if (!this.rotation) {
      return rect
    }

    const normalized = ((this.rotation % 360) + 360) % 360
    const swap = normalized === 90 || normalized === 270
    const fit = this.getRotationFitScale()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const width = (swap ? rect.height : rect.width) * fit
    const height = (swap ? rect.width : rect.height) * fit
    return {
      left: cx - width / 2,
      right: cx + width / 2,
      top: cy - height / 2,
      bottom: cy + height / 2,
      width,
      height,
    }
  }

  // Порт tweb base.ts:932-950.
  protected rotateMedia() {
    // Прайминг transition ТОЛЬКО на первом применении transform'а
    // (moversContainer ещё на CSS-дефолте, без инлайна): закоммитить
    // identity-структурированный transform, чтобы первый поворот
    // интерполировал rotate/scale пофункционально, а не через
    // matrix-декомпозицию от голого дефолта (та уводила картинку в сторону
    // до доводки). Когда инлайн-transform уже есть (после любого
    // зума/поворота), он уже в этой форме — повторный прайминг добавил бы
    // no-transition посреди полёта и схлопнул ещё играющий поворот в цель.
    if (!this.moversContainer.style.transform) {
      this.moversContainer.classList.add('no-transition')
      this.applyMoversTransform()
      void this.moversContainer.offsetLeft // рефлоу-барьер: коммит запраймленного состояния
      this.moversContainer.classList.remove('no-transition')
    }

    this.rotation -= 90 // против часовой, как Telegram Desktop
    this.applyMoversTransform()
    this.updateVideoControlsLock() // tweb :949
  }

  // Порт tweb base.ts:958-968: хром плеера живёт внутри moversContainer и
  // скейлился/крутился бы вместе с кадром — на время зума ИЛИ поворота контролы
  // запираются скрытыми (как уже делает зум), иначе возвращается автоскрытие.
  // Клавиатура плеера продолжает работать (`listenKeyboardEvents: 'always'`).
  protected updateVideoControlsLock() {
    if (!this.videoPlayer) {
      return
    }

    this.videoPlayer.lockControls(this.isZooming || this.isRotated() ? false : undefined)
  }

  // Порт tweb base.ts:952-956: медиа визуально повёрнуто (любое не кратное
  // 360°). −360° выглядит как вертикаль — сравнивается нормализованный угол,
  // не сырой аккумулятор.
  protected isRotated() {
    return (((this.rotation % 360) + 360) % 360) !== 0
  }

  // Порт tweb base.ts:2416-2425 (блок внутри _openMedia, вынесен методом):
  // поворот — пер-медиа. Снять
  // остаточный поворот прошлой картинки и мгновенно (no-transition) вернуть
  // moversContainer в identity — чтобы ни уезжающий nav-слайд, ни входящее
  // открытие не сыграли лишний доворот.
  protected resetRotationForNav() {
    if (this.rotation) {
      this.rotation = 0
      this.moversContainer.classList.add('no-transition')
      this.applyMoversTransform()
      void this.moversContainer.offsetLeft // рефлоу-барьер: коммит до слайда/открытия
      this.moversContainer.classList.remove('no-transition')
    }
  }

  // Порт tweb base.ts:975-1024 в нашем объёме. Не портированы (каждое помечено):
  //   • disposeSolid (:976) — solid-островов нет, наши React-острова умирают в
  //     destroyIslands ниже;
  //   • lazyLoadQueue.clear() (:996) — очереди нет (шапка файла, Task 14);
  //   • author.avatarMiddlewareHelper.destroy() (:997) — остров аватарки
  //     уничтожает destroyIslands в finally;
  //   • SearchListLoader.cleanup (:1002) — MTProto-специфика, не портирована
  //     вместе с ним (Task 3);
  //   • (window as any).appMediaViewer (:1005-1007) — глобальную ссылку не
  //     заводили (_openMedia тоже её не пишет).
  public close(e?: MouseEvent): Promise<void> | null {
    if (e) {
      cancelEvent(e)
    }

    if (this.closing) {
      // tweb :983-985 возвращает setMoverAnimationPromise — тот же deferred по
      // часам; отдаём сохранённый промис полёта (стабильный объект, см. поле)
      return this.closePromise
    }

    if (this.setMoverAnimationPromise) {
      const rejected = Promise.reject(new Error('close during setMoverToTarget'))
      // tweb :987 возвращает голый Promise.reject() — у нас результат кликов
      // никто не ждёт, гасим unhandled rejection (vitest/консоль)
      void rejected.catch(() => {})
      return rejected
    }

    this.closing = true
    this.swipeHandler?.removeListeners()

    // tweb :991-993 — слой снимается В НАЧАЛЕ закрытия, а не по концу полёта:
    // Esc/Back во время улёта мувера уже ничего не закрывают.
    if (this.navigationItem) {
      this.navigation?.removeItem(this.navigationItem)
      this.navigationItem = undefined
    }

    const promise = this.closePromise =
      this.setMoverToTarget(this.target?.element, true).then(({ onAnimationEnd }) => onAnimationEnd)

    this.listLoader.reset()
    this.setMoverPromise = null
    this.tempId = -1

    this.removeGlobalListeners()

    void promise.finally(() => {
      this.revealHiddenFloatings()
      this.wholeDiv.remove()
      this.toggleOverlay(false)
      this.destroyIslands()
      this.middlewareHelper.destroy()
      this.onClose?.()
    })

    return promise
  }

  // Порт tweb base.ts:1027-1034. `overlayCounter.isDarkOverlayActive` НЕ
  // портирован — оверлей-счётчика (стек попапов/пасскод-лока tweb) у нас нет
  // (Esc/Back-слои живут в контроллере openMediaViewer.ts); остаётся вторая половина: глушение
  // анимаций (стикеры/видео) под тёмным оверлеем через animationIntersector.
  protected toggleOverlay(active: boolean) {
    if (this.overlayActive === active) {
      return
    }

    this.overlayActive = active
    animationIntersector.checkAnimations2(active)
  }

  // Уничтожение React-островов (замена tweb-уборке avatarMiddlewareHelper,
  // :997): unmount корней + снятие хоста; caption-слот чистится вместе с ними.
  protected destroyIslands() {
    this.authorRoot?.unmount()
    this.authorRoot = null
    this.authorHost?.remove()
    this.authorHost = null
    this.authorInfo = null
    this.captionRoot?.unmount()
    this.captionRoot = null
    this.captionScrollable.replaceChildren()
  }

  // Порт tweb base.ts:1036-1053 (в объёме окна: у tweb — getAppWindow(),
  // активное окно Document-PiP; у нас приложение в PiP не переезжает — всегда
  // главный window). Ресайз — как в оригинале, событием `mediaSizes`
  // (:1044, :1052): у него уже есть событийная часть (порт tweb
  // helpers/mediaSizes.ts в `core/dom/mediaSizes.ts`), и снимок окна у вьювера с
  // брейкпоинтом общий. Esc — не здесь: см. шапку
  // файла (appNavigationController → pushEsc контроллера openMediaViewer.ts).
  protected toggleGlobalListeners(active: boolean) {
    if (active) this.setGlobalListeners()
    else this.removeGlobalListeners()
  }

  protected removeGlobalListeners() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    mediaSizes.removeEventListener('resize', this.applyLayoutVariables)
  }

  protected setGlobalListeners() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    mediaSizes.addEventListener('resize', this.applyLayoutVariables)
  }

  // Порт tweb base.ts:2195-2205: вьюпорт изменился → пере-вписать content.media
  // и мувер, затем повторно применить center-позиционирование. Open-путь зовёт
  // только applyLayoutPadding — сайзинг он делает сам следом (_openMedia).
  protected applyLayoutVariables = () => {
    this.applyLayoutPadding()
    const mover = this.content.mover
    if (mover && mover.classList.contains('center')) {
      this.refitMediaToViewport()
      this.applyCenterStyles(mover)
    }
  }

  // Порт tweb base.ts:2207-2213.
  protected applyLayoutPadding() {
    const { top, bottom } = this.getLayoutReserves()
    const cs = this.content.main.style
    cs.paddingTop = `${top}px`
    cs.paddingBottom = `${bottom}px`
  }

  // Порт tweb base.ts:2215-2235: ре-фит content.media (скрытой цели) и мувера
  // под новый mediaBoxSize с сохранением пропорции источника (выведенной из
  // текущих инлайн-px content.media — аспект-фита прошлого вьюпорта), чтобы
  // containerRect оставался синхронным вьюпорту и математика закрытия не врала.
  protected refitMediaToViewport() {
    const media = this.content.media
    const w = parseFloat(media.style.width)
    const h = parseFloat(media.style.height)
    if (!w || !h) return
    const { width: boxW, height: boxH } = this.mediaBoxSize
    const noZoom = !mediaSizes.isMobile
    const fit = calcImageInBox(w, h, boxW, boxH, noZoom)
    media.style.width = `${fit.width}px`
    media.style.height = `${fit.height}px`
    const mover = this.content.mover
    if (mover) {
      mover.style.width = `${fit.width}px`
      mover.style.height = `${fit.height}px`
    }
  }

  // Порт tweb base.ts:1058-1130 в объёме без видео/PiP/live (см. шапку файла):
  // гейт overlayCounter.overlaysActive tweb (:1061 в onKeyDown) и попапов у
  // нас эквивалентен findUpClassName(target, 'popup') — оверлей-стека нет
  // (попапы поверх вьювера у нас перекрывают его по z-index, см. _bridge.scss).
  onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (findUpClassName(target, 'popup')) { // target может быть внутри попапа
      return
    }

    if (this.ignoreNextClick) {
      this.ignoreNextClick = false
      return
    }

    if (this.setMoverAnimationPromise) return

    if (target.tagName === 'A') return
    cancelEvent(e)

    // На мобильном медиа без контролов плеера (фото/GIF, `!this.videoPlayer`
    // tweb :1077) не имеет своего controls-toggle, поэтому тап по нему
    // переключает хром (топбар + caption) сам — зеркаля тоггл видеоконтролов, —
    // а не закрывает вьювер; у видео тем же тоггло-тапом владеет ControlsHover
    // плеера. Тапы по хрому/меню сохраняют свои обработчики; драги уже
    // отфильтрованы через ignoreNextClick.
    if (mediaSizes.isMobile && !this.videoPlayer && !findUpClassName(target, 'media-viewer-topbar') && !findUpClassName(target, 'media-viewer-caption') && !findUpClassName(target, 'btn-menu')) {
      this.wholeDiv.classList.toggle('chrome-hidden')
      return
    }

    if (IS_TOUCH_SUPPORTED) {
      if (this.highlightSwitchersTimeout) {
        clearTimeout(this.highlightSwitchersTimeout)
      } else {
        this.wholeDiv.classList.add('highlight-switchers')
      }

      this.highlightSwitchersTimeout = window.setTimeout(() => {
        this.wholeDiv.classList.remove('highlight-switchers')
        this.highlightSwitchersTimeout = 0
      }, 3e3)

      return
    }

    if (hasMouseMovedSinceDown(e)) {
      return
    }

    const isZooming = this.isZooming && false
    // Зоны, считающиеся «кликом по контролу», — такой клик НЕ трактуется как
    // тап по фону (который закрывает вьювер). 'media-viewer-topbar' накрывает
    // весь топбар, включая handheld-крестик в .media-viewer-topbar-left (вне
    // .media-viewer-buttons). Ветка live-стрима (admin-popup-container, PiP по
    // клику в фон, tweb :1102-1122) не портирована — см. шапку файла.
    const classNames = ['ckin__player', 'media-viewer-buttons', 'media-viewer-author', 'media-viewer-caption', 'zoom-container', 'media-viewer-topbar']
    if (isZooming) {
      classNames.push('media-viewer-movers')
    }

    const hasClickedSomething = classNames.some((s) => !!findUpClassName(target, s))
    if (!hasClickedSomething || (!isZooming && (target.tagName === 'IMG' || target.tagName === 'image'))) {
      void this.close() // void: fire-and-forget как в tweb (oxlint no-floating-promises)
    }
  }

  // Порт tweb base.ts:1132-1160. Гейт overlayCounter.overlaysActive > 1
  // (:1134-1136, :1163-1165 — «поверх вьювера открыт ещё оверлей») не
  // портирован — оверлей-счётчика нет (пометка в шапке файла).
  private onKeyDown = (e: KeyboardEvent) => {
    const key = e.key

    let good = true
    if (key === 'ArrowRight') {
      // в tweb `!this.isZooming && ...click()` (oxlint no-unused-expressions)
      if (!this.isZooming) this.buttons.next.click()
    } else if (key === 'ArrowLeft') {
      if (!this.isZooming) this.buttons.prev.click()
    } else if (key === '-' || key === '=') {
      if (this.ctrlKeyDown) {
        this.addZoomStep(key === '=')
      }
    } else {
      good = false
    }

    if (e.ctrlKey || e.metaKey) {
      this.ctrlKeyDown = true
    }

    if (good) {
      cancelEvent(e)
    }
  }

  // Порт tweb base.ts:1162-1174.
  private onKeyUp = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) {
      this.ctrlKeyDown = false

      if (this.isZooming) {
        this.setZoomValue()
      }
    }
  }

  // См. шапку файла: у tweb — body активного окна (Document-PiP), у нас — body.
  protected getOverlayRoot(): HTMLElement {
    return document.body
  }

  // Порт tweb base.ts:2452-2455 (внутри _openMedia): вьювер живёт в body,
  // reflow нужен, чтобы transition открытия стартовал из примонтированного
  // состояния, а не схлопнулся в первый кадр.
  protected mountToOverlay() {
    if (!this.wholeDiv.parentElement) {
      this.getOverlayRoot().append(this.wholeDiv)
      void this.wholeDiv.offsetLeft // reflow
    }
  }

  // Порт tweb base.ts:2017-2064 на React-остров. avatarNew → наш
  // shared/ui/Avatar (сателлит authorIsland.tsx) через createRoot в
  // display:contents-хост — `.media-viewer-userpic` остаётся визуальным
  // ребёнком `.media-viewer-author`, правила партиала целы. Повторный вызов
  // НЕ плодит root (в tweb — replaceWith нового узла + destroy старого
  // avatarMiddlewareHelper; у React та же смена содержимого — ре-рендер).
  // wrapPeerTitle/formatFullSentTime (RPC пиров + лангпак) не портированы:
  // имя/дата приезжают готовыми строками дескриптора (Task 14 собирает их из
  // сообщения), поэтому replaceContent-аналог — textContent.
  public setAuthorInfo(author: ViewerAuthor) {
    this.authorInfo = author
    if (!this.authorRoot) {
      const host = this.authorHost = document.createElement('div')
      host.style.display = 'contents'
      this.author.container.prepend(host)
      this.authorRoot = createRoot(host)
    }
    // flushSync: ядро vanilla — топбар обязан быть собран синхронно в кадре
    // открытия, как prepend узла аватара в tweb (:2046-2050)
    flushSync(() => {
      this.authorRoot!.render(createElement(ViewerAuthorAvatar, {
        name: author.name,
        avatarPreview: author.avatarPreview,
        peerId: author.peerId,
      }))
    })
    this.author.nameEl.textContent = author.name
    // tweb :2043 — `replaceContent(this.author.date, formatFullSentTime(timestamp))`.
    // Узел, а не строка: язык и настройку 12/24 часа ведёт ядро.
    this.author.date.replaceChildren(
      ...(author.date === undefined ? [] : [formatFullSentTime(author.date)]),
    )
  }

  // Слот caption (vanilla-путь): вставить готовый DOM-узел в scrollable
  // (`.media-viewer-caption > .scrollable`), null — очистить; пустая подпись
  // прячет контейнер классом hide (как setCaption message-варианта tweb).
  public setCaptionNode(node: HTMLElement | null) {
    if (node) {
      this.captionScrollable.replaceChildren(node)
    } else {
      this.captionScrollable.replaceChildren()
    }
    this.content.caption.classList.toggle('hide', !node)
  }

  // React-путь caption: остров в том же scrollable-слоте — им пользуется
  // message-подкласс (setCaption → RichText). Пути взаимоисключающие — слот
  // принадлежит либо root'у, либо setCaptionNode.
  public renderCaptionIsland(jsx: ReactNode | null) {
    this.captionRoot ??= createRoot(this.captionScrollable)
    flushSync(() => {
      this.captionRoot!.render(jsx)
    })
    this.content.caption.classList.toggle('hide', jsx == null)
  }

  // Порт tweb base.ts:1176-1798 — полёт открытия/закрытия. Из веток tweb НЕ
  // портированы только не имеющие целей в приложении (каждая помечена на месте):
  // SVG-хвостовые баблы (измерение, снапшот-пересборка svg, sizeTailPath),
  // profile-avatars (Task 16), findUpAvatar (Task 16), live-стрим RTMP.
  protected async setMoverToTarget(target: HTMLElement | undefined, closing = false, fromRight = 0) {
    this.dispatchEvent('setMoverBefore')

    // tweb :1179-1182: geometry-риды держим раньше style-райтов по источнику —
    // прятать плавающие бейджи до getBoundingClientRect/getComputedStyle значило
    // бы лишний принудительный style/layout-флаш на холодном открытии.
    const sourceTarget = target

    // setNewMover кладёт в content.mover MoverElement (карта content типизирована
    // общим HTMLElement — как в tweb, где middlewareHelper ambient на элементах)
    const mover = this.content.mover as MoverElement

    if (!closing) {
      mover.replaceChildren()
    }

    const zoomValue = this.isZooming && closing ? this.transform.scale : ZOOM_INITIAL_VALUE
    const zoomedClose = closing && zoomValue !== 1
    // tweb :1193-1197: закрытие в повороте требует того же переноса transform'а
    // moversContainer → mover, что и зум-закрытие ниже: контейнер должен
    // закончить в identity, чтобы математика thumb-rect шла в чистых
    // вьюпорт-координатах.
    const closeRotation = closing ? this.rotation : 0
    const rotatedClose = closeRotation !== 0
    // tweb :1198-1202: пивот поворота в СОБСТВЕННЫХ координатах мувера (центр
    // его контента) — захватывается при переносе, чтобы close-анимация ниже
    // раскручивала поворот вокруг той же точки.
    let closeRotationPivotX = 0
    let closeRotationPivotY = 0
    if (zoomedClose || rotatedClose) {
      // tweb :1204-1215: анимировать transform moversContainer'а к целевой
      // матрице, одновременно везя ребёнка к вьюпортному thumb-rect, нельзя —
      // не-identity родитель дополнительно скейлил/крутил/сдвигал бы целевой
      // transform и локальный клип. Вместо этого живой transform переносится с
      // moversContainer на мувер синхронно (без видимого скачка — тот же кадр,
      // без transition), контейнер сбрасывается в identity, и стандартный
      // close-путь анимирует мувер с текущей экранной позиции к thumb-rect.
      // initialContentRect — до-зумный bbox медиа (снят setZoomValue в Task 12
      // до первого зума): × zoom + пан воспроизводят позицию юзера точно.
      const zoom = this.transform.scale
      const panX = this.transform.x
      const panY = this.transform.y
      const baseRect = (zoomedClose && this.initialContentRect) || this.content.media.getBoundingClientRect()
      const visualX = zoom * baseRect.left + panX
      const visualY = zoom * baseRect.top + panY

      let startTransform = `translate3d(${visualX}px, ${visualY}px, 0) scale3d(${zoom}, ${zoom}, 1)`
      if (rotatedClose) {
        // tweb :1224-1233: тот же rotate+refit-обёртыш, что эмитит
        // buildMoversTransform (Task 12), ВНУТРЕННИМ transform'ом (после переноса
        // зум/пана) с пивотом на центре контента мувера — зеркалит экранный
        // порядок, визуальная позиция воспроизводится точно. transform-origin:
        // top left (0,0) делает явный translate(C)…translate(-C) независимым
        // от origin.
        closeRotationPivotX = baseRect.width / 2
        closeRotationPivotY = baseRect.height / 2
        const fit = this.getRotationFitScale(closeRotation)
        startTransform += ` translate(${closeRotationPivotX}px, ${closeRotationPivotY}px) rotate(${closeRotation}deg) scale(${fit.toFixed(5)}) translate(${-closeRotationPivotX}px, ${-closeRotationPivotY}px)`
      }

      this.moversContainer.classList.add('no-transition')
      // tweb :1238-1243: подавить transition мувера инлайном на этот кадр, чтобы
      // скачок transform'а (.center-якорь → текущая визуальная позиция) не
      // анимировался; применить transform, снять .center, вычистить
      // инлайн-позиционирование и сбросить контейнер — всё в одном кадре,
      // визуальная позиция не меняется.
      mover.style.transition = 'none'
      mover.style.transform = startTransform
      mover.classList.remove('center')
      this.clearCenterStyles(mover)
      if (!zoomedClose) {
        // tweb :1246-1252: поворот без зума — прибить мувер к реальному rect
        // медиа (как в не-transfer close-ветке ниже), чтобы на кадрах doubleRaf
        // он не рисовался мобильным full-viewport размером до назначения
        // containerRect.
        mover.style.width = `${baseRect.width}px`
        mover.style.height = `${baseRect.height}px`
      }
      this.moversContainer.style.transform = ''
      // tweb :1254: рефлоу-барьер — коммитит no-transition-сброс (перенос
      // transform'а и identity контейнера) до возврата transition, иначе браузер
      // слил бы обе записи в один кадр и сыграл скачок анимацией
      void mover.offsetLeft
      mover.style.transition = ''
      this.moversContainer.classList.remove('no-transition')
    } else {
      this.removeCenterFromMover(mover)
      if (closing) {
        // tweb :1259-1269: removeCenterFromMover снял .center, но оставил
        // мобильные width/height:100% applyCenterStyles (full-viewport rest
        // state). Прибиваем к реальному rect медиа сейчас, чтобы мувер не
        // рисовался на весь вьюпорт два кадра doubleRaf ниже (видимая вспышка)
        // до назначения containerRect. Десктоп уже несёт px — значение совпадает.
        const mediaRect = this.content.media.getBoundingClientRect()
        mover.style.width = `${mediaRect.width}px`
        mover.style.height = `${mediaRect.height}px`
      }
    }
    if (closing) {
      // tweb :1272: рефлоу-барьер — фиксирует стартовое состояние закрытия
      // (pin размера/transform выше) в layout до кадров doubleRaf, чтобы переход
      // к целевому transform стартовал из сформированного состояния
      void mover.offsetLeft
      await doubleRaf()
    }

    const wasActive = fromRight !== 0

    const delay = liteMode.isAvailable('animations') ? (wasActive ? MOVE_TRANSITION_TIME : OPEN_TRANSITION_TIME) : 0

    let realParent: HTMLElement | undefined

    let rect: DOMRectEditable | undefined
    if (target) {
      // Измерение source-rect по типу цели (tweb :1293-1309). Оставлены только
      // ветки с целями в нашем приложении; пропущено:
      //   • findUpAvatar (tweb :1294, реф в условии grid-item) — аватарки
      //     откроют вьювер в Task 16;
      //   • SVGImageElement/SVGForeignObjectElement → .attachment (:1297-1299) —
      //     SVG-хвостовых баблов у нас нет (фичи не существует);
      //   • profile-avatars-avatar → profile-avatars-container + сброс цели у
      //     неактивного аватара (:1300-1308) — шапка профиля у нас на
      //     CSS-модулях без tweb-классов, цель появится в Task 16.
      if (target.classList.contains('grid-item')) {
        realParent = target
        rect = target.getBoundingClientRect()
      }
    }

    if (!target) {
      target = this.content.media
    }

    if (!rect) {
      realParent = target.parentElement as HTMLElement
      rect = target.getBoundingClientRect()
    }

    let needOpacity = false
    let viewportClipPath: string | undefined
    let overflowElement: HTMLElement | null = null
    if (target === this.content.media) {
      needOpacity = true
    } else {
      // условие tweb :1325 `!target.classList.contains('profile-avatars-avatar')`
      // опущено вместе с profile-веткой измерения выше (цель появится в Task 16)
      overflowElement = findUpClassName(realParent!, 'scrollable')
      let overflowRect: DOMRectMinified | undefined
      // tweb :1329-1342: в чате scrollable выступает за видимую область баблов
      // отрицательным inset-block, поэтому overflow-rect ужимается до
      // .bubbles-viewport (реальная видимая зона между топбаром и полем ввода).
      // У нас `.bubbles-viewport` существует только правилом партиала
      // (styles/tweb/_chat.scss:1097) — Chat.tsx такого узла не рендерит,
      // querySelector отдаёт null и overflowRect остаётся невыставленным (кадр
      // не ужимается). Код оставлен 1:1 — оживёт, когда лента дорастёт до
      // узла-вьюпорта.
      const chatContainer = overflowElement && findUpClassName(realParent!, 'chat')
      const bubblesViewport = chatContainer?.querySelector(':scope > .bubbles-viewport') as HTMLElement | null
      if (bubblesViewport && overflowElement) {
        const baseRect = overflowElement.getBoundingClientRect()
        const viewportRect = bubblesViewport.getBoundingClientRect()
        overflowRect = {
          top: Math.max(baseRect.top, viewportRect.top),
          right: Math.min(baseRect.right, viewportRect.right),
          bottom: Math.min(baseRect.bottom, viewportRect.bottom),
          left: Math.max(baseRect.left, viewportRect.left),
        }
      }
      const visibleRect = overflowElement && getVisibleRect(realParent!, overflowElement, true, rect, overflowRect)

      if (closing && overflowElement && (!visibleRect || visibleRect.overflow.vertical === 2 || visibleRect.overflow.horizontal === 2)) {
        // tweb :1345-1354: на закрытии перецеливаемся в отцентрованное медиа
        // вместо полёта к ушедшему за экран / большему вьюпорта источнику.
        // Перецел оставляет мувер на месте, так что при полностью оффскринном
        // источнике движения нет — и раз анимировать некуда, гасим opacity
        // (движение ноль, только opacity).
        target = this.content.media
        realParent = target.parentElement as HTMLElement
        rect = target.getBoundingClientRect()
        needOpacity = true
      } else if (overflowElement && !visibleRect) {
        // tweb :1355-1357: открытие от оффскринного источника — вплытие opacity
        needOpacity = true
      } else if (visibleRect && (visibleRect.overflow.vertical || visibleRect.overflow.horizontal)) {
        // tweb :1358-1366: воспроизводим только границы клипающего предка; свои
        // кромки цели остаются открыты, чтобы мувер мог вырасти из source-rect
        viewportClipPath = getMediaViewerClipPath({
          visibleRect,
          viewportWidth: windowSize.width,
          viewportHeight: windowSize.height,
        })
      }
    }

    // tweb :1369-1372: moversContainer здесь identity (zoomedClose-ветка выше
    // сбросила его после переноса transform'а), так что это до-зумный
    // layout-rect — как и при незумном закрытии.
    const containerRect = this.content.media.getBoundingClientRect()

    let transform = ''
    let left: number
    let top: number

    if (wasActive) {
      left = fromRight === 1 ? windowSize.width : -containerRect.width
      top = containerRect.top
    } else {
      left = rect.left
      top = rect.top
    }

    transform += `translate3d(${left}px,${top}px,0) `

    let aspecter: HTMLDivElement | undefined
    if (target instanceof HTMLImageElement || target instanceof HTMLVideoElement || target.tagName === 'DIV') {
      if (mover.firstElementChild && mover.firstElementChild.classList.contains('media-viewer-aspecter')) {
        aspecter = mover.firstElementChild as HTMLDivElement

        // .ckin__player — chrome vanilla-плеера (@lib/mediaPlayer): на
        // закрытии/листании видео возвращается голым в аспектер, плеер уходит
        const player = aspecter.querySelector('.ckin__player')
        if (player && !needOpacity) {
          const video = player.querySelector('video')
          if (video) {
            video.pause()
            player.replaceWith(video)
          }
        }

        if (!aspecter.style.cssText) { // всё из-за видео, элементы управления скейлятся, так бы можно было этого не делать
          mover.classList.remove('active')
          this.setFullAspect(aspecter, containerRect, rect)
          // tweb :1423: рефлоу-барьер — коммитит full-aspect в «неактивном»
          // состоянии, чтобы возврат .active не сыграл переход от старых значений
          void mover.offsetLeft
          mover.classList.add('active')
        }
      } else {
        aspecter = document.createElement('div')
        aspecter.classList.add('media-viewer-aspecter')
        mover.prepend(aspecter)
      }

      aspecter.style.cssText = `width: ${rect.width}px; height: ${rect.height}px; transform: scale3d(${containerRect.width / rect.width}, ${containerRect.height / rect.height}, 1);`
    }

    mover.style.width = containerRect.width + 'px'
    mover.style.height = containerRect.height + 'px'

    const scaleX = rect.width / containerRect.width
    const scaleY = rect.height / containerRect.height
    if (!wasActive) {
      transform += `scale3d(${scaleX},${scaleY},1) `
    }

    // tweb :1445-1459: радиусы по углам (tl, tr, br, bl) в px вьюпорта — с
    // наследованием от клипающих предков (скруглённый контейнер shared-media
    // грида), когда угол realParent совпадает с углом предка. Мувер скейлится
    // неравномерно (scaleX ≠ scaleY у квадратной ячейки над альбомной фоткой),
    // поэтому радиусы выражены эллиптически X/Y на угол — видимый угол остаётся
    // круглым на масштабе вьюпорта, а не тянется с мувером.
    const effectiveCornerRadii = this.computeEffectiveCornerRadii(realParent!, rect, overflowElement)
    const xRadii = effectiveCornerRadii.map((r) => r / scaleX)
    const yRadii = effectiveCornerRadii.map((r) => r / scaleY)
    // в tweb строка дальше уходит и в sizeTailPath (SVG-хвосты — не портированы);
    // здесь скругляет трансформируемый мувер независимо от клипа предка
    const borderRadius = `${xRadii.map((v) => v + 'px').join(' ')} / ${yRadii.map((v) => v + 'px').join(' ')}`

    if (!closing && sourceTarget) {
      this.hideFloatings(sourceTarget)
    }

    if (rotatedClose) {
      // tweb :1466-1476: раскрутить поворот до ближайшей «вертикали» (кратное
      // 360 ≡ 0° визуально — как всё ещё вертикальная миниатюра) и снять
      // orientation-refit вокруг того же mover-локального пивота, что и перенос,
      // ВНУТРЕННИМ transform'ом. Та же структура функций, что у перенесённого
      // стартового transform'а — CSS интерполирует rotate→вертикаль / scale→1
      // в ногу с translate/scale к миниатюре, коротким путём (|дельта| ≤ 180°).
      const upright = Math.round(closeRotation / 360) * 360
      transform += `translate(${closeRotationPivotX}px, ${closeRotationPivotY}px) rotate(${upright}deg) scale(1) translate(${-closeRotationPivotX}px, ${-closeRotationPivotY}px)`
    }

    // tweb :1478-1481: fixed-wrapper воспроизводит ТОЛЬКО клипающего предка
    // источника: стартует на его вьюпорт-границе и втягивается к inset(0), пока
    // мувер растёт; клип не на скейленном мувере — каждый inset интерполируется
    // в пикселях вьюпорта.
    const useClipPath = USE_MEDIA_VIEWER_CLIP_PATH && !!viewportClipPath && !wasActive
    if (!wasActive) {
      mover.style.borderRadius = borderRadius
      if (aspecter) {
        aspecter.style.borderRadius = borderRadius
      }
    }

    if (needOpacity) {
      mover.style.opacity = '0'
    }

    const wrapper = mover.parentElement!
    if (useClipPath) {
      if (closing && !wrapper.style.clipPath) {
        // tweb :1493-1500: вьювер, открытый от полностью видимого источника, в
        // покое клипа не несёт. Праймим синтаксически совместимый inset(0)
        // перед целевым клипом закрытия, чтобы браузер интерполировал, а не
        // переключил none → inset() дискретно.
        wrapper.style.transition = 'none'
        wrapper.style.clipPath = NO_MEDIA_VIEWER_CLIP_PATH
        // tweb :1499: рефлоу-барьер — коммитит праймер под выключенным
        // transition; без него запись целевого клипа ниже слилась бы с праймером
        // в один кадр и интерполяции не было бы
        void wrapper.offsetLeft
        wrapper.style.transition = ''
      } else if (!closing) {
        // tweb :1501-1505: не анимировать от `none` к стартовому состоянию
        // открытия; transition вернётся в подготовительном кадре (fastRaf ниже)
        wrapper.style.transition = 'none'
      }
      wrapper.style.clipPath = viewportClipPath!
    } else {
      wrapper.style.clipPath = ''
    }
    mover.style.clipPath = ''

    const transitionProperty = needOpacity ? 'opacity' : 'transform'
    const closeTransitionPromise = closing ? this.waitForMoverTransition(mover, delay, transitionProperty) : undefined
    mover.style.transform = transform

    // `path`/`isOut` tweb (:1520-1521) обслуживали только SVG-хвосты — не портированы

    const deferred = this.setMoverAnimationPromise = deferredPromise<void>()
    const ret = { onAnimationEnd: deferred }

    void deferred.finally(() => {
      this.dispatchEvent('setMoverAfter')

      if (this.setMoverAnimationPromise === deferred) {
        this.setMoverAnimationPromise = null
      }
    })

    if (!closing) {
      let mediaElement: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | undefined

      const selector = 'video, img, .canvas-thumbnail'
      const queryFrom = target.matches(selector) ? target.parentElement! : target
      const elements = Array.from(queryFrom.querySelectorAll(selector)) as (HTMLImageElement | HTMLVideoElement | HTMLCanvasElement)[]
      if (elements.length) {
        const snapshotSource = elements.pop()!
        target = snapshotSource
        // tweb :1543-1547: отрендеренная картинка переиспользует уже
        // декодированный браузером ресурс; canvas-снапшоты — для кадров
        // video/canvas, их backing store ограничен отображаемым размером
        // (getMediaViewerSnapshotSize). Ветка live-стрима tweb (:1548
        // `this.live`: DPR=1 + размытие boxBlurCanvasRGB) не портирована —
        // RTMP-стримов у нас нет (фичи не существует).
        if (!(snapshotSource instanceof HTMLImageElement)) {
          const sourceWidth = snapshotSource instanceof HTMLVideoElement ? snapshotSource.videoWidth : snapshotSource.width
          const sourceHeight = snapshotSource instanceof HTMLVideoElement ? snapshotSource.videoHeight : snapshotSource.height
          const snapshotSize = getMediaViewerSnapshotSize({
            width: rect.width,
            height: rect.height,
            sourceWidth,
            sourceHeight,
            devicePixelRatio: window.devicePixelRatio,
          })
          const canvas = document.createElement('canvas')
          canvas.width = snapshotSize.width
          canvas.height = snapshotSize.height
          canvas.className = 'canvas-thumbnail thumbnail media-photo'
          const context = canvas.getContext('2d')
          if (context) {
            try {
              context.drawImage(snapshotSource, 0, 0, canvas.width, canvas.height)
              target = canvas
            } catch {
              // tweb :1572-1575: оставить отрендеренный источник фолбэком, когда
              // браузер не может скопировать ещё не готовый видеокадр или
              // защищённый canvas
            }
          }
        }
      }

      if (target.tagName === 'DIV') { // useContainerAsTarget; `|| findUpAvatar(target)` tweb :1580 — аватарки в Task 16
        const images = Array.from(target.querySelectorAll('img'))
        const image = images.pop()
        if (image) {
          mediaElement = new Image()
          mediaElement.src = image.currentSrc || image.src
          mover.append(mediaElement)
        }
        // else-ветка tweb :1587-1594 (клон цветного `.avatar[data-color]`) не
        // портирована — цвет-аватары у нас React-компонент без этого класса,
        // цель появится в Task 16
      } else if (target instanceof HTMLImageElement) {
        mediaElement = new Image()
        mediaElement.src = target.currentSrc || target.src
      } else if (target instanceof HTMLVideoElement) {
        mediaElement = createVideo({ middleware: mover.middlewareHelper.get() })
        mediaElement.src = target.src
        // SVGSVGElement-ветка tweb :1603-1654 (пересборка clip-id, хвостик
        // use/path, generatePathData) не портирована — SVG-хвостовых баблов нет
      } else if (target instanceof HTMLCanvasElement) {
        mediaElement = target
      }

      if (aspecter) {
        aspecter.style.borderRadius = borderRadius

        if (mediaElement) {
          aspecter.append(mediaElement)
        }
      }

      const foundMedia = mover.querySelector('video, img') as HTMLImageElement | HTMLVideoElement | null
      if (foundMedia instanceof HTMLImageElement) {
        foundMedia.classList.add('thumbnail')
        if (!aspecter) {
          foundMedia.style.width = containerRect.width + 'px'
          foundMedia.style.height = containerRect.height + 'px'
        }
      }

      mover.style.visibility = ''

      fastRaf(() => {
        wrapper.style.transition = ''
        mover.classList.add(wasActive ? 'moving' : 'active')
      })
    } else {
      // SVG sizeTailPath tweb :1696-1702 — не портирован (нет SVG-хвостов)

      this.toggleWholeActive(false)

      void closeTransitionPromise!.then((completed) => {
        if (!completed) {
          deferred.resolve!()
          return
        }

        mover.replaceChildren()
        mover.classList.remove('moving', 'active', 'hiding')
        mover.style.cssText = 'visibility: hidden; width: 1px; height: 1px;'
        wrapper.style.transition = 'none'
        wrapper.style.clipPath = ''
        this.revealHiddenFloatings()

        deferred.resolve!()
      })

      mover.classList.remove('opening')

      return ret
    }

    mover.classList.add('opening')

    // tweb :1729-1732: одного RAF'а недостаточно, иногда анимация с одним не
    // срабатывает (преимущественно на мобильных)
    await doubleRaf()

    const openTransitionPromise = this.waitForMoverTransition(mover, delay, transitionProperty)
    mover.style.transform = `translate3d(${containerRect.left}px,${containerRect.top}px,0) scale3d(1,1,1)`
    if (needOpacity) {
      mover.style.opacity = ''
    }
    if (useClipPath) {
      wrapper.style.clipPath = NO_MEDIA_VIEWER_CLIP_PATH
    }

    if (aspecter) {
      this.setFullAspect(aspecter, containerRect, rect)
    }

    mover.style.borderRadius = ''
    if (aspecter) {
      aspecter.style.borderRadius = ''
    }

    void openTransitionPromise.then((completed) => {
      if (!completed) {
        wrapper.style.transition = 'none'
        wrapper.style.clipPath = ''
        deferred.resolve!()
        return
      }

      mover.classList.remove('moving', 'opening')

      if (aspecter) { // всё из-за видео, элементы управления скейлятся, так бы можно было этого не делать
        // условие tweb :1767 `if(mover.querySelector('video') || true)` — всегда
        // истинно, ветка развёрнута без него
        mover.classList.remove('active')
        aspecter.style.cssText = ''
        // tweb :1770: рефлоу-барьер — коммитит сброс аспектера в «неактивном»
        // состоянии, чтобы возврат .active ниже не анимировал схлопывание
        // counter-scale
        void mover.offsetLeft
      }

      // tweb :1776-1784: установка центральной позиции (важно для ресайза).
      // transition снимается инлайном на одну reflow-точку, чтобы переход из
      // open-transform в .center-transform не анимировался; затем инлайн
      // чистится — будущие изменения (PiP opacity, close transform) идут через
      // .active-правило.
      mover.classList.add('center')
      mover.style.transition = 'none'
      this.applyCenterStyles(mover)
      // tweb :1783: рефлоу-барьер — коммитит center-transform без анимации
      void mover.offsetLeft
      mover.style.transition = ''

      // это уже нужно для будущих анимаций
      mover.classList.add('active')
      wrapper.style.clipPath = ''

      deferred.resolve!()
    })

    // sizeTailPath tweb :1793-1795 — не портирован (нет SVG-хвостов)

    return ret
  }

  // Порт tweb base.ts:1800-1841: ожидание конца transition мувера по
  // transitionend/transitioncancel С ФИЛЬТРОМ по propertyName + страховочный
  // таймер duration+100 — переход может легитимно не создаться при равных
  // старт/конец-значениях; штатный путь — transitionend, чтобы уборка не
  // резала задержанный первый кадр пополам.
  private waitForMoverTransition(mover: HTMLElement, duration: number, propertyName: string) {
    this.cancelMoverTransition(mover)
    if (!duration) {
      return Promise.resolve(true)
    }

    return new Promise<boolean>((resolve) => {
      let settled = false
      let timeout = 0

      const finish = (completed: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        mover.removeEventListener('transitionend', onTransitionEnd)
        mover.removeEventListener('transitioncancel', onTransitionCancel)
        if (this.moverTransitionCancels.get(mover) === cancel) {
          this.moverTransitionCancels.delete(mover)
        }
        resolve(completed)
      }
      const cancel = () => finish(false)
      const onTransitionEnd = (event: TransitionEvent) => {
        if (event.target === mover && event.propertyName === propertyName) {
          finish(true)
        }
      }
      const onTransitionCancel = (event: TransitionEvent) => {
        if (event.target === mover && event.propertyName === propertyName) {
          finish(false)
        }
      }

      this.moverTransitionCancels.set(mover, cancel)
      mover.addEventListener('transitionend', onTransitionEnd)
      mover.addEventListener('transitioncancel', onTransitionCancel)
      timeout = window.setTimeout(() => finish(true), duration + 100)
    })
  }

  private cancelMoverTransition(mover: HTMLElement) {
    this.moverTransitionCancels.get(mover)?.()
  }

  // Порт tweb base.ts:1847-1856: на закрытии сперва ставится `backwards`
  // (CSS видит «активен + задом наперёд» и готовит обратный переход), и лишь
  // отдельной таской снимается `active` — иначе оба класса применились бы в
  // одном кадре и переход пошёл бы вперёд.
  protected toggleWholeActive(active: boolean) {
    if (active) {
      this.wholeDiv.classList.add('active')
    } else {
      this.wholeDiv.classList.add('backwards')
      setTimeout(() => {
        this.wholeDiv.classList.remove('active')
      }, 0)
    }
  }

  // Порт tweb base.ts:1858-1882: аспектер растягивается до пропорции целевого
  // бокса (containerRect), сохраняя привязку к rect источника, — counter-scale
  // считается уже от полного аспекта.
  protected setFullAspect(aspecter: HTMLDivElement, containerRect: DOMRect, rect: DOMRectEditable) {
    const proportion = containerRect.width / containerRect.height

    let { width, height } = rect
    if (proportion > 0) {
      width = height * proportion
    } else {
      height = width * proportion
    }

    aspecter.style.cssText = `width: ${width}px; height: ${height}px; transform: scale3d(${containerRect.width / width}, ${containerRect.height / height}, 1);`
  }

  // sizeTailPath tweb :1884-1910 не портирован — обслуживал только
  // SVG-хвостовые баблы (фичи нет)

  // Порт tweb base.ts:1912-1926.
  protected removeCenterFromMover(mover: HTMLElement) {
    if (mover.classList.contains('center')) {
      const rect = this.content.media.getBoundingClientRect()
      // tweb :1916-1919: подавить скачок transform'а от .center-якоря к целевому
      // rect: transition снимается инлайном на эту reflow-точку и возвращается
      // после, чтобы последующая close-анимация (скейленный transform в
      // setMoverToTarget) анимировалась штатно.
      mover.style.transition = 'none'
      mover.style.transform = `translate3d(${rect.left}px,${rect.top}px,0)`
      mover.classList.remove('center')
      this.clearCenterStyles(mover)
      // tweb :1923: рефлоу-барьер — коммитит транзишенлесс-скачок до возврата
      // transition, иначе снятие .center сыграло бы анимацией
      void mover.offsetLeft
      mover.style.transition = ''
    }
  }

  // Порт tweb base.ts:1928-1956 — слайд мувера при листании prev/next.
  protected moveTheMover(mover: MoverElement, toLeft = true) {
    const windowW = windowSize.width

    this.removeCenterFromMover(mover)

    mover.classList.add('moving')

    const rect = mover.getBoundingClientRect()

    const newTransform = mover.style.transform.replace(/translate3d\((.+?),/, (match, p1: string) => {
      const x = toLeft ? -rect.width : windowW
      return match.replace(p1, x + 'px')
    })

    const delay = liteMode.isAvailable('animations') ? MOVE_TRANSITION_TIME : 0
    const transitionPromise = this.waitForMoverTransition(mover, delay, 'transform')
    mover.style.transform = newTransform

    void transitionPromise.then((completed) => {
      if (!completed) return
      mover.middlewareHelper.destroy()
      // wrapper удаляется вместе с мувером, чтобы не утёк (tweb :1953-1954)
      const wrapper = mover.parentElement || mover
      wrapper.remove()
    })
  }

  // Порт tweb base.ts:1958-1980.
  protected setNewMover(): MoverElement {
    // Каждый мувер живёт в своём wrapper'е: при листании prev/next старые
    // уезжают и удаляются целиком (Task 11, tweb :1950-1955).
    const wrapper = document.createElement('div')
    wrapper.classList.add(MEDIA_VIEWER_CLASSNAME + '-mover-wrapper')

    // Object.assign даёт тип-пересечение без каста (в tweb `middlewareHelper`
    // объявлен на HTMLElement глобально — см. шапку файла)
    const newMover: MoverElement = Object.assign(document.createElement('div'), {
      middlewareHelper: this.middlewareHelper.get().create(),
    })
    newMover.classList.add('media-viewer-mover')
    // Крошечная, но участвующая в layout цель трансформа с самого создания:
    // с display:none will-change не работал бы до кадра первой анимации.
    newMover.style.cssText = 'visibility: hidden; width: 1px; height: 1px;'
    wrapper.appendChild(newMover)

    if (this.content.mover) {
      const oldWrapper = this.content.mover.parentElement!
      oldWrapper.parentElement!.appendChild(wrapper)
    } else {
      this.moversContainer.appendChild(wrapper)
    }

    return this.content.mover = newMover
  }

  // Порт tweb base.ts:2066-2114: обход вверх от элемента со сбором радиусов по
  // углам (tl, tr, br, bl) в px вьюпорта. У каждого клипающего предка
  // (overflow != visible) с ненулевым border-radius радиус угла наследуется
  // ТОЛЬКО когда соответствующий угол элемента совпадает с углом предка — так
  // внутренние ячейки скруглённого контейнера не подхватывают внешнее
  // скругление, а угловая ячейка — подхватывает.
  protected computeEffectiveCornerRadii(
    element: HTMLElement,
    elementRect: DOMRectMinified,
    clippingBoundary?: HTMLElement | null,
  ): [number, number, number, number] {
    const TOLERANCE = 1.5 // суб-пиксель + люфт grid-gap
    const radii: [number, number, number, number] = [0, 0, 0, 0]

    const elementStyle = window.getComputedStyle(element)
    radii[0] = parseFloat(elementStyle.borderTopLeftRadius) || 0
    radii[1] = parseFloat(elementStyle.borderTopRightRadius) || 0
    radii[2] = parseFloat(elementStyle.borderBottomRightRadius) || 0
    radii[3] = parseFloat(elementStyle.borderBottomLeftRadius) || 0

    let ancestor = element.parentElement
    let depth = 0
    while (ancestor && ancestor !== document.body && depth++ < 12) {
      const aStyle = window.getComputedStyle(ancestor)
      if (aStyle.overflow !== 'visible') {
        const aTL = parseFloat(aStyle.borderTopLeftRadius) || 0
        const aTR = parseFloat(aStyle.borderTopRightRadius) || 0
        const aBR = parseFloat(aStyle.borderBottomRightRadius) || 0
        const aBL = parseFloat(aStyle.borderBottomLeftRadius) || 0

        if (aTL || aTR || aBR || aBL) {
          const aRect = ancestor.getBoundingClientRect()
          const sameLeft = Math.abs(elementRect.left - aRect.left) < TOLERANCE
          const sameRight = Math.abs(elementRect.right - aRect.right) < TOLERANCE
          const sameTop = Math.abs(elementRect.top - aRect.top) < TOLERANCE
          const sameBottom = Math.abs(elementRect.bottom - aRect.bottom) < TOLERANCE

          if (aTL && sameLeft && sameTop) radii[0] = Math.max(radii[0], aTL)
          if (aTR && sameRight && sameTop) radii[1] = Math.max(radii[1], aTR)
          if (aBR && sameRight && sameBottom) radii[2] = Math.max(radii[2], aBR)
          if (aBL && sameLeft && sameBottom) radii[3] = Math.max(radii[3], aBL)
        }
      }

      if (ancestor === clippingBoundary) break
      ancestor = ancestor.parentElement
    }

    return radii
  }

  // Порт tweb base.ts:2116-2122.
  protected getLayoutReserves(): { top: number, bottom: number } {
    if (mediaSizes.isMobile) {
      return { top: RESERVE_TOP_MOBILE, bottom: RESERVE_BOTTOM_MOBILE }
    }

    return { top: RESERVE_TOP_DESKTOP, bottom: RESERVE_BOTTOM_DESKTOP }
  }

  // Порт tweb base.ts:2124-2127: плавающие оверлеи source/target-бабла
  // (.video-time, .time.is-floating) не должны светиться во время полёта —
  // перекрывали бы силуэт мувера на позиции миниатюры. На открытии прячутся
  // мгновенно, на закрытии возвращаются анимацией.
  protected hiddenFloatings = new Set<HTMLElement>()

  // Порт tweb base.ts:2129-2151: контексты — по trigger-классу в предках цели;
  // слои контекста сами выбирают контейнер (containerClass) и гасят внутри него
  // селекторы плавающих элементов.
  // Контекст profile-avatars-container tweb (:2140-2144: инфо/градиент шапки
  // профиля + соседний .sidebar-header) НЕ портирован — шапка профиля у нас на
  // CSS-модулях без tweb-классов, цель появится в Task 16.
  protected static readonly FLOATING_CONTEXTS: ReadonlyArray<{
    readonly trigger: string
    readonly layers: ReadonlyArray<{ readonly containerClass: string, readonly selectors: string }>
  }> = [{
      trigger: 'bubble',
      // наши баблы несут все три класса tweb: .video-time (RealMediaBubble),
      // .time.is-floating (bubbleParts/Time, mode='floating'), .video-play
      // (кнопка play в RealMediaBubble)
      layers: [{ containerClass: 'bubble', selectors: '.video-time, .time.is-floating, .video-play' }],
    }, {
      trigger: 'grid-item',
      layers: [{ containerClass: 'grid-item', selectors: '.video-time, .time.is-floating, .video-play' }],
    }]

  // Порт tweb base.ts:2153-2174.
  protected hideFloatings(target: HTMLElement | undefined) {
    if (!target) return
    const context = AppMediaViewerBase.FLOATING_CONTEXTS.find(({ trigger }) => findUpClassName(target, trigger))
    if (!context) return
    // tweb :2157-2160: в альбоме каждый item несёт свои оверлеи (.video-time,
    // .video-play), а запрос по контейнеру накрывает весь бабл; летит только
    // кликнутый item — оверлеи чужих .album-item пропускаются, бабловые
    // (.time.is-floating без .album-item-предка) прячутся по-прежнему.
    const targetAlbumItem = findUpClassName(target, 'album-item')
    for (const { containerClass, selectors } of context.layers) {
      const container = findUpClassName(target, containerClass)
      if (!container) continue
      container.querySelectorAll<HTMLElement>(selectors).forEach((el) => {
        if (this.hiddenFloatings.has(el)) return
        const albumItem = findUpClassName(el, 'album-item')
        if (albumItem && albumItem !== targetAlbumItem) return
        el.style.transition = 'none'
        el.style.opacity = '0'
        this.hiddenFloatings.add(el)
      })
    }
  }

  // Порт tweb base.ts:2176-2193.
  protected revealHiddenFloatings() {
    if (!this.hiddenFloatings.size) return
    const elements = Array.from(this.hiddenFloatings)
    this.hiddenFloatings.clear()
    // tweb :2180-2181: зовётся из реального завершения transition мувера —
    // источник больше не перекрыт и может вплывать сразу
    elements.forEach((el) => {
      // tweb :2183-2184: литеральная длительность — --open-duration скоупится
      // на .media-viewer-whole, а эти оверлеи живут в бабле чата (вне скоупа)
      el.style.transition = `opacity ${OPEN_TRANSITION_TIME}ms`
      el.style.opacity = ''
    })
    setTimeout(() => {
      elements.forEach((el) => {
        el.style.transition = ''
      })
    }, OPEN_TRANSITION_TIME)
  }

  // Порт tweb base.ts:2236-2252: центральная якорная позиция мувера в покое
  // (важно для ресайза — transform не зависит от текущего вьюпорта).
  protected applyCenterStyles(mover: HTMLElement) {
    const { top, bottom } = this.getLayoutReserves()
    const s = mover.style
    s.left = '50%'
    s.top = `calc(50% + ${(top - bottom) / 2}px)`
    s.transform = 'translate3d(-50%, -50%, 0)'
    s.maxWidth = '100vw'
    s.maxHeight = `calc(100vh - ${top + bottom}px)`
    // tweb :2244-2251: на мобильных мувер растягивается на весь вьюпорт (поверх
    // px из openMedia/refit); на десктопе width/height не трогаем — их держит
    // openMedia (Task 13) и синхронизирует с вьюпортом refitMediaToViewport.
    if (mediaSizes.isMobile) {
      s.width = '100%'
      s.height = '100%'
    }
  }

  // Порт tweb base.ts:2254-2265: чистит позиционирование applyCenterStyles,
  // КРОМЕ transform и width/height. Transform принадлежит вызывающему
  // (close-цель / пан), а width/height сразу перезапишет setMoverToTarget
  // свежим containerRect — чистка добавила бы лишний layout-проход
  // (auto → flex shrink → обратно px) в том же синхронном кадре.
  protected clearCenterStyles(mover: HTMLElement) {
    const s = mover.style
    s.left = ''
    s.top = ''
    s.maxWidth = ''
    s.maxHeight = ''
  }

  // Порт tweb base.ts:2267-2274.
  protected get mediaBoxSize(): MediaSize {
    const { width, height } = windowSize
    const { top, bottom } = this.getLayoutReserves()
    return new MediaSize(
      width,
      height - top - bottom - this.extraHeightPadding,
    )
  }

  // Порт tweb base.ts:885-905: после поворота на 90°/270° bbox медиа меняет
  // width/height местами — скейл, чтобы повёрнутый бокс влезал (и заполнял)
  // вьюпорт в новой ориентации, как в Telegram Desktop. 0°/180° сохраняют
  // бокс — fit = 1. Независим от зума (зум умножается сверху в экранном
  // пространстве).
  protected getRotationFitScale(rotation = this.rotation) {
    const normalized = ((rotation % 360) + 360) % 360
    if (normalized !== 90 && normalized !== 270) {
      return 1
    }

    const rect = this.initialContentRect ?? this.content.media.getBoundingClientRect()
    const { width, height } = rect
    if (!width || !height) {
      return 1
    }

    const box = this.mediaBoxSize
    return Math.min(box.width / height, box.height / width)
  }

  // Порт tweb base.ts:2320-3005 (фото + видео). Из веток tweb не портированы
  // (каждая помечена на месте): live-стрим RTMP (фичи нет), HLS/quality-меню
  // (HLS-качеств нет). Вход — наш дескриптор
  // ViewerMedia вместо MyPhoto/MyDocument: байты и URL живут в воркерном
  // конвейере downloadMediaURL (Task 6), стрим видео — resolveStreamUrl.
  protected async _openMedia({
    media,
    author,
    fromRight,
    target,
    reverse = false,
    prevTargets = [],
    nextTargets = [],
  }: {
    media: ViewerMedia,
    author?: ViewerAuthor,
    fromRight: number,
    target?: HTMLElement,
    reverse?: boolean,
    prevTargets?: TargetType[],
    nextTargets?: TargetType[],
  }): Promise<void> {
    if (this.setMoverPromise) return this.setMoverPromise

    const isVideo = media.kind === 'video'

    // tweb :2366 (setAuthorPromise): у нас setAuthorInfo синхронный (строки +
    // flushSync-остров) — промиса нечего глотать; noAuthor-вариант = без author
    if (author) {
      this.setAuthorInfo(author)
    }

    // Open-путь: только паддинги, чтобы mediaBoxSize читал правильные резервы.
    // Текущий мувер вот-вот заменит setNewMover — refit/recenter ресайз-хендлера
    // здесь не нужны (tweb :2368-2371).
    this.applyLayoutPadding()

    if (this.isFirstOpen) {
      this.isFirstOpen = false
      this.listLoader.setTargets(prevTargets, nextTargets, reverse)
      // (window as any).appMediaViewer tweb :2379 — глобальную ссылку не заводим
    }

    const shouldLoadMore = this.listLoader.next.length < 10

    this.buttons.prev.classList.toggle('hide', !this.listLoader.previous.length)
    this.buttons.next.classList.toggle('hide', !this.listLoader.next.length)

    // buttons.rotate.toggle('hide', isLiveStream) tweb :2394 — live-стримов нет

    const container = this.content.media
    // tweb :2400-2402, развёрнуто для строгого TS (narrow после присваивания)
    if (!target || target === container) target = container
    const useContainerAsTarget = target === container

    // tweb :2400: `this.target = {element: target} as any` — цель стартует голым
    // {element}, поля message-варианта дописывает подкласс (openMedia)
    this.target = { element: target } as TargetType
    const tempId = ++this.tempId

    if (container.firstElementChild) {
      container.replaceChildren()
    }

    // changeQualityOptionsPromise tweb :2410-2418 — HLS-качеств у нас нет

    // Поворот — пер-медиа (tweb :2420-2429, вынесено методом ещё в Task 12)
    this.resetRotationForNav()

    const wasActive = fromRight !== 0
    if (wasActive) {
      this.moveTheMover(this.content.mover as MoverElement, fromRight === 1)
      this.setNewMover()
    } else {
      // tweb :2432-2447 — слой Esc/Back ставится ровно здесь, на ПЕРВОМ открытии
      // (при листании соседей ветка `wasActive` его не трогает).
      this.navigationItem = {
        onPop: () => {
          // tweb :2434-2436 — вето: пока летит мувер, слой не снимается.
          // Без него Back в этот момент снимал слой навсегда, а вьювер
          // оставался открытым: его `close()` во время полёта отклоняется.
          if (this.setMoverAnimationPromise) {
            return false
          }

          // tweb :2438-2440 (`!canAnimate && IS_MOBILE_SAFARI` → мгновенный снос
          // wholeDiv) не портирован: `canAnimate` даёт appNavigationController
          // из своего swipe-back-детектора Safari, которого у нас нет.
          void this.close()
        },
      }

      this.navigation?.pushItem(this.navigationItem)

      this.toggleOverlay(true)
      this.setGlobalListeners()
      this.mountToOverlay()
      this.toggleWholeActive(true)
    }

    const mover = this.content.mover as MoverElement

    // tweb :2463-2477 — бокс считает ОБЩАЯ `setAttachmentSize`, та же, что у
    // баблов; она же и ставит px на layout-ghost (от него считается
    // containerRect всего полёта). Своего расчёта у вьювера нет — иначе он
    // терял бы минимальную сторону 200 (`MIN_SIDE_SIZE`), которую оригинал
    // получает даром. `message` вьювер не передаёт, поэтому минимальная ШИРИНА
    // (120/368) здесь не применяется — это ветка медиа В СООБЩЕНИИ.
    // noZoom — как tweb (`noZoom: mediaSizes.isMobile ? false : true`).
    const mediaBoxSize = this.mediaBoxSize
    setAttachmentSize({
      width: media.width,
      height: media.height,
      element: container,
      boxWidth: mediaBoxSize.width,
      boxHeight: mediaBoxSize.height,
      noZoom: mediaSizes.isMobile ? false : true,
      // tweb :2471 `photo: media` — вьювер отдаёт то же медиа, что и лента, а
      // оно у него либо фото, либо документ-видео (tweb :2359-2360 считает
      // `isDocument` ровно так же — по типу медиа). Отсюда дефолт натурального
      // размера 512 у видео без размеров кадра в атрибутах (:52-56).
      isDocument: isVideo,
      documentType: isVideo ? (media.gif ? 'gif' : 'video') : undefined,
    })

    // Порт tweb :2479-2493: узкое видео с UI плеера добивается до
    // VIDEO_MIN_WIDTH (контролы не влезают), с сохранением пропорции и
    // клампом по mediaBoxSize; gif плеера не получает — не добивается.
    const isVideoWithPlayer = isVideo && !media.gif
    if (isVideoWithPlayer) {
      const currentWidth = parseFloat(container.style.width)
      if (currentWidth > 0 && currentWidth < VIDEO_MIN_WIDTH) {
        const currentHeight = parseFloat(container.style.height)
        const aspect = currentWidth / currentHeight
        let newWidth = Math.min(VIDEO_MIN_WIDTH, mediaBoxSize.width)
        let newHeight = newWidth / aspect
        if (newHeight > mediaBoxSize.height) {
          newHeight = mediaBoxSize.height
          newWidth = newHeight * aspect
        }
        container.style.width = `${newWidth}px`
        container.style.height = `${newHeight}px`
      }
    }

    let thumbPromise: Promise<unknown> = Promise.resolve()
    if (useContainerAsTarget) {
      // tweb :2494-2528: thumb в ghost. Скачанное медиа — синхронно из зеркала
      // конвейера (наш аналог cacheContext.downloaded: URL уже объявлен
      // владельцем), иначе — канвас-блюр stripped-превью (blur, Task 9;
      // `data:`-обёртка — как useBlurThumb в баблах).
      // media.url строкой (секретное, уже расшифрованное вкладкой; фото
      // профиля) — готовая подложка: конвейерное зеркало про эти байты не
      // знает (Task 16)
      const cachedUrl = typeof media.url === 'string' ? media.url : cachedMediaUrl(media.mediaId)
      let img: HTMLImageElement | HTMLCanvasElement | undefined
      if (cachedUrl) {
        img = new Image()
        // Ждать decode: setMoverToTarget рисует этот thumb на canvas через
        // drawImage — недекодированная картинка даёт ПУСТОЙ canvas, полёт
        // от container-цели летел бы пустым до конца (tweb :2500-2506)
        thumbPromise = renderImageFromUrlPromise(img, cachedUrl, false).catch(() => {})
      } else if (media.blurPreview) {
        const got = blur(`data:image/jpeg;base64,${media.blurPreview}`)
        img = got.canvas
        thumbPromise = got.promise
      }

      if (img) {
        img.classList.add('thumbnail')
        container.append(img)
      }
    }

    // live-стрим-thumb (tweb :2530-2547) — RTMP-фичи нет

    // tweb :2548 `supportsStreaming ? preloaderStreamable : preloader`: наше
    // видео всегда стримится HTTP-range'ами (resolveStreamUrl) — у него
    // стримовое кольцо, у фото — обычное
    const preloader = isVideo ? this.preloaderStreamable : this.preloader

    // canAttachPreloader — адаптация tweb photo.ts:297-301 к вьюверу: кольцо
    // только на медиа ≥150×150 (у мелкого нет места под 54px-кольцо);
    // `|| noAutoDownload` не портирован — автозагрузка у нас всегда включена,
    // manual-ветка остаётся живой через catch ниже (ошибка загрузки).
    const canAttachPreloader = media.width >= 150 && media.height >= 150

    let setMoverPromise: Promise<void>
    if (isVideo) {
      // Видео-ветка — порт tweb :2557-2896 + createPlayer :2627-2740 в нашем
      // объёме. Не портированы (помечено): live/RTMP (фичи нет), HLS-качества
      // (changeQualityOptionsPromise/isHlsStream), appMediaPlaybackController
      // (useController/setSingleMedia/releaseSingleMedia — контроллер у нас
      // обслуживает голос/музыку), mediaTimestamp (таймкоды сообщений — Task 14
      // их не собирает), storyboard, handleVideoLeak/shouldIgnoreVideoError
      // (фиксы crbug/утечек MTProto-стримов — наш стрим обычный HTTP-range),
      // updateMediaSource (см. фото-ветку).
      const middleware = mover.middlewareHelper.get()
      const video = createVideo({ pip: !media.gif, middleware })

      video.addEventListener('contextmenu', (event) => {
        // гейт tweb :2569-2573 (без live-условия)
        if (this.wholeDiv.classList.contains('no-forwards')) {
          cancelEvent(event)
        }
      })

      const set = () => this.setMoverToTarget(target, false, fromRight).then(({ onAnimationEnd }) => {
        const div = (mover.firstElementChild?.classList.contains('media-viewer-aspecter')
          ? mover.firstElementChild
          : mover) as HTMLElement

        // tweb :2584-2585: снапшот-видео мувера (кадр источника, поставленный
        // setMoverToTarget) удаляется перед вставкой живого видео
        mover.querySelector('video')?.remove()

        video.setAttribute('playsinline', 'true')
        video.autoplay = true

        if (media.gif) {
          video.muted = true
          video.autoplay = true
          video.loop = true
        } else if ((media.duration ?? 0) < 60) {
          video.loop = true
        }

        // * don't remove (комментарий tweb :2609)
        div.append(video)

        const canPlayThrough = new Promise<void>((resolve) => {
          video.addEventListener('canplay', () => resolve(), { once: true })
        })

        // Порт tweb createPlayer :2627-2740: плеер создаётся СТРОГО после
        // Promise.all([canplay-гейт, конец полёта]) — иначе контролы рендерились
        // бы внутри ещё анимируемого аспектера и прыгали к финальной позиции.
        const createPlayer = async () => {
          if (media.gif) {
            return
          }

          const readyPromise = Promise.all([canPlayThrough, onAnimationEnd])
          await readyPromise
          if (this.tempId !== tempId) {
            return
          }

          const player = this.videoPlayer = new VideoPlayer({
            video,
            play: true,
            streamable: true,
            duration: media.duration,
            onMenuToggle: (open) => {
              // меню плеера перекрывает подпись — прячем её (tweb :2657-2660)
              this.wholeDiv.classList.toggle('hide-caption', !!open)
            },
            onTimePreviewToggle: (visible) => {
              // превью-время сикбара стоит на месте подписи (tweb :2662-2666)
              this.wholeDiv.classList.toggle('hide-caption', visible)
            },
            onPip: (pip) => {
              // tweb :2668-2699 без ветки «другой вьювер уже открыт» (глобальной
              // ссылки window.appMediaViewer не заводим) и без setSingleMedia
              const lastMover = this.moversContainer.lastElementChild as HTMLElement
              // PiP-фейд: мувер в покое несёт .active (transition opacity) —
              // инлайн-opacity анимируется через --open-duration
              lastMover.style.opacity = pip ? '0' : ''
              this.toggleWholeActive(!pip)
              this.toggleOverlay(!pip)
              this.toggleGlobalListeners(!pip)

              // tweb :2682-2685 — на время картинки-в-картинке слой снимается:
              // вьювера на экране нет, и Esc/Back обязаны уйти тому, кто под
              // ним (закрыть чат/панель), а не «закрывать» невидимое окно.
              if (this.navigationItem) {
                if (pip) this.navigation?.removeItem(this.navigationItem)
                else this.navigation?.pushItem(this.navigationItem)
              }
            },
            onPipClose: () => {
              void this.close()
            },
            listenKeyboardEvents: 'always',
          })

          // Плеер есть (в отличие от фото) и его контролы на открытии показаны;
          // дальше has-video-controls ведёт их show/hide (tweb :2707-2712)
          this.wholeDiv.classList.add('has-video', 'has-video-controls')

          player.addEventListener('toggleControls', (show) => {
            this.wholeDiv.classList.toggle('has-video-controls', show)
          })

          this.addEventListener('setMoverBefore', () => {
            this.wholeDiv.classList.remove('has-video', 'has-video-controls')
            this.videoPlayer?.cleanup()
            this.videoPlayer = undefined
          }, { once: true })

          if (this.isZooming || this.isRotated()) {
            this.videoPlayer.lockControls(false)
          }
        }

        // Буферизация (tweb :2742-2803, ветка supportsStreaming): waiting →
        // стримовое кольцо + is-buffering (гасит большую play-иконку), canplay →
        // detach; разлочка контролов — после конца полёта (см. комментарий tweb).
        let attachedCanPlay = false
        let buffering = false

        const _onBuffering = (noCanPlay?: boolean) => {
          if (buffering) {
            return
          }

          buffering = true
          if (!noCanPlay) attachCanPlay()
          preloader.attach(mover, true)

          // класс для плеера, чтобы убрать большую иконку пока прелоадер на
          // месте (комментарий tweb :2755)
          video.parentElement!.classList.add('is-buffering')
        }

        void onAnimationEnd.then(() => {
          if (video.readyState < video.HAVE_FUTURE_DATA) {
            _onBuffering(true)
          }
        })

        const attachCanPlay = () => {
          if (attachedCanPlay) {
            return
          }

          attachedCanPlay = true
          video.addEventListener('canplay', () => {
            attachedCanPlay = false
            buffering = false
            preloader.detach()
            video.parentElement!.classList.remove('is-buffering')

            if (!this.isZooming) {
              // Разлочка — после доигрыша открытия: canplay может стрельнуть
              // посреди анимации, контролы прыгнули бы (комментарий tweb)
              void onAnimationEnd.then(() => {
                if (this.tempId === tempId) {
                  this.videoPlayer?.lockControls(undefined)
                }
              })
            }
          }, { once: true })
        }

        video.addEventListener('waiting', () => {
          const loading = video.networkState === video.NETWORK_LOADING
          const isntEnoughData = video.readyState < video.HAVE_FUTURE_DATA

          if (loading && isntEnoughData) {
            _onBuffering()
          }
        })

        attachCanPlay()

        const load = async () => {
          // Стрим-URL (DNP-ON → /dnp-stream SW-206, иначе токенный URL);
          // supportsStreaming tweb: промис загрузки = Promise.resolve() —
          // кольцом ведает буферизация выше, не догрузка файла.
          // media.url (секретное E2E-видео / видео-аватар) минует стрим (Task 16)
          const promise = resolveDirectMediaUrl(media) ?? Promise.resolve(resolveStreamUrl(media.mediaId))

          void Promise.all([promise, onAnimationEnd]).then(([url]) => {
            if (this.tempId !== tempId) {
              console.warn('media viewer changed video') // tweb :2830
              return
            }

            const onError = () => {
              console.error('video error', video.error) // tweb :2836-2851 (см. шапку ветки)
              preloader.detach()
            }

            video.addEventListener('error', onError, { once: true })
            middleware.onClean(() => {
              video.removeEventListener('error', onError)
            })

            // void: без колбэка видео-ветка renderImageFromUrl только назначает
            // `src` и возвращает undefined (ожидание `onMediaLoad` включается
            // ТОЛЬКО когда колбэк передан) — тип-объединение с промисом идёт от
            // картинок (oxlint no-floating-promises)
            void renderImageFromUrl(video, url)

            // tweb :2886-2889 onMediaLoadPromise.then(createPlayer): у нас гейт
            // метаданных уже внутри createPlayer (canplay ⊇ metadata)
            void createPlayer()
          })

          return promise
        }

        // lazyLoadQueue tweb :2896 — очереди нет (шапка файла): прямой запуск
        void load().catch((err: unknown) => console.error(err))
      })

      setMoverPromise = thumbPromise.then(set)
    } else {
      const set = () => this.setMoverToTarget(target, false, fromRight).then(({ onAnimationEnd }) => {
        const load = async () => {
          // RPC к воркеру-владельцу (конвейер download→cache→objectURL, Task 6)
          // через startClient().managers — как жил MediaLightbox. thumb-вариант
          // (tweb `{media, thumb: size}`) не нужен: вьювер всегда показывает
          // полноразмер. fullPhotoSize-добор tweb (:2909-2912, сортировка
          // media.sizes) не портирован — у нашего бэка один полноразмер,
          // photoSize-лестницы не существует.
          // media.url (секретное E2E / фото профиля) минует конвейер (Task 16)
          const cancellablePromise = resolveDirectMediaUrl(media) ?? startClient().managers.media.downloadMediaURL(media.mediaId)

          // Наш аналог tweb-гейта `!(await getCacheContext()).url` (:2915):
          // судьба конвейера отслеживается флагами — ответ уже пришёл → кольцо
          // не нужно; упал → manual-кольцо уже висит (catch ниже), перевешивать
          // его attach'ом нельзя (attach снимает класс manual).
          let arrived = false
          let failedLoad = false
          void cancellablePromise.then(() => { arrived = true }, () => { failedLoad = true })

          void onAnimationEnd.then(() => {
            // tweb :2914-2919 (attachPromise; attach(mover, true, promise) —
            // рядом в комментарии): вешаем кольцо на мувер. Промис в attach НЕ
            // передаём — RPC-промис без notify/cancel ничего не даёт
            // attachPromise, а его авто-detach по резолву маскировал бы явный
            // detach по приходу медиа ниже (кольцо крутится индетерминированно).
            if (canAttachPreloader && !arrived && !failedLoad) {
              preloader.attach(mover, true)
            }
          })

          void Promise.all([onAnimationEnd, cancellablePromise]).then(([, url]) => {
            if (this.tempId !== tempId) {
              return // «media viewer changed photo» tweb :2924
            }

            // SVGSVGElement-ветка tweb :2928-2941 — SVG-хвостов нет
            const div = (mover.firstElementChild?.classList.contains('media-viewer-aspecter')
              ? mover.firstElementChild
              : mover) as HTMLElement
            const haveImage = ['CANVAS', 'IMG'].includes(div.firstElementChild?.tagName ?? '')
              ? div.firstElementChild as HTMLElement
              : null
            if ((haveImage as HTMLImageElement | null)?.src !== url) {
              const image = new Image()
              image.classList.add('thumbnail')

              // tweb :2946-2957: полное медиа декодируется офскрин
              // (renderImageFromUrl), встаёт fastRaf-кадром, старый thumb
              // уходит кадром ПОЗЖЕ — свап без чёрной вспышки.
              // void: decode-промис доводится колбэком (oxlint no-floating-promises)
              void renderImageFromUrl(image, url, () => {
                fastRaf(() => {
                  // updateMediaSource(target, url) tweb :2948 не портирован:
                  // источник-бабл — React с тем же зеркалом URL (useMediaUrl),
                  // его src вьювер не трогает; восстановление скрытой
                  // миниатюры — Task 16 (onClose)
                  if (haveImage) {
                    fastRaf(() => {
                      haveImage.remove()
                    })
                  }

                  div.append(image)
                })
              }, false)

              // cancellableFullPromise tweb :2959-2967 — см. комментарий у
              // downloadMediaURL выше (photoSize-лестницы нет)
            }

            // В tweb detach здесь закомментирован — его исполняет авто-detach
            // attachPromise; у нас промис в attach не передаётся (см. выше) —
            // detach по приходу медиа явный.
            preloader.detach()
          }).catch((err: unknown) => {
            console.error(err) // this.log.error tweb :2972
            // manual-ветка (tweb :2973-2976) — живая: attach без reset +
            // setManual, клик по кольцу перезапускает load (loadFunc ниже)
            preloader.attach(mover)
            preloader.setManual()
          })

          return cancellablePromise
        }

        // lazyLoadQueue.unshift({load}) tweb :2983 — очереди нет (шапка файла,
        // соседи по листанию — Task 14): прямой запуск; loadFunc — путь
        // ретрая manual-кольца (в tweb его зовёт onClick прелоадера).
        // catch — глушим повтор реджекта возвращаемого load'ом промиса:
        // ошибку уже обслужил manual-catch внутри (в tweb возврат уходит в
        // lazyLoadQueue, которая его же и глотает)
        const run = () => { void load().catch(() => {}) }
        preloader.setDownloadFunction(run)
        run()
      })

      setMoverPromise = thumbPromise.then(set)
    }

    const result = this.setMoverPromise = setMoverPromise.catch(() => {
      this.setMoverAnimationPromise = null
    }).finally(() => {
      this.setMoverPromise = null
    })

    if (shouldLoadMore) {
      // tweb :2996-3003: префетч соседей — после реального конца полёта, чтобы
      // невидимая работа списка/воркера не толкалась с анимацией открытия
      void result.then(() => this.setMoverAnimationPromise).then(() => {
        if (this.tempId === tempId && this.listLoader.next.length < 10) {
          void this.listLoader.load(true)
        }
      })
    }

    return result
  }

  // В tweb жизнь вьювера завершает close() (base.ts:1020: destroy общего
  // middlewareHelper после ухода мувера); наш destroy — явный деструктор
  // каркаса для хозяина инстанса (тесты, горячая замена точки входа Task 16).
  public destroy() {
    this.swipeHandler?.removeListeners()
    this.videoPlayer?.cleanup()
    this.videoPlayer = undefined
    this.zoomElements.rangeSelector.removeListeners()
    this.destroyIslands()
    this.wholeDiv.remove()
    this.middlewareHelper.destroy()
    this.cleanup()
  }
}
