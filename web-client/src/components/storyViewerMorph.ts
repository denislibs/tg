// Морф открытия/закрытия сториз-вьюера — порт функции `animate()` из
// `tweb/src/components/stories/viewer.tsx:3150-3313`.
//
// В tweb вьюер не проявляется fade'ом: за 250 ms `cubic-bezier(.4,0,.6,1)`
//   • клон аватарки-источника (32 px, tweb `avatarFrom`) летит из ряда историй
//     в аватарку шапки, уменьшаясь с масштаба `rectFrom.width / 32` до 1;
//   • контейнер активной стори морфит из прямоугольника аватарки в свой бокс
//     (translate3d + scale3d + border-radius 50% → 0%, opacity 0 → 1 к 30 %);
//   • фон и кнопка close проявляются простым opacity 0 → 1;
//   • соседи карусели съезжаются к центру (±60 px на шаг) из масштаба .33/2.
// Закрытие — те же кадры, развёрнутые вручную (в tweb `direction: reverse`
// не используется: Safari лагает, viewer.tsx:3190).
//
// Если аватарки-источника нет (или она уехала из своего скроллера), полёта нет:
// анимируются только сам вьюер и контейнер — opacity 0 → 1 (viewer.tsx:3258-3263).
import getVisibleRect from '../core/dom/getVisibleRect'

/** tweb viewer.tsx:3199-3202 */
const DURATION = 250
const EASING = 'cubic-bezier(0.4, 0.0, 0.6, 1)'
/** tweb STORY_HEADER_AVATAR_SIZE (viewer.tsx:108) */
const STORY_HEADER_AVATAR_SIZE = 32
/** tweb STORY_SCALE_SMALL (viewer.tsx:109) */
const STORY_SCALE_SMALL = 0.33

export interface StoryMorphElements {
  /** `.Viewer` — корень вьюера (tweb аргумент `el`) */
  root: HTMLElement
  /** `.ViewerBackground` */
  background: HTMLElement | null
  /** `.ViewerClose` — в isFull кнопки нет, тогда null */
  closeButton: HTMLElement | null
  /** все `.ViewerStoryContainer` в порядке DOM */
  containers: HTMLElement[]
  /** активный `.ViewerStoryContainer` (tweb getActiveStoryContainer) */
  activeContainer: HTMLElement | null
  /** `.ViewerStoryHeaderAvatar` активного контейнера */
  headerAvatar: HTMLElement | null
  /** клон аватарки, летящий в шапку (tweb `avatarFrom.node`); null — полёта нет */
  flyAvatar: HTMLElement | null
  /** аватарка-источник в ряду историй (tweb `props.target()`) */
  target: Element | null
}

// tweb `liteMode.isAvailable('animations')` (viewer.tsx:3152). У нас тот же гейт
// выражен классом `body.animation-level-2`, который App.tsx переключает по
// настройке reduceMotion (1:1 tweb appImManager.ts:2209-2211).
function animationsAvailable(): boolean {
  return document.body.classList.contains('animation-level-2') &&
    // отступление от tweb: страхуемся от среды без WAAPI (jsdom в тестах) —
    // иначе морф падает и вьюер остаётся заблокированным флагом animating.
    typeof Element.prototype.animate === 'function'
}

/**
 * Проигрывает морф вьюера. `forwards` — открытие, иначе закрытие.
 * Промис резолвится, когда все анимации доиграли (tweb `done()`).
 */
export function animateStoryViewer(el: StoryMorphElements, forwards: boolean): Promise<void> {
  const { root, background, closeButton, containers, activeContainer: container, headerAvatar } = el
  if (!animationsAvailable() || !container) return Promise.resolve()

  // tweb :3159-3185 — цель перечитывается на момент анимации (на закрытии это уже
  // аватарка ТЕКУЩЕГО автора). Если она лежит в скроллере и уехала из него —
  // полёт отменяется вместе с клоном, остаётся простой fade.
  let target = el.target
  let fly = el.flyAvatar
  let needAvatarOpacity = false
  if (target) {
    const overflowElement = target.closest('.scrollable')
    if (overflowElement) {
      const visible = getVisibleRect(target as HTMLElement, overflowElement as HTMLElement)
      if (!visible) {
        target = null
        fly = null
      } else if (fly && (visible.overflow.horizontal || visible.overflow.vertical)) {
        needAvatarOpacity = true
      }
    }
  }

  const rectFrom = target ? (target.querySelector('.avatar') ?? target).getBoundingClientRect() : null
  const rectTo = container.getBoundingClientRect()
  const borderRadius = fly ? '50%' : window.getComputedStyle(container).borderRadius

  // tweb :3191-3197 — кадры разворачиваем руками, а не `direction: reverse`.
  const makeKeyframes = (keyframes: Keyframe[]) => {
    if (!forwards) keyframes.reverse()
    return keyframes
  }

  const options: KeyframeAnimationOptions = { duration: DURATION, easing: EASING }

  // * animate avatar movement (tweb :3206-3234)
  let avatarAnimation: Animation | undefined
  if (fly && rectFrom && headerAvatar) {
    headerAvatar.style.visibility = 'hidden'
    const avatarRectTo = headerAvatar.getBoundingClientRect()
    fly.style.top = `${rectFrom.top}px`
    fly.style.left = `${rectFrom.left}px`
    fly.style.visibility = 'visible'
    const translateX = avatarRectTo.left - rectFrom.left
    const translateY = avatarRectTo.top - rectFrom.top

    const keyframes: Keyframe[] = makeKeyframes([
      { transform: `translate(0, 0) scale(${rectFrom.width / STORY_HEADER_AVATAR_SIZE})` },
      { transform: `translate(${translateX}px, ${translateY}px) scale(1)` },
    ])

    // tweb ставит opacity ПОСЛЕ разворота кадров (viewer.tsx:3228-3231), то есть
    // на закрытии частично скрытая аватарка проявляется, а не гаснет. Оставлено 1:1.
    if (needAvatarOpacity) {
      keyframes[0].opacity = 0
      keyframes[1].opacity = 1
    }

    avatarAnimation = fly.animate(keyframes, options)
  }

  // * animate main container (tweb :3243-3256)
  const containerAnimation = rectFrom && container.animate(makeKeyframes([
    {
      borderRadius,
      transform: `translate3d(${rectFrom.left - window.innerWidth / 2 + rectFrom.width / 2}px, ${rectFrom.top - window.innerHeight / 2 + rectFrom.height / 2}px, 0) scale3d(${rectFrom.width / rectTo.width}, ${rectFrom.height / rectTo.height}, 1)`,
      opacity: 0,
    },
    { opacity: 1, offset: 0.3 },
    { borderRadius: '0%', transform: 'translate3d(0, 0, 0) scale3d(1, 1, 1)' },
  ]), options)

  // * animate simple opacity (tweb :3258-3263)
  const opacityAnimations = (containerAnimation
    ? [background, closeButton].filter((e): e is HTMLElement => !!e)
    : [container, root]
  ).map((element) => element.animate(makeKeyframes([{ opacity: 0 }, { opacity: 1 }]), options))

  // * animate small containers (tweb :3265-3294)
  const rest = containers.slice()
  const activeIndex = rest.indexOf(container)
  rest.splice(activeIndex, 1)
  const before = rest.slice(0, activeIndex)
  const after = rest.slice(activeIndex)
  const animateSmallContainers = (list: HTMLElement[], next: boolean) => {
    if (!rectFrom) {
      return list.map((c) => c.animate(makeKeyframes([{ opacity: 0 }, { opacity: 1 }]), options))
    }

    return list.map((c, idx, arr) => {
      const offsetX = (next ? idx + 1 : arr.length - idx) * 60 * (next ? -1 : 1)
      return c.animate(makeKeyframes([
        {
          transform: `translate3d(calc(var(--translateX) + ${offsetX}px), 0, 0) scale3d(${STORY_SCALE_SMALL / 2}, ${STORY_SCALE_SMALL / 2}, 1)`,
          // fix lag with fractal opacity so element should be prepared for animation
          opacity: 0.001,
        },
        { opacity: 0.001, offset: 0.5 },
        {
          transform: `translate3d(var(--translateX), 0, 0) scale3d(${STORY_SCALE_SMALL}, ${STORY_SCALE_SMALL}, 1)`,
          opacity: 1,
        },
      ]), options)
    })
  }

  const animations: (Animation | undefined | null)[] = [
    ...opacityAnimations,
    containerAnimation,
    avatarAnimation,
    ...animateSmallContainers(before, false),
    ...animateSmallContainers(after, true),
  ]

  return Promise.all(animations.filter((a): a is Animation => !!a).map((a) => a.finished))
    // анимацию могли отменить (размонтирование) — .finished реджектится, это не ошибка
    .catch(() => {})
    .then(() => {
      // отступление от tweb: там клон аватарки удаляется из DOM (viewer.tsx:3304-3307),
      // у нас его рендерит React — просто прячем обратно.
      if (fly) fly.style.visibility = ''
      if (headerAvatar) headerAvatar.style.visibility = ''
    })
}
