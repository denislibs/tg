/**
 * Порт tweb `src/components/stickerViewer.ts` (812502980, 397 строк) —
 * предпросмотр стикера/GIF по зажатию левой кнопки мыши. Один ванильный
 * слушатель `mousedown` на контейнере (`listenTo`): удержание 125 мс открывает
 * оверлей `.sticker-viewer` над ячейкой под курсором, ведение мыши с зажатой
 * кнопкой переключает стикер, отпускание закрывает и глотает следующий `click`.
 * Стили — `styles/tweb/_stickerViewer.scss` (партиал tweb 1:1).
 *
 * Вызывающие (как у tweb): лента (`chat/bubbles.ts`, tweb bubbles.ts:1591),
 * подсказки стикеров (`StickersHelper.tsx`, tweb stickersHelper.ts:118), вкладка
 * стикеров панели (`emoji/StickersTab.tsx`, tweb emoticonsDropdown/tab.ts:471),
 * попап набора (`stickers/StickerSetModal.tsx`, tweb popups/stickers.tsx:336),
 * поиск стикеров в правой колонке (tweb sidebarRight/tabs/stickers.tsx:166).
 *
 * Расхождения с оригиналом:
 *  1. Документ по `data-doc-id` достаётся у реестра воркера
 *     `startClient().managers.docs.getDoc` (порт `appDocsManager.getDoc`,
 *     хранилище наполняет `saveDocument`, `core/media/messageMedia.ts`), а не у
 *     `rootScope.managers.appDocsManager`: у нашего `rootScope` нет `managers`.
 *     Id документа у нас число, отсюда `Number(docId)`. Менеджеры берутся
 *     в момент жеста (`() => startClient().managers`, как `core/calls/*`), а
 *     не при навешивании: слушатель вешает и конструктор ленты, которому
 *     RPC-мост в эту секунду не нужен.
 *  2. Премиум-эффекта стикера нет: `getStickerEffectThumb` (`doc.video_thumbs`),
 *     класс `has-effect`, сдвиг `--translateX` на `STICKER_EFFECT_MULTIPLIER`,
 *     `simulateClickEvent` запуска эффекта и опции `isOut`/`relativeEffect`/
 *     `loopEffect` у `wrapSticker` выпали — у документа нет `video_thumbs`, у
 *     клиента нет подсистемы эффектов. Размер — ветка без эффекта: 360 у
 *     стикера, `min(480, высота окна − 200)` у GIF (tweb :100).
 *  3. Кастомных эмодзи-документов нет (`documentAttributeCustomEmoji` в нашей
 *     `DocumentAttribute` не объявлен), поэтому выпали параметр `getTextColor`,
 *     `EMOJI_TEXT_COLOR`, ветка `textColor` и сверка кадра с `CustomEmojiElement`.
 *  4. `wrapSticker` получает `mediaId` и натуральные размеры вместо `doc`
 *     (вход нашего враппера, шапка `wrappers/sticker.ts`); `managers` ему не
 *     нужен. `emoji` не передаётся: наш враппер ещё держит правило старой
 *     базы `loop = !emoji && loop`, которое 812502980 убрал, — с эмодзи превью
 *     сыграло бы один раз вместо цикла (`loop: true`, tweb :180). Эмодзи над
 *     стикером рисует сам просмотрщик (`.sticker-viewer-emoji`), атрибут
 *     `data-sticker-emoji` на его контейнере никто не читает.
 *  5. `SetTransition` → `setTransition` (`core/dom/setTransition.ts`, порт
 *     `singleTransition.ts`), `wrapEmojiText` — `lib/richtext/wrapEmojiText`.
 *     `render` нашего `wrapSticker` — один плеер, не массив (`o[0]` выпал).
 *  6. Замер `is-overflow` проверяет, что ячейка лежит в `.scrollable` и видна
 *     в нём (`getVisibleRect` отдаёт `null` для невидимой). У tweb без этих
 *     проверок исключение уходит в `catch` таймера, и оверлей молча не
 *     открывается; у видимой ячейки в скроллере поведение то же.
 */
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { getAppWindow, getOverlayRoot } from '@helpers/appWindow'
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpAsChild from '@helpers/dom/findUpAsChild'
import findUpClassName from '@helpers/dom/findUpClassName'
import getVisibleRect from '@helpers/dom/getVisibleRect'
import isInDOM from '@helpers/dom/isInDOM'
import safePlay from '@helpers/dom/safePlay'
import type ListenerSetter from '@helpers/listenerSetter'
import { makeMediaSize } from '@helpers/mediaSize'
import { getMiddleware, type Middleware } from '@helpers/middleware'
import { doubleRaf } from '@helpers/schedulers'
import pause from '@helpers/schedulers/pause'
import windowSize from '@helpers/windowSize'
import type { MyDocument } from '@core/media/messageMedia'
import { setTransition } from '@core/dom/setTransition'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import lottieLoader from '@lib/lottie/lottieLoader'
import LottiePlayer from '@lib/lottie/lottiePlayer'
import { startClient } from '@/client/bootstrap'
import animationIntersector, { type AnimationItemGroup } from '@components/animationIntersector'
import wrapSticker from '@components/wrappers/sticker'
import wrapVideo from '@components/wrappers/video'

let hasViewer = false
export default function attachStickerViewerListeners({ listenTo, listenerSetter, selector, findTarget: originalFindTarget, additionalClass }: {
  additionalClass?: string,
  listenerSetter: ListenerSetter,
  listenTo: HTMLElement,
  selector?: string,
  findTarget?: (e: MouseEvent) => HTMLElement | null | undefined
}) {
  if(IS_TOUCH_SUPPORTED) {
    return
  }

  const findTarget = (e: MouseEvent, checkForParent?: boolean) => {
    let el: HTMLElement | null | undefined
    if(originalFindTarget) el = originalFindTarget(e)
    else {
      const s = selector || '.media-sticker-wrapper, .media-gif-wrapper'
      el = (e.target as HTMLElement).closest<HTMLElement>(s)
    }

    return el && (!checkForParent || findUpAsChild(el, listenTo)) ? el : undefined
  }

  // расхождение 1
  const managers = () => startClient().managers

  listenerSetter.add(listenTo)('mousedown', (e: MouseEvent) => {
    if(hasViewer || e.buttons > 1 || e.button !== 0) return
    let mediaContainer = findTarget(e)
    if(!mediaContainer) {
      return
    }

    const docId = mediaContainer.dataset.docId
    if(!docId) {
      return
    }

    // The whole hold-drag-release gesture is tracked on document-level mousemove/mouseup + a post-
    // release click-swallow, and timed by setTimeout/setInterval — all of which must use whichever
    // window the app currently lives in (the tab, or the Document PiP window). Bound to the MAIN
    // window, the viewer opens on hold but its mouseup/mousemove fire on the PiP document and never
    // arrive, so it sticks open and can't switch stickers.
    const activeWindow = getAppWindow()
    const activeDocument = activeWindow.document

    const className = 'sticker-viewer'
    const group: AnimationItemGroup = 'STICKER-VIEWER'
    const openDuration = 200
    const switchDuration = 200
    const previousGroup = animationIntersector.getOnlyOnePlayableGroup()
    const _middleware = getMiddleware()
    let container: HTMLElement | undefined,
      previousTransformer: HTMLElement | undefined,
      isMouseUp = false

    const doThatSticker = async({ mediaContainer, doc, middleware, lockGroups, isSwitching }: {
      mediaContainer: HTMLElement,
      doc: MyDocument,
      middleware: Middleware,
      lockGroups?: boolean,
      isSwitching?: boolean
    }) => {
      const isGif = doc.type === 'gif'
      const mediaRect: DOMRect = mediaContainer.getBoundingClientRect()
      const s = makeMediaSize(doc.w, doc.h)
      // расхождение 2
      const size = isGif ? Math.min(480, windowSize.height - 200) : 360
      const boxSize = makeMediaSize(size, size)
      const fitted = mediaRect.width === mediaRect.height ? boxSize : s.aspectFitted(boxSize)

      const transformer = document.createElement('div')
      transformer.classList.add(className + '-transformer')
      transformer.middlewareHelper = middleware.create()
      middleware = transformer.middlewareHelper.get()

      const stickerContainer = document.createElement('div')
      stickerContainer.classList.add(className + '-sticker')
      stickerContainer.style.width = fitted.width + 'px'
      stickerContainer.style.height = fitted.height + 'px'

      const viewerEmoji = mediaContainer.dataset.stickerEmoji || doc.stickerEmojiRaw || ''
      const stickerEmoji = document.createElement('div')
      stickerEmoji.classList.add(className + '-emoji')
      stickerEmoji.append(wrapEmojiText(viewerEmoji))

      // расхождение 6
      const overflowElement = findUpClassName(mediaContainer, 'scrollable')
      if(overflowElement) {
        const visibleRect = getVisibleRect(mediaContainer, overflowElement, true, mediaRect)
        if(visibleRect && (visibleRect.overflow.vertical || visibleRect.overflow.horizontal)) {
          stickerContainer.classList.add('is-overflow')
        }
      }

      const rect = mediaContainer.getBoundingClientRect()
      const scaleX = rect.width / fitted.width
      const scaleY = rect.height / fitted.height
      const transformX = rect.left - (windowSize.width - rect.width) / 2
      const transformY = rect.top - (windowSize.height - rect.height) / 2
      transformer.style.transform = `translate(${transformX}px, ${transformY}px) scale(${scaleX}, ${scaleY})`
      if(isSwitching) transformer.classList.add('is-switching', 'forwards')
      transformer.append(stickerContainer, stickerEmoji)
      container!.append(transformer)

      // расхождения 3, 4
      const player = isGif ? await wrapVideo({
        doc,
        container: stickerContainer,
        group,
        boxWidth: fitted.width,
        boxHeight: fitted.height,
        canAutoplay: true,
        middleware,
        noInfo: true,
      }).then(async(res) => (await res.loadPromise, res.video)) : await wrapSticker({
        mediaId: doc.id,
        docWidth: doc.w,
        docHeight: doc.h,
        div: stickerContainer,
        group,
        width: fitted.width,
        height: fitted.height,
        play: false,
        loop: true,
        middleware,
        needFadeIn: false,
        withThumb: false,
      }).render
      if(!middleware()) return

      if(!container!.parentElement) {
        getOverlayRoot().append(container!)
      }

      const firstFramePromise = player instanceof LottiePlayer ?
        new Promise<void>((resolve) => player.addEventListener('firstFrame', resolve, { once: true })) :
        Promise.resolve()
      await Promise.all([firstFramePromise, doubleRaf()])
      await pause(0) // ! need it because firstFrame will be called just from the loop
      if(!middleware()) return

      if(lockGroups) {
        animationIntersector.setOnlyOnePlayableGroup(group)
        animationIntersector.checkAnimations2(true)
      }

      if(player instanceof LottiePlayer) {
        // расхождение 3
        const prevPlayer = lottieLoader.getAnimation(mediaContainer)
        if(prevPlayer) {
          player.curFrame = prevPlayer.curFrame
          player.play()
          await new Promise<void>((resolve) => {
            let i = 0
            const c = () => {
              if(++i === 2) {
                resolve()
                player.removeEventListener('enterFrame', c)
              }
            }

            player.addEventListener('enterFrame', c)
          })
          if(!middleware()) return
          player.pause()
        }
      } else if(player instanceof HTMLVideoElement) {
        const prevPlayer = mediaContainer.querySelector<HTMLVideoElement>('video')
        if(prevPlayer) {
          player.currentTime = prevPlayer.currentTime
        }
      }

      return {
        ready: () => {
          if(player instanceof LottiePlayer || player instanceof HTMLVideoElement) {
            safePlay(player)
          }
        },
        transformer,
      }
    }

    const timeout = activeWindow.setTimeout(async() => {
      activeDocument.removeEventListener('mousemove', onMousePreMove)

      container = document.createElement('div')
      container.classList.add(className)
      if(additionalClass) container.classList.add(additionalClass)
      hasViewer = true

      const middleware = _middleware.get()
      const doc = await managers().docs.getDoc(Number(docId))
      if(!middleware()) return

      let result: Awaited<ReturnType<typeof doThatSticker>>
      try {
        result = await doThatSticker({
          doc: doc!,
          mediaContainer: mediaContainer!,
          middleware,
          lockGroups: true,
        })
        if(!result) return
      } catch {
        return
      }

      // * can't use middleware here
      if(isMouseUp) {
        return
      }

      const { ready, transformer } = result

      previousTransformer = transformer

      setTransition({
        element: container,
        className: 'is-visible',
        forwards: true,
        duration: openDuration,
        onTransitionEnd: () => {
          if(!middleware()) return
          ready()
        },
      })

      activeDocument.addEventListener('mousemove', onMouseMove)
    }, 125)

    const onMouseMove = async(e: MouseEvent) => {
      const newMediaContainer = findTarget(e, true)
      if(!newMediaContainer || mediaContainer === newMediaContainer) {
        return
      }

      const docId = newMediaContainer.dataset.docId
      if(!docId) {
        return
      }

      mediaContainer = newMediaContainer
      _middleware.clean()
      const middleware = _middleware.get()

      const doc = await managers().docs.getDoc(Number(docId))
      if(!middleware()) return

      let r: Awaited<ReturnType<typeof doThatSticker>>
      try {
        r = await doThatSticker({
          doc: doc!,
          mediaContainer,
          middleware,
          isSwitching: true,
        })
        if(!r) return
      } catch(err) {
        console.error('sticker viewer error', err)
        return
      }

      const { ready, transformer } = r

      const _previousTransformer = previousTransformer!
      setTransition({
        element: _previousTransformer,
        className: 'is-switching',
        forwards: true,
        duration: switchDuration,
        onTransitionEnd: () => {
          _previousTransformer.remove()
          _previousTransformer.middlewareHelper!.destroy()
        },
      })

      previousTransformer = transformer

      setTransition({
        element: transformer,
        className: 'is-switching',
        forwards: false,
        duration: switchDuration,
        onTransitionEnd: () => {
          if(!middleware()) return
          ready()
        },
      })
    }

    const onMousePreMove = (e: MouseEvent) => {
      if(!findUpAsChild(e.target as HTMLElement, mediaContainer!)) {
        onMouseUp()
      }
    }

    const onMouseUp = () => {
      isMouseUp = true
      activeWindow.clearTimeout(timeout)
      activeWindow.clearInterval(unmountInterval)
      // _middleware.clean();

      if(container) {
        const _container = container
        setTransition({
          element: _container,
          className: 'is-visible',
          forwards: false,
          duration: openDuration,
          onTransitionEnd: () => {
            _container.remove()
            animationIntersector.setOnlyOnePlayableGroup(previousGroup)
            animationIntersector.checkAnimations2(false)
            _middleware.destroy()
            hasViewer = false
          },
        })

        attachClickEvent(activeDocument.body, cancelEvent, { capture: true, once: true })
      }

      activeDocument.removeEventListener('mousemove', onMousePreMove)
      activeDocument.removeEventListener('mousemove', onMouseMove)
      activeDocument.removeEventListener('mouseup', onMouseUp, { capture: true })
    }

    activeDocument.addEventListener('mousemove', onMousePreMove)
    activeDocument.addEventListener('mouseup', onMouseUp, { once: true, capture: true })
    const unmountInterval = activeWindow.setInterval(() => {
      if(!isInDOM(mediaContainer!)) {
        onMouseUp()
      }
    }, 100)
  })
}
