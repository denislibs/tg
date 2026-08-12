// Каркас vanilla-ядра медиавьювера — порт tweb `src/components/mediaViewer/base.ts`
// (константы :81-105, конструктор DOM :318-445, toggleWholeActive :1847-1856,
// setNewMover :1958-1980, монтирование :2452-2455). Класс ИНЕРТЕН: его пока никто
// не создаёт и не открывает — открытие/полёт мувера (`setMoverToTarget`) — Task 11,
// зум/пан/тач — Task 12, наполнение медиа и React-острова (аватарка автора,
// caption) — Task 13, message-подкласс `AppMediaViewer` — Task 14.
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
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { glyph, type IconName } from '@core/tgico-icons'
import type SwipeHandler from '@core/dom/swipeHandler'
import ProgressivePreloader from '../preloader'
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
// HTMLElement) — уничтожается вместе с мувером при уходе (Task 11, tweb :1952).
export type MoverElement = HTMLElement & { middlewareHelper: MiddlewareHelper }

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

  // В tweb жизнь вьювера завершает close() (base.ts:1020: destroy общего
  // middlewareHelper после ухода мувера); у нас close приедет в Task 11 —
  // до тех пор явный деструктор каркаса.
  public destroy() {
    this.wholeDiv.remove()
    this.middlewareHelper.destroy()
    this.cleanup()
  }
}
