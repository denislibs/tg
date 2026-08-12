// Каркас vanilla-ядра медиавьювера — порт tweb `src/components/mediaViewer/base.ts`
// (константы :81-105, конструктор DOM :318-445, полёт открытия/закрытия
// `setMoverToTarget` :1176-1798 + `waitForMoverTransition` :1800-1845,
// toggleWholeActive :1847-1856, setFullAspect :1858-1882, removeCenterFromMover
// :1912-1926, moveTheMover :1928-1956, setNewMover :1958-1980, радиусы
// :2066-2114, floatings :2124-2193, center-стили :2236-2265, монтирование
// :2452-2455). Класс всё ещё ИНЕРТЕН: его пока никто не создаёт — зум/пан/тач —
// Task 12, наполнение медиа и React-острова (аватарка автора, caption) —
// Task 13, message-подкласс `AppMediaViewer` с точками входа — Task 14.
//
// Порядок append детей `.media-viewer-whole` — load-bearing: правила партиала
// `styles/tweb/_mediaViewer.scss` построены на соседях
// (`.zoom-container.is-visible ~ .media-viewer-caption`, `~ .media-viewer-movers`,
// tweb mediaViewer.scss:725,730) — не переставлять (пин — base.test.ts).
//
// Адаптации (поведение не менялось):
//   • ButtonIcon/Icon tweb (`button.ts`/`buttonIcon.ts`/`icon.ts`) → локальные
//     `btnIcon`/`iconSpan`: та же разметка `button.btn-icon > span.tgico.button-icon`,
//     глифы — из нашей карты `@core/tgico-icons` (шрифт tgico). Ripple у
//     mobile-close (в tweb ButtonIcon без noRipple вешает `rp` + `div.c-ripple`)
//     не портирован: наш ripple — React-хук (`shared/ui/Ripple`), vanilla-порт
//     поедет вместе с оживлением кнопок в Task 13
//   • RangeSelector зума (tweb :375-396) — пока голый контейнер
//     `div.progress-line.with-transition` (те же классы, что строит RangeSelector
//     c `withTransition: true`); наполнение (filled/seek + хендлеры) — Task 12
//   • `getOverlayRoot()` в tweb (`helpers/appWindow.ts:33`) возвращает body
//     АКТИВНОГО окна (приложение целиком умеет переезжать в Document-PiP);
//     у нас в PiP уходит только видео (`core/pip.ts`) — всегда body главного
//     документа
//   • прелоадеры (tweb :309-315) создаются, но `attach` к муверу — Task 13;
//     `lazyLoadQueue` tweb не портирован — понадобится только соседям по
//     листанию (Task 14)
//   • `middlewareHelper` мувера в tweb лежит прямо на HTMLElement (global.d.ts);
//     у нас HTMLElement не аугментирован — локальный тип `MoverElement`
import EventListenerBase from '@helpers/eventListenerBase'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import deferredPromise from '@helpers/cancellablePromise'
import findUpClassName from '@helpers/dom/findUpClassName'
import getVisibleRect from '@helpers/dom/getVisibleRect'
import liteMode from '@helpers/liteMode'
import { MediaSize } from '@helpers/mediaSize'
import mediaSizes from '@helpers/mediaSizes'
import { doubleRaf, fastRaf } from '@helpers/schedulers'
import windowSize from '@helpers/windowSize'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { glyph, type IconName } from '@core/tgico-icons'
import { getHeavyAnimationPromise } from '@core/dom/heavyAnimation'
import type SwipeHandler from '@core/dom/swipeHandler'
import ProgressivePreloader from '../preloader'
import getMediaViewerClipPath from './clipPath'
import getMediaViewerSnapshotSize from './snapshotSize'
import type ListLoader from './listLoader'

// Константы tweb base.ts:81-105. Экспортированы: потребители внутри класса
// появляются по мере порта (открытие — Task 11, зум — Task 12, видео — Task 15),
// а снаружи их уже сейчас читают тесты и будущие сателлиты (RangeSelector зума).
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

// tweb base.ts:107-111 — стопка зум/пан. Значения оживит Task 12; до него
// transform тождественен (x/y = 0, scale = 1).
type Transform = {
  x: number
  y: number
  scale: number
}

// tweb global.d.ts:295-296 — как и в getVisibleRect.ts, весь global.d.ts ради
// двух ambient-типов не тащим, объявлены локально.
type DOMRectMinified = { top: number, right: number, bottom: number, left: number }
type DOMRectEditable = DOMRectMinified & { width: number, height: number }

// Порт tweb `helpers/dom/createVideo.ts` в объёме ветки-фолбэка снапшота
// (видео, чей кадр не удалось скопировать в canvas): элемент + playsinline +
// уборка src по смерти middleware после тяжёлой анимации. HLS/stream-учёт
// tweb (`initVideoHls`/`toggleStreamInUse`) приедет с плеером в Task 15.
function createVideo({ middleware }: { middleware: Middleware }): HTMLVideoElement {
  const video = document.createElement('video')
  video.disablePictureInPicture = true
  video.setAttribute('playsinline', 'true')
  middleware.onDestroy(async () => {
    await getHeavyAnimationPromise()
    video.src = ''
    video.load()
  })
  return video
}

// span.tgico — порт tweb `Icon()` (icon.ts:28-37): глиф шрифтом tgico + классы.
// RTL-отражение (`icon-reflect`) не портировано — RTL-локалей у нас нет.
function iconSpan(icon: IconName, ...classes: string[]): HTMLSpanElement {
  const span = document.createElement('span')
  span.classList.add('tgico', ...classes)
  span.textContent = glyph(icon)
  return span
}

// button.btn-icon > span.tgico.button-icon — порт tweb `ButtonIcon()` в объёме
// вьювера (все кнопки топбара в tweb идут с `noRipple: true`; про mobile-close
// см. шапку файла). `onlyMobile` → `only-handhelds` (button.ts:33-35).
function btnIcon(icon: IconName, options: { onlyMobile?: boolean } = {}): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'btn-icon'
  if (options.onlyMobile) {
    button.classList.add('only-handhelds')
  }
  button.append(iconSpan(icon, 'button-icon'))
  return button
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
  // avatarEl (tweb avatarNew → `.media-viewer-userpic`, prepend в container при
  // открытии, base.ts:2035-2048) у нас — React-остров, приедет в Task 13.
  protected author: {
    container: HTMLElement
    nameEl: HTMLElement
    date: HTMLElement
  } = {} as AppMediaViewerBase<ContentAdditionType, ButtonsAdditionType, TargetType>['author']
  protected content: { [k in 'main' | 'container' | 'media' | 'mover' | ContentAdditionType]: HTMLElement } =
    {} as AppMediaViewerBase<ContentAdditionType, ButtonsAdditionType, TargetType>['content']
  protected buttons: {
    [k in 'download' | 'close' | 'prev' | 'next' | 'mobile-close' | 'zoomin' | 'rotate' | ButtonsAdditionType]: HTMLElement
  } = {} as AppMediaViewerBase<ContentAdditionType, ButtonsAdditionType, TargetType>['buttons']
  protected topbar: HTMLElement
  protected moversContainer: HTMLElement

  protected tempId = 0
  protected preloader: ProgressivePreloader
  protected preloaderStreamable: ProgressivePreloader

  protected isFirstOpen = true

  protected setMoverPromise: Promise<void> | null = null
  protected setMoverAnimationPromise: Promise<void> | null = null
  // Ожидатели transition мувера (tweb :229): у каждого мувера максимум один
  // живой ожидатель — новый снимает предыдущий (cancelMoverTransition).
  private moverTransitionCancels = new WeakMap<HTMLElement, () => void>()

  // ЗАГЛУШКИ КАРКАСА (tweb :257-266): зум/пан/поворот оживит Task 12 — до него
  // transform тождественен, rotation 0 и isZooming false, поэтому ветки переноса
  // трансформа при закрытии (zoomedClose/rotatedClose в setMoverToTarget)
  // портированы целиком, но пока недостижимы.
  protected transform: Transform = { x: 0, y: 0, scale: ZOOM_INITIAL_VALUE }
  // Накопленный поворот в градусах (кратные 90, против часовой — отрицательные).
  protected rotation = 0
  protected isZooming = false
  protected initialContentRect: DOMRect | null = null

  // Разводка жестов по wholeDiv (tweb :522-587) — Task 12.
  protected swipeHandler: SwipeHandler | null = null

  protected zoomElements: {
    container: HTMLElement
    btnOut: HTMLElement
    btnIn: HTMLElement
    // в tweb — RangeSelector({step: .01, min/max: ZOOM_*, withTransition: true});
    // наполнение контейнера — Task 12
    rangeSelector: HTMLElement
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
    this.zoomElements.btnIn = btnIcon('zoomin')

    // наполнение — Task 12 (порт RangeSelector: filled/seek, onScrub → addZoom)
    this.zoomElements.rangeSelector = document.createElement('div')
    this.zoomElements.rangeSelector.classList.add('progress-line', 'with-transition')

    this.zoomElements.container.append(this.zoomElements.btnOut, this.zoomElements.rangeSelector, this.zoomElements.btnIn)

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

    // caption (`.media-viewer-caption`) создаёт подкласс — Task 14

    topbarLeft.append(this.buttons['mobile-close'], this.author.container)
    topbar.append(topbarLeft, buttonsDiv)

    this.buttons.prev = document.createElement('div')
    this.buttons.prev.className = `${MEDIA_VIEWER_CLASSNAME}-switcher ${MEDIA_VIEWER_CLASSNAME}-switcher-left`
    this.buttons.prev.append(iconSpan('previous', `${MEDIA_VIEWER_CLASSNAME}-sibling-button`, `${MEDIA_VIEWER_CLASSNAME}-prev-button`))

    this.buttons.next = document.createElement('div')
    this.buttons.next.className = `${MEDIA_VIEWER_CLASSNAME}-switcher ${MEDIA_VIEWER_CLASSNAME}-switcher-right`
    this.buttons.next.append(iconSpan('next', `${MEDIA_VIEWER_CLASSNAME}-sibling-button`, `${MEDIA_VIEWER_CLASSNAME}-next-button`))

    this.moversContainer = document.createElement('div')
    this.moversContainer.classList.add(MEDIA_VIEWER_CLASSNAME + '-movers')

    this.moversContainer.append(this.buttons.prev, this.buttons.next)

    this.wholeDiv.append(this.overlaysDiv, this.topbar, this.moversContainer)

    // * constructing html end

    this.listLoader.onLoadedMore = () => {
      this.buttons.prev.classList.toggle('hide', !this.listLoader.previous.length)
      this.buttons.next.classList.toggle('hide', !this.listLoader.next.length)
    }

    this.setNewMover()
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

        // .ckin__player — chrome vanilla-плеера (Task 15); ветка готова заранее
        // и до него узла просто не находит
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
  // пространстве). До Task 12 rotation всегда 0 — но зовётся переносом
  // rotatedClose в setMoverToTarget, портированным целиком.
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

  // В tweb жизнь вьювера завершает close() (base.ts:1020: destroy общего
  // middlewareHelper после ухода мувера); у нас close приедет с message-
  // подклассом (Task 14) — до тех пор явный деструктор каркаса.
  public destroy() {
    this.wholeDiv.remove()
    this.middlewareHelper.destroy()
    this.cleanup()
  }
}
