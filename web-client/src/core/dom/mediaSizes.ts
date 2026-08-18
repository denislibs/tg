// Порт tweb `src/helpers/mediaSizes.ts` (объект `mediaSizes`: активный набор
// размеров медиа, текущий экран и СОБЫТИЯ его смены) + `src/helpers/
// setAttachmentSize.ts` (бокс вложения).
//
// ── Отступления от оригинала ────────────────────────────────────────────────
//  • solid-стор (`createStore` + `useMediaSizes()`, mediaSizes.ts:46-52,157-163,
//    196-198) — привязка к solid-js, которой в проекте нет (то же решение, что
//    в `helpers/solid/readValue.ts`). Реактивность потребителя у нас — обычный
//    ре-рендер React, а императивный код подписывается на `changeScreen`/
//    `resize`, как в самом tweb (`wrappers/video.ts:54-74`,
//    `helpers/updateColumnWidths.ts:385`);
//  • `getAppWindow`/`onAppWindowChange` (`helpers/appWindow.ts`) — Document
//    Picture-in-Picture, куда tweb переносит весь клиент; фичи нет (тот же
//    вырез уже задокументирован в `components/animationIntersector.ts`),
//    поэтому окно ровно одно. `bindWindow` при этом сохранён: он и есть точка,
//    в которую PiP-окно приедет, когда фича появится;
//  • гард `typeof window === 'undefined'` — модуль читают и невизуальные пути
//    (островок lottie через `@helpers/mediaSizes` берёт `isMobile`), где
//    `window` нет. Приём тот же, что в `helpers/windowSize.ts`; без окна
//    активен десктопный набор, как было до этого порта.
//
// ЕДИНСТВЕННЫЙ владелец брейкпоинтов: `helpers/mediaSizes.ts` (путь tweb, по
// которому импортируют вендорные островки) теперь ре-экспортирует ЭТОТ
// инстанс, а `core/dom/updateColumnWidths.ts` читает `isMobile`/
// `isLessThanFloatingLeftSidebar` отсюда и слушает `resize` вместо своего
// window-слушателя — ровно как оригинал.
import { MOUNT_CLASS_TO } from '@config/debug'
import EventListenerBase from '@helpers/eventListenerBase'
import { makeMediaSize, type MediaSize } from '@helpers/mediaSize'

export type { MediaSize }

export interface MediaTypeSizes {
  regular: MediaSize
  webpage: MediaSize
  album: MediaSize
  esgSticker: MediaSize
  animatedSticker: MediaSize
  staticSticker: MediaSize
  emojiSticker: MediaSize
  poll: MediaSize
  round: MediaSize
  documentName: MediaSize
  invoice: MediaSize
  extendedInvoice: MediaSize
  customEmoji: MediaSize
  esgCustomEmoji: MediaSize
  emojiStatus: MediaSize
  popupSticker: MediaSize
}

export type MediaSizeType = keyof MediaTypeSizes

// tweb mediaSizes.ts:28-32
export enum ScreenSize {
  mobile,
  medium,
  large,
}

// tweb mediaSizes.ts:34-40 (MOBILE_SIZE = $small-screen в SCSS;
// FLOATING_LEFT_SIDEBAR_SIZE — граница «плавающий ↔ пристыкованный сайдбар»).
export const MOBILE_SIZE = 600
export const FLOATING_LEFT_SIDEBAR_SIZE = 925
const LARGE_SIZE = 1680

// Без окна (воркер/SSR) брейкпоинты считать не от чего — берём десктоп, как
// делал прежний `mediaSizes(width = 1280)`.
const NO_WINDOW_WIDTH = 1280

const CUSTOM_EMOJI_SIZE = makeMediaSize(20, 20)
const ESG_CUSTOM_EMOJI_SIZE = makeMediaSize(36, 36)
const EMOJI_STATUS_SIZE = makeMediaSize(18, 18)

// tweb mediaSizes.ts:65-82 (handhelds) и :83-100 (desktop) — 1:1.
export const HANDHELDS: MediaTypeSizes = {
  regular: makeMediaSize(340, 340),
  webpage: makeMediaSize(340, 200),
  album: makeMediaSize(340, 0),
  esgSticker: makeMediaSize(68, 68),
  animatedSticker: makeMediaSize(180, 180),
  staticSticker: makeMediaSize(180, 180),
  emojiSticker: makeMediaSize(112, 112),
  poll: makeMediaSize(240, 0),
  round: makeMediaSize(240, 240),
  documentName: makeMediaSize(200, 0),
  invoice: makeMediaSize(340, 340),
  extendedInvoice: makeMediaSize(340, 340),
  customEmoji: CUSTOM_EMOJI_SIZE,
  esgCustomEmoji: ESG_CUSTOM_EMOJI_SIZE,
  emojiStatus: EMOJI_STATUS_SIZE,
  popupSticker: makeMediaSize(68, 68),
}

export const DESKTOP: MediaTypeSizes = {
  regular: makeMediaSize(420, 400),
  webpage: makeMediaSize(420, 380),
  album: makeMediaSize(420, 0),
  esgSticker: makeMediaSize(72, 72),
  animatedSticker: makeMediaSize(200, 200),
  staticSticker: makeMediaSize(200, 200),
  emojiSticker: makeMediaSize(112, 112),
  poll: makeMediaSize(330, 0),
  round: makeMediaSize(280, 280),
  documentName: makeMediaSize(240, 0),
  invoice: makeMediaSize(320, 320),
  extendedInvoice: makeMediaSize(420, 400),
  customEmoji: CUSTOM_EMOJI_SIZE,
  esgCustomEmoji: ESG_CUSTOM_EMOJI_SIZE,
  emojiStatus: EMOJI_STATUS_SIZE,
  popupSticker: makeMediaSize(80, 80),
}

/** tweb mediaSizes.ts:54-190 — 1:1 (без solid-стора, см. шапку). */
export class MediaSizes extends EventListenerBase<{
  changeScreen: (from: ScreenSize, to: ScreenSize) => void,
  resize: () => void
}> {
  private screenSizes: { key: ScreenSize, value: number }[] = [
    { key: ScreenSize.mobile, value: MOBILE_SIZE },
    { key: ScreenSize.medium, value: FLOATING_LEFT_SIDEBAR_SIZE },
    { key: ScreenSize.large, value: LARGE_SIZE },
  ]

  private sizes: { [k in 'desktop' | 'handhelds']: MediaTypeSizes } = {
    handhelds: HANDHELDS,
    desktop: DESKTOP,
  }

  public isMobile = false
  public isFloatingLeftSidebar = false
  public isLessThanFloatingLeftSidebar = false
  public active!: MediaTypeSizes
  public activeScreen!: ScreenSize
  private rAF = 0
  private win: Window | undefined
  private onWinResize: () => void

  constructor() {
    super()

    this.onWinResize = () => {
      const win = this.win
      if(!win) return
      if(this.rAF) win.cancelAnimationFrame(this.rAF)
      this.rAF = win.requestAnimationFrame(() => {
        this.handleResize()
        this.rAF = 0
      })
    }

    this.bindWindow(typeof window === 'undefined' ? undefined : window)
  }

  private bindWindow(win: Window | undefined) {
    this.win?.removeEventListener('resize', this.onWinResize)
    this.win = win
    this.win?.addEventListener('resize', this.onWinResize)
    this.handleResize()
  }

  private handleResize = () => {
    const innerWidth = this.win ? this.win.innerWidth : NO_WINDOW_WIDTH

    let activeScreen = this.screenSizes[0].key
    for(let i = this.screenSizes.length - 1; i >= 0; --i) {
      if(this.screenSizes[i].value < innerWidth) {
        activeScreen = (this.screenSizes[i + 1] || this.screenSizes[i]).key
        break
      }
    }

    const wasScreen = this.activeScreen
    const isMobile = activeScreen === ScreenSize.mobile
    const isLessThanFloatingLeftSidebar = innerWidth <= FLOATING_LEFT_SIDEBAR_SIZE
    this.activeScreen = activeScreen
    this.isMobile = isMobile
    this.isLessThanFloatingLeftSidebar = isLessThanFloatingLeftSidebar
    this.isFloatingLeftSidebar = activeScreen === ScreenSize.medium && isLessThanFloatingLeftSidebar
    this.active = isMobile ? this.sizes.handhelds : this.sizes.desktop

    if(wasScreen !== activeScreen) {
      if(wasScreen !== undefined) {
        this.dispatchEvent('changeScreen', wasScreen, activeScreen)
      }
    }

    if(wasScreen !== undefined) {
      this.dispatchEvent('resize')
    }
  }
}

const mediaSizesInstance = new MediaSizes()
MOUNT_CLASS_TO.mediaSizes = mediaSizesInstance
export default mediaSizesInstance

/**
 * СТАРАЯ форма доступа к активному набору (`mediaSizes().regular`), пока на ней
 * стоят `wrappers/video.ts` и `wrappers/album.ts` — файлы соседней задачи.
 * Своего вывода брейкпоинта не держит: читает того же владельца, что и
 * `mediaSizes.active`. Уйдёт вместе с переводом этих двух вызовов на
 * `mediaSizes.active`, как в оригинале.
 */
export function mediaSizes(): MediaTypeSizes {
  return mediaSizesInstance.active
}

// tweb setAttachmentSize.ts:9-12.
export const EXPAND_TEXT_WIDTH = 320
export const MIN_IMAGE_WIDTH = 120
export const MIN_SIDE_SIZE = 200
export const MIN_VIDEO_SIDE_SIZE = 368

/**
 * Бокс вложения — порт `setAttachmentSize` (tweb setAttachmentSize.ts:14-107).
 * Шаги ровно как в оригинале: вписать в бокс → если обе стороны меньше 200,
 * растянуть покрытием до 200 → если у сообщения есть текст/reply/webpage/
 * фактчек, расширить до 320 ради читаемости → добить минимальную ширину (120, а
 * для видео с плеером — 368). Как и оригинал, сама ставит размер элементу.
 *
 * Возвращает ДВА размера, и это не удобство, а разные роли (tweb:64-66,83-92):
 *   • `size` — ВПИСАННЫЙ (aspect + покрытие до 200). Минимумы 320/120/368 его
 *     не трогают, и он уходит в `.media-container-aspecter`;
 *   • `boxSize` — он же, расширенный минимумами; это размер САМОГО контейнера
 *     (живой дамп tweb: контейнер 320×400, аспектер 300×400).
 *
 * Отступления от оригинала — следствие модели медиа (лестницы `PhotoSize` у нас
 * нет, размеров ровно два):
 *   • вместо `photo`/`photoSize`/`size`/`pushDocumentSize` (и возвращаемого
 *     `photoSize`) вход — натуральные `width`/`height`. Выбирать размер из
 *     лестницы (`choosePhotoSize`) не из чего;
 *   • `message` → `hasMessageBlock`: проверка «у сообщения есть текст,
 *     фактчек, reply, webpage или видимые комментарии» (:75-82) решается у
 *     вызывающего, потому что таких полей у плоского входа нет;
 *   • `canHaveVideoPlayer` + `photo.type === 'video'` → `isVideoWithPlayer`:
 *     тип медиа знает вызывающий (`wrapVideo`), сюда едет уже готовый ответ;
 *   • `element` не обязателен: React-потребители считают бокс В РЕНДЕРЕ, где
 *     узла ещё нет, и кладут `boxSize` в `style` сами. Императивные
 *     потребители (`wrapPhoto`) передают элемент и стиль ставит функция.
 */
export function setAttachmentSize({
  width,
  height,
  element,
  boxWidth,
  boxHeight,
  noZoom = true,
  hasMessageBlock = false,
  isVideoWithPlayer = false,
  noMinSize = false,
}: {
  width: number
  height: number
  /** элемент, которому проставить `boxSize` (tweb `element`) */
  element?: HTMLElement
  boxWidth: number
  boxHeight: number
  noZoom?: boolean
  /** у сообщения есть подпись / reply / webpage / фактчек — tweb расширяет бокс */
  hasMessageBlock?: boolean
  isVideoWithPlayer?: boolean
  noMinSize?: boolean
}): { size: MediaSize; boxSize: MediaSize; isFit: boolean } {
  let size = makeMediaSize(width || 100, height || 100)
  let boxSize = makeMediaSize(boxWidth, boxHeight)

  boxSize = size = size.aspect(boxSize, noZoom)

  let isFit = true
  if(!noMinSize) {
    const minSideSize = MIN_SIDE_SIZE
    if(boxSize.width < minSideSize && boxSize.height < minSideSize) { // make at least one side this big
      boxSize = size = size.aspectCovered(makeMediaSize(minSideSize, minSideSize))
    }

    if(hasMessageBlock) { // make sure that bubble block is human-readable
      if(boxSize.width < EXPAND_TEXT_WIDTH) {
        boxSize = makeMediaSize(EXPAND_TEXT_WIDTH, boxSize.height)
        isFit = false
      }
    }

    const minWidth = isVideoWithPlayer ? MIN_VIDEO_SIDE_SIZE : MIN_IMAGE_WIDTH
    if(boxSize.width < minWidth) { // if image is too narrow
      boxSize = makeMediaSize(minWidth, boxSize.height)
      isFit = false
    }
  }

  if(element) {
    element.style.width = boxSize.width + 'px'
    element.style.height = boxSize.height + 'px'
  }

  return { size, boxSize, isFit }
}
